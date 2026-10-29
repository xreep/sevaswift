import { prisma } from '../../common/prisma';

export interface TechnicianPerformance {
  /** Offers that reached a decision (accepted, rejected or timed out). */
  offersAnswered: number;
  offersAccepted: number;
  offersRejected: number;
  offersExpired: number;
  /** Accepted ÷ answered offers, 0–1; null without offers. */
  acceptanceRate: number | null;
  /** Average seconds from offer to accept. */
  avgAcceptSecs: number | null;
  completedJobs: number;
  /** Average minutes from accepting to arriving at the customer. */
  avgArrivalMins: number | null;
  /** Average minutes from arriving to completing the job. */
  avgServiceMins: number | null;
  avgRating: number | null;
  ratingCount: number;
}

const round1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

function empty(): TechnicianPerformance {
  return {
    offersAnswered: 0,
    offersAccepted: 0,
    offersRejected: 0,
    offersExpired: 0,
    acceptanceRate: null,
    avgAcceptSecs: null,
    completedJobs: 0,
    avgArrivalMins: null,
    avgServiceMins: null,
    avgRating: null,
    ratingCount: 0,
  };
}

/**
 * Performance figures for the given technicians since a point in time,
 * keyed by technician user id. Aggregated in SQL so it scales with job volume.
 */
export async function performanceFor(
  technicians: { profileId: string; userId: string }[],
  since: Date = new Date(0)
): Promise<Map<string, TechnicianPerformance>> {
  const result = new Map<string, TechnicianPerformance>();
  if (technicians.length === 0) return result;
  for (const t of technicians) result.set(t.userId, empty());

  const profileIds = technicians.map(t => t.profileId);
  const userIds = technicians.map(t => t.userId);
  const userByProfile = new Map(technicians.map(t => [t.profileId, t.userId]));

  const [offers, jobs, ratings] = await Promise.all([
    prisma.$queryRaw<
      {
        technicianId: string;
        accepted: number;
        rejected: number;
        expired: number;
        avgAcceptSecs: number | null;
      }[]
    >`
      SELECT "technicianId",
        COUNT(*) FILTER (WHERE status = 'ACCEPTED')::int AS accepted,
        COUNT(*) FILTER (WHERE status = 'REJECTED')::int AS rejected,
        COUNT(*) FILTER (WHERE status = 'EXPIRED')::int AS expired,
        AVG(EXTRACT(EPOCH FROM ("respondedAt" - "offeredAt")))
          FILTER (WHERE status = 'ACCEPTED')::float8 AS "avgAcceptSecs"
      FROM "JobOffer"
      WHERE "technicianId" = ANY(${profileIds}) AND "offeredAt" >= ${since}
      GROUP BY "technicianId"`,
    prisma.$queryRaw<
      {
        technicianId: string;
        completed: number;
        avgArrivalMins: number | null;
        avgServiceMins: number | null;
      }[]
    >`
      SELECT "technicianId",
        COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
        AVG(EXTRACT(EPOCH FROM ("arrivedAt" - "acceptedAt")) / 60)
          FILTER (WHERE "arrivedAt" IS NOT NULL AND "acceptedAt" IS NOT NULL)::float8 AS "avgArrivalMins",
        AVG(EXTRACT(EPOCH FROM ("completedAt" - "arrivedAt")) / 60)
          FILTER (WHERE status = 'COMPLETED' AND "arrivedAt" IS NOT NULL)::float8 AS "avgServiceMins"
      FROM "JobRequest"
      WHERE "technicianId" = ANY(${userIds}) AND "createdAt" >= ${since}
      GROUP BY "technicianId"`,
    prisma.$queryRaw<{ technicianId: string; avgRating: number; ratingCount: number }[]>`
      SELECT j."technicianId", AVG(r.rating)::float8 AS "avgRating", COUNT(*)::int AS "ratingCount"
      FROM "Review" r JOIN "JobRequest" j ON j.id = r."jobId"
      WHERE j."technicianId" = ANY(${userIds}) AND r."createdAt" >= ${since}
      GROUP BY j."technicianId"`,
  ]);

  for (const o of offers) {
    const perf = result.get(userByProfile.get(o.technicianId) as string);
    if (!perf) continue;
    const answered = o.accepted + o.rejected + o.expired;
    Object.assign(perf, {
      offersAnswered: answered,
      offersAccepted: o.accepted,
      offersRejected: o.rejected,
      offersExpired: o.expired,
      acceptanceRate: answered > 0 ? Math.round((o.accepted / answered) * 1000) / 1000 : null,
      avgAcceptSecs: o.avgAcceptSecs == null ? null : Math.round(o.avgAcceptSecs),
    });
  }
  for (const j of jobs) {
    const perf = result.get(j.technicianId);
    if (!perf) continue;
    perf.completedJobs = j.completed;
    perf.avgArrivalMins = round1(j.avgArrivalMins);
    perf.avgServiceMins = round1(j.avgServiceMins);
  }
  for (const r of ratings) {
    const perf = result.get(r.technicianId);
    if (!perf) continue;
    perf.avgRating = Math.round(r.avgRating * 100) / 100;
    perf.ratingCount = r.ratingCount;
  }
  return result;
}
