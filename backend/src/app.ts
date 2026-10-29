import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { errorHandler } from './common/middleware/errorHandler';
import { notFoundHandler } from './common/middleware/notFoundHandler';
import { config } from './config/index';
import authRoutes from './modules/auth/auth.routes';
import catalogRoutes from './modules/catalog/catalog.routes';
import jobsRoutes from './modules/jobs/jobs.routes';
import techniciansRoutes from './modules/technicians/technicians.routes';
import usersRoutes from './modules/users/users.routes';
import uploadsRoutes from './modules/uploads/uploads.routes';
import adminRoutes from './modules/admin/admin.routes';
import availabilityRoutes from './modules/dispatch/availability';

const tooManyRequests = {
  status: 429,
  code: 'TOO_MANY_REQUESTS',
  message: 'Too many requests, please try again later',
};

export function createApp() {
  const app = express();
  const skip = () => config.nodeEnv === 'test';

  // Render/Vercel sit behind a proxy; needed for correct client IPs in rate limiting.
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Map tiles come from OpenStreetMap; geocoding from Nominatim.
          'img-src': [
            "'self'",
            'data:',
            'blob:',
            'https://tile.openstreetmap.org',
            'https://*.tile.openstreetmap.org',
          ],
          'connect-src': ["'self'", 'https://nominatim.openstreetmap.org', 'wss:', 'ws:'],
        },
      },
    })
  );
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use(
    '/api/',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 1000,
      standardHeaders: true,
      legacyHeaders: false,
      message: tooManyRequests,
      skip,
    })
  );

  // Strict limit only on credential endpoints; refresh and /me are called routinely.
  app.use(
    [
      '/api/v1/auth/login',
      '/api/v1/auth/register',
      '/api/v1/auth/forgot-password',
      '/api/v1/auth/reset-password',
    ],
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 20,
      standardHeaders: true,
      legacyHeaders: false,
      message: tooManyRequests,
      skip,
    })
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/services', catalogRoutes);
  app.use('/api/v1/jobs', jobsRoutes);
  app.use('/api/v1/technicians', techniciansRoutes);
  app.use('/api/v1/users', usersRoutes);
  app.use('/api/v1/uploads', uploadsRoutes);
  app.use('/api/v1/admin', adminRoutes);
  app.use('/api/v1/availability', availabilityRoutes);

  // Single-service deployment: serve the built web app and let it handle client routes.
  const dist = config.frontendDist ? path.resolve(config.frontendDist) : null;
  if (dist && fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/|\/socket\.io\/|\/health$).*/, (_req, res) => {
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
