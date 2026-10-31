import type { JobStatus, Prisma } from '@prisma/client';
import { OfferStatus } from '@prisma/client';
import bcrypt from 'bcrypt';
import { prisma } from '../../common/prisma';
import { events } from '../../common/events/index';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors/index';
import { ACTIVE_JOB_STATUSES } from '../jobs/lifecycle';
import { takeOffline } from '../technicians/technicians.service';

/** Jobs in these states carry no live dispatch or visit and may be deleted. */
const DELETABLE_JOB_STATUSES: JobStatus[] = ['COMPLETED', 'CANCELLED', 'EXPIRED'];
const OPEN_JOB_STATUSES: JobStatus[] = ['CREATED', 'MATCHED', ...ACTIVE_JOB_STATUSES];

/** Shared demo logins (customer@, tech@, admin@ and the simulated fleet) are never deleted. */
const DEMO_EMAIL_SUFFIX = '@demo.sevaswift';

/** Records labelled TEST by testers: names, descriptions or addresses that start with "TEST". */
export const TEST_PREFIX = 'TEST';
export const PURGE_CONFIRM_TEXT = 'DELETE TEST DATA';

const testUserWhere: Prisma.UserWhereInput = {
  name: { startsWith: TEST_PREFIX },
  role: { not: 'ADMIN' },
  NOT: { email: { endsWith: DEMO_EMAIL_SUFFIX } },
};

function testJobWhere(testUserIds: string[]): Prisma.JobRequestWhereInput {
  return {
    OR: [
      { customerId: { in: testUserIds } },
      { description: { startsWith: TEST_PREFIX } },
      { address: { startsWith: TEST_PREFIX } },
    ],
  };
}

/**
 * Recomputes completed-job and rating totals from what is left, so deleting a
 * customer or a job never leaves a technician with ratings nobody gave.
 */
export async function recomputeTechnicianTotals(technicianUserIds: Iterable<string>) {
  for (const userId of new Set(technicianUserIds)) {
    const profile = await prisma.technicianProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) continue;
    const [completedJobs, ratings] = await Promise.all([
      prisma.jobRequest.count({ where: { technicianId: userId, status: 'COMPLETED' } }),
      prisma.review.aggregate({
        where: { job: { technicianId: userId } },
        _avg: { rating: true },
        _count: true,
      }),
    ]);
    await prisma.technicianProfile.update({
      where: { id: profile.id },
      data: {
        completedJobs,
        ratingCount: ratings._count,
        ratingAvg: ratings._avg.rating ? Math.round(ratings._avg.rating * 100) / 100 : 0,
      },
    });
  }
}

async function technicianIdsOfJobs(where: Prisma.JobRequestWhereInput) {
  const jobs = await prisma.jobRequest.findMany({
    where: { ...where, technicianId: { not: null } },
    select: { technicianId: true },
  });
  return jobs.map(j => j.technicianId as string);
}

/** Throws unless the account may be deleted: not an admin, not a demo login, no open jobs. */
async function assertDeletableUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!user) throw notFound('USER_NOT_FOUND', 'User not found');
  if (user.role === 'ADMIN') {
    throw forbidden('ADMIN_PROTECTED', 'Admin accounts cannot be deleted');
  }
  if (user.email.endsWith(DEMO_EMAIL_SUFFIX)) {
    throw forbidden('DEMO_PROTECTED', 'Shared demo accounts cannot be deleted');
  }
  const open = await prisma.jobRequest.count({
    where:
      user.role === 'TECHNICIAN'
        ? { technicianId: userId, status: { in: ACTIVE_JOB_STATUSES } }
        : { customerId: userId, status: { in: OPEN_JOB_STATUSES } },
  });
  if (open > 0) {
    throw conflict(
      'HAS_OPEN_JOBS',
      'This account has open jobs. Cancel or finish them before deleting it.'
    );
  }
  return user;
}

/**
 * Permanently removes an account. A customer's requests, ratings and photos go
 * with it; a technician's finished jobs stay in the customers' history without
 * the technician's name.
 */
async function removeUser(userId: string, role: string) {
  if (role === 'TECHNICIAN') await takeOffline(userId);
  const affected = role === 'CUSTOMER' ? await technicianIdsOfJobs({ customerId: userId }) : [];
  await prisma.user.delete({ where: { id: userId } });
  await recomputeTechnicianTotals(affected);
  events.publish('user.status_changed', { userId, status: 'INACTIVE' });
}

