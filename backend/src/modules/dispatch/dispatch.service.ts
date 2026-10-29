import type { JobOffer, JobRequest, JobStatus, Prisma } from '@prisma/client';
import { OfferStatus, UserStatus, VerificationStatus } from '@prisma/client';
import { config } from '../../config/index';
import { prisma } from '../../common/prisma';
import { events } from '../../common/events/index';
import { conflict, notFound } from '../../common/errors/index';
import { estimateMinutes, haversineKm } from '../../common/geo/index';
import { getClock } from '../../common/utils/clock';
import { ACTIVE_JOB_STATUSES, publishStatusChange, transitionJob } from '../jobs/lifecycle';
import { rankCandidates } from './ranking';
import { cancelOfferExpiry, scheduleOfferExpiry } from './scheduler';
import { estimateTravel } from './travel';

/** Serializes offer creation so one technician never holds two pending offers. */
export const DISPATCH_LOCK_KEY = 7_340_001;

/** At most this many nearest technicians are sent to the routing API per round. */
const MAX_ROUTED_CANDIDATES = 10;

const DISPATCHABLE: JobStatus[] = ['CREATED', 'MATCHED'];
/** Statuses an offer can be made from (EXPIRED only by an admin). */
const OFFERABLE: JobStatus[] = ['CREATED', 'MATCHED', 'EXPIRED'];

export interface Candidate {
  technicianId: string;
  userId: string;
  name: string;
  ratingAvg: number;
  lat: number;
  lng: number;
  straightKm: number;
  distanceKm: number;
  etaMinutes: number;
}

/** Every technician looked at for a job, with the reason they were passed over (null = eligible). */
export interface ConsideredTechnician {
  technicianId: string;
  name: string;
  distanceKm: number;
  etaMinutes: number;
  reason: string | null;
}

export type DispatchOutcome =
  | { outcome: 'OFFERED'; offer: JobOffer; candidate: Candidate }
  | { outcome: 'EXPIRED'; reason: string }
  | { outcome: 'SKIPPED' };

function now() {
  return new Date(getClock().now());
}

/** Technicians examined per attempt and kept in the log (nearest first). */
const MAX_LOGGED = 25;

/**
 * Looks at every technician with a known location around the job (out to 1.5x
 * the radius, so "just outside" shows up in the log) and records why each one
 * can or cannot take it. Eligible ones are ranked by fastest arrival.
 */
