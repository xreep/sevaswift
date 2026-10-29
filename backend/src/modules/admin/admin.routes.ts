import { Router } from 'express';
import { validate } from '../../common/middleware/validate';
import { authMiddleware, requireRole } from '../../common/middleware/auth';
import * as adminController from './admin.controller';
import * as adminDto from './admin.dto';

const router = Router();

router.use(authMiddleware, requireRole('ADMIN'));

router.get('/overview', adminController.overview);
router.get('/live', adminController.liveMap);
router.get('/services', adminController.listAllServices);

router.get(
  '/technicians',
  validate(adminDto.listTechniciansSchema),
  adminController.listTechnicians
);
router.patch(
  '/technicians/:id/verification',
  validate(adminDto.verificationSchema),
  adminController.setVerification
);

router.get('/users', validate(adminDto.listUsersSchema), adminController.listUsers);
router.patch(
  '/users/:id/status',
  validate(adminDto.userStatusSchema),
  adminController.setUserStatus
);

router.get('/jobs/:id/candidates', validate(adminDto.jobIdSchema), adminController.jobCandidates);
router.post('/jobs/:id/assign', validate(adminDto.assignSchema), adminController.assignJob);
router.post('/jobs/:id/offer', validate(adminDto.assignSchema), adminController.offerJob);

router.get('/analytics', validate(adminDto.analyticsSchema), adminController.analytics);
router.get('/reports/jobs.csv', validate(adminDto.analyticsSchema), adminController.jobsCsv);

export default router;
