import request from 'supertest';
import { createApp } from '@/app';
import { prisma } from '@/common/prisma';
import * as authService from '@/modules/auth/auth.service';

const app = createApp();
const DOMAIN = '@security.test';
const password = 'password123';

function cookieValue(res: request.Response, name: string): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find(c => c.startsWith(`${name}=`));
  return cookie?.split(';')[0].split('=')[1] ?? '';
}

async function registerUser(local: string, role: 'CUSTOMER' | 'TECHNICIAN' = 'CUSTOMER') {
  return request(app)
    .post('/api/v1/auth/register')
    .send({ name: 'Security Test', email: `${local}${DOMAIN}`, password, role })
    .expect(201);
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('access token handling', () => {
  it('accepts the Bearer token returned by login on protected routes', async () => {
    const reg = await registerUser('bearer');
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(200);

    expect(res.body.user.email).toBe(`bearer${DOMAIN}`);
  });

  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/v1/auth/me').expect(401);
    expect(res.body.code).toBe('MISSING_TOKEN');
  });

  it('rejects a malformed token', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  it('returns 403 (not 401) when the role is wrong', async () => {
    const reg = await registerUser('customer');
    const res = await request(app)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ name: 'X', category: 'Y', baseFee: 100 })
      .expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});

describe('registration', () => {
  it('normalizes email case and whitespace', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Mixed', email: `  MiXeD${DOMAIN.toUpperCase()} `, password, role: 'CUSTOMER' })
      .expect(201);
    expect(res.body.user.email).toBe(`mixed${DOMAIN}`);

    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `mixed${DOMAIN}`, password })
      .expect(200);
  });

  it('creates a technician profile for technician accounts', async () => {
    const res = await registerUser('newtech', 'TECHNICIAN');
    const profile = await prisma.technicianProfile.findUnique({
      where: { userId: res.body.user.id },
    });
    expect(profile?.verificationStatus).toBe('PENDING');
  });
});

describe('token separation', () => {
  it('does not accept a refresh token as a password reset token', async () => {
    const reg = await registerUser('takeover');
    const refreshToken = cookieValue(reg, 'refreshToken');

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: refreshToken, password: 'hijacked123' })
      .expect(400);
    expect(res.body.code).toBe('INVALID_RESET_TOKEN');

    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `takeover${DOMAIN}`, password })
      .expect(200);
  });

  it('does not accept a reset token as a refresh token', async () => {
    await registerUser('resetrefresh');
    const resetToken = await authService.forgotPassword({ email: `resetrefresh${DOMAIN}` });

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`refreshToken=${resetToken}`])
      .expect(401);
    expect(res.body.code).toBe('INVALID_REFRESH_TOKEN');
  });
});

describe('password reset', () => {
  it('resets the password once and signs out existing sessions', async () => {
    const reg = await registerUser('reset');
    const refreshToken = cookieValue(reg, 'refreshToken');
    const resetToken = await authService.forgotPassword({ email: `reset${DOMAIN}` });
    expect(resetToken).toBeTruthy();

    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: resetToken, password: 'newpassword123' })
      .expect(200);

    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `reset${DOMAIN}`, password: 'newpassword123' })
      .expect(200);

    // Single use.
    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: resetToken, password: 'another123' })
      .expect(400);

    // Old session no longer refreshes.
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`refreshToken=${refreshToken}`])
      .expect(401);
  });

  it('returns null for unknown emails without leaking existence', async () => {
    expect(await authService.forgotPassword({ email: `nobody${DOMAIN}` })).toBeNull();
    await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: `nobody${DOMAIN}` })
      .expect(200);
  });
});

describe('refresh rotation', () => {
  it('records which token replaced the old one', async () => {
    const reg = await registerUser('rotate');
    const refreshToken = cookieValue(reg, 'refreshToken');

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`refreshToken=${refreshToken}`])
      .expect(200);
    const newToken = cookieValue(res, 'refreshToken');
    expect(newToken).not.toBe(refreshToken);

    const tokens = await prisma.refreshToken.findMany({
      where: { user: { email: `rotate${DOMAIN}` } },
      orderBy: { createdAt: 'asc' },
    });
    const [oldRow, newRow] = tokens;
    expect(oldRow.revokedAt).not.toBeNull();
    expect(oldRow.replacedByTokenHash).toBe(newRow.tokenHash);
    expect(newRow.replacedByTokenHash).toBeNull();
  });
});