export async function evaluateCandidates(
  job: Pick<JobRequest, 'lat' | 'lng' | 'serviceId'>,
  radiusKm: number,
  triedTechnicianIds: string[] = []
): Promise<{ ranked: Candidate[]; considered: ConsideredTechnician[] }> {
  const searchKm = radiusKm * 1.5;
  const latDelta = searchKm / 111;
  const lngDelta = searchKm / (111 * Math.max(Math.cos((job.lat * Math.PI) / 180), 0.01));
  const at = getClock().now();

  const profiles = await prisma.technicianProfile.findMany({
    where: {
      lastLat: { gte: job.lat - latDelta, lte: job.lat + latDelta },
      lastLng: { gte: job.lng - lngDelta, lte: job.lng + lngDelta },
    },
    select: {
      id: true,
      userId: true,
      ratingAvg: true,
      isOnline: true,
      verificationStatus: true,
      lastLat: true,
      lastLng: true,
      locationUpdatedAt: true,
      user: { select: { name: true, status: true } },
      skills: { where: { serviceId: job.serviceId }, select: { id: true } },
      jobOffers: { where: { status: OfferStatus.PENDING }, select: { jobId: true } },
    },
  });

  const busy = new Set(
    (
      await prisma.jobRequest.findMany({
        where: {
          technicianId: { in: profiles.map(t => t.userId) },
          status: { in: ACTIVE_JOB_STATUSES },
        },
        select: { technicianId: true },
      })
    ).map(b => b.technicianId)
  );
  const tried = new Set(triedTechnicianIds);
  const { locationStaleMs, averageSpeedKmph } = config.dispatch;

  const examined = profiles
    .map(t => {
      const lat = t.lastLat as number;
      const lng = t.lastLng as number;
      const straightKm = haversineKm({ lat, lng }, job);
      const ageMs = t.locationUpdatedAt ? at - t.locationUpdatedAt.getTime() : Infinity;
      let reason: string | null = null;
      if (t.verificationStatus !== VerificationStatus.VERIFIED) reason = 'not verified';
      else if (t.user.status !== UserStatus.ACTIVE) reason = 'account suspended';
      else if (!t.isOnline) reason = 'offline';
      else if (t.skills.length === 0) reason = 'no matching skill';
      else if (ageMs > locationStaleMs) {
        reason = Number.isFinite(ageMs)
          ? `location stale (${Math.round(ageMs / 60_000)} min old)`
          : 'location never shared';
      } else if (straightKm > radiusKm) reason = `outside ${radiusKm} km`;
      else if (busy.has(t.userId)) reason = 'on another job';
      else if (tried.has(t.id)) reason = 'already offered this job';
      else if (t.jobOffers.length > 0) reason = 'answering another offer';
      return { t, lat, lng, straightKm, reason };
    })
    .filter(e => e.straightKm <= searchKm)
    .sort((a, b) => a.straightKm - b.straightKm);

  const nearest = examined.filter(e => e.reason === null).slice(0, MAX_ROUTED_CANDIDATES);
  const travel = await estimateTravel(nearest, job);
  const candidates = nearest.map((e, i) => ({
    technicianId: e.t.id,
    userId: e.t.userId,
    name: e.t.user.name,
    ratingAvg: e.t.ratingAvg,
    lat: e.lat,
    lng: e.lng,
    straightKm: e.straightKm,
    distanceKm: travel[i].distanceKm,
    etaMinutes: travel[i].etaMinutes,
  }));
  const travelById = new Map(candidates.map(c => [c.technicianId, c]));

  const considered = examined.slice(0, MAX_LOGGED).map(e => {
    const routed = travelById.get(e.t.id);
    return {
      technicianId: e.t.userId,
      name: e.t.user.name,
      distanceKm: routed?.distanceKm ?? Math.round(e.straightKm * 100) / 100,
      etaMinutes: routed?.etaMinutes ?? estimateMinutes(e.straightKm, averageSpeedKmph),
      reason: e.reason,
    };
  });

  return { ranked: rankCandidates(candidates, radiusKm), considered };
}

/** Eligible technicians for a job within a radius, fastest arrival first. */
export async function findCandidates(
  job: Pick<JobRequest, 'lat' | 'lng' | 'serviceId'>,
  excludeTechnicianIds: string[] = [],
  radiusKm: number = config.dispatch.radiusKm
): Promise<Candidate[]> {
  return (await evaluateCandidates(job, radiusKm, excludeTechnicianIds)).ranked;
}

export async function logAttempt(
  jobId: string,
  entry: {
    radiusKm: number;
    outcome: string;
    candidates?: ConsideredTechnician[];
    offeredTechnicianId?: string | null;
    note?: string;
  }
) {
  await prisma.dispatchAttempt.create({
    data: {
      jobId,
      radiusKm: entry.radiusKm,
      outcome: entry.outcome,
      candidates: (entry.candidates ?? []) as unknown as Prisma.InputJsonValue,
      offeredTechnicianId: entry.offeredTechnicianId ?? null,
      note: entry.note,
      at: now(),
    },
  });
  events.publish('job.dispatch_updated', { jobId });
}

async function expireJob(jobId: string, from: JobStatus, reason: string): Promise<DispatchOutcome> {
  const job = await prisma.$transaction(tx =>
    transitionJob(tx, { jobId, from, to: 'EXPIRED', note: reason })
  );
  if (!job) return { outcome: 'SKIPPED' };
  publishStatusChange(job, from);
  return { outcome: 'EXPIRED', reason };
}

