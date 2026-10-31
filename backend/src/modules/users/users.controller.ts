import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../../common/middleware/auth';
import * as usersService from './users.service';
import { deleteOwnAccount } from '../admin/cleanup.service';

export async function getMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await usersService.getProfile(req.user!.id);
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

export async function updateMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await usersService.updateProfile(req.user!.id, req.body);
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

export async function changePassword(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await usersService.changePassword(req.user!.id, req.body);
    res.json({ message: 'Password changed. Other sessions have been signed out.' });
  } catch (err) {
    next(err);
  }
}

export async function deleteMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await deleteOwnAccount(req.user!.id, req.body.password);
    res.clearCookie('refreshToken', { path: '/' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
