import type { JobRequest, JobStatus, Prisma } from '@prisma/client';
import { events } from '../../common/events/index';
import { conflict } from '../../common/errors/index';
import { getClock } from '../../common/utils/clock';

/**
 * Allowed job status transitions.
 *
 *   CREATED → MATCHED (offer sent) → ACCEPTED → EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED
 *
 * EXPIRED means no technician accepted within the widest search radius; an admin
 * can still offer it to someone (back to MATCHED) or assign it directly.
 * Cancellation is allowed until the technician has arrived.
 */
export const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  CREATED: ['MATCHED', 'EXPIRED', 'CANCELLED'],
  MATCHED: ['ACCEPTED', 'EXPIRED', 'CANCELLED'],
  ACCEPTED: ['EN_ROUTE', 'CANCELLED'],
  EN_ROUTE: ['ARRIVED', 'CANCELLED'],
  ARRIVED: ['IN_PROGRESS'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  // An admin can offer the job again (MATCHED) or assign it directly (ACCEPTED).
  EXPIRED: ['MATCHED', 'ACCEPTED', 'CANCELLED'],
};

/** Statuses in which the assigned technician is busy with the job. */
export const ACTIVE_JOB_STATUSES: JobStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) {
    throw conflict('INVALID_TRANSITION', `Cannot move a job from ${from} to ${to}`);
  }
}

interface TransitionInput {
  jobId: string;
  from: JobStatus;
  to: JobStatus;
  data?: Prisma.JobRequestUncheckedUpdateManyInput;
  note?: string;
}

/**
 * Moves a job from `from` to `to` inside a transaction, only if it is still in
 * `from` (compare-and-set), and writes the history row. Returns null when the
 * job was changed concurrently. Call publishStatusChange after the commit.
 */
export async function transitionJob(
  tx: Prisma.TransactionClient,
  { jobId, from, to, data, note }: TransitionInput
): Promise<JobRequest | null> {
  assertTransition(from, to);
  const updated = await tx.jobRequest.updateMany({
    where: { id: jobId, status: from },
    data: { ...data, status: to },
  });
  if (updated.count === 0) return null;

  await tx.jobStatusHistory.create({
    data: { jobId, fromStatus: from, toStatus: to, note, at: new Date(getClock().now()) },
  });
  return tx.jobRequest.findUniqueOrThrow({ where: { id: jobId } });
}

export function publishStatusChange(job: JobRequest, from: JobStatus | null): void {
  events.publish('job.status_changed', {
    jobId: job.id,
    customerId: job.customerId,
    technicianUserId: job.technicianId,
    from,
    to: job.status,
  });
}