/** Creates an offer for one technician under the dispatch lock; null if they became unavailable. */
async function createOffer(
  job: Pick<JobRequest, 'id'>,
  candidate: Pick<Candidate, 'technicianId' | 'userId' | 'name' | 'distanceKm' | 'etaMinutes'>,
  radiusKm: number,
  note: string
) {
  const offeredAt = now();
  const expiresAt = new Date(offeredAt.getTime() + config.dispatch.offerTimeoutSeconds * 1000);

  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DISPATCH_LOCK_KEY})`;

    const fresh = await tx.jobRequest.findUnique({
      where: { id: job.id },
      select: {
        status: true,
        dispatchRounds: true,
        offers: { where: { status: OfferStatus.PENDING }, select: { id: true } },
      },
    });
    if (!fresh || !OFFERABLE.includes(fresh.status) || fresh.offers.length > 0) return null;

    // Re-check under the lock: the technician may have been offered or assigned another job meanwhile.
    const [pending, active] = await Promise.all([
      tx.jobOffer.count({
        where: { technicianId: candidate.technicianId, status: OfferStatus.PENDING },
      }),
      tx.jobRequest.count({
        where: { technicianId: candidate.userId, status: { in: ACTIVE_JOB_STATUSES } },
      }),
    ]);
    if (pending > 0 || active > 0) return 'BUSY' as const;

    const round = fresh.dispatchRounds + 1;
    const offer = await tx.jobOffer.create({
      data: {
        jobId: job.id,
        technicianId: candidate.technicianId,
        round,
        radiusKm,
        distanceKm: candidate.distanceKm,
        etaMinutes: candidate.etaMinutes,
        offeredAt,
        expiresAt,
      },
    });

    let matched: JobRequest | null = null;
    if (fresh.status === 'MATCHED') {
      await tx.jobRequest.update({
        where: { id: job.id },
        data: { dispatchRounds: round, dispatchRadiusKm: radiusKm },
      });
    } else {
      matched = await transitionJob(tx, {
        jobId: job.id,
        from: fresh.status,
        to: 'MATCHED',
        data: { dispatchRounds: round, dispatchRadiusKm: radiusKm },
        note,
      });
    }
    return { offer, matched, from: fresh.status };
  });
}

function announceOffer(
  jobId: string,
  created: { offer: JobOffer; matched: JobRequest | null; from: JobStatus },
  technicianUserId: string
) {
  if (created.matched) publishStatusChange(created.matched, created.from);
  scheduleOfferExpiry(created.offer.id, created.offer.expiresAt, () =>
    expireOffer(created.offer.id)
  );
  events.publish('job.offered', {
    jobId,
    offerId: created.offer.id,
    technicianUserId,
    expiresAt: created.offer.expiresAt,
  });
}

/**
 * Offers the job to the best available technician. Called when a job is
 * created and again whenever an offer is rejected or times out. Within each
 * radius step up to MAX_DISPATCH_ROUNDS offers are made; then the search
 * widens to the next step (15 -> 25 -> 40 km by default). When the last step
 * is used up the job becomes EXPIRED and waits for an admin. Every decision is
 * written to the dispatch log.
 */
export async function dispatchJob(jobId: string): Promise<DispatchOutcome> {
  const job = await prisma.jobRequest.findUnique({
    where: { id: jobId },
    include: { offers: { select: { technicianId: true, status: true, radiusKm: true } } },
  });
  if (!job || !DISPATCHABLE.includes(job.status)) return { outcome: 'SKIPPED' };
  if (job.offers.some(o => o.status === OfferStatus.PENDING)) return { outcome: 'SKIPPED' };

  const steps = config.dispatch.radiusStepsKm;
  const { maxRounds } = config.dispatch;
  let stepIndex = Math.max(
    0,
    steps.findIndex(km => km >= job.dispatchRadiusKm)
  );
  const tried = job.offers.map(o => o.technicianId);

  for (;;) {
    const radiusKm = steps[stepIndex];
    const offersInStep = job.offers.filter(o => o.radiusKm === radiusKm).length;

    if (offersInStep < maxRounds) {
      const { ranked, considered } = await evaluateCandidates(job, radiusKm, tried);
      for (const candidate of ranked) {
        const created = await createOffer(
          job,
          candidate,
          radiusKm,
          `Offered to ${candidate.name} (${candidate.distanceKm} km, ~${candidate.etaMinutes} min)`
        );
        if (created === null) return { outcome: 'SKIPPED' };
        if (created === 'BUSY') continue;
        await logAttempt(job.id, {
          radiusKm,
          outcome: 'OFFERED',
          candidates: considered,
          offeredTechnicianId: candidate.userId,
          note: `Offered to ${candidate.name}, ${candidate.distanceKm} km away (~${candidate.etaMinutes} min)`,
        });
        announceOffer(job.id, created, candidate.userId);
        return { outcome: 'OFFERED', offer: created.offer, candidate };
      }
      await logAttempt(job.id, {
        radiusKm,
        outcome: 'NO_CANDIDATES',
        candidates: considered,
        note: `No free technician within ${radiusKm} km`,
      });
    }

    if (stepIndex + 1 < steps.length) {
      stepIndex += 1;
      const next = steps[stepIndex];
      await prisma.jobRequest.update({ where: { id: job.id }, data: { dispatchRadiusKm: next } });
      await logAttempt(job.id, {
        radiusKm: next,
        outcome: 'RADIUS_EXPANDED',
        note: `Search widened from ${radiusKm} km to ${next} km`,
      });
      continue;
    }

    const offered = job.offers.length;
    const reason =
      offered > 0
        ? `No technician accepted after ${offered} offer${offered > 1 ? 's' : ''} within ${radiusKm} km`
        : `No available technician within ${radiusKm} km`;
    await logAttempt(job.id, { radiusKm, outcome: 'EXHAUSTED', note: reason });
    return expireJob(job.id, job.status, reason);
  }
}

/**
 * An admin offers the job to one technician (the default for manual
 * assignment): the same 60-second offer, the same accept/decline, and if it
 * lapses auto-dispatch carries on. Works for jobs waiting for a technician
 * (EXPIRED) and to replace an open offer (MATCHED).
 */
export async function offerToTechnician(
  jobId: string,
  candidate: Pick<Candidate, 'technicianId' | 'userId' | 'name' | 'distanceKm' | 'etaMinutes'>,
  adminName: string
): Promise<JobOffer> {
  const job = await prisma.jobRequest.findUnique({ where: { id: jobId } });
  if (!job) throw notFound('JOB_NOT_FOUND', 'Job not found');
  if (!OFFERABLE.includes(job.status)) {
    throw conflict('NOT_ASSIGNABLE', 'Only jobs waiting for a technician can be offered');
  }
  if (job.status === 'MATCHED') await cancelOpenOffers(jobId);

  const created = await createOffer(
    job,
    candidate,
    job.dispatchRadiusKm,
    `Offered to ${candidate.name} by ${adminName}`
  );
  if (created === null) {
    throw conflict('JOB_CHANGED', 'The job was updated by someone else, please refresh');
  }
  if (created === 'BUSY') {
    throw conflict('TECHNICIAN_BUSY', 'Technician is on another job or answering another offer');
  }
  await logAttempt(jobId, {
    radiusKm: job.dispatchRadiusKm,
    outcome: 'MANUAL_OFFER',
    offeredTechnicianId: candidate.userId,
    note: `${adminName} offered the job to ${candidate.name}, ${candidate.distanceKm} km away (~${candidate.etaMinutes} min)`,
  });
  announceOffer(jobId, created, candidate.userId);
  return created.offer;
}

async function technicianProfileFor(userId: string) {
  const profile = await prisma.technicianProfile.findUnique({
    where: { userId },
    select: { id: true, user: { select: { name: true } } },
  });
  if (!profile) throw notFound('TECHNICIAN_NOT_FOUND', 'Technician profile not found');
  return profile;
}

/**
 * Atomic claim: the offer flips PENDING → ACCEPTED and the job MATCHED →
 * ACCEPTED in one transaction, each guarded by its current status, so
 * concurrent accepts produce exactly one winner.
 */
export async function acceptOffer(jobId: string, technicianUserId: string): Promise<JobRequest> {
  const profile = await technicianProfileFor(technicianUserId);
  const at = now();

  const { job, offerId } = await prisma.$transaction(async tx => {
    const offer = await tx.jobOffer.findFirst({
      where: { jobId, technicianId: profile.id },
      orderBy: { offeredAt: 'desc' },
    });
    if (!offer) throw notFound('OFFER_NOT_FOUND', 'No offer for this job');
    if (offer.status === OfferStatus.ACCEPTED) {
      throw conflict('ALREADY_CLAIMED', 'This job has already been accepted');
    }
    if (
      offer.status === OfferStatus.EXPIRED ||
      (offer.status === OfferStatus.PENDING && offer.expiresAt <= at)
    ) {
      throw conflict('OFFER_EXPIRED', 'This offer has expired');
    }
    if (offer.status !== OfferStatus.PENDING) {
      throw conflict('OFFER_CLOSED', 'This offer is no longer available');
    }

    const claimed = await tx.jobOffer.updateMany({
      where: { id: offer.id, status: OfferStatus.PENDING },
      data: { status: OfferStatus.ACCEPTED, respondedAt: at },
    });
    if (claimed.count === 0)
      throw conflict('ALREADY_CLAIMED', 'This job has already been accepted');

    const current = await tx.jobRequest.findUniqueOrThrow({ where: { id: jobId } });
    const accepted = await transitionJob(tx, {
      jobId,
      from: 'MATCHED',
      to: 'ACCEPTED',
      data: {
        technicianId: technicianUserId,
        acceptedAt: at,
        responseTimeSecs: Math.max(
          0,
          Math.round((at.getTime() - current.createdAt.getTime()) / 1000)
        ),
      },
      note: `Accepted by ${profile.user.name}`,
    });
    if (!accepted) throw conflict('ALREADY_CLAIMED', 'This job is no longer available');
    return { job: accepted, offerId: offer.id };
  });

  cancelOfferExpiry(offerId);
  events.publish('job.offer_closed', { jobId, offerId, technicianUserId, reason: 'ACCEPTED' });
  publishStatusChange(job, 'MATCHED');
  return job;
}

/** Technician declines; the job is immediately offered to the next-best technician. */
export async function rejectOffer(
  jobId: string,
  technicianUserId: string
): Promise<DispatchOutcome> {
  const profile = await technicianProfileFor(technicianUserId);
  const offer = await prisma.jobOffer.findFirst({
    where: { jobId, technicianId: profile.id, status: OfferStatus.PENDING },
  });
  if (!offer) throw conflict('OFFER_CLOSED', 'No pending offer for this job');

  const closed = await prisma.jobOffer.updateMany({
    where: { id: offer.id, status: OfferStatus.PENDING },
    data: { status: OfferStatus.REJECTED, respondedAt: now() },
  });
  if (closed.count === 0) throw conflict('OFFER_CLOSED', 'No pending offer for this job');

  cancelOfferExpiry(offer.id);
  events.publish('job.offer_closed', {
    jobId,
    offerId: offer.id,
    technicianUserId,
    reason: 'REJECTED',
  });
  return dispatchJob(jobId);
}

/** Closes an unanswered offer once its window has passed and re-dispatches the job. */
export async function expireOffer(offerId: string): Promise<DispatchOutcome> {
  const at = now();
  const offer = await prisma.jobOffer.findUnique({
    where: { id: offerId },
    select: { jobId: true, technician: { select: { userId: true } } },
  });
  if (!offer) return { outcome: 'SKIPPED' };

  const closed = await prisma.jobOffer.updateMany({
    where: { id: offerId, status: OfferStatus.PENDING, expiresAt: { lte: at } },
    data: { status: OfferStatus.EXPIRED, respondedAt: at },
  });
  if (closed.count === 0) return { outcome: 'SKIPPED' };

  events.publish('job.offer_closed', {
    jobId: offer.jobId,
    offerId,
    technicianUserId: offer.technician.userId,
    reason: 'EXPIRED',
  });
  return dispatchJob(offer.jobId);
}

/** Withdraws any open offer on a job (used when the job is cancelled). */
export async function cancelOpenOffers(jobId: string): Promise<void> {
  const open = await prisma.jobOffer.findMany({
    where: { jobId, status: OfferStatus.PENDING },
    select: { id: true, technician: { select: { userId: true } } },
  });
  if (open.length === 0) return;
  await prisma.jobOffer.updateMany({
    where: { id: { in: open.map(o => o.id) }, status: OfferStatus.PENDING },
    data: { status: OfferStatus.CANCELLED, respondedAt: now() },
  });
  for (const offer of open) {
    cancelOfferExpiry(offer.id);
    events.publish('job.offer_closed', {
      jobId,
      offerId: offer.id,
      technicianUserId: offer.technician.userId,
      reason: 'CANCELLED',
    });
  }
}

/**
 * Restores dispatch after a restart: re-arms timers for open offers (expiring
 * overdue ones now) and dispatches jobs left in CREATED.
 */
export async function recoverDispatchState(): Promise<void> {
  const pending = await prisma.jobOffer.findMany({
    where: { status: OfferStatus.PENDING },
    select: { id: true, expiresAt: true },
  });
  for (const offer of pending) {
    if (offer.expiresAt.getTime() <= getClock().now()) {
      await expireOffer(offer.id);
    } else {
      scheduleOfferExpiry(offer.id, offer.expiresAt, () => expireOffer(offer.id));
    }
  }

  const stranded = await prisma.jobRequest.findMany({
    where: { status: 'CREATED' },
    select: { id: true },
  });
  for (const job of stranded) {
    await dispatchJob(job.id);
  }
}
