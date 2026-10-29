import { OfferStatus } from '@prisma/client';
import { prisma } from '../../common/prisma';
import { events } from '../../common/events/index';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors/index';
import { config } from '../../config/index';
import { getClock } from '../../common/utils/clock';
import { rejectOffer } from '../dispatch/dispatch.service';
import { jobInclude, toJobDto } from '../jobs/jobs.mapper';
import { ACTIVE_JOB_STATUSES } from '../jobs/lifecycle';
import { performanceFor } from './performance';
import type { LocationInput, SkillsInput } from './technicians.dto';

const profileInclude = {
  user: { select: { id: true, name: true, email: true, phone: true } },
  skills: {
    include: { service: { select: { id: true, name: true, category: true, icon: true } } },
  },
} as const;

async function loadProfile(userId: string) {
  const profile = await prisma.technicianProfile.findUnique({
    where: { userId },
    include: profileInclude,
  });
  if (!profile) throw notFound('TECHNICIAN_NOT_FOUND', 'Technician profile not found');
  return profile;
}

function toProfileDto(profile: Awaited<ReturnType<typeof loadProfile>>) {
  return {
    id: profile.id,
    user: profile.user,
    verificationStatus: profile.verificationStatus,
    rejectionReason: profile.rejectionReason,
    isOnline: profile.isOnline,
    ratingAvg: profile.ratingAvg,
    ratingCount: profile.ratingCount,
    completedJobs: profile.completedJobs,
    location:
      profile.lastLat != null && profile.lastLng != null
        ? { lat: profile.lastLat, lng: profile.lastLng, updatedAt: profile.locationUpdatedAt }
        : null,
    skills: profile.skills.map(s => s.service),
  };
}

export async function getProfile(userId: string) {
  return toProfileDto(await loadProfile(userId));
}

/**
 * Takes a technician off duty: logs the switch for utilization, tells admins,
 * and declines any open offer so the job moves on at once. Used for an
 * explicit "go offline", sign-out, a missed heartbeat, rejection or suspension.
 */
export async function takeOffline(userId: string): Promise<boolean> {
  const profile = await prisma.technicianProfile.findUnique({
    where: { userId },
    select: { id: true, isOnline: true },
  });
  if (!profile) return false;

  const switched = await prisma.technicianProfile.updateMany({
    where: { id: profile.id, isOnline: true },
    data: { isOnline: false },
  });
  if (switched.count > 0) {
    await prisma.availabilityLog.create({
      data: { technicianId: profile.id, isOnline: false, at: new Date(getClock().now()) },
    });
    events.publish('technician.availability', { technicianUserId: userId, isOnline: false });
  }

  const open = await prisma.jobOffer.findMany({
    where: { technicianId: profile.id, status: OfferStatus.PENDING },
    select: { jobId: true },
  });
  for (const offer of open) {
    await rejectOffer(offer.jobId, userId);
  }
  return switched.count > 0;
}

export function isLocationFresh(updatedAt: Date | null | undefined): boolean {
  return !!updatedAt && getClock().now() - updatedAt.getTime() <= config.dispatch.locationStaleMs;
}

/**
 * Going on duty needs admin verification and a fresh location, so dispatch
 * never relies on a position from another day or a default map centre.
 */
export async function setAvailability(userId: string, isOnline: boolean) {
  const profile = await loadProfile(userId);
  if (!isOnline) {
    await takeOffline(userId);
    return getProfile(userId);
  }

  if (profile.verificationStatus !== 'VERIFIED') {
    throw forbidden(
      'NOT_VERIFIED',
      'Your account must be verified by an admin before going online'
    );
  }
  if (!isLocationFresh(profile.locationUpdatedAt)) {
    throw conflict(
      'LOCATION_REQUIRED',
      'Share your current location (GPS or confirm a spot on the map) before going on duty'
    );
  }

  if (!profile.isOnline) {
    await prisma.$transaction([
      prisma.technicianProfile.update({ where: { id: profile.id }, data: { isOnline: true } }),
      prisma.availabilityLog.create({
        data: { technicianId: profile.id, isOnline: true, at: new Date(getClock().now()) },
      }),
    ]);
    events.publish('technician.availability', { technicianUserId: userId, isOnline: true });
  }
  return getProfile(userId);
}

