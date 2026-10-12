import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { createApp } from '@/app';
import { config } from '@/config/index';
import { prisma } from '@/common/prisma';
import { setClock } from '@/common/utils/clock';
import { expireOffer } from '@/modules/dispatch/dispatch.service';

const app = createApp();
const DOMAIN = '@dispatch.test';
const SERVICE_ID = 'dispatch_test_service';
const OTHER_SERVICE_ID = 'dispatch_test_other';
// An empty spot (Gulf of Guinea) so no other test data is ever in range.
const JOB = { lat: 1.0, lng: 4.0 };
const KM = 1 / 111; // degrees of latitude per km

const START = new Date('2026-10-07T12:00:00.000Z').getTime();
let clockMs = START;
function advance(seconds: number) {
  clockMs += seconds * 1000;
}

const users: Record<string, { id: string; token: string }> = {};

async function makeUser(key: string, role: Role) {
  const user = await prisma.user.create({
    data: { name: key, email: `${key}${DOMAIN}`, passwordHash: 'x', role },
  });
  const token = jwt.sign({ sub: user.id, email: user.email, role }, config.jwt.accessSecret);
  users[key] = { id: user.id, token };
  return user;
}

async function makeTech(
  key: string,
  opts: { km: number; skill?: string; online?: boolean; verified?: boolean; rating?: number }
) {
  const user = await makeUser(key, 'TECHNICIAN');
  await prisma.technicianProfile.create({
    data: {
      userId: user.id,
      verificationStatus: opts.verified === false ? 'PENDING' : 'VERIFIED',
      isOnline: opts.online ?? true,
      ratingAvg: opts.rating ?? 4.5,
      lastLat: JOB.lat + opts.km * KM,
      lastLng: JOB.lng,
      skills: { create: { serviceId: opts.skill ?? SERVICE_ID } },
    },
  });
}

function auth(key: string) {
  return { Authorization: `Bearer ${users[key].token}` };
}

async function raiseJob(customer = 'customer') {
  const res = await request(app)
    .post('/api/v1/jobs')
    .set(auth(customer))
    .send({ serviceId: SERVICE_ID, ...JOB, address: '1 Test Street', priority: 'URGENT' })
    .expect(201);
  return res.body.job;
}

async function pendingOffer(jobId: string) {
  return prisma.jobOffer.findFirstOrThrow({
    where: { jobId, status: 'PENDING' },
    include: { technician: { include: { user: true } } },
  });
}

