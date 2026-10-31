import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import type { Role } from '@prisma/client';
import { createApp } from '@/app';
import { config } from '@/config/index';
import { prisma } from '@/common/prisma';
import { setClock } from '@/common/utils/clock';

const app = createApp();
const DOMAIN = '@cleanup.test';
const DEMO_LOOKALIKE = 'tech_cleanup_0@demo.sevaswift';
const SERVICE_ID = 'cleanup_test_service';
// Southern Indian Ocean, far from every other suite's fixtures.
const SPOT = { lat: -50.0, lng: 100.0 };
const KM = 1 / 111;
const START = new Date('2026-10-07T12:00:00.000Z').getTime();
const PASSWORD = 'Password123';

const users: Record<string, { id: string; token: string }> = {};

async function makeUser(
  key: string,
  role: Role,
  opts: { name?: string; verified?: boolean; email?: string } = {}
) {
  const email = opts.email ?? `${key}${DOMAIN}`;
  const user = await prisma.user.create({
    data: {
      name: opts.name ?? key,
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      role,
      emailVerified: opts.verified ?? true,
    },
  });
  users[key] = {
    id: user.id,
    token: jwt.sign({ sub: user.id, email, role }, config.jwt.accessSecret),
  };
  return user;
}

async function makeTech(key: string, km: number, name?: string) {
  const user = await makeUser(key, 'TECHNICIAN', { name });
  await prisma.technicianProfile.create({
    data: {
      userId: user.id,
      verificationStatus: 'VERIFIED',
      isOnline: true,
      locationUpdatedAt: new Date(START),
      lastLat: SPOT.lat + km * KM,
      lastLng: SPOT.lng,
      skills: { create: { serviceId: SERVICE_ID } },
    },
  });
  return user;
}

const auth = (key: string) => ({ Authorization: `Bearer ${users[key].token}` });

function raise(customer: string, extra: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/v1/jobs')
    .set(auth(customer))
    .send({
      serviceId: SERVICE_ID,
      ...SPOT,
      address: '4 Cleanup Lane',
      priority: 'URGENT',
      ...extra,
    });
}

/** Raises a job, lets `tech` accept it and walks it to `upTo`. */
async function jobWith(customer: string, tech: string, upTo: string[] = [], extra = {}) {
  const job = (await raise(customer, extra).expect(201)).body.job;
  await request(app).post(`/api/v1/jobs/${job.id}/accept`).set(auth(tech)).expect(200);
  for (const status of upTo) {
    await request(app)
      .post(`/api/v1/jobs/${job.id}/status`)
      .set(auth(tech))
      .send({ status, confirmFar: true })
      .expect(200);
  }
  return job.id as string;
}

async function resetTech(key: string, km: number) {
  await prisma.technicianProfile.update({
    where: { userId: users[key].id },
    data: { isOnline: true, lastLat: SPOT.lat + km * KM, locationUpdatedAt: new Date(START) },
  });
}

async function cleanup() {
  await prisma.jobRequest.deleteMany({ where: { customer: { email: { endsWith: DOMAIN } } } });
  await prisma.user.deleteMany({
    where: { OR: [{ email: { endsWith: DOMAIN } }, { email: DEMO_LOOKALIKE }] },
  });
  await prisma.service.deleteMany({ where: { id: SERVICE_ID } });
}

beforeAll(async () => {
  setClock({ now: () => START });
  await cleanup();
  await prisma.service.create({
    data: { id: SERVICE_ID, name: 'Cleanup Test Plumbing', category: 'Test', baseFee: 49900 },
  });
  await makeUser('admin', 'ADMIN');
  await makeUser('customer', 'CUSTOMER');
  await makeTech('tech', 0.2);
});

