import type { JobStatus, Prisma } from '@prisma/client';
import { OfferStatus, UserStatus, VerificationStatus } from '@prisma/client';
import { prisma } from '../../common/prisma';
import { events } from '../../common/events/index';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../common/errors/index';
import { config } from '../../config/index';
import { haversineKm } from '../../common/geo/index';
import { getClock } from '../../common/utils/clock';
import { estimateTravel } from '../dispatch/travel';
import {
  DISPATCH_LOCK_KEY,
  cancelOpenOffers,
  logAttempt,
  offerToTechnician,
} from '../dispatch/dispatch.service';
import { ACTIVE_JOB_STATUSES, publishStatusChange, transitionJob } from '../jobs/lifecycle';
import { getJob } from '../jobs/jobs.service';
import { performanceFor } from '../technicians/performance';
import { isDemoFleetEmail, takeOffline } from '../technicians/technicians.service';
import type { ListTechniciansQuery, ListUsersQuery, VerificationInput } from './admin.dto';

const OPEN_STATUSES: JobStatus[] = ['CREATED', 'MATCHED', ...ACTIVE_JOB_STATUSES];
const ASSIGNABLE: JobStatus[] = ['EXPIRED', 'MATCHED'];
const DAY_MS = 24 * 60 * 60 * 1000;

function now() {
  return new Date(getClock().now());
}

/** Map of technician user id → their current active job, for "busy" flags. */
async function activeJobsByTechnician(userIds?: string[]) {
  const jobs = await prisma.jobRequest.findMany({
    where: {
      status: { in: ACTIVE_JOB_STATUSES },
      technicianId: userIds ? { in: userIds } : { not: null },
    },
    select: { id: true, technicianId: true, status: true },
  });
  return new Map(jobs.map(j => [j.technicianId as string, { id: j.id, status: j.status }]));
}

// ---------------------------------------------------------------------------
// Live operations
// ---------------------------------------------------------------------------

/** Headline numbers for the admin dashboard. */
export async function overview() {
  const since = new Date(getClock().now() - DAY_MS);
  const [
    customers,
    techniciansByVerification,
    online,
    busyJobs,
    openJobs,
    awaitingAssignment,
    last24h,
    completed24h,
    response24h,
  ] = await Promise.all([
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    prisma.technicianProfile.groupBy({ by: ['verificationStatus'], _count: { _all: true } }),
    prisma.technicianProfile.findMany({
      where: { isOnline: true, verificationStatus: 'VERIFIED', user: { status: 'ACTIVE' } },
      select: { userId: true },
    }),
    prisma.jobRequest.findMany({
      where: { status: { in: ACTIVE_JOB_STATUSES } },
      select: { technicianId: true },
      distinct: ['technicianId'],
    }),
    prisma.jobRequest.count({ where: { status: { in: OPEN_STATUSES } } }),
    prisma.jobRequest.count({ where: { status: 'EXPIRED' } }),
    prisma.jobRequest.count({ where: { createdAt: { gte: since } } }),
    prisma.jobRequest.count({ where: { completedAt: { gte: since } } }),
    prisma.jobRequest.aggregate({
      where: { acceptedAt: { gte: since }, responseTimeSecs: { not: null } },
      _avg: { responseTimeSecs: true },
    }),
  ]);

  const byVerification = Object.fromEntries(
    techniciansByVerification.map(g => [g.verificationStatus, g._count._all])
  ) as Partial<Record<VerificationStatus, number>>;
  const busy = new Set(busyJobs.map(j => j.technicianId));
  const onlineIds = online.map(t => t.userId);
  const avgResponse = response24h._avg.responseTimeSecs;

  return {
    customers,
    technicians: {
      total: Object.values(byVerification).reduce((a, b) => a + (b ?? 0), 0),
      verified: byVerification.VERIFIED ?? 0,
      pendingVerification: byVerification.PENDING ?? 0,
      online: onlineIds.length,
      busy: busy.size,
      available: onlineIds.filter(id => !busy.has(id)).length,
    },
    jobs: {
      open: openJobs,
      awaitingAssignment,
      last24h,
      completedLast24h: completed24h,
      avgResponseSecsLast24h: avgResponse == null ? null : Math.round(avgResponse),
    },
  };
}

