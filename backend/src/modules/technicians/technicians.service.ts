import { OfferStatus } from '@prisma/client';
import { prisma } from '../../common/prisma';
import { events } from '../../common/events/index';
import { badRequest, forbidden, notFound } from '../../common/errors/index';
import { getClock } from '../../common/utils/clock';
import { rejectOffer } from '../dispatch/dispatch.service';
import { jobInclude, toJobDto } from '../jobs/jobs.mapper';
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

/** Only verified technicians can go online. Going offline declines any open offer. */
export async function setAvailability(userId: string, isOnline: boolean) {
  const profile = await loadProfile(userId);
  if (isOnline && profile.verificationStatus !== 'VERIFIED') {
    throw forbidden(
      'NOT_VERIFIED',
      'Your account must be verified by an admin before going online'
    );
  }

  await prisma.technicianProfile.update({ where: { id: profile.id }, data: { isOnline } });

  if (!isOnline) {
    const open = await prisma.jobOffer.findMany({
      where: { technicianId: profile.id, status: OfferStatus.PENDING },
      select: { jobId: true },
    });
    for (const offer of open) {
      await rejectOffer(offer.jobId, userId);
    }
  }
  return getProfile(userId);
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
