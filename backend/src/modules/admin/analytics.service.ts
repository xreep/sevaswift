import { prisma } from '../../common/prisma';
import { config } from '../../config/index';
import { getClock } from '../../common/utils/clock';
import { performanceFor } from '../technicians/performance';

const DAY_MS = 24 * 60 * 60 * 1000;

const round = (n: number | null | undefined, digits = 1) => {
  if (n == null || Number.isNaN(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};
const ratio = (part: number, whole: number) => (whole > 0 ? round(part / whole, 3) : null);

interface Window {
  from: Date;
  to: Date;
}

function windowFor(days: number): Window {
  const to = new Date(getClock().now());
  return { from: new Date(to.getTime() - days * DAY_MS), to };
}

/** Local calendar days (YYYY-MM-DD) covered by the window, in the report time zone. */
function daysIn({ from, to }: Window): string[] {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.reportTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const days = new Set<string>();
  // Stepping by 6h and de-duplicating stays correct across DST changes.
  for (let t = from.getTime(); t <= to.getTime(); t += 6 * 60 * 60 * 1000) {
    days.add(fmt.format(new Date(t)));
  }
  days.add(fmt.format(to));
  return [...days].sort();
}

interface Interval {
  start: number;
  end: number;
}

function overlapMs(a: Interval, b: Interval) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/**
 * Technician utilization over a window: time spent on jobs (accepted until
 * completed or cancelled) divided by time spent online, from AvailabilityLog.
 * Technicians with no log at all are assumed to have held their current state.
 */
export async function utilization({ from, to }: Window) {
  const profiles = await prisma.technicianProfile.findMany({
    where: { verificationStatus: 'VERIFIED' },
    select: { id: true, userId: true, isOnline: true },
  });
  if (profiles.length === 0) return { fleet: null, byTechnician: new Map<string, number | null>() };
  const profileIds = profiles.map(p => p.id);

  const [before, during, jobs] = await Promise.all([
    prisma.$queryRaw<{ technicianId: string; isOnline: boolean }[]>`
      SELECT DISTINCT ON ("technicianId") "technicianId", "isOnline"
      FROM "AvailabilityLog"
      WHERE "technicianId" = ANY(${profileIds}) AND at < ${from}
      ORDER BY "technicianId", at DESC`,
    prisma.availabilityLog.findMany({
      where: { technicianId: { in: profileIds }, at: { gte: from, lt: to } },
      select: { technicianId: true, isOnline: true, at: true },
      orderBy: { at: 'asc' },
    }),
    prisma.jobRequest.findMany({
      where: {
        technicianId: { in: profiles.map(p => p.userId) },
        acceptedAt: { not: null, lt: to },
        OR: [
          { completedAt: { gt: from } },
          { cancelledAt: { gt: from } },
          { completedAt: null, cancelledAt: null },
        ],
      },
      select: { technicianId: true, acceptedAt: true, completedAt: true, cancelledAt: true },
    }),
  ]);

  const initial = new Map(before.map(b => [b.technicianId, b.isOnline]));
  const logsByTech = new Map<string, { isOnline: boolean; at: Date }[]>();
  for (const log of during) {
    const list = logsByTech.get(log.technicianId) ?? [];
    list.push(log);
    logsByTech.set(log.technicianId, list);
  }

  const window: Interval = { start: from.getTime(), end: to.getTime() };
  const onlineMs = new Map<string, number>();
  for (const p of profiles) {
    const logs = logsByTech.get(p.id) ?? [];
    let state = initial.get(p.id) ?? (logs.length > 0 ? !logs[0].isOnline : p.isOnline);
    let cursor = window.start;
    let total = 0;
    for (const log of logs) {
      if (state) total += log.at.getTime() - cursor;
      state = log.isOnline;
      cursor = log.at.getTime();
    }
    if (state) total += window.end - cursor;
    onlineMs.set(p.userId, total);
  }

  const busyMs = new Map<string, number>();
  for (const job of jobs) {
    const end = (job.completedAt ?? job.cancelledAt ?? to).getTime();
    const busy = overlapMs({ start: (job.acceptedAt as Date).getTime(), end }, window);
    const id = job.technicianId as string;
    busyMs.set(id, (busyMs.get(id) ?? 0) + busy);
  }

  let fleetOnline = 0;
  let fleetBusy = 0;
  const byTechnician = new Map<string, number | null>();
  for (const p of profiles) {
    const online = onlineMs.get(p.userId) ?? 0;
    const busy = Math.min(busyMs.get(p.userId) ?? 0, online);
    fleetOnline += online;
    fleetBusy += busy;
    byTechnician.set(p.userId, online > 0 ? round(busy / online, 3) : null);
  }
  return { fleet: fleetOnline > 0 ? round(fleetBusy / fleetOnline, 3) : null, byTechnician };
}

async function jobSummary({ from, to }: Window) {
  const [row] = await prisma.$queryRaw<
    {
      total: number;
      completed: number;
      cancelled: number;
      expired: number;
      open: number;
      urgent: number;
      avgResponseSecs: number | null;
      p90ResponseSecs: number | null;
      avgArrivalMins: number | null;
      avgResolutionMins: number | null;
      avgServiceMins: number | null;
    }[]
  >`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
      COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
      COUNT(*) FILTER (WHERE status = 'EXPIRED')::int AS expired,
      COUNT(*) FILTER (WHERE status IN ('CREATED','MATCHED','ACCEPTED','EN_ROUTE','ARRIVED','IN_PROGRESS'))::int AS open,
      COUNT(*) FILTER (WHERE priority = 'URGENT')::int AS urgent,
      AVG("responseTimeSecs")::float8 AS "avgResponseSecs",
      (percentile_cont(0.9) WITHIN GROUP (ORDER BY "responseTimeSecs"))::float8 AS "p90ResponseSecs",
      (AVG(EXTRACT(EPOCH FROM ("arrivedAt" - "acceptedAt")) / 60)
        FILTER (WHERE "arrivedAt" IS NOT NULL AND "acceptedAt" IS NOT NULL))::float8 AS "avgArrivalMins",
      (AVG(EXTRACT(EPOCH FROM ("completedAt" - "createdAt")) / 60)
        FILTER (WHERE status = 'COMPLETED'))::float8 AS "avgResolutionMins",
      (AVG(EXTRACT(EPOCH FROM ("completedAt" - "arrivedAt")) / 60)
        FILTER (WHERE status = 'COMPLETED' AND "arrivedAt" IS NOT NULL))::float8 AS "avgServiceMins"
    FROM "JobRequest"
    WHERE "createdAt" >= ${from} AND "createdAt" < ${to}`;
  return row;
}

/** Operational analytics for the last `days` days, with the previous period for comparison. */
export async function analytics(days: number) {
  const current = windowFor(days);
  const previous = { from: new Date(current.from.getTime() - days * DAY_MS), to: current.from };
  const { from, to } = current;
  const tz = config.reportTimezone;

  const [
    summary,
    prevSummary,
    dispatchRow,
    offerRow,
    csatRow,
    daily,
    hourly,
    byService,
    byPriority,
    util,
    technicians,
  ] = await Promise.all([
    jobSummary(current),
    jobSummary(previous),
    prisma.$queryRaw<{ acceptedJobs: number; autoAssigned: number; firstOfferAccepted: number }[]>`
      SELECT
        COUNT(*)::int AS "acceptedJobs",
        COUNT(o.id)::int AS "autoAssigned",
        (COUNT(o.id) FILTER (WHERE o.round = 1))::int AS "firstOfferAccepted"
      FROM "JobRequest" j
      LEFT JOIN "JobOffer" o ON o."jobId" = j.id AND o.status = 'ACCEPTED'
      WHERE j."createdAt" >= ${from} AND j."createdAt" < ${to} AND j."acceptedAt" IS NOT NULL`,
    prisma.$queryRaw<{ answered: number; accepted: number; avgOfferEtaMins: number | null }[]>`
      SELECT
        (COUNT(*) FILTER (WHERE status IN ('ACCEPTED','REJECTED','EXPIRED')))::int AS answered,
        (COUNT(*) FILTER (WHERE status = 'ACCEPTED'))::int AS accepted,
        (AVG("etaMinutes") FILTER (WHERE status = 'ACCEPTED'))::float8 AS "avgOfferEtaMins"
      FROM "JobOffer"
      WHERE "offeredAt" >= ${from} AND "offeredAt" < ${to}`,
    prisma.$queryRaw<{ count: number; avg: number | null; positive: number }[]>`
      SELECT COUNT(*)::int AS count, AVG(rating)::float8 AS avg,
        (COUNT(*) FILTER (WHERE rating >= 4))::int AS positive
      FROM "Review"
      WHERE "createdAt" >= ${from} AND "createdAt" < ${to}`,
    prisma.$queryRaw<
      {
        day: string;
        requests: number;
        completed: number;
        unfulfilled: number;
        avgResponseSecs: number | null;
      }[]
    >`
      SELECT
        to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS requests,
        (COUNT(*) FILTER (WHERE status = 'COMPLETED'))::int AS completed,
        (COUNT(*) FILTER (WHERE status IN ('CANCELLED','EXPIRED')))::int AS unfulfilled,
        AVG("responseTimeSecs")::float8 AS "avgResponseSecs"
      FROM "JobRequest"
      WHERE "createdAt" >= ${from} AND "createdAt" < ${to}
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ hour: number; requests: number; avgResponseSecs: number | null }[]>`
      SELECT
        EXTRACT(HOUR FROM ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::int AS hour,
        COUNT(*)::int AS requests,
        AVG("responseTimeSecs")::float8 AS "avgResponseSecs"
      FROM "JobRequest"
      WHERE "createdAt" >= ${from} AND "createdAt" < ${to}
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<
      {
        serviceId: string;
        name: string;
        icon: string | null;
        requests: number;
        completed: number;
        avgResponseSecs: number | null;
      }[]
    >`
      SELECT s.id AS "serviceId", s.name, s.icon,
        COUNT(j.id)::int AS requests,
        (COUNT(j.id) FILTER (WHERE j.status = 'COMPLETED'))::int AS completed,
        AVG(j."responseTimeSecs")::float8 AS "avgResponseSecs"
      FROM "JobRequest" j JOIN "Service" s ON s.id = j."serviceId"
      WHERE j."createdAt" >= ${from} AND j."createdAt" < ${to}
      GROUP BY s.id, s.name, s.icon
      ORDER BY requests DESC`,
    prisma.$queryRaw<{ priority: string; requests: number; avgResponseSecs: number | null }[]>`
      SELECT priority::text AS priority, COUNT(*)::int AS requests,
        AVG("responseTimeSecs")::float8 AS "avgResponseSecs"
      FROM "JobRequest"
      WHERE "createdAt" >= ${from} AND "createdAt" < ${to}
      GROUP BY 1`,
    utilization(current),
    prisma.technicianProfile.findMany({
      where: { verificationStatus: 'VERIFIED' },
      select: { id: true, userId: true, user: { select: { name: true } } },
    }),
  ]);

  const perf = await performanceFor(
    technicians.map(t => ({ profileId: t.id, userId: t.userId })),
    from
  );
  const leaderboard = technicians
    .map(t => ({
      id: t.userId,
      name: t.user.name,
      utilization: util.byTechnician.get(t.userId) ?? null,
      ...(perf.get(t.userId) as NonNullable<ReturnType<typeof perf.get>>),
    }))
    .filter(t => t.completedJobs > 0 || t.offersAnswered > 0)
    .sort(
      (a, b) =>
        b.completedJobs - a.completedJobs ||
        (b.avgRating ?? 0) - (a.avgRating ?? 0) ||
        a.name.localeCompare(b.name)
    )
    .slice(0, 10);

  const dailyByDay = new Map(daily.map(d => [d.day, d]));
  const hourlyByHour = new Map(hourly.map(h => [h.hour, h]));
  const closed = summary.completed + summary.cancelled + summary.expired;
  const dispatch = dispatchRow[0];
  const offers = offerRow[0];
  const csat = csatRow[0];
  const avgResponse = round(summary.avgResponseSecs, 0);
  const prevAvgResponse = round(prevSummary.avgResponseSecs, 0);

  return {
    range: { days, from, to, timezone: tz },
    kpis: {
      requests: summary.total,
      urgentRequests: summary.urgent,
      completed: summary.completed,
      cancelled: summary.cancelled,
      expired: summary.expired,
      open: summary.open,
      completionRate: ratio(summary.completed, closed),
      avgResponseSecs: avgResponse,
      p90ResponseSecs: round(summary.p90ResponseSecs, 0),
      prevAvgResponseSecs: prevAvgResponse,
      // Negative = faster than the previous period.
      responseTimeChange:
        avgResponse != null && prevAvgResponse
          ? round((avgResponse - prevAvgResponse) / prevAvgResponse, 3)
          : null,
      avgArrivalMins: round(summary.avgArrivalMins),
      avgServiceMins: round(summary.avgServiceMins),
      avgResolutionMins: round(summary.avgResolutionMins),
      utilization: util.fleet,
      // Share of auto-dispatched jobs accepted by the engine's first choice.
      dispatchAccuracy: ratio(dispatch.firstOfferAccepted, dispatch.autoAssigned),
      autoAssignRate: ratio(dispatch.autoAssigned, dispatch.acceptedJobs),
      offerAcceptanceRate: ratio(offers.accepted, offers.answered),
      avgOfferEtaMins: round(offers.avgOfferEtaMins),
      csat: {
        avgRating: round(csat.avg, 2),
        ratings: csat.count,
        positiveShare: ratio(csat.positive, csat.count),
      },
    },
    daily: daysIn(current).map(day => {
      const d = dailyByDay.get(day);
      return {
        day,
        requests: d?.requests ?? 0,
        completed: d?.completed ?? 0,
        unfulfilled: d?.unfulfilled ?? 0,
        avgResponseSecs: round(d?.avgResponseSecs, 0),
      };
    }),
    hourly: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      requests: hourlyByHour.get(hour)?.requests ?? 0,
      avgResponseSecs: round(hourlyByHour.get(hour)?.avgResponseSecs, 0),
    })),
    byService: byService.map(s => ({
      ...s,
      completionRate: ratio(s.completed, s.requests),
      avgResponseSecs: round(s.avgResponseSecs, 0),
    })),
    byPriority: byPriority.map(p => ({ ...p, avgResponseSecs: round(p.avgResponseSecs, 0) })),
    technicians: leaderboard,
  };
}

function csvCell(value: unknown): string {
  if (value == null) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Service history for the window as CSV (one row per request). */
export async function jobsCsv(days: number): Promise<string> {
  const { from, to } = windowFor(days);
  const jobs = await prisma.jobRequest.findMany({
    where: { createdAt: { gte: from, lt: to } },
    include: {
      service: { select: { name: true } },
      customer: { select: { name: true, email: true } },
      technician: { select: { name: true } },
      review: { select: { rating: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const header = [
    'Request ID',
    'Created',
    'Service',
    'Priority',
    'Status',
    'Customer',
    'Customer email',
    'Address',
    'Technician',
    'Dispatch rounds',
    'Response time (s)',
    'Accepted',
    'Arrived',
    'Completed',
    'Cancelled',
    'Rating',
  ];
  const rows = jobs.map(j => [
    j.id,
    j.createdAt,
    j.service.name,
    j.priority,
    j.status,
    j.customer.name,
    j.customer.email,
    j.address,
    j.technician?.name,
    j.dispatchRounds,
    j.responseTimeSecs,
    j.acceptedAt,
    j.arrivedAt,
    j.completedAt,
    j.cancelledAt,
    j.review?.rating,
  ]);
  return [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
