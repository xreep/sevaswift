import { Router } from 'express';
import { validate } from '../../common/middleware/validate';
import { authMiddleware } from '../../common/middleware/auth';
import * as usersController from './users.controller';
import * as usersDto from './users.dto';

const router = Router();

router.use(authMiddleware);

router.get('/me', usersController.getMe);
router.patch('/me', validate(usersDto.updateProfileSchema), usersController.updateMe);
router.post(
  '/me/password',
  validate(usersDto.changePasswordSchema),
  usersController.changePassword
);

export default router;
