import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../../common/middleware/auth';
import * as techniciansService from './technicians.service';

export async function getMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const profile = await techniciansService.getProfile(req.user!.id);
    res.json({ profile });
  } catch (err) {
    next(err);
  }
}

export async function setAvailability(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const profile = await techniciansService.setAvailability(req.user!.id, req.body.isOnline);
    res.json({ profile });
  } catch (err) {
    next(err);
  }
}

export async function setSkills(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const profile = await techniciansService.setSkills(req.user!.id, req.body);
    res.json({ profile });
  } catch (err) {
    next(err);
  }
}

export async function updateLocation(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await techniciansService.updateLocation(req.user!.id, req.body);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function listOffers(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const offers = await techniciansService.listOffers(req.user!.id);
    res.json({ offers });
  } catch (err) {
    next(err);
  }
}
