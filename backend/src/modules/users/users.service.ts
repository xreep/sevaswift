import bcrypt from 'bcrypt';
import { prisma } from '../../common/prisma';
import { badRequest, notFound } from '../../common/errors/index';
import { getClock } from '../../common/utils/clock';
import type { ChangePasswordInput, UpdateProfileInput } from './users.dto';

const profileSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  emailVerified: true,
  createdAt: true,
} as const;

/** The signed-in user's account with a summary of their service history. */
export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: profileSelect });
  if (!user) throw notFound('USER_NOT_FOUND', 'User not found');

  const field = user.role === 'TECHNICIAN' ? 'technicianId' : 'customerId';
  const [total, completed] =
    user.role === 'ADMIN'
      ? [0, 0]
      : await Promise.all([
          prisma.jobRequest.count({ where: { [field]: userId } }),
          prisma.jobRequest.count({ where: { [field]: userId, status: 'COMPLETED' } }),
        ]);

  return { ...user, stats: { totalJobs: total, completedJobs: completed } };
}

export async function updateProfile(userId: string, input: UpdateProfileInput) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.phone !== undefined && { phone: input.phone === '' ? null : input.phone }),
    },
  });
  return getProfile(userId);
}

/** Changes the password and signs out every other session. */
export async function changePassword(userId: string, input: ChangePasswordInput) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('USER_NOT_FOUND', 'User not found');

  const valid = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!valid) {
    throw badRequest('INVALID_PASSWORD', 'Current password is incorrect', {
      currentPassword: ['Current password is incorrect'],
    });
  }
  if (input.currentPassword === input.newPassword) {
    throw badRequest('SAME_PASSWORD', 'New password must differ from the current one', {
      newPassword: ['New password must differ from the current one'],
    });
  }

  const passwordHash = await bcrypt.hash(input.newPassword, 10);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(getClock().now()) },
    }),
  ]);
}
