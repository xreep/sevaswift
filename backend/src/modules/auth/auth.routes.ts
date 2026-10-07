import { Router } from 'express';
import { validate } from '../../common/middleware/validate';
import { authMiddleware } from '../../common/middleware/auth';
import * as authController from './auth.controller';
import * as authDto from './auth.dto';

const router = Router();

router.post('/register', validate(authDto.registerSchema), authController.register);
router.post('/login', validate(authDto.loginSchema), authController.login);
router.post('/refresh', validate(authDto.refreshSchema), authController.refresh);
router.post('/logout', authController.logout);
router.post('/verify-email', validate(authDto.verifyEmailSchema), authController.verifyEmail);
router.post('/forgot-password', validate(authDto.forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', validate(authDto.resetPasswordSchema), authController.resetPassword);
router.get('/me', authMiddleware, authController.me);

export default router;