beforeEach(async () => {
  setClock({ now: () => START });
  await prisma.jobRequest.deleteMany({ where: { customer: { email: { endsWith: DOMAIN } } } });
  await resetTech('tech', 0.2);
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('email verification gate', () => {
  it('blocks an unverified customer until the email is verified', async () => {
    await makeUser('unverified', 'CUSTOMER', { verified: false });
    const res = await raise('unverified').expect(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(await prisma.jobRequest.count({ where: { customerId: users.unverified.id } })).toBe(0);
  });

  it('resends a fresh link and retires the old one', async () => {
    const before = await prisma.authToken.count({
      where: { userId: users.unverified.id, usedAt: null },
    });
    await request(app).post('/api/v1/auth/resend-verification').set(auth('unverified')).expect(200);
    await request(app).post('/api/v1/auth/resend-verification').set(auth('unverified')).expect(200);
    const live = await prisma.authToken.count({
      where: { userId: users.unverified.id, usedAt: null, purpose: 'EMAIL_VERIFICATION' },
    });
    expect(before).toBe(0);
    expect(live).toBe(1);
  });

  it('lets an admin mark the email verified when no mail can be delivered', async () => {
    await request(app)
      .patch(`/api/v1/admin/users/${users.unverified.id}/email-verified`)
      .set(auth('customer'))
      .send({ emailVerified: true })
      .expect(403);
    const res = await request(app)
      .patch(`/api/v1/admin/users/${users.unverified.id}/email-verified`)
      .set(auth('admin'))
      .send({ emailVerified: true })
      .expect(200);
    expect(res.body.user.emailVerified).toBe(true);
    await raise('unverified').expect(201);
  });
});

describe('arrival check', () => {
  it('asks the technician to confirm "arrived" when far from the pin, then notes it', async () => {
    const jobId = await jobWith('customer', 'tech', ['EN_ROUTE']);
    await resetTech('tech', 5);

    const refused = await request(app)
      .post(`/api/v1/jobs/${jobId}/status`)
      .set(auth('tech'))
      .send({ status: 'ARRIVED' })
      .expect(409);
    expect(refused.body.code).toBe('ARRIVAL_CONFIRMATION_REQUIRED');
    expect(refused.body.details.distanceKm).toBeCloseTo(5, 0);
    expect((await prisma.jobRequest.findUniqueOrThrow({ where: { id: jobId } })).status).toBe(
      'EN_ROUTE'
    );

    const ok = await request(app)
      .post(`/api/v1/jobs/${jobId}/status`)
      .set(auth('tech'))
      .send({ status: 'ARRIVED', confirmFar: true })
      .expect(200);
    const arrived = ok.body.job.timeline.find((t: { to: string }) => t.to === 'ARRIVED');
    expect(arrived.note).toMatch(
      /^Marked arrived 5(\.\d+)? km from the customer's pin \(technician confirmed\)$/
    );
  });

  it('marks arrived without a prompt or note when at the customer', async () => {
    const jobId = await jobWith('customer', 'tech', ['EN_ROUTE']);
    const res = await request(app)
      .post(`/api/v1/jobs/${jobId}/status`)
      .set(auth('tech'))
      .send({ status: 'ARRIVED' })
      .expect(200);
    const arrived = res.body.job.timeline.find((t: { to: string }) => t.to === 'ARRIVED');
    expect(arrived.note).toBeNull();
  });
});

describe('deleting accounts and jobs', () => {
  it('protects admins, demo logins, your own account and accounts with open jobs', async () => {
    await makeUser('demo', 'CUSTOMER', { email: DEMO_LOOKALIKE });
    const del = (key: string) =>
      request(app).delete(`/api/v1/admin/users/${users[key].id}`).set(auth('admin'));

    expect((await del('admin').expect(403)).body.code).toBe('SELF_UPDATE');
    expect((await del('demo').expect(403)).body.code).toBe('DEMO_PROTECTED');

    await makeUser('busy', 'CUSTOMER');
    await raise('busy').expect(201);
    expect((await del('busy').expect(409)).body.code).toBe('HAS_OPEN_JOBS');
    expect(await prisma.user.count({ where: { id: users.busy.id } })).toBe(1);
  });

  it('deletes a customer with their ratings and corrects the technician totals', async () => {
    await makeUser('leaver', 'CUSTOMER');
    const jobId = await jobWith('leaver', 'tech', [
      'EN_ROUTE',
      'ARRIVED',
      'IN_PROGRESS',
      'COMPLETED',
    ]);
    await request(app)
      .post(`/api/v1/jobs/${jobId}/review`)
      .set(auth('leaver'))
      .send({ rating: 1 })
      .expect(201);
    let profile = await prisma.technicianProfile.findUniqueOrThrow({
      where: { userId: users.tech.id },
    });
    expect(profile).toMatchObject({ ratingCount: 1, ratingAvg: 1, completedJobs: 1 });

    await request(app)
      .delete(`/api/v1/admin/users/${users.leaver.id}`)
      .set(auth('admin'))
      .expect(200);

    expect(await prisma.user.count({ where: { id: users.leaver.id } })).toBe(0);
    expect(await prisma.jobRequest.count({ where: { id: jobId } })).toBe(0);
    profile = await prisma.technicianProfile.findUniqueOrThrow({
      where: { userId: users.tech.id },
    });
    expect(profile).toMatchObject({ ratingCount: 0, ratingAvg: 0, completedJobs: 0 });
  });

  it('deletes only finished jobs', async () => {
    const open = (await raise('customer').expect(201)).body.job.id;
    const refused = await request(app)
      .delete(`/api/v1/admin/jobs/${open}`)
      .set(auth('admin'))
      .expect(409);
    expect(refused.body.code).toBe('JOB_NOT_DELETABLE');

    await request(app)
      .post(`/api/v1/jobs/${open}/cancel`)
      .set(auth('customer'))
      .send({ reason: 'TEST cleanup' })
      .expect(200);
    await request(app).delete(`/api/v1/admin/jobs/${open}`).set(auth('admin')).expect(200);
    expect(await prisma.jobRequest.count({ where: { id: open } })).toBe(0);
  });

  it('lets a user delete their own account after re-entering the password', async () => {
    await makeUser('self', 'CUSTOMER');
    const wrong = await request(app)
      .delete('/api/v1/users/me')
      .set(auth('self'))
      .send({ password: 'not-it' })
      .expect(400);
    expect(wrong.body.code).toBe('INVALID_PASSWORD');

    await request(app)
      .delete('/api/v1/users/me')
      .set(auth('self'))
      .send({ password: PASSWORD })
      .expect(204);
    await request(app).get('/api/v1/users/me').set(auth('self')).expect(401);
  });

  it('never lets an admin delete their own account from the profile', async () => {
    const res = await request(app)
      .delete('/api/v1/users/me')
      .set(auth('admin'))
      .send({ password: PASSWORD })
      .expect(403);
    expect(res.body.code).toBe('ADMIN_PROTECTED');
  });
});

describe('TEST data purge', () => {
  it('previews and removes only TEST-labelled records, skipping open work', async () => {
    await makeUser('testcust', 'CUSTOMER', { name: 'TEST Customer 071026' });
    await makeTech('testtech', 50, 'TEST Technician 071026');
    await makeUser('testopen', 'CUSTOMER', { name: 'TEST Open Customer' });
    await makeUser('realname', 'CUSTOMER', { name: 'Testa Real' });

    const done = await jobWith('testcust', 'tech', [
      'EN_ROUTE',
      'ARRIVED',
      'IN_PROGRESS',
      'COMPLETED',
    ]);
    await request(app)
      .post(`/api/v1/jobs/${done}/review`)
      .set(auth('testcust'))
      .send({ rating: 2 })
      .expect(201);
    // A real customer's job labelled TEST in its description, already cancelled.
    const labelled = (await raise('customer', { description: 'TEST only, ignore' }).expect(201))
      .body.job.id;
    await request(app).post(`/api/v1/jobs/${labelled}/cancel`).set(auth('customer')).expect(200);
    const realJob = (await raise('customer').expect(201)).body.job.id;
    await request(app).post(`/api/v1/jobs/${realJob}/cancel`).set(auth('customer')).expect(200);
    const stillOpen = (await raise('testopen').expect(201)).body.job.id;

    const preview = await request(app)
      .get('/api/v1/admin/test-data')
      .set(auth('admin'))
      .expect(200);
    const { users: tu, jobs: tj } = preview.body.testData;
    expect(tu.map((u: { name: string }) => u.name).sort()).toEqual([
      'TEST Customer 071026',
      'TEST Open Customer',
      'TEST Technician 071026',
    ]);
    expect(tu.find((u: { name: string }) => u.name === 'TEST Open Customer').skipped).toBe(true);
    expect(tj.map((j: { id: string }) => j.id).sort()).toEqual([done, labelled, stillOpen].sort());
    expect(tj.find((j: { id: string }) => j.id === stillOpen).skipped).toBe(true);

    const refused = await request(app)
      .post('/api/v1/admin/test-data/purge')
      .set(auth('admin'))
      .send({ confirmText: 'delete' })
      .expect(400);
    expect(refused.body.code).toBe('CONFIRMATION_REQUIRED');

    const res = await request(app)
      .post('/api/v1/admin/test-data/purge')
      .set(auth('admin'))
      .send({ confirmText: 'DELETE TEST DATA' })
      .expect(200);
    expect(res.body.purged).toEqual({
      deletedUsers: 2,
      deletedJobs: 2,
      skippedUsers: 1,
      skippedJobs: 1,
    });

    const left = await prisma.user.findMany({
      where: { id: { in: Object.values(users).map(u => u.id) } },
      select: { name: true },
    });
    const names = left.map(u => u.name);
    expect(names).toEqual(expect.arrayContaining(['TEST Open Customer', 'Testa Real', 'customer']));
    expect(names).not.toContain('TEST Customer 071026');
    expect(names).not.toContain('TEST Technician 071026');
    expect(await prisma.jobRequest.count({ where: { id: { in: [done, labelled] } } })).toBe(0);
    expect(await prisma.jobRequest.count({ where: { id: { in: [realJob, stillOpen] } } })).toBe(2);

    const profile = await prisma.technicianProfile.findUniqueOrThrow({
      where: { userId: users.tech.id },
    });
    expect(profile).toMatchObject({ ratingCount: 0, completedJobs: 0 });
  });
});
