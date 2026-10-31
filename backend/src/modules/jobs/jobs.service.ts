import type { JobStatus, Prisma } from '@prisma/client';
import { OfferStatus } from '@prisma/client';
import { prisma } from '../../common/prisma';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../common/errors/index';
import { haversineKm } from '../../common/geo/index';
import { getClock } from '../../common/utils/clock';
import { cancelOpenOffers, dispatchJob } from '../dispatch/dispatch.service';
import { assertOwnedUploads } from '../uploads/uploads.service';
import {
  ACTIVE_JOB_STATUSES,
  assertTransition,
  publishStatusChange,
  transitionJob,
} from './lifecycle';
import type { LatLng } from '../../common/geo/index';
import type { Viewer } from './jobs.mapper';
import { jobInclude, liveEta, toJobDto } from './jobs.mapper';
import type {
  CancelJobInput,
  CreateJobInput,
  ListJobsQuery,
  ReviewJobInput,
  UpdateStatusInput,
} from './jobs.dto';

const OPEN_STATUSES: JobStatus[] = ['CREATED', 'MATCHED', ...ACTIVE_JOB_STATUSES];
const CANCELLABLE: JobStatus[] = ['CREATED', 'MATCHED', 'ACCEPTED', 'EN_ROUTE', 'EXPIRED'];

function now() {
  return new Date(getClock().now());
}

async function loadJob(jobId: string) {
  return prisma.jobRequest.findUnique({ where: { id: jobId }, include: jobInclude });
}

/** Who may see a job: its customer, its assigned technician, a technician it is offered to, or an admin. */
async function canView(
  jobId: string,
  job: { customerId: string; technicianId: string | null },
  viewer: Viewer
) {
  if (viewer.role === 'ADMIN') return true;
  if (viewer.role === 'CUSTOMER') return job.customerId === viewer.id;
  if (job.technicianId === viewer.id) return true;
  const offered = await prisma.jobOffer.count({
    where: { jobId, status: OfferStatus.PENDING, technician: { userId: viewer.id } },
  });
  return offered > 0;
}

export async function getJob(jobId: string, viewer: Viewer) {
  const job = await loadJob(jobId);
  // 404 rather than 403 so job ids cannot be probed.
  if (!job || !(await canView(jobId, job, viewer))) {
    throw notFound('JOB_NOT_FOUND', 'Job not found');
  }
  return toJobDto(job, viewer);
}

/** Whether the viewer may follow this job's live updates. */
export async function canViewJob(jobId: string, viewer: Viewer): Promise<boolean> {
  const job = await prisma.jobRequest.findUnique({
    where: { id: jobId },
    select: { customerId: true, technicianId: true },
  });
  return !!job && canView(jobId, job, viewer);
}

/** The technician's in-progress jobs, with a live ETA from the given position. */
export async function activeJobsWithEta(technicianUserId: string, position: LatLng) {
  const jobs = await prisma.jobRequest.findMany({
    where: { technicianId: technicianUserId, status: { in: ACTIVE_JOB_STATUSES } },
    select: { id: true, status: true, lat: true, lng: true },
  });
  return jobs.map(job => ({ jobId: job.id, eta: liveEta(job.status, position, job) }));
}

/** "Arrived" further than this from the customer's pin needs the technician to confirm. */
export const ARRIVAL_WARN_KM = 1;

export async function createJob(customerId: string, input: CreateJobInput) {
  const customer = await prisma.user.findUnique({
    where: { id: customerId },
    select: { emailVerified: true },
  });
  if (!customer?.emailVerified) {
    throw forbidden(
      'EMAIL_NOT_VERIFIED',
      'Verify your email address before raising a request. Use the link we sent, or resend it from your profile.'
    );
  }

  const service = await prisma.service.findUnique({ where: { id: input.serviceId } });
  if (!service || !service.isActive) {
    throw badRequest('INVALID_SERVICE', 'Selected service is not available');
  }

  const open = await prisma.jobRequest.count({
    where: { customerId, status: { in: OPEN_STATUSES } },
  });
  if (open >= 3) {
    throw conflict('TOO_MANY_OPEN_REQUESTS', 'You already have 3 open requests');
  }
  if (input.photoUrls.length > 0) {
    await assertOwnedUploads(customerId, input.photoUrls);
  }

  const createdAt = now();
  const job = await prisma.jobRequest.create({
    data: {
      customerId,
      serviceId: input.serviceId,
      lat: input.lat,
      lng: input.lng,
      address: input.address,
      description: input.description,
      priority: input.priority,
      photoUrls: input.photoUrls,
      createdAt,
      statusHistory: { create: { toStatus: 'CREATED', note: 'Request raised', at: createdAt } },
    },
  });
  publishStatusChange(job, null);

  await dispatchJob(job.id);
  return getJob(job.id, { id: customerId, role: 'CUSTOMER' });
}

export async function listJobs(viewer: Viewer, query: ListJobsQuery) {
  const where: Prisma.JobRequestWhereInput = {};
  if (viewer.role === 'CUSTOMER') where.customerId = viewer.id;
  if (viewer.role === 'TECHNICIAN') where.technicianId = viewer.id;
  if (query.status) where.status = query.status;
  else if (query.active === 'true') where.status = { in: OPEN_STATUSES };
  else if (query.active === 'false') where.status = { notIn: OPEN_STATUSES };

  const jobs = await prisma.jobRequest.findMany({
    where,
    include: jobInclude,
    orderBy: { createdAt: 'desc' },
    take: query.limit,
  });
  return jobs.map(job => toJobDto(job, viewer));
}