/** Everything the live map needs: technicians with a position and all open jobs. */
export async function liveMap() {
  const [technicians, jobs] = await Promise.all([
    prisma.technicianProfile.findMany({
      where: {
        verificationStatus: 'VERIFIED',
        user: { status: 'ACTIVE' },
        lastLat: { not: null },
        lastLng: { not: null },
      },
      select: {
        userId: true,
        isOnline: true,
        lastLat: true,
        lastLng: true,
        locationUpdatedAt: true,
        ratingAvg: true,
        user: { select: { name: true, phone: true, email: true } },
        skills: { select: { service: { select: { name: true } } } },
      },
    }),
    prisma.jobRequest.findMany({
      where: { status: { in: [...OPEN_STATUSES, 'EXPIRED'] } },
      select: {
        id: true,
        status: true,
        priority: true,
        lat: true,
        lng: true,
        address: true,
        createdAt: true,
        technicianId: true,
        service: { select: { id: true, name: true, category: true, icon: true } },
        customer: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const activeByTech = new Map(
    jobs
      .filter(j => j.technicianId && ACTIVE_JOB_STATUSES.includes(j.status))
      .map(j => [j.technicianId as string, j.id])
  );

  return {
    technicians: technicians.map(t => ({
      id: t.userId,
      name: t.user.name,
      phone: t.user.phone,
      isOnline: t.isOnline,
      ratingAvg: t.ratingAvg,
      lat: t.lastLat as number,
      lng: t.lastLng as number,
      locationUpdatedAt: t.locationUpdatedAt,
      skills: t.skills.map(s => s.service.name),
      activeJobId: activeByTech.get(t.userId) ?? null,
      simulated: isDemoFleetEmail(t.user.email),
    })),
    jobs: jobs.map(j => ({
      id: j.id,
      status: j.status,
      priority: j.priority,
      lat: j.lat,
      lng: j.lng,
      address: j.address,
      createdAt: j.createdAt,
      service: j.service,
      customerName: j.customer.name,
      technicianId: j.technicianId,
    })),
  };
}

// ---------------------------------------------------------------------------
// Workforce
// ---------------------------------------------------------------------------

export async function listTechnicians(query: ListTechniciansQuery, onlyUserId?: string) {
  const where: Prisma.TechnicianProfileWhereInput = {};
  if (onlyUserId) where.userId = onlyUserId;
  if (query.verification) where.verificationStatus = query.verification;
  if (query.online) where.isOnline = query.online === 'true';
  if (query.q) {
    where.user = {
      OR: [
        { name: { contains: query.q, mode: 'insensitive' } },
        { email: { contains: query.q, mode: 'insensitive' } },
        { phone: { contains: query.q } },
      ],
    };
  }

  const profiles = await prisma.technicianProfile.findMany({
    where,
    include: {
      user: {
        select: { id: true, name: true, email: true, phone: true, status: true, createdAt: true },
      },
      skills: { include: { service: { select: { id: true, name: true, icon: true } } } },
      jobOffers: { where: { status: OfferStatus.PENDING }, select: { jobId: true } },
    },
    orderBy: [{ verificationStatus: 'asc' }, { createdAt: 'desc' }],
    take: 200,
  });

  const userIds = profiles.map(p => p.userId);
  const [active, perf] = await Promise.all([
    activeJobsByTechnician(userIds),
    performanceFor(profiles.map(p => ({ profileId: p.id, userId: p.userId }))),
  ]);

  return profiles.map(p => ({
    id: p.userId,
    profileId: p.id,
    name: p.user.name,
    email: p.user.email,
    phone: p.user.phone,
    accountStatus: p.user.status,
    joinedAt: p.user.createdAt,
    simulated: isDemoFleetEmail(p.user.email),
    verificationStatus: p.verificationStatus,
    rejectionReason: p.rejectionReason,
    isOnline: p.isOnline,
    ratingAvg: p.ratingAvg,
    ratingCount: p.ratingCount,
    completedJobs: p.completedJobs,
    location:
      p.lastLat != null && p.lastLng != null
        ? { lat: p.lastLat, lng: p.lastLng, updatedAt: p.locationUpdatedAt }
        : null,
    skills: p.skills.map(s => s.service),
    activeJob: active.get(p.userId) ?? null,
    pendingOfferJobId: p.jobOffers[0]?.jobId ?? null,
    performance: perf.get(p.userId),
  }));
}

/** Approves or rejects a technician. Rejection takes them offline and declines open offers. */
export async function setVerification(technicianUserId: string, input: VerificationInput) {
  const profile = await prisma.technicianProfile.findUnique({
    where: { userId: technicianUserId },
  });
  if (!profile) throw notFound('TECHNICIAN_NOT_FOUND', 'Technician not found');

  if (input.status === 'REJECTED') {
    const active = await activeJobsByTechnician([technicianUserId]);
    if (active.size > 0) {
      throw conflict(
        'TECHNICIAN_BUSY',
        'This technician is on an active job; wait for it to finish or cancel it first'
      );
    }
    await takeOffline(technicianUserId);
  }

  await prisma.technicianProfile.update({
    where: { id: profile.id },
    data: {
      verificationStatus: input.status,
      rejectionReason: input.status === 'REJECTED' ? input.reason : null,
    },
  });
  const [updated] = await listTechnicians({}, technicianUserId);
  return updated;
}

export async function listUsers(query: ListUsersQuery, onlyUserId?: string) {
  const where: Prisma.UserWhereInput = {};
  if (onlyUserId) where.id = onlyUserId;
  if (query.role) where.role = query.role;
  if (query.status) where.status = query.status;
  if (query.q) {
    where.OR = [
      { name: { contains: query.q, mode: 'insensitive' } },
      { email: { contains: query.q, mode: 'insensitive' } },
      { phone: { contains: query.q } },
    ];
  }
  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      emailVerified: true,
      createdAt: true,
      _count: { select: { customerJobs: true, technicianJobs: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: query.limit,
  });
  return users.map(({ _count, ...u }) => ({
    ...u,
    jobCount: u.role === 'TECHNICIAN' ? _count.technicianJobs : _count.customerJobs,
  }));
}

/**
 * Suspends or reactivates an account. Suspension signs the user out everywhere
 * and, for a technician, takes them offline and declines their open offers.
 */
export async function setUserStatus(
  adminId: string,
  userId: string,
  status: 'ACTIVE' | 'SUSPENDED'
) {
  if (adminId === userId) throw forbidden('SELF_UPDATE', 'You cannot change your own status');
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { technicianProfile: true },
  });
  if (!user) throw notFound('USER_NOT_FOUND', 'User not found');
  if (user.role === 'ADMIN') throw forbidden('ADMIN_PROTECTED', 'Admin accounts cannot be changed');

  if (status === 'SUSPENDED') {
    const open = await prisma.jobRequest.count({
      where:
        user.role === 'TECHNICIAN'
          ? { technicianId: userId, status: { in: ACTIVE_JOB_STATUSES } }
          : { customerId: userId, status: { in: OPEN_STATUSES } },
    });
    if (open > 0) {
      throw conflict(
        'HAS_OPEN_JOBS',
        'This user has open jobs; cancel or finish them before suspending'
      );
    }
    if (user.technicianProfile) {
      await takeOffline(userId);
    }
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { status } }),
    ...(status === 'SUSPENDED'
      ? [
          prisma.refreshToken.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: now() },
          }),
        ]
      : []),
  ]);
  events.publish('user.status_changed', { userId, status });

  const [updated] = await listUsers({ limit: 1 }, userId);
  return updated;
}