async function cleanup() {
  await prisma.jobRequest.deleteMany({ where: { customer: { email: { endsWith: DOMAIN } } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.service.deleteMany({ where: { id: { in: [SERVICE_ID, OTHER_SERVICE_ID] } } });
}

beforeAll(async () => {
  await cleanup();
  await prisma.service.createMany({
    data: [
      { id: SERVICE_ID, name: 'Dispatch Test Plumbing', category: 'Test', baseFee: 49900 },
      { id: OTHER_SERVICE_ID, name: 'Dispatch Test Other', category: 'Test', baseFee: 49900 },
    ],
  });
  await makeUser('customer', 'CUSTOMER');
  await makeUser('othercustomer', 'CUSTOMER');
  await makeUser('admin', 'ADMIN');

  await makeTech('near', { km: 1 });
  await makeTech('mid', { km: 3 });
  await makeTech('far', { km: 6 });
  await makeTech('farther', { km: 9 });
  await makeTech('unskilled', { km: 0.5, skill: OTHER_SERVICE_ID });
  await makeTech('offline', { km: 0.5, online: false });
  await makeTech('unverified', { km: 0.5, verified: false });
  await makeTech('outofrange', { km: 30 });
});

beforeEach(async () => {
  clockMs = START;
  setClock({ now: () => clockMs });
  await prisma.jobRequest.deleteMany({ where: { customer: { email: { endsWith: DOMAIN } } } });
  await prisma.technicianProfile.updateMany({
    where: { user: { email: { endsWith: DOMAIN } }, verificationStatus: 'VERIFIED' },
    data: { completedJobs: 0, ratingCount: 0, ratingAvg: 4.5 },
  });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('auto-dispatch', () => {
  it('offers the job to the nearest verified, online, skilled technician', async () => {
    const job = await raiseJob();
    expect(job.status).toBe('MATCHED');

    const offer = await pendingOffer(job.id);
    expect(offer.technician.user.name).toBe('near');
    expect(offer.round).toBe(1);
    expect(offer.expiresAt.getTime() - offer.offeredAt.getTime()).toBe(60_000);

    const offers = await request(app)
      .get('/api/v1/technicians/me/offers')
      .set(auth('near'))
      .expect(200);
    expect(offers.body.offers.map((o: { id: string }) => o.id)).toEqual([job.id]);
    expect(offers.body.offers[0].customer.phone).toBeNull();
  });

  it('runs the full lifecycle to completion and feedback', async () => {
    const job = await raiseJob();

    const accepted = await request(app)
      .post(`/api/v1/jobs/${job.id}/accept`)
      .set(auth('near'))
      .expect(200);
    expect(accepted.body.job.status).toBe('ACCEPTED');
    expect(accepted.body.job.technician.name).toBe('near');
    expect(accepted.body.job.eta.minutes).toBeGreaterThan(0);

    for (const status of ['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED']) {
      advance(60);
      const res = await request(app)
        .post(`/api/v1/jobs/${job.id}/status`)
        .set(auth('near'))
        .send({ status })
        .expect(200);
      expect(res.body.job.status).toBe(status);
    }

    const review = await request(app)
      .post(`/api/v1/jobs/${job.id}/review`)
      .set(auth('customer'))
      .send({ rating: 5, comment: 'Quick fix' })
      .expect(201);
    expect(review.body.job.review).toEqual({ rating: 5, comment: 'Quick fix' });

    const final = await request(app)
      .get(`/api/v1/jobs/${job.id}`)
      .set(auth('customer'))
      .expect(200);
    expect(final.body.job.timeline.map((t: { to: string }) => t.to)).toEqual([
      'CREATED',
      'MATCHED',
      'ACCEPTED',
      'EN_ROUTE',
      'ARRIVED',
      'IN_PROGRESS',
      'COMPLETED',
    ]);
    expect(final.body.job.arrivedAt).not.toBeNull();
    expect(final.body.job.completedAt).not.toBeNull();

    const profile = await prisma.technicianProfile.findFirstOrThrow({
      where: { userId: users.near.id },
    });
    expect(profile.completedJobs).toBe(1);
    expect(profile.ratingCount).toBe(1);
    expect(profile.ratingAvg).toBe(5);

    await request(app)
      .post(`/api/v1/jobs/${job.id}/review`)
      .set(auth('customer'))
      .send({ rating: 1 })
      .expect(409);
  });

  it('re-offers to the next-best technician when the offer is rejected', async () => {
    const job = await raiseJob();
    await request(app).post(`/api/v1/jobs/${job.id}/reject`).set(auth('near')).expect(204);

    const offer = await pendingOffer(job.id);
    expect(offer.technician.user.name).toBe('mid');
    expect(offer.round).toBe(2);
  });

  it('reassigns on timeout and expires the job after the maximum rounds', async () => {
    const job = await raiseJob();
    const names: string[] = [];

    for (let round = 1; round <= 3; round++) {
      const offer = await pendingOffer(job.id);
      names.push(offer.technician.user.name);

      // Not yet expired: nothing happens.
      advance(30);
      expect((await expireOffer(offer.id)).outcome).toBe('SKIPPED');

      advance(31);
      await expireOffer(offer.id);
    }

    expect(names).toEqual(['near', 'mid', 'far']);
    const res = await request(app).get(`/api/v1/jobs/${job.id}`).set(auth('admin')).expect(200);
    expect(res.body.job.status).toBe('EXPIRED');
    expect(res.body.job.dispatchLog.map((o: { status: string }) => o.status)).toEqual([
      'EXPIRED',
      'EXPIRED',
      'EXPIRED',
    ]);
    expect(res.body.job.timeline.at(-1).note).toMatch(/No technician accepted after 3 offers/);
  });

  it('rejects an accept after the offer window has passed', async () => {
    const job = await raiseJob();
    advance(61);
    const res = await request(app)
      .post(`/api/v1/jobs/${job.id}/accept`)
      .set(auth('near'))
      .expect(409);
    expect(res.body.code).toBe('OFFER_EXPIRED');
  });

  it('lets exactly one of several simultaneous accepts win', async () => {
    const job = await raiseJob();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post(`/api/v1/jobs/${job.id}/accept`).set(auth('near'))
      )
    );
    const statuses = results.map(r => r.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409, 409]);
    expect(
      results.filter(r => r.status === 409).every(r => r.body.code === 'ALREADY_CLAIMED')
    ).toBe(true);
  });

  it('does not offer a busy technician a second job', async () => {
    const first = await raiseJob();
    await request(app).post(`/api/v1/jobs/${first.id}/accept`).set(auth('near')).expect(200);

    const second = await raiseJob('othercustomer');
    const offer = await pendingOffer(second.id);
    expect(offer.technician.user.name).toBe('mid');
  });

  it('expires immediately when nobody qualified is in range', async () => {
    await prisma.technicianProfile.updateMany({
      where: { user: { email: { endsWith: DOMAIN } } },
      data: { isOnline: false },
    });
    try {
      const job = await raiseJob();
      expect(job.status).toBe('EXPIRED');
      expect(job.timeline.at(-1).note).toMatch(/No available technician within 15 km/);
    } finally {
      await prisma.technicianProfile.updateMany({
        where: { user: { email: { endsWith: DOMAIN } }, NOT: { user: { name: 'offline' } } },
        data: { isOnline: true },
      });
    }
  });
});

describe('job rules', () => {
  it('rejects skipping lifecycle steps', async () => {
    const job = await raiseJob();
    await request(app).post(`/api/v1/jobs/${job.id}/accept`).set(auth('near')).expect(200);
    const res = await request(app)
      .post(`/api/v1/jobs/${job.id}/status`)
      .set(auth('near'))
      .send({ status: 'COMPLETED' })
      .expect(409);
    expect(res.body.code).toBe('INVALID_TRANSITION');
  });

  it('lets the customer cancel and withdraws the open offer', async () => {
    const job = await raiseJob();
    const res = await request(app)
      .post(`/api/v1/jobs/${job.id}/cancel`)
      .set(auth('customer'))
      .send({ reason: 'Fixed it myself' })
      .expect(200);
    expect(res.body.job.status).toBe('CANCELLED');

    const offers = await prisma.jobOffer.findMany({ where: { jobId: job.id } });
    expect(offers.map(o => o.status)).toEqual(['CANCELLED']);
    await request(app).post(`/api/v1/jobs/${job.id}/accept`).set(auth('near')).expect(409);
  });

  it('hides jobs from other customers and unrelated technicians', async () => {
    const job = await raiseJob();
    await request(app).get(`/api/v1/jobs/${job.id}`).set(auth('othercustomer')).expect(404);
    await request(app).get(`/api/v1/jobs/${job.id}`).set(auth('far')).expect(404);
    await request(app).get(`/api/v1/jobs/${job.id}`).set(auth('near')).expect(200);
  });

  it('only lets customers raise requests', async () => {
    await request(app)
      .post('/api/v1/jobs')
      .set(auth('near'))
      .send({ serviceId: SERVICE_ID, ...JOB, address: '1 Test Street' })
      .expect(403);
  });

  it('validates the request body', async () => {
    const res = await request(app)
      .post('/api/v1/jobs')
      .set(auth('customer'))
      .send({ serviceId: SERVICE_ID, lat: 200, lng: 4, address: '' })
      .expect(400);
    expect(Object.keys(res.body.fieldErrors)).toEqual(
      expect.arrayContaining(['body.lat', 'body.address'])
    );
  });
});

describe('technician profile', () => {
  it('blocks unverified technicians from going online', async () => {
    const res = await request(app)
      .patch('/api/v1/technicians/me/availability')
      .set(auth('unverified'))
      .send({ isOnline: true })
      .expect(403);
    expect(res.body.code).toBe('NOT_VERIFIED');
  });

  it('going offline declines the open offer and re-dispatches', async () => {
    const job = await raiseJob();
    await request(app)
      .patch('/api/v1/technicians/me/availability')
      .set(auth('near'))
      .send({ isOnline: false })
      .expect(200);
    const offer = await pendingOffer(job.id);
    expect(offer.technician.user.name).toBe('mid');

    await request(app)
      .patch('/api/v1/technicians/me/availability')
      .set(auth('near'))
      .send({ isOnline: true })
      .expect(200);
  });

  it('updates skills and location', async () => {
    const skills = await request(app)
      .put('/api/v1/technicians/me/skills')
      .set(auth('farther'))
      .send({ serviceIds: [SERVICE_ID, OTHER_SERVICE_ID] })
      .expect(200);
    expect(skills.body.profile.skills).toHaveLength(2);

    await request(app)
      .post('/api/v1/technicians/me/location')
      .set(auth('farther'))
      .send({ lat: JOB.lat + 9 * KM, lng: JOB.lng })
      .expect(204);
    const me = await request(app).get('/api/v1/technicians/me').set(auth('farther')).expect(200);
    expect(me.body.profile.location.lat).toBeCloseTo(JOB.lat + 9 * KM);
  });
});