/** Technician moves an accepted job forward: EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED. */
export async function updateStatus(
  jobId: string,
  technicianUserId: string,
  input: UpdateStatusInput
) {
  const job = await prisma.jobRequest.findUnique({ where: { id: jobId } });
  if (!job || job.technicianId !== technicianUserId) {
    throw notFound('JOB_NOT_FOUND', 'Job not found');
  }
  assertTransition(job.status, input.status);

  // "Arrived" is checked against the technician's last known position; far away needs a confirm.
  let note: string | undefined;
  if (input.status === 'ARRIVED') {
    const profile = await prisma.technicianProfile.findUnique({
      where: { userId: technicianUserId },
      select: { lastLat: true, lastLng: true },
    });
    const distanceKm =
      profile?.lastLat != null && profile.lastLng != null
        ? Math.round(haversineKm({ lat: profile.lastLat, lng: profile.lastLng }, job) * 100) / 100
        : null;
    const far = distanceKm === null || distanceKm > ARRIVAL_WARN_KM;
    if (far && !input.confirmFar) {
      throw new AppError(
        409,
        'ARRIVAL_CONFIRMATION_REQUIRED',
        distanceKm === null
          ? 'Your location is unknown. Confirm you are at the customer to mark arrived.'
          : `Your location shows ${distanceKm} km from the customer. Confirm you are there to mark arrived.`,
        undefined,
        { distanceKm }
      );
    }
    if (far) {
      note =
        distanceKm === null
          ? 'Marked arrived with no known location (technician confirmed)'
          : `Marked arrived ${distanceKm} km from the customer's pin (technician confirmed)`;
    }
  }

  const at = now();
  const data: Prisma.JobRequestUncheckedUpdateManyInput = {};
  if (input.status === 'ARRIVED') data.arrivedAt = at;
  if (input.status === 'COMPLETED') data.completedAt = at;

  const updated = await prisma.$transaction(async tx => {
    const moved = await transitionJob(tx, {
      jobId,
      from: job.status,
      to: input.status,
      data,
      note,
    });
    if (!moved)
      throw conflict('JOB_CHANGED', 'The job was updated by someone else, please refresh');
    if (input.status === 'COMPLETED') {
      await tx.technicianProfile.update({
        where: { userId: technicianUserId },
        data: { completedJobs: { increment: 1 } },
      });
    }
    return moved;
  });

  publishStatusChange(updated, job.status);
  return getJob(jobId, { id: technicianUserId, role: 'TECHNICIAN' });
}

/** Customer (own job) or admin cancels, up until the technician arrives. */
export async function cancelJob(jobId: string, viewer: Viewer, input: CancelJobInput) {
  const job = await prisma.jobRequest.findUnique({ where: { id: jobId } });
  if (!job || (viewer.role === 'CUSTOMER' && job.customerId !== viewer.id)) {
    throw notFound('JOB_NOT_FOUND', 'Job not found');
  }
  if (!CANCELLABLE.includes(job.status)) {
    throw conflict('NOT_CANCELLABLE', 'This job can no longer be cancelled');
  }

  const by = viewer.role === 'ADMIN' ? 'admin' : 'customer';
  const cancelled = await prisma.$transaction(tx =>
    transitionJob(tx, {
      jobId,
      from: job.status,
      to: 'CANCELLED',
      data: { cancelledAt: now() },
      note: input.reason ? `Cancelled by ${by}: ${input.reason}` : `Cancelled by ${by}`,
    })
  );
  if (!cancelled)
    throw conflict('JOB_CHANGED', 'The job was updated by someone else, please refresh');

  await cancelOpenOffers(jobId);
  publishStatusChange(cancelled, job.status);
  return getJob(jobId, viewer);
}

/** Customer rates a completed job once; the technician's average is updated in the same transaction. */
export async function reviewJob(jobId: string, customerId: string, input: ReviewJobInput) {
  const job = await prisma.jobRequest.findUnique({
    where: { id: jobId },
    include: { review: true },
  });
  if (!job || job.customerId !== customerId) {
    throw notFound('JOB_NOT_FOUND', 'Job not found');
  }
  if (job.status !== 'COMPLETED' || !job.technicianId) {
    throw conflict('NOT_COMPLETED', 'Only completed jobs can be rated');
  }
  if (job.review) {
    throw conflict('ALREADY_REVIEWED', 'This job has already been rated');
  }
  const technicianUserId = job.technicianId;

  await prisma.$transaction(async tx => {
    await tx.review.create({
      data: { jobId, customerId, rating: input.rating, comment: input.comment, createdAt: now() },
    });
    const profile = await tx.technicianProfile.findUniqueOrThrow({
      where: { userId: technicianUserId },
    });
    const ratingCount = profile.ratingCount + 1;
    const ratingAvg = (profile.ratingAvg * profile.ratingCount + input.rating) / ratingCount;
    await tx.technicianProfile.update({
      where: { id: profile.id },
      data: { ratingCount, ratingAvg: Math.round(ratingAvg * 100) / 100 },
    });
  });

  return getJob(jobId, { id: customerId, role: 'CUSTOMER' });
}
