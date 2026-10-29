import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../../common/middleware/auth';
import * as adminService from './admin.service';
import * as analyticsService from './analytics.service';
import { listServices } from '../catalog/catalog.service';
import type { ListTechniciansQuery, ListUsersQuery } from './admin.dto';

type Handler = (req: AuthRequest, res: Response) => Promise<void>;

/** Wraps a handler so rejected promises reach the error middleware. */
const handle =
  (fn: Handler) =>
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

export const overview = handle(async (_req, res) => {
  res.json({ overview: await adminService.overview() });
});

export const liveMap = handle(async (_req, res) => {
  res.json(await adminService.liveMap());
});

export const listTechnicians = handle(async (req, res) => {
  const technicians = await adminService.listTechnicians(
    req.query as unknown as ListTechniciansQuery
  );
  res.json({ technicians });
});

export const setVerification = handle(async (req, res) => {
  const technician = await adminService.setVerification(req.params.id as string, req.body);
  res.json({ technician });
});

export const listUsers = handle(async (req, res) => {
  const users = await adminService.listUsers(req.query as unknown as ListUsersQuery);
  res.json({ users });
});

export const setUserStatus = handle(async (req, res) => {
  const user = await adminService.setUserStatus(
    req.user!.id,
    req.params.id as string,
    req.body.status
  );
  res.json({ user });
});

export const jobCandidates = handle(async (req, res) => {
  const candidates = await adminService.jobCandidates(req.params.id as string);
  res.json({ candidates });
});

export const assignJob = handle(async (req, res) => {
  const job = await adminService.assignJob(
    req.user!.id,
    req.params.id as string,
    req.body.technicianUserId
  );
  res.json({ job });
});

export const analytics = handle(async (req, res) => {
  const days = (req.query as unknown as { days: number }).days;
  res.json({ analytics: await analyticsService.analytics(days) });
});

export const jobsCsv = handle(async (req, res) => {
  const days = (req.query as unknown as { days: number }).days;
  const csv = await analyticsService.jobsCsv(days);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="sevaswift-jobs-${days}d-${stamp}.csv"`
  );
  res.send(csv);
});

export const listAllServices = handle(async (_req, res) => {
  res.json({ services: await listServices(true) });
});
