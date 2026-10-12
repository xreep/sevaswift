import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { config } from '../../config/index';
import { prisma } from '../prisma';
import { forbidden, unauthorized } from '../errors/index';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: Role;
  };
}

function readAccessToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim() || undefined;
  }
  return undefined;
}

export async function authMiddleware(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const accessToken = readAccessToken(req);
  if (!accessToken) {
    throw unauthorized('MISSING_TOKEN', 'Access token required');
  }

  let payload: { sub: string };
  try {
    payload = jwt.verify(accessToken, config.jwt.accessSecret) as { sub: string };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw unauthorized('TOKEN_EXPIRED', 'Access token expired');
    }
    throw unauthorized('INVALID_TOKEN', 'Invalid access token');
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, role: true, status: true },
  });

  if (!user || user.status !== 'ACTIVE') {
    throw unauthorized('USER_NOT_FOUND', 'User not found or inactive');
  }

  req.user = { id: user.id, email: user.email, role: user.role };
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: AuthRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw unauthorized('MISSING_TOKEN', 'Access token required');
    }
    if (!roles.includes(req.user.role)) {
      throw forbidden('FORBIDDEN', 'Insufficient permissions');
    }
    next();
  };
}
