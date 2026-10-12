import { Router } from 'express';
import { validate } from '../../common/middleware/validate';
import { authMiddleware, requireRole } from '../../common/middleware/auth';
import * as jobsController from './jobs.controller';
import * as jobsDto from './jobs.dto';

const router = Router();

router.use(authMiddleware);

router.post(
  '/',
  requireRole('CUSTOMER'),
  validate(jobsDto.createJobSchema),
  jobsController.createJob
);
router.get('/', validate(jobsDto.listJobsSchema), jobsController.listJobs);
router.get('/:id', validate(jobsDto.jobIdSchema), jobsController.getJob);
router.post(
  '/:id/accept',
  requireRole('TECHNICIAN'),
  validate(jobsDto.jobIdSchema),
  jobsController.acceptJob
);
router.post(
  '/:id/reject',
  requireRole('TECHNICIAN'),
  validate(jobsDto.jobIdSchema),
  jobsController.rejectJob
);
router.post(
  '/:id/status',
  requireRole('TECHNICIAN'),
  validate(jobsDto.updateStatusSchema),
  jobsController.updateStatus
);
router.post(
  '/:id/cancel',
  requireRole('CUSTOMER', 'ADMIN'),
  validate(jobsDto.cancelJobSchema),
  jobsController.cancelJob
);
router.post(
  '/:id/review',
  requireRole('CUSTOMER'),
  validate(jobsDto.reviewJobSchema),
  jobsController.reviewJob
);

export default router;
