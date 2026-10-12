import type { JobStatus, Prisma, Role } from '@prisma/client';
import { config } from '../../config/index';
import { estimateMinutes, haversineKm, type LatLng } from '../../common/geo/index';

export const jobInclude = {
  service: { select: { id: true, name: true, category: true, icon: true, baseFee: true } },
  customer: { select: { id: true, name: true, phone: true } },
  technician: {
    select: {
      id: true,
      name: true,
      phone: true,
      technicianProfile: {
        select: {
          ratingAvg: true,
          ratingCount: true,
          completedJobs: true,
          lastLat: true,
          lastLng: true,
          locationUpdatedAt: true,
        },
      },
    },
  },
  statusHistory: { orderBy: { at: 'asc' } },
  offers: {
    orderBy: { offeredAt: 'asc' },
    include: { technician: { select: { userId: true, user: { select: { name: true } } } } },
  },
  review: true,
} satisfies Prisma.JobRequestInclude;

export type JobWithRelations = Prisma.JobRequestGetPayload<{ include: typeof jobInclude }>;

export interface Viewer {
  id: string;
  role: Role;
}

/** Live ETA is only meaningful while the technician is on the way. */
const TRACKED_STATUSES = new Set<JobStatus>(['ACCEPTED', 'EN_ROUTE']);

export type LiveEta = { distanceKm: number; minutes: number } | null;

/** Straight-line ETA from the technician to the job, or null once they are no longer travelling. */
export function liveEta(status: JobStatus, techLocation: LatLng, jobLocation: LatLng): LiveEta {
  if (!TRACKED_STATUSES.has(status)) return null;
  const distanceKm = haversineKm(techLocation, jobLocation);
  return {
    distanceKm: Math.round(distanceKm * 10) / 10,
    minutes: estimateMinutes(distanceKm, config.dispatch.averageSpeedKmph),
  };
}

export function toJobDto(job: JobWithRelations, viewer: Viewer) {
  const profile = job.technician?.technicianProfile;
  const techLocation =
    profile?.lastLat != null && profile.lastLng != null
      ? { lat: profile.lastLat, lng: profile.lastLng, updatedAt: profile.locationUpdatedAt }
      : null;

  const eta = techLocation ? liveEta(job.status, techLocation, job) : null;

  const isAdmin = viewer.role === 'ADMIN';
  const isAssignedTech = job.technicianId === viewer.id;
  const pendingOffer = job.offers.find(o => o.status === 'PENDING');
  const myOffer =
    viewer.role === 'TECHNICIAN' ? pendingOffer?.technician.userId === viewer.id : false;

  return {
    id: job.id,
    status: job.status,
    priority: job.priority,
    service: job.service,
    location: { lat: job.lat, lng: job.lng, address: job.address },
    description: job.description,
    photoUrls: job.photoUrls,
    customer: {
      id: job.customer.id,
      name: job.customer.name,
      // Contact details are shared only once a technician is assigned.
      phone: isAdmin || isAssignedTech ? job.customer.phone : null,
    },
    technician: job.technician
      ? {
          id: job.technician.id,
          name: job.technician.name,
          phone: job.technician.phone,
          ratingAvg: profile?.ratingAvg ?? 0,
          ratingCount: profile?.ratingCount ?? 0,
          completedJobs: profile?.completedJobs ?? 0,
          location: techLocation,
        }
      : null,
    eta,
    offer:
      pendingOffer && (myOffer || isAdmin)
        ? {
            id: pendingOffer.id,
            round: pendingOffer.round,
            distanceKm: pendingOffer.distanceKm,
            etaMinutes: pendingOffer.etaMinutes,
            offeredAt: pendingOffer.offeredAt,
            expiresAt: pendingOffer.expiresAt,
          }
        : null,
    dispatchRounds: job.dispatchRounds,
    responseTimeSecs: job.responseTimeSecs,
    createdAt: job.createdAt,
    acceptedAt: job.acceptedAt,
    arrivedAt: job.arrivedAt,
    completedAt: job.completedAt,
    cancelledAt: job.cancelledAt,
    timeline: job.statusHistory.map(h => ({
      from: h.fromStatus,
      to: h.toStatus,
      note: h.note,
      at: h.at,
    })),
    dispatchLog: isAdmin
      ? job.offers.map(o => ({
          technicianName: o.technician.user.name,
          round: o.round,
          status: o.status,
          distanceKm: o.distanceKm,
          etaMinutes: o.etaMinutes,
          offeredAt: o.offeredAt,
          respondedAt: o.respondedAt,
        }))
      : undefined,
    review: job.review ? { rating: job.review.rating, comment: job.review.comment } : null,
  };
}

export type JobDto = ReturnType<typeof toJobDto>;