export async function deleteUser(adminId: string, userId: string) {
  if (adminId === userId) throw forbidden('SELF_UPDATE', 'You cannot delete your own account');
  const user = await assertDeletableUser(userId);
  await removeUser(user.id, user.role);
  return { id: user.id, name: user.name };
}

/** Self-service account deletion; the password is asked again. */
export async function deleteOwnAccount(userId: string, password: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('USER_NOT_FOUND', 'User not found');
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw badRequest('INVALID_PASSWORD', 'Password is incorrect', {
      password: ['Password is incorrect'],
    });
  }
  await assertDeletableUser(userId);
  await removeUser(user.id, user.role);
}

export async function deleteJob(jobId: string) {
  const job = await prisma.jobRequest.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      technicianId: true,
      offers: { where: { status: OfferStatus.PENDING }, select: { id: true } },
    },
  });
  if (!job) throw notFound('JOB_NOT_FOUND', 'Job not found');
  if (!DELETABLE_JOB_STATUSES.includes(job.status) || job.offers.length > 0) {
    throw conflict(
      'JOB_NOT_DELETABLE',
      'Only completed, cancelled or unassigned jobs with no pending offer can be deleted. Cancel it first.'
    );
  }
  await prisma.jobRequest.delete({ where: { id: jobId } });
  if (job.technicianId) await recomputeTechnicianTotals([job.technicianId]);
  return { id: job.id };
}

/** What the TEST purge would remove, and what it would skip because it is still open. */
export async function testDataPreview() {
  const users = await prisma.user.findMany({
    where: testUserWhere,
    select: { id: true, name: true, email: true, role: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const jobs = await prisma.jobRequest.findMany({
    where: testJobWhere(users.map(u => u.id)),
    select: {
      id: true,
      status: true,
      address: true,
      description: true,
      createdAt: true,
      customerId: true,
      customer: { select: { name: true } },
      review: { select: { id: true } },
      offers: { where: { status: OfferStatus.PENDING }, select: { id: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const openJobs = jobs.filter(j => !DELETABLE_JOB_STATUSES.includes(j.status) || j.offers.length);
  const openTechnicianIds = new Set(
    (
      await prisma.jobRequest.findMany({
        where: {
          technicianId: { in: users.map(u => u.id) },
          status: { in: ACTIVE_JOB_STATUSES },
        },
        select: { technicianId: true },
      })
    ).map(j => j.technicianId)
  );
  const blockedUser = (u: (typeof users)[number]) =>
    openTechnicianIds.has(u.id) || openJobs.some(j => j.customerId === u.id);

  return {
    users: users.map(u => ({ ...u, skipped: blockedUser(u) })),
    jobs: jobs.map(j => ({
      id: j.id,
      status: j.status,
      address: j.address,
      description: j.description,
      createdAt: j.createdAt,
      customerName: j.customer.name,
      rated: !!j.review,
      skipped: openJobs.includes(j),
    })),
  };
}

/** Deletes every TEST-labelled account and job that is not still open. */
export async function purgeTestData(confirmText: string) {
  if (confirmText !== PURGE_CONFIRM_TEXT) {
    throw badRequest('CONFIRMATION_REQUIRED', `Type "${PURGE_CONFIRM_TEXT}" to confirm`, {
      confirmText: [`Type "${PURGE_CONFIRM_TEXT}" to confirm`],
    });
  }
  const preview = await testDataPreview();
  const jobIds = preview.jobs.filter(j => !j.skipped).map(j => j.id);
  const users = preview.users.filter(u => !u.skipped);

  const affected = await technicianIdsOfJobs({ id: { in: jobIds } });
  const deletedJobs = await prisma.jobRequest.deleteMany({ where: { id: { in: jobIds } } });
  for (const user of users) await removeUser(user.id, user.role);
  await recomputeTechnicianTotals(affected);

  return {
    deletedUsers: users.length,
    deletedJobs: deletedJobs.count,
    skippedUsers: preview.users.length - users.length,
    skippedJobs: preview.jobs.length - jobIds.length,
  };
}
