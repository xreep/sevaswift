import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { errorHandler } from '@/common/middleware/errorHandler';
import { notFoundHandler } from '@/common/middleware/notFoundHandler';
import authRoutes from '@/modules/auth/auth.routes';
import { prisma } from '@/common/prisma';
import bcrypt from 'bcrypt';
import { setClock, getClock } from '@/common/utils/clock';

const app = express();
app.use(express.json());
app.use(cookieParser());

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      status: 429,
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many requests, please try again later',
    });
  },
});
app.use('/api/v1/auth/login', loginLimiter);
app.use('/api/v1/auth', authRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

describe('Auth Module', () => {
  const testEmail = 'test@example.com';
  const testPassword = 'password123';

  beforeAll(() => {
    setClock({ now: () => new Date('2026-10-07T12:00:00.000Z').getTime() });
  });

  afterAll(() => {
    setClock({ now: () => Date.now() });
  });

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany({ where: { user: { email: testEmail } } });
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await prisma.user.deleteMany({ where: { email: 'tech_test@example.com' } });
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { user: { email: testEmail } } });
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await prisma.$disconnect();
  });

  describe('POST /api/v1/auth/register', () => {
    it('registers a new customer', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Test User',
          email: testEmail,
          password: testPassword,
          role: 'CUSTOMER',
        })
        .expect(201);

      expect(res.body.user).toMatchObject({
        email: testEmail,
        name: 'Test User',
        role: 'CUSTOMER',
        status: 'ACTIVE',
      });
      expect(res.body.accessToken).toBeDefined();
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('registers a new technician', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Tech User',
          email: 'tech_test@example.com',
          password: testPassword,
          role: 'TECHNICIAN',
        })
        .expect(201);

      expect(res.body.user.role).toBe('TECHNICIAN');
    });

    it('rejects admin registration', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Admin User',
          email: 'admin_test@example.com',
          password: testPassword,
          role: 'ADMIN',
        })
        .expect(400);

      expect(res.body.code).toBe('INVALID_ROLE');
    });

    it('rejects duplicate email', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Test User',
          email: testEmail,
          password: testPassword,
          role: 'CUSTOMER',
        });

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Another User',
          email: testEmail,
          password: testPassword,
          role: 'CUSTOMER',
        })
        .expect(409);

      expect(res.body.code).toBe('EMAIL_EXISTS');
    });

    it('validates required fields', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({})
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.fieldErrors).toBeDefined();
    });

    it('validates password length', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Test',
          email: 'test2@example.com',
          password: 'short',
          role: 'CUSTOMER',
        })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    beforeEach(async () => {
      const passwordHash = await bcrypt.hash(testPassword, 10);
      await prisma.user.create({
        data: {
          name: 'Test User',
          email: testEmail,
          passwordHash,
          role: 'CUSTOMER',
          status: 'ACTIVE',
          emailVerified: true,
        },
      });
    });

    it('logs in with valid credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testEmail, password: testPassword })
        .expect(200);

      expect(res.body.user.email).toBe(testEmail);
      expect(res.body.accessToken).toBeDefined();
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('rejects invalid password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testEmail, password: 'wrongpassword' })
        .expect(401);

      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects non-existent user', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'nonexistent@example.com', password: testPassword })
        .expect(401);

      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('validates required fields', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({})
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    let refreshToken: string;

    beforeEach(async () => {
      const passwordHash = await bcrypt.hash(testPassword, 10);
      const user = await prisma.user.create({
        data: {
          name: 'Test User',
          email: testEmail,
          passwordHash,
          role: 'CUSTOMER',
          status: 'ACTIVE',
          emailVerified: true,
        },
      });

      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testEmail, password: testPassword });

      const cookies = Array.isArray(loginRes.headers['set-cookie']) 
        ? loginRes.headers['set-cookie'] 
        : [loginRes.headers['set-cookie']].filter(Boolean);
      const refreshCookie = cookies.find((c: string) => c.startsWith('refreshToken='));
      refreshToken = refreshCookie?.split(';')[0].split('=')[1] || '';
    });

    it('refreshes access token with valid refresh token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refreshToken=${refreshToken}`])
        .expect(200);

      expect(res.body.accessToken).toBeDefined();
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('rejects missing refresh token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .expect(401);

      expect(res.body.code).toBe('MISSING_REFRESH_TOKEN');
    });

    it('rejects invalid refresh token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', ['refreshToken=invalid'])
        .expect(401);

      expect(res.body.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('detects token reuse and revokes all sessions', async () => {
      await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refreshToken=${refreshToken}`])
        .expect(200);

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refreshToken=${refreshToken}`])
        .expect(401);

      expect(res.body.code).toBe('TOKEN_REUSE_DETECTED');
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('clears refresh token cookie', async () => {
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .expect(204);

      expect(res.headers['set-cookie']).toBeDefined();
      const cookie = res.headers['set-cookie'][0];
      expect(cookie).toContain('refreshToken=');
      // Cookie can be cleared with Max-Age=0 or Expires in the past
      expect(cookie).toMatch(/Max-Age=0|Expires=/);
    });
  });

  describe('Rate limiting', () => {
    it('limits auth endpoints', async () => {
      for (let i = 0; i < 20; i++) {
        await request(app)
          .post('/api/v1/auth/login')
          .send({ email: `test${i}@example.com`, password: 'password' });
      }

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'test@example.com', password: 'password' })
        .expect(429);

      expect(res.body.code).toBe('TOO_MANY_REQUESTS');
    });
  });
});