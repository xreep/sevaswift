import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/index';
import { config } from '../../config/index';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    const problem = err.toProblemDetails(_req.originalUrl);
    res.status(problem.status).json(problem);
    return;
  }

  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.errors) {
      const path = issue.path.join('.');
      if (!fieldErrors[path]) fieldErrors[path] = [];
      fieldErrors[path].push(issue.message);
    }
    const problem: ReturnType<AppError['toProblemDetails']> = {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      fieldErrors,
      instance: _req.originalUrl,
    };
    res.status(400).json(problem);
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = err.meta?.target as string[] | undefined;
      const field = target?.[0] ?? 'field';
      const problem = new AppError(409, 'DUPLICATE_ENTRY', `A record with this ${field} already exists`).toProblemDetails(_req.originalUrl);
      res.status(409).json(problem);
      return;
    }
  }

  console.error('Unhandled error:', err);
  const problem = new AppError(500, 'INTERNAL_ERROR', config.nodeEnv === 'production' ? 'An unexpected error occurred' : err.message).toProblemDetails(_req.originalUrl);
  res.status(500).json(problem);
}