// ---------------------------------------------------------------------------
// Manual assignment
// ---------------------------------------------------------------------------

export type GuardLevel = 'ok' | 'warn' | 'confirm';

export interface AssignmentGuard {
  level: GuardLevel;
  distanceKm: number;
  etaMinutes: number;
  locationAgeMins: number | null;
  reasons: string[];
}

/**
 * How risky a manual assignment is for an emergency: a warning beyond the
 * dispatch radius or a 45-minute ETA (or a stale location), and a typed
 * confirmation beyond 40 km or 90 minutes. Never silently a 40-hour ETA.
 */
export function assignmentGuard(
  distanceKm: number,
  etaMinutes: number,
  locationUpdatedAt: Date | null
): AssignmentGuard {
  const { warnKm, warnEtaMins, confirmKm, confirmEtaMins } = config.dispatch.manualGuard;
  const ageMs = locationUpdatedAt ? getClock().now() - locationUpdatedAt.getTime() : null;
  const reasons: string[] = [];
  let level: GuardLevel = 'ok';
  const raise = (to: GuardLevel) => {
    if (to === 'confirm' || (to === 'warn' && level === 'ok')) level = to;
  };

  if (distanceKm > confirmKm) {
    raise('confirm');
    reasons.push(`${distanceKm} km away, beyond the ${confirmKm} km limit for emergencies`);
  } else if (distanceKm > warnKm) {
    raise('warn');
    reasons.push(`${distanceKm} km away, outside the ${warnKm} km emergency radius`);
  }
  if (etaMinutes > confirmEtaMins) {
    raise('confirm');
    reasons.push(`about ${etaMinutes} min to arrive, beyond the ${confirmEtaMins} min limit`);
  } else if (etaMinutes > warnEtaMins) {
    raise('warn');
    reasons.push(`about ${etaMinutes} min to arrive, slower than ${warnEtaMins} min`);
  }
  if (ageMs === null) {
    raise('warn');
    reasons.push('location has never been shared');
  } else if (ageMs > config.dispatch.locationStaleMs) {
    raise('warn');
    reasons.push(`location is ${Math.round(ageMs / 60_000)} min old`);
  }
  return {
    level,
    distanceKm,
    etaMinutes,
    locationAgeMins: ageMs === null ? null : Math.round(ageMs / 60_000),
    reasons,
  };
}

