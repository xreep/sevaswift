import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { validate } from '../../common/middleware/validate';
import { authMiddleware, type AuthRequest } from '../../common/middleware/auth';
import { AppError } from '../../common/errors/index';
import * as uploadsService from './uploads.service';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: uploadsService.MAX_UPLOAD_BYTES, files: 1 },
});

function single(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, err => {
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 5 MB or smaller' : err.message;
      return next(new AppError(400, 'UPLOAD_FAILED', message));
    }
    next(err);
  });
}

router.post('/', authMiddleware, single, async (req: AuthRequest, res, next) => {
  try {
    const created = await uploadsService.createUpload(req.user!.id, req.file);
    res.status(201).json({ upload: created });
  } catch (err) {
    next(err);
  }
});

// Served without auth so <img> tags work; ids are random UUIDs.
router.get(
  '/:id',
  validate(z.object({ params: z.object({ id: z.string().uuid() }) })),
  async (req, res, next) => {
    try {
      const file = await uploadsService.getUpload(req.params.id as string);
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(Buffer.from(file.data));
    } catch (err) {
      next(err);
    }
  }
);

export default router;
