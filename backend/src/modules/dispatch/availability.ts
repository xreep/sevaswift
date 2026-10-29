import { Router } from 'express';
import { OfferStatus, UserStatus, VerificationStatus } from '@prisma/client';
import { z } from 'zod';
import { config } from '../../config/index';
import { prisma } from '../../common/prisma';
import { estimateMinutes, haversineKm } from '../../common/geo/index';
import { authMiddleware } from '../../common/middleware/auth';
import { validate } from '../../common/middleware/validate';
import { ACTIVE_JOB_STATUSES } from '../jobs/lifecycle';

export const availabilitySchema = z.object({
  query: z
    .object({
      lat: z.coerce.number().min(-90).max(90).optional(),
      lng: z.coerce.number().min(-180).max(180).optional(),
      serviceId: z.string().min(1).max(64).optional(),
    })
    .refine(q => (q.lat === undefined) === (q.lng === undefined), {
      message: 'Pass both lat and lng, or neither',
    }),
});

type AvailabilityQuery = z.infer<typeof availabilitySchema>['query'];

/**
 * How much help is out there right now: technicians on duty and those free to
 * take a job, optionally around a point (within the dispatch radius) and for
 * one service. Uses straight-line estimates so it stays cheap to call.
 */
export async function availability(query: AvailabilityQuery) {
  const technicians = await prisma.technicianProfile.findMany({
    where: {
      verificationStatus: VerificationStatus.VERIFIED,
      isOnline: true,
      user: { status: UserStatus.ACTIVE },
      lastLat: { not: null },
      lastLng: { not: null },
      ...(query.serviceId && { skills: { some: { serviceId: query.serviceId } } }),
    },
    select: {
      userId: true,
      lastLat: true,
      lastLng: true,
      jobOffers: { where: { status: OfferStatus.PENDING }, select: { id: true } },
    },
  });

  const busy = new Set(
    (
      await prisma.jobRequest.findMany({
        where: {
          technicianId: { in: technicians.map(t => t.userId) },
          status: { in: ACTIVE_JOB_STATUSES },
        },
        select: { technicianId: true },
      })
    ).map(j => j.technicianId)
  );

  const radiusKm = config.dispatch.radiusKm;
  const point =
    query.lat !== undefined && query.lng !== undefined ? { lat: query.lat, lng: query.lng } : null;
  const inArea = technicians
    .map(t => ({
      ...t,
      km: point ? haversineKm({ lat: t.lastLat as number, lng: t.lastLng as number }, point) : 0,
    }))
    .filter(t => !point || t.km <= radiusKm);
  const free = inArea.filter(t => !busy.has(t.userId) && t.jobOffers.length === 0);
  const nearest = point && free.length ? Math.min(...free.map(t => t.km)) : null;

  return {
    radiusKm: point ? radiusKm : null,
    onDuty: inArea.length,
    available: free.length,
    nearestKm: nearest == null ? null : Math.round(nearest * 10) / 10,
    nearestEtaMins:
      nearest == null ? null : estimateMinutes(nearest, config.dispatch.averageSpeedKmph),
  };
}

const router = Router();

router.get('/', authMiddleware, validate(availabilitySchema), async (req, res, next) => {
  try {
    res.json({ availability: await availability(req.query as unknown as AvailabilityQuery) });
  } catch (err) {
    next(err);
  }
});

export default router;