export interface AssignmentConfirmation {
  acknowledgeWarning?: boolean;
  confirmText?: string;
}

function enforceGuard(guard: AssignmentGuard, confirmation: AssignmentConfirmation) {
  if (guard.level === 'confirm' && confirmation.confirmText?.trim().toUpperCase() !== 'ASSIGN') {
    throw new AppError(
      409,
      'TYPED_CONFIRMATION_REQUIRED',
      'This assignment is far outside emergency limits. Type ASSIGN to confirm.',
      undefined,
      { guard }
    );
  }
  if (guard.level === 'warn' && !confirmation.acknowledgeWarning) {
    throw new AppError(
      409,
      'CONFIRMATION_REQUIRED',
      'This assignment is outside emergency limits. Confirm to continue.',
      undefined,
      { guard }
    );
  }
}

/**
 * Technicians an admin can hand a job to: verified, active and skilled in the
 * service, nearest first, each with distance, ETA, location age and the
 * guard level an assignment would trigger. Offline, busy and stale ones are
 * included (flagged) so the admin sees the whole picture.
 */
export async function jobCandidates(jobId: string) {
  const job = await prisma.jobRequest.findUnique({
    where: { id: jobId },
    select: { id: true, lat: true, lng: true, serviceId: true, status: true },
  });
  if (!job) throw notFound('JOB_NOT_FOUND', 'Job not found');

  const profiles = await prisma.technicianProfile.findMany({
    where: {
      verificationStatus: VerificationStatus.VERIFIED,
      user: { status: UserStatus.ACTIVE },
      skills: { some: { serviceId: job.serviceId } },
      lastLat: { not: null },
      lastLng: { not: null },
    },
    select: {
      id: true,
      userId: true,
      isOnline: true,
      ratingAvg: true,
      completedJobs: true,
      lastLat: true,
      lastLng: true,
      locationUpdatedAt: true,
      user: { select: { name: true, phone: true } },
      jobOffers: { where: { status: OfferStatus.PENDING }, select: { jobId: true } },
    },
  });

  const active = await activeJobsByTechnician(profiles.map(p => p.userId));
  const nearest = profiles
    .map(p => ({
      p,
      straightKm: haversineKm({ lat: p.lastLat as number, lng: p.lastLng as number }, job),
    }))
    .sort((a, b) => a.straightKm - b.straightKm)
    .slice(0, 15);

  const travel = await estimateTravel(
    nearest.map(n => ({ lat: n.p.lastLat as number, lng: n.p.lastLng as number })),
    job
  );

  return nearest.map(({ p }, i) => {
    const otherOffer = p.jobOffers.find(o => o.jobId !== job.id);
    const busy = active.has(p.userId);
    const guard = assignmentGuard(travel[i].distanceKm, travel[i].etaMinutes, p.locationUpdatedAt);
    return {
      id: p.userId,
      name: p.user.name,
      phone: p.user.phone,
      isOnline: p.isOnline,
      ratingAvg: p.ratingAvg,
      completedJobs: p.completedJobs,
      location: {
        lat: p.lastLat as number,
        lng: p.lastLng as number,
        updatedAt: p.locationUpdatedAt,
      },
      distanceKm: travel[i].distanceKm,
      etaMinutes: travel[i].etaMinutes,
      busy,
      hasOtherOffer: !!otherOffer,
      // Direct assignment works for anyone free; an offer needs them online to see it.
      assignable: !busy && !otherOffer,
      offerable: !busy && !otherOffer && p.isOnline,
      guard,
    };
  });
}

