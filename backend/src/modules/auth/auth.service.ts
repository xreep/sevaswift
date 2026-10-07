import { PrismaClient, Role, UserStatus, Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../../config/index.js';
import { getClock } from '../../common/utils/clock.js';
import { AppError, badRequest, conflict, unauthorized, notFound } from '../../common/errors/index.js';
import type { RegisterInput, LoginInput, VerifyEmailInput, ForgotPasswordInput, ResetPasswordInput } from './auth.dto.js';

const prisma = new PrismaClient();

const DUMMY_HASH = '$2b$10$dummyhashdummyhashdummyhashdummyhashdummyhas';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateTokens(userId: string, email: string, role: Role) {
  const clock = getClock();
  const accessToken = jwt.sign(
    { sub: userId, email, role },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpiry as jwt.SignOptions['expiresIn'] }
  );
  const refreshToken = crypto.randomBytes(32).toString('hex');
  const refreshTokenHash = hashToken(refreshToken);
  const expiresAt = new Date(clock.now() + 7 * 24 * 60 * 60 * 1000);

  return { accessToken, refreshToken, refreshTokenHash, expiresAt };
}

async function setRefreshTokenCookie(res: any, refreshToken: string) {
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

async function clearRefreshTokenCookie(res: any) {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

export async function register(
  input: RegisterInput,
  res: any
): Promise<{ user: any; accessToken: string }> {
  const clock = getClock();

  const existingUser = await prisma.user.findUnique({
    where: { email: input.email },
  });

  if (existingUser) {
    throw conflict('EMAIL_EXISTS', 'Email already registered');
  }

  const passwordHash = await bcrypt.hash(input.password, 10);
  const emailVerificationToken = crypto.randomBytes(32).toString('hex');
  const emailVerificationTokenHash = hashToken(emailVerificationToken);
  const emailVerificationExpires = new Date(clock.now() + 24 * 60 * 60 * 1000);

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      phone: input.phone,
      passwordHash,
      role: input.role,
      status: UserStatus.ACTIVE,
      emailVerified: false,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      emailVerified: true,
      createdAt: true,
    },
  });

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: emailVerificationTokenHash,
      expiresAt: emailVerificationExpires,
    },
  });

  const { accessToken, refreshToken, refreshTokenHash, expiresAt } = generateTokens(
    user.id,
    user.email,
    user.role
  );

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: refreshTokenHash,
      expiresAt,
    },
  });

  await setRefreshTokenCookie(res, refreshToken);

  return { user, accessToken };
}

export async function login(
  input: LoginInput,
  res: any
): Promise<{ user: any; accessToken: string }> {
  const clock = getClock();

  const user = await prisma.user.findUnique({
    where: { email: input.email },
  });

  const isValidPassword = user
    ? await bcrypt.compare(input.password, user.passwordHash)
    : await bcrypt.compare(input.password, DUMMY_HASH);

  if (!user || !isValidPassword) {
    throw unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');
  }

  if (user.status !== UserStatus.ACTIVE) {
    throw unauthorized('ACCOUNT_INACTIVE', 'Account is inactive or suspended');
  }

  const { accessToken, refreshToken, refreshTokenHash, expiresAt } = generateTokens(
    user.id,
    user.email,
    user.role
  );

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: refreshTokenHash,
      expiresAt,
    },
  });

  await setRefreshTokenCookie(res, refreshToken);

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerified,
    },
    accessToken,
  };
}

export async function refresh(refreshToken: string | undefined, res: any): Promise<{ accessToken: string }> {
  if (!refreshToken) {
    throw unauthorized('MISSING_REFRESH_TOKEN', 'Refresh token required');
  }

  const tokenHash = hashToken(refreshToken);
  const clock = getClock();

  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!storedToken) {
    throw unauthorized('INVALID_REFRESH_TOKEN', 'Invalid refresh token');
  }

  if (storedToken.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: storedToken.userId },
      data: { revokedAt: new Date(clock.now()) },
    });
    throw unauthorized('TOKEN_REUSE_DETECTED', 'Token reuse detected, all sessions revoked');
  }

  if (storedToken.expiresAt < new Date(clock.now())) {
    throw unauthorized('REFRESH_TOKEN_EXPIRED', 'Refresh token expired');
  }

  if (storedToken.user.status !== UserStatus.ACTIVE) {
    throw unauthorized('ACCOUNT_INACTIVE', 'Account is inactive or suspended');
  }

  await prisma.refreshToken.update({
    where: { id: storedToken.id },
    data: { revokedAt: new Date(clock.now()) },
  });

  const { accessToken, refreshToken: newRefreshToken, refreshTokenHash: newRefreshTokenHash, expiresAt } =
    generateTokens(storedToken.user.id, storedToken.user.email, storedToken.user.role);

  await prisma.refreshToken.create({
    data: {
      userId: storedToken.user.id,
      tokenHash: newRefreshTokenHash,
      expiresAt,
      replacedByTokenHash: newRefreshTokenHash,
    },
  });

  await setRefreshTokenCookie(res, newRefreshToken);

  return { accessToken };
}

export async function logout(refreshToken: string | undefined, res: any): Promise<void> {
  if (refreshToken) {
    const tokenHash = hashToken(refreshToken);
    const clock = getClock();
    await prisma.refreshToken.updateMany({
      where: { tokenHash },
      data: { revokedAt: new Date(clock.now()) },
    });
  }
  await clearRefreshTokenCookie(res);
}

export async function verifyEmail(input: VerifyEmailInput): Promise<void> {
  const tokenHash = hashToken(input.token);
  const clock = getClock();

  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!storedToken || storedToken.expiresAt < new Date(clock.now())) {
    throw badRequest('INVALID_VERIFICATION_TOKEN', 'Invalid or expired verification token');
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: storedToken.userId },
      data: { emailVerified: true },
    }),
    prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date(clock.now()) },
    }),
  ]);
}

export async function forgotPassword(input: ForgotPasswordInput): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
  });

  if (!user) {
    return;
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetTokenHash = hashToken(resetToken);
  const clock = getClock();
  const expiresAt = new Date(clock.now() + 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: resetTokenHash,
      expiresAt,
    },
  });
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const tokenHash = hashToken(input.token);
  const clock = getClock();

  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!storedToken || storedToken.expiresAt < new Date(clock.now())) {
    throw badRequest('INVALID_RESET_TOKEN', 'Invalid or expired reset token');
  }

  if (storedToken.revokedAt) {
    throw badRequest('TOKEN_ALREADY_USED', 'Reset token already used');
  }

  const passwordHash = await bcrypt.hash(input.password, 10);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: storedToken.userId },
      data: { passwordHash },
    }),
    prisma.refreshToken.updateMany({
      where: { userId: storedToken.userId },
      data: { revokedAt: new Date(clock.now()) },
    }),
  ]);
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      emailVerified: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw notFound('USER_NOT_FOUND', 'User not found');
  }

  return user;
}