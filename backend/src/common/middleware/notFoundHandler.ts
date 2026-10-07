import { Request, Response } from 'express';
import { AppError } from '../errors/index.js';

export function notFoundHandler(req: Request, _res: Response): void {
  throw new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`);
}