/** Loads the job, the technician and the guard for a manual action; throws on anything invalid. */
async function prepareManual(jobId: string, technicianUserId: string, allowed: JobStatus[]) {
  const job = await prisma.jobRequest.findUnique({ where: { id: jobId } });
  if (!job) throw notFound('JOB_NOT_FOUND', 'Job not found');
  if (!allowed.includes(job.status)) {
    throw conflict(
      'NOT_ASSIGNABLE',
      'Only jobs waiting for a technician (needs assignment or awaiting acceptance) can be assigned'
    );
  }
  const tech = await prisma.technicianProfile.findUnique({
    where: { userId: technicianUserId },
    include: { user: { select: { name: true, status: true } } },
  });
  if (!tech) throw badRequest('TECHNICIAN_NOT_FOUND', 'Technician not found');
  if (tech.verificationStatus !== 'VERIFIED' || tech.user.status !== 'ACTIVE') {
    throw conflict('TECHNICIAN_UNAVAILABLE', 'Technician must be verified and active');
  }
  if (tech.lastLat == null || tech.lastLng == null) {
    throw conflict('NO_LOCATION', 'This technician has never shared a location');
  }
  const [travel] = await estimateTravel([{ lat: tech.lastLat, lng: tech.lastLng }], job);
  const guard = assignmentGuard(travel.distanceKm, travel.etaMinutes, tech.locationUpdatedAt);
  return { job, tech, travel, guard };
}

/**
 * Default manual action: send the technician the normal 60-second offer.
 * If they decline or let it lapse, auto-dispatch carries on.
 */
export async function offerJob(
  adminId: string,
  jobId: string,
  technicianUserId: string,
  confirmation: AssignmentConfirmation = {}
) {
  const { tech, travel, guard } = await prepareManual(jobId, technicianUserId, [
    'EXPIRED',
    'MATCHED',
    'CREATED',
  ]);
  if (!tech.isOnline) {
    throw conflict(
      'TECHNICIAN_OFFLINE',
      'This technician is offline and will not see an offer. Assign directly if you have spoken to them.'
    );
  }
  enforceGuard(guard, confirmation);
  const admin = await prisma.user.findUniqueOrThrow({
    where: { id: adminId },
    select: { name: true },
  });
  await offerToTechnician(
    jobId,
    {
      technicianId: tech.id,
      userId: technicianUserId,
      name: tech.user.name,
      distanceKm: travel.distanceKm,
      etaMinutes: travel.etaMinutes,
    },
    admin.name
  );
  return getJob(jobId, { id: adminId, role: 'ADMIN' });
}

/**
 * Override: assigns the job straight to a technician (for example one the
 * admin has phoned). For EXPIRED jobs or to replace an open offer. Runs under
 * the dispatch lock so the engine cannot offer the technician another job at
 * the same moment, and is written to the dispatch log with the admin's name.
 */
export async function assignJob(
  adminId: string,
  jobId: string,
  technicianUserId: string,
  confirmation: AssignmentConfirmation = {}
) {
  const { job, tech, travel, guard } = await prepareManual(jobId, technicianUserId, ASSIGNABLE);
  enforceGuard(guard, confirmation);
  const admin = await prisma.user.findUniqueOrThrow({
    where: { id: adminId },
    select: { name: true },
  });

  // Withdraw the open offer first so its holder can no longer accept.
  if (job.status === 'MATCHED') await cancelOpenOffers(jobId);

  const at = now();
  const assigned = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DISPATCH_LOCK_KEY})`;
    const [busy, otherOffer] = await Promise.all([
      tx.jobRequest.count({
        where: { technicianId: technicianUserId, status: { in: ACTIVE_JOB_STATUSES } },
      }),
      tx.jobOffer.count({
        where: { technicianId: tech.id, status: OfferStatus.PENDING, jobId: { not: jobId } },
      }),
    ]);
    if (busy > 0) throw conflict('TECHNICIAN_BUSY', 'Technician is already on another job');
    if (otherOffer > 0) {
      throw conflict('TECHNICIAN_BUSY', 'Technician is currently answering another job offer');
    }

    return transitionJob(tx, {
      jobId,
      from: job.status,
      to: 'ACCEPTED',
      data: {
        technicianId: technicianUserId,
        acceptedAt: at,
        responseTimeSecs: Math.max(0, Math.round((at.getTime() - job.createdAt.getTime()) / 1000)),
      },
      note: `Manually assigned to ${tech.user.name} by ${admin.name}`,
    });
  });
  if (!assigned) {
    throw conflict('JOB_CHANGED', 'The job was updated by someone else, please refresh');
  }

  await logAttempt(jobId, {
    radiusKm: job.dispatchRadiusKm,
    outcome: 'MANUAL_ASSIGN',
    offeredTechnicianId: technicianUserId,
    note:
      `${admin.name} assigned ${tech.user.name} directly, ${travel.distanceKm} km away (~${travel.etaMinutes} min)` +
      (guard.level !== 'ok' ? `; confirmed despite: ${guard.reasons.join('; ')}` : ''),
  });
  publishStatusChange(assigned, job.status);
  return getJob(jobId, { id: adminId, role: 'ADMIN' });
}
