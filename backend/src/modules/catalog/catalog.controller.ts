import { Request, Response, NextFunction } from 'express';
import * as catalogService from './catalog.service.js';
import { AppError } from '../../common/errors/index.js';

export async function listServices(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const services = await catalogService.listServices();
    res.json({ services });
  } catch (err) {
    next(err);
  }
}

export async function getService(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const service = await catalogService.getService(req.params.id as string);
    res.json({ service });
  } catch (err) {
    next(err);
  }
}

export async function createService(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const service = await catalogService.createService(req.body);
    res.status(201).json({ service });
  } catch (err) {
    next(err);
  }
}

export async function updateService(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const service = await catalogService.updateService(req.params.id as string, req.body);
    res.json({ service });
  } catch (err) {
    next(err);
  }
}

export async function deleteService(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await catalogService.deleteService(req.params.id as string);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}