/** Seeded demo technicians (tech_<city>_<n>@demo.sevaswift), kept on duty by the simulation. */
const DEMO_FLEET = { startsWith: 'tech_', endsWith: '@demo.sevaswift' } as const;

/**
 * Presence sweep, run every minute: keeps the simulated demo fleet's positions
 * current (when enabled), then takes off duty any online technician whose app
 * has not reported a location within the stale window.
 */
export async function sweepPresence(): Promise<{ simulated: number; wentOffline: number }> {
  const at = new Date(getClock().now());
  let simulated = 0;
  if (config.demoFleetSimulation) {
    simulated = (
      await prisma.technicianProfile.updateMany({
        where: { isOnline: true, user: { email: DEMO_FLEET } },
        data: { locationUpdatedAt: at },
      })
    ).count;
  }

  const cutoff = new Date(at.getTime() - config.dispatch.locationStaleMs);
  const silent = await prisma.technicianProfile.findMany({
    where: {
      isOnline: true,
      OR: [{ locationUpdatedAt: null }, { locationUpdatedAt: { lt: cutoff } }],
    },
    select: { userId: true },
  });
  let wentOffline = 0;
  for (const t of silent) {
    if (await takeOffline(t.userId)) wentOffline++;
  }
  return { simulated, wentOffline };
}

let sweeper: NodeJS.Timeout | null = null;

export function startPresenceSweeper(intervalMs = 60_000) {
  if (sweeper || config.nodeEnv === 'test') return;
  sweeper = setInterval(() => {
    sweepPresence().catch(err => console.error('[presence] Sweep failed:', err));
  }, intervalMs);
  sweeper.unref();
}

export function isDemoFleetEmail(email: string) {
  return email.startsWith(DEMO_FLEET.startsWith) && email.endsWith(DEMO_FLEET.endsWith);
}

export async function setSkills(userId: string, input: SkillsInput) {
  const profile = await loadProfile(userId);
  const serviceIds = [...new Set(input.serviceIds)];
  const found = await prisma.service.count({ where: { id: { in: serviceIds }, isActive: true } });
  if (found !== serviceIds.length) {
    throw badRequest('INVALID_SERVICE', 'One or more services do not exist');
  }

  await prisma.$transaction([
    prisma.technicianSkill.deleteMany({
      where: { technicianId: profile.id, serviceId: { notIn: serviceIds } },
    }),
    prisma.technicianSkill.createMany({
      data: serviceIds.map(serviceId => ({ technicianId: profile.id, serviceId })),
      skipDuplicates: true,
    }),
  ]);
  return getProfile(userId);
}

/** GPS heartbeat from the technician's browser; broadcast for live tracking. */
export async function updateLocation(userId: string, input: LocationInput) {
  const at = new Date(getClock().now());
  const updated = await prisma.technicianProfile.updateMany({
    where: { userId },
    data: { lastLat: input.lat, lastLng: input.lng, locationUpdatedAt: at },
  });
  if (updated.count === 0) throw notFound('TECHNICIAN_NOT_FOUND', 'Technician profile not found');
  events.publish('technician.location', {
    technicianUserId: userId,
    lat: input.lat,
    lng: input.lng,
    at,
  });
}

/** Open offers waiting for this technician's answer. */
export async function listOffers(userId: string) {
  const jobs = await prisma.jobRequest.findMany({
    where: {
      offers: {
        some: {
          status: OfferStatus.PENDING,
          expiresAt: { gt: new Date(getClock().now()) },
          technician: { userId },
        },
      },
    },
    include: jobInclude,
    orderBy: { createdAt: 'asc' },
  });
  return jobs.map(job => toJobDto(job, { id: userId, role: 'TECHNICIAN' }));
}

/** Lifetime and last-30-day performance plus the job the technician is working on. */
export async function getStats(userId: string) {
  const profile = await loadProfile(userId);
  const ref = [{ profileId: profile.id, userId }];
  const since30 = new Date(getClock().now() - 30 * 24 * 60 * 60 * 1000);
  const [lifetime, last30, activeJob] = await Promise.all([
    performanceFor(ref),
    performanceFor(ref, since30),
    prisma.jobRequest.findFirst({
      where: { technicianId: userId, status: { in: ACTIVE_JOB_STATUSES } },
      select: { id: true },
    }),
  ]);
  return {
    lifetime: lifetime.get(userId),
    last30Days: last30.get(userId),
    activeJobId: activeJob?.id ?? null,
  };
}
