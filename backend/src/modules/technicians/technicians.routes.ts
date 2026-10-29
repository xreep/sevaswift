import { Router } from 'express';
import { validate } from '../../common/middleware/validate';
import { authMiddleware, requireRole } from '../../common/middleware/auth';
import * as techniciansController from './technicians.controller';
import * as techniciansDto from './technicians.dto';

const router = Router();

router.use(authMiddleware, requireRole('TECHNICIAN'));

router.get('/me', techniciansController.getMe);
router.patch(
  '/me/availability',
  validate(techniciansDto.availabilitySchema),
  techniciansController.setAvailability
);
router.put('/me/skills', validate(techniciansDto.skillsSchema), techniciansController.setSkills);
router.post(
  '/me/location',
  validate(techniciansDto.locationSchema),
  techniciansController.updateLocation
);
router.get('/me/offers', techniciansController.listOffers);
router.get('/me/stats', techniciansController.getStats);

export default router;
