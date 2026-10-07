import { Router } from 'express';
import { validate } from '../../common/middleware/validate.js';
import { authMiddleware, requireRole } from '../../common/middleware/auth.js';
import * as catalogController from './catalog.controller.js';
import * as catalogDto from './catalog.dto.js';

const router = Router();

router.get('/', catalogController.listServices);
router.get('/:id', validate(catalogDto.getServiceSchema), catalogController.getService);
router.post('/', authMiddleware, requireRole('ADMIN'), validate(catalogDto.createServiceSchema), catalogController.createService);
router.patch('/:id', authMiddleware, requireRole('ADMIN'), validate(catalogDto.updateServiceSchema), catalogController.updateService);
router.delete('/:id', authMiddleware, requireRole('ADMIN'), validate(catalogDto.deleteServiceSchema), catalogController.deleteService);

export default router;