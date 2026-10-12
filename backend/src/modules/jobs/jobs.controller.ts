import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../../common/middleware/auth';
import * as dispatchService from '../dispatch/dispatch.service';
import * as jobsService from './jobs.service';
import type { ListJobsQuery } from './jobs.dto';

export async function createJob(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const job = await jobsService.createJob(req.user!.id, req.body);
    res.status(201).json({ job });
  } catch (err) {
    next(err);
  }
}

export async function listJobs(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const jobs = await jobsService.listJobs(req.user!, req.query as unknown as ListJobsQuery);
    res.json({ jobs });
  } catch (err) {
    next(err);
  }
}

export async function getJob(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const job = await jobsService.getJob(req.params.id as string, req.user!);
    res.json({ job });
  } catch (err) {
    next(err);
  }
}

export async function acceptJob(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await dispatchService.acceptOffer(req.params.id as string, req.user!.id);
    const job = await jobsService.getJob(req.params.id as string, req.user!);
    res.json({ job });
  } catch (err) {
    next(err);
  }
}

export async function rejectJob(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await dispatchService.rejectOffer(req.params.id as string, req.user!.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function updateStatus(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const job = await jobsService.updateStatus(req.params.id as string, req.user!.id, req.body);
    res.json({ job });
  } catch (err) {
    next(err);
  }
}

export async function cancelJob(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const job = await jobsService.cancelJob(req.params.id as string, req.user!, req.body);
    res.json({ job });
  } catch (err) {
    next(err);
  }
}

export async function reviewJob(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const job = await jobsService.reviewJob(req.params.id as string, req.user!.id, req.body);
    res.status(201).json({ job });
  } catch (err) {
    next(err);
  }
}
