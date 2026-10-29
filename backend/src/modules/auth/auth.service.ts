import type { Role } from '@prisma/client';
import { AuthTokenPurpose, UserStatus } from '@prisma/client';
import type { Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../../config/index';
import { prisma } from '../../common/prisma';
import { getClock } from '../../common/utils/clock';
import { badRequest, conflict, unauthorized, notFound } from '../../common/errors/index';
import { sendMail } from '../../common/mail/index';
import type {
  RegisterInput,
  LoginInput,
  VerifyEmailInput,
  ForgotPasswordInput,
  ResetPasswordInput,
} from './auth.dto';

// A real bcrypt hash (of a random string) so unknown-email logins cost the same as real ones.
const DUMMY_HASH = '$2b$10$cFUj4KIoF.NylmtLIA4zIO4Eq1K.tiCs8NxVW/KFwZXwq2LNvDS.G';

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

const userSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  emailVerified: true,
  createdAt: true,
} as const;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateTokens(userId: string, email: string, role: Role) {
  const accessToken = jwt.sign({ sub: userId, email, role }, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiry as jwt.SignOptions['expiresIn'],
  });
  const refreshToken = crypto.randomBytes(32).toString('hex');
  const refreshTokenHash = hashToken(refreshToken);
  const expiresAt = new Date(getClock().now() + REFRESH_TTL_MS);

  return { accessToken, refreshToken, refreshTokenHash, expiresAt };
}

function setRefreshTokenCookie(res: Response, refreshToken: string) {
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
    maxAge: REFRESH_TTL_MS,
    path: '/',
  });
}

function clearRefreshTokenCookie(res: Response) {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
    path: '/',
  });
}

async function issueSession(res: Response, user: { id: string; email: string; role: Role }) {
  const { accessToken, refreshToken, refreshTokenHash, expiresAt } = generateTokens(
    user.id,
    user.email,
    user.role
  );
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: refreshTokenHash, expiresAt },
  });
  setRefreshTokenCookie(res, refreshToken);
  return accessToken;
}

async function createAuthToken(userId: string, purpose: AuthTokenPurpose, ttlMs: number) {
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.authToken.create({
    data: {
      userId,
      purpose,
      tokenHash: hashToken(token),
      expiresAt: new Date(getClock().now() + ttlMs),
    },
  });
  return token;
}

async function consumeAuthToken(token: string, purpose: AuthTokenPurpose) {
  const stored = await prisma.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
  const now = new Date(getClock().now());
  if (!stored || stored.purpose !== purpose || stored.usedAt || stored.expiresAt < now) {
    return null;
  }
  return stored;
}

function appLink(path: string, token: string) {
  return `${config.appUrl.replace(/\/$/, '')}${path}?token=${token}`;
}

export async function register(input: RegisterInput, res: Response) {
  if (input.role === 'ADMIN') {
    throw badRequest('INVALID_ROLE', 'Admin registration not allowed');
  }

  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) {
    throw conflict('EMAIL_EXISTS', 'Email already registered');
  }

  const passwordHash = await bcrypt.hash(input.password, 10);

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      phone: input.phone,
      passwordHash,
      role: input.role,
      status: UserStatus.ACTIVE,
      emailVerified: false,
      ...(input.role === 'TECHNICIAN' && { technicianProfile: { create: {} } }),
    },
    select: userSelect,
  });

  const verificationToken = await createAuthToken(
    user.id,
    AuthTokenPurpose.EMAIL_VERIFICATION,
    EMAIL_VERIFICATION_TTL_MS
  );
  void sendMail({
    to: user.email,
    subject: 'Verify your SevaSwift email',
    text: `Hi ${user.name},\n\nConfirm your email address by opening this link (valid for 24 hours):\n${appLink('/verify-email', verificationToken)}\n`,
  });

  const accessToken = await issueSession(res, user);
  return { user, accessToken };
}

export async function login(input: LoginInput, res: Response) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  const isValidPassword = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !isValidPassword) {
    throw unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');
  }

  if (user.status !== UserStatus.ACTIVE) {
    throw unauthorized('ACCOUNT_INACTIVE', 'Account is inactive or suspended');
  }

  const accessToken = await issueSession(res, user);

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    },
    accessToken,
  };
}

export async function refresh(refreshToken: string | undefined, res: Response) {
  if (!refreshToken) {
    throw unauthorized('MISSING_REFRESH_TOKEN', 'Refresh token required');
  }

  const now = new Date(getClock().now());

  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    include: { user: true },
  });

  if (!storedToken) {
    throw unauthorized('INVALID_REFRESH_TOKEN', 'Invalid refresh token');
  }

  if (storedToken.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: storedToken.userId, revokedAt: null },
      data: { revokedAt: now },
    });
    throw unauthorized('TOKEN_REUSE_DETECTED', 'Token reuse detected, all sessions revoked');
  }

  if (storedToken.expiresAt < now) {
    throw unauthorized('REFRESH_TOKEN_EXPIRED', 'Refresh token expired');
  }

  if (storedToken.user.status !== UserStatus.ACTIVE) {
    throw unauthorized('ACCOUNT_INACTIVE', 'Account is inactive or suspended');
  }

  const { user } = storedToken;
  const next = generateTokens(user.id, user.email, user.role);

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: now, replacedByTokenHash: next.refreshTokenHash },
    }),
    prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: next.refreshTokenHash, expiresAt: next.expiresAt },
    }),
  ]);

  setRefreshTokenCookie(res, next.refreshToken);

  return { accessToken: next.accessToken };
}

export async function logout(refreshToken: string | undefined, res: Response): Promise<void> {
  if (refreshToken) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date(getClock().now()) },
    });
  }
  clearRefreshTokenCookie(res);
}

export async function verifyEmail(input: VerifyEmailInput): Promise<void> {
  const stored = await consumeAuthToken(input.token, AuthTokenPurpose.EMAIL_VERIFICATION);
  if (!stored) {
    throw badRequest('INVALID_VERIFICATION_TOKEN', 'Invalid or expired verification token');
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: stored.userId }, data: { emailVerified: true } }),
    prisma.authToken.update({
      where: { id: stored.id },
      data: { usedAt: new Date(getClock().now()) },
    }),
  ]);
}

/** Returns the raw reset token (or null for unknown emails) so tests can drive the flow. */
export async function forgotPassword(input: ForgotPasswordInput): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    return null;
  }

  const resetToken = await createAuthToken(
    user.id,
    AuthTokenPurpose.PASSWORD_RESET,
    PASSWORD_RESET_TTL_MS
  );
  void sendMail({
    to: user.email,
    subject: 'Reset your SevaSwift password',
    text: `Hi ${user.name},\n\nReset your password with this link (valid for 1 hour):\n${appLink('/reset-password', resetToken)}\n\nIf you did not ask for this, you can ignore this email.\n`,
  });
  return resetToken;
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const stored = await consumeAuthToken(input.token, AuthTokenPurpose.PASSWORD_RESET);
  if (!stored) {
    throw badRequest('INVALID_RESET_TOKEN', 'Invalid, expired or already used reset token');
  }

  const passwordHash = await bcrypt.hash(input.password, 10);
  const now = new Date(getClock().now());

  await prisma.$transaction([
    prisma.user.update({ where: { id: stored.userId }, data: { passwordHash } }),
    prisma.authToken.update({ where: { id: stored.id }, data: { usedAt: now } }),
    // A password change signs the user out everywhere.
    prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: now },
    }),
  ]);
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: userSelect });

  if (!user) {
    throw notFound('USER_NOT_FOUND', 'User not found');
  }

  return user;
}
