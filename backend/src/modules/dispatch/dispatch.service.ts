import type { JobOffer, JobRequest, JobStatus } from '@prisma/client';
import { OfferStatus, UserStatus, VerificationStatus } from '@prisma/client';
import { config } from '../../config/index';
import { prisma } from '../../common/prisma';
import { events } from '../../common/events/index';
import { conflict, notFound } from '../../common/errors/index';
import { haversineKm } from '../../common/geo/index';
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

export type DispatchOutcome =
  | { outcome: 'OFFERED'; offer: JobOffer; candidate: Candidate }
  | { outcome: 'EXPIRED'; reason: string }
  | { outcome: 'SKIPPED' };

function now() {
  return new Date(getClock().now());
}

/**
 * Verified, online, skilled, idle technicians with a known location inside a
 * bounding box around the job, ranked by fastest arrival.
 */
export async function findCandidates(
  job: Pick<JobRequest, 'lat' | 'lng' | 'serviceId'>,
  excludeTechnicianIds: string[] = []
): Promise<Candidate[]> {
  const radiusKm = config.dispatch.radiusKm;
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.max(Math.cos((job.lat * Math.PI) / 180), 0.01));

  const technicians = await prisma.technicianProfile.findMany({
    where: {
      id: { notIn: excludeTechnicianIds },
      verificationStatus: VerificationStatus.VERIFIED,
      isOnline: true,
      lastLat: { gte: job.lat - latDelta, lte: job.lat + latDelta },
      lastLng: { gte: job.lng - lngDelta, lte: job.lng + lngDelta },
      user: { status: UserStatus.ACTIVE },
      skills: { some: { serviceId: job.serviceId } },
      jobOffers: { none: { status: OfferStatus.PENDING } },
    },
    select: {
      id: true,
      userId: true,
      ratingAvg: true,
      lastLat: true,
      lastLng: true,
      user: { select: { name: true } },
    },
  });

  const busy = await prisma.jobRequest.findMany({
    where: {
      technicianId: { in: technicians.map(t => t.userId) },
      status: { in: ACTIVE_JOB_STATUSES },
    },
    select: { technicianId: true },
  });
  const busyUserIds = new Set(busy.map(b => b.technicianId));

  const nearest = technicians
    .filter(t => !busyUserIds.has(t.userId))
    .map(t => {
      const lat = t.lastLat as number;
      const lng = t.lastLng as number;
      return {
        technicianId: t.id,
        userId: t.userId,
        name: t.user.name,
        ratingAvg: t.ratingAvg,
        lat,
        lng,
        straightKm: haversineKm({ lat, lng }, job),
      };
    })
    .filter(c => c.straightKm <= radiusKm)
    .sort((a, b) => a.straightKm - b.straightKm)
    .slice(0, MAX_ROUTED_CANDIDATES);

  const travel = await estimateTravel(nearest, job);
  const candidates = nearest.map((c, i) => ({
    ...c,
    distanceKm: travel[i].distanceKm,
    etaMinutes: travel[i].etaMinutes,
  }));
  return rankCandidates(candidates, radiusKm);
}

async function expireJob(jobId: string, from: JobStatus, reason: string): Promise<DispatchOutcome> {
  const job = await prisma.$transaction(tx =>
    transitionJob(tx, { jobId, from, to: 'EXPIRED', note: reason })
  );
  if (!job) return { outcome: 'SKIPPED' };
  publishStatusChange(job, from);
  return { outcome: 'EXPIRED', reason };
}

/**
 * Offers the job to the best available technician. Called when a job is
 * created and again whenever an offer is rejected or times out. After
 * MAX_DISPATCH_ROUNDS unanswered offers (or with nobody in range) the job
 * becomes EXPIRED and waits for an admin to assign it manually.
 */
export async function dispatchJob(jobId: string): Promise<DispatchOutcome> {
  const job = await prisma.jobRequest.findUnique({
    where: { id: jobId },
    include: { offers: { select: { technicianId: true, status: true } } },
  });
  if (!job || !DISPATCHABLE.includes(job.status)) return { outcome: 'SKIPPED' };
  if (job.offers.some(o => o.status === OfferStatus.PENDING)) return { outcome: 'SKIPPED' };

  const { maxRounds, radiusKm, offerTimeoutSeconds } = config.dispatch;
  if (job.dispatchRounds >= maxRounds) {
    return expireJob(job.id, job.status, `No technician accepted after ${maxRounds} offers`);
  }

  const tried = job.offers.map(o => o.technicianId);
  const ranked = await findCandidates(job, tried);
  const noneReason =
    tried.length === 0
      ? `No available technician within ${radiusKm} km`
      : 'No other available technician nearby';
  if (ranked.length === 0) {
    return expireJob(job.id, job.status, noneReason);
  }

  const offeredAt = now();
  const expiresAt = new Date(offeredAt.getTime() + offerTimeoutSeconds * 1000);

  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DISPATCH_LOCK_KEY})`;

    const fresh = await tx.jobRequest.findUnique({
      where: { id: job.id },
      select: {
        status: true,
        dispatchRounds: true,
        offers: { where: { status: OfferStatus.PENDING }, select: { id: true } },
      },
    });
    if (!fresh || !DISPATCHABLE.includes(fresh.status) || fresh.offers.length > 0) return null;

    for (const candidate of ranked) {
      // Re-check under the lock: the technician may have been offered or assigned another job meanwhile.
      const [pending, active] = await Promise.all([
        tx.jobOffer.count({
          where: { technicianId: candidate.technicianId, status: OfferStatus.PENDING },
        }),
        tx.jobRequest.count({
          where: { technicianId: candidate.userId, status: { in: ACTIVE_JOB_STATUSES } },
        }),
      ]);
      if (pending > 0 || active > 0) continue;

      const round = fresh.dispatchRounds + 1;
      const offer = await tx.jobOffer.create({
        data: {
          jobId: job.id,
          technicianId: candidate.technicianId,
          round,
          distanceKm: candidate.distanceKm,
          etaMinutes: candidate.etaMinutes,
          offeredAt,
          expiresAt,
        },
      });

      let matched: JobRequest | null = null;
      if (fresh.status === 'CREATED') {
        matched = await transitionJob(tx, {
          jobId: job.id,
          from: 'CREATED',
          to: 'MATCHED',
          data: { dispatchRounds: round },
          note: `Offered to ${candidate.name} (${candidate.distanceKm} km, ~${candidate.etaMinutes} min)`,
        });
      } else {
        await tx.jobRequest.update({ where: { id: job.id }, data: { dispatchRounds: round } });
      }
      return { offer, candidate, matched };
    }
    return 'NONE' as const;
  });

  if (result === null) return { outcome: 'SKIPPED' };
  if (result === 'NONE') return expireJob(job.id, job.status, noneReason);

  const { offer, candidate, matched } = result;
  if (matched) publishStatusChange(matched, 'CREATED');
  scheduleOfferExpiry(offer.id, offer.expiresAt, () => expireOffer(offer.id));
  events.publish('job.offered', {
    jobId: job.id,
    offerId: offer.id,
    technicianUserId: candidate.userId,
    expiresAt: offer.expiresAt,
  });
  return { outcome: 'OFFERED', offer, candidate };
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
