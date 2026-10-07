import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config/index.js';
import { unauthorized } from '../errors/index.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: 'CUSTOMER' | 'TECHNICIAN' | 'ADMIN';
  };
}

export async function authMiddleware(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const accessToken = req.cookies?.accessToken;
  if (!accessToken) {
    throw unauthorized('MISSING_TOKEN', 'Access token required');
  }

  try {
    const payload = jwt.verify(accessToken, config.jwt.accessSecret) as {
      sub: string;
      email: string;
      role: 'CUSTOMER' | 'TECHNICIAN' | 'ADMIN';
    };

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, status: true },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw unauthorized('USER_NOT_FOUND', 'User not found or inactive');
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
    };
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw unauthorized('TOKEN_EXPIRED', 'Access token expired');
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw unauthorized('INVALID_TOKEN', 'Invalid access token');
    }
    throw err;
  }
}

export function requireRole(...roles: Array<'CUSTOMER' | 'TECHNICIAN' | 'ADMIN'>) {
  return (req: AuthRequest, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw unauthorized('FORBIDDEN', 'Insufficient permissions');
    }
    next();
  };
}