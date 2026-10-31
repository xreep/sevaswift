import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { createApp } from '@/app';
import { config } from '@/config/index';
import { prisma } from '@/common/prisma';
import { setClock } from '@/common/utils/clock';
import { sweepPresence } from '@/modules/technicians/technicians.service';

const app = createApp();
const DOMAIN = '@p0.test';
const DEMO_UNIT = 'tech_p0city_0@demo.sevaswift';
const SERVICE_ID = 'p0_test_service';
// Mid-Atlantic, far from every other suite's fixtures.
const SPOT = { lat: 10.0, lng: -30.0 };
const FAR = { lat: 14.0, lng: -30.0 }; // ~445 km north
const KM = 1 / 111;
const START = new Date('2026-10-07T12:00:00.000Z').getTime();
const minutesAgo = (m: number) => new Date(START - m * 60_000);

const users: Record<string, { id: string; token: string }> = {};

async function makeUser(key: string, role: Role, email = `${key}${DOMAIN}`) {
  const user = await prisma.user.create({
    data: { name: key, email, passwordHash: 'x', role, emailVerified: true },
  });
  users[key] = {
    id: user.id,
    token: jwt.sign({ sub: user.id, email, role }, config.jwt.accessSecret),
  };
  return user;
}

const TECHS = {
  fresh: { km: 2, ageMins: 0 },
  stale: { km: 1, ageMins: 11 },
  wide: { km: 20, ageMins: 0 },
};

async function resetTechs() {
  for (const [key, t] of Object.entries(TECHS)) {
    await prisma.technicianProfile.update({
      where: { userId: users[key].id },
      data: {
        isOnline: true,
        lastLat: SPOT.lat + t.km * KM,
        lastLng: SPOT.lng,
        locationUpdatedAt: minutesAgo(t.ageMins),
      },
    });
  }
}

const auth = (key: string) => ({ Authorization: `Bearer ${users[key].token}` });

async function raise(spot = SPOT, customer = 'customer') {
  const res = await request(app)
    .post('/api/v1/jobs')
    .set(auth(customer))
    .send({ serviceId: SERVICE_ID, ...spot, address: 'TEST 9 Dispatch Road', priority: 'URGENT' })
    .expect(201);
  return res.body.job;
}

const pendingOffer = (jobId: string) =>
  prisma.jobOffer.findFirstOrThrow({
    where: { jobId, status: 'PENDING' },
    include: { technician: { include: { user: true } } },
  });

async function cleanup() {
  await prisma.jobRequest.deleteMany({ where: { customer: { email: { endsWith: DOMAIN } } } });
  await prisma.user.deleteMany({
    where: { OR: [{ email: { endsWith: DOMAIN } }, { email: DEMO_UNIT }] },
  });
  await prisma.service.deleteMany({ where: { id: SERVICE_ID } });
}

beforeAll(async () => {
  setClock({ now: () => START });
  await cleanup();
  await prisma.service.create({
    data: { id: SERVICE_ID, name: 'P0 Test Plumbing', category: 'Test', baseFee: 49900 },
  });
  await makeUser('customer', 'CUSTOMER');
  await makeUser('admin', 'ADMIN');
  for (const key of Object.keys(TECHS)) {
    const user = await makeUser(key, 'TECHNICIAN');
    await prisma.technicianProfile.create({
      data: {
        userId: user.id,
        verificationStatus: 'VERIFIED',
        skills: { create: { serviceId: SERVICE_ID } },
      },
    });
  }
});

beforeEach(async () => {
  setClock({ now: () => START });
  await prisma.jobRequest.deleteMany({ where: { customer: { email: { endsWith: DOMAIN } } } });
  await resetTechs();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('location you can trust', () => {
  it('skips a technician whose location is stale and says why in the dispatch log', async () => {
    const job = await raise();
    const offer = await pendingOffer(job.id);
    expect(offer.technician.user.name).toBe('fresh');

    const [attempt] = await prisma.dispatchAttempt.findMany({ where: { jobId: job.id } });
    expect(attempt.outcome).toBe('OFFERED');
    const reasons = Object.fromEntries(
      (attempt.candidates as { name: string; reason: string | null }[]).map(c => [c.name, c.reason])
    );
    expect(reasons).toMatchObject({
      stale: 'location stale (11 min old)',
      fresh: null,
      wide: 'outside 15 km',
    });
  });

  it('refuses to go on duty with a stale location, then allows it once shared', async () => {
    await request(app)
      .patch('/api/v1/technicians/me/availability')
      .set(auth('stale'))
      .send({ isOnline: false })
      .expect(200);
    const refused = await request(app)
      .patch('/api/v1/technicians/me/availability')
      .set(auth('stale'))
      .send({ isOnline: true })
      .expect(409);
    expect(refused.body.code).toBe('LOCATION_REQUIRED');

    await request(app)
      .post('/api/v1/technicians/me/location')
      .set(auth('stale'))
      .send({ lat: SPOT.lat + KM, lng: SPOT.lng })
      .expect(204);
    await request(app)
      .patch('/api/v1/technicians/me/availability')
      .set(auth('stale'))
      .send({ isOnline: true })
      .expect(200);
  });
});

describe('stepwise radius', () => {
  it('widens to 25 km and tells the customer who is being asked', async () => {
    await prisma.technicianProfile.update({
      where: { userId: users.fresh.id },
      data: { isOnline: false },
    });
    const job = await raise();

    const offer = await pendingOffer(job.id);
    expect(offer.technician.user.name).toBe('wide');
    expect(offer.radiusKm).toBe(25);

    const view = await request(app).get(`/api/v1/jobs/${job.id}`).set(auth('customer')).expect(200);
    expect(view.body.job.dispatch).toMatchObject({
      radiusKm: 25,
      offersMade: 1,
      currentOffer: { technicianName: 'wide', etaMinutes: expect.any(Number) },
      widened: [{ radiusKm: 25 }],
    });
    expect(view.body.job.dispatch.currentOffer.distanceKm).toBeCloseTo(20, 0);
    // Customers see progress but not the full log.
    expect(view.body.job.dispatchAttempts).toBeUndefined();
  });
});

describe('availability follows the technician', () => {
  it('signing out takes a technician off duty and passes their open offer on', async () => {
    const job = await raise();
    expect((await pendingOffer(job.id)).technician.user.name).toBe('fresh');

    await request(app).post('/api/v1/auth/logout').set(auth('fresh')).expect(204);

    const profile = await prisma.technicianProfile.findUniqueOrThrow({
      where: { userId: users.fresh.id },
      include: { availabilityLog: { orderBy: { at: 'desc' }, take: 1 } },
    });
    expect(profile.isOnline).toBe(false);
    expect(profile.availabilityLog[0].isOnline).toBe(false);
    // The offer moved on: stale is skipped, so the search widened to the 20 km technician.
    expect((await pendingOffer(job.id)).technician.user.name).toBe('wide');
  });

  it('the presence sweep takes silent technicians off duty but keeps the demo fleet live', async () => {
    const demo = await makeUser('demoUnit', 'TECHNICIAN', DEMO_UNIT);
    await prisma.technicianProfile.create({
      data: {
        userId: demo.id,
        verificationStatus: 'VERIFIED',
        isOnline: true,
        lastLat: SPOT.lat,
        lastLng: SPOT.lng,
        locationUpdatedAt: minutesAgo(60),
      },
    });
    const settings = config as { demoFleetSimulation: boolean };
    settings.demoFleetSimulation = true;
    try {
      const result = await sweepPresence();
      expect(result.simulated).toBeGreaterThanOrEqual(1);
    } finally {
      settings.demoFleetSimulation = false;
    }

    const [stale, fresh, unit] = await Promise.all(
      [users.stale.id, users.fresh.id, demo.id].map(userId =>
        prisma.technicianProfile.findUniqueOrThrow({ where: { userId } })
      )
    );
    expect(stale.isOnline).toBe(false);
    expect(fresh.isOnline).toBe(true);
    expect(unit.isOnline).toBe(true);
    expect(unit.locationUpdatedAt?.getTime()).toBe(START);
  });
});

describe('manual offers and the assignment guard', () => {
  async function waitingJob(spot: { lat: number; lng: number }) {
    return prisma.jobRequest.create({
      data: {
        customerId: users.customer.id,
        serviceId: SERVICE_ID,
        ...spot,
        address: 'TEST 1 Waiting Lane',
        status: 'EXPIRED',
        dispatchRadiusKm: 40,
        createdAt: minutesAgo(5),
      },
    });
  }

  it('sends the normal offer, which the technician can accept', async () => {
    const job = await waitingJob({ lat: SPOT.lat + 2 * KM, lng: SPOT.lng });
    const res = await request(app)
      .post(`/api/v1/admin/jobs/${job.id}/offer`)
      .set(auth('admin'))
      .send({ technicianUserId: users.fresh.id })
      .expect(200);
    expect(res.body.job.status).toBe('MATCHED');
    expect(res.body.job.offer).toMatchObject({ round: 1 });
    expect(res.body.job.dispatchAttempts.at(-1)).toMatchObject({ outcome: 'MANUAL_OFFER' });
    expect(res.body.job.dispatchAttempts.at(-1).note).toMatch(/^admin offered the job to fresh/);

    const accepted = await request(app)
      .post(`/api/v1/jobs/${job.id}/accept`)
      .set(auth('fresh'))
      .expect(200);
    expect(accepted.body.job.status).toBe('ACCEPTED');
  });

  it('asks the admin to confirm an offer outside the emergency radius', async () => {
    // ~18 km from "fresh": beyond 15 km, within 40 km.
    const job = await waitingJob({ lat: SPOT.lat + 20 * KM, lng: SPOT.lng });
    const blocked = await request(app)
      .post(`/api/v1/admin/jobs/${job.id}/offer`)
      .set(auth('admin'))
      .send({ technicianUserId: users.fresh.id })
      .expect(409);
    expect(blocked.body.code).toBe('CONFIRMATION_REQUIRED');
    expect(blocked.body.details.guard).toMatchObject({ level: 'warn' });
    expect(blocked.body.details.guard.reasons[0]).toMatch(/outside the 15 km first search radius/);

    await request(app)
      .post(`/api/v1/admin/jobs/${job.id}/offer`)
      .set(auth('admin'))
      .send({ technicianUserId: users.fresh.id, acknowledgeWarning: true })
      .expect(200);
  });

  it('never silently creates an hours-long emergency ETA', async () => {
    const job = await waitingJob(FAR);
    const blocked = await request(app)
      .post(`/api/v1/admin/jobs/${job.id}/assign`)
      .set(auth('admin'))
      .send({ technicianUserId: users.fresh.id, acknowledgeWarning: true })
      .expect(409);
    expect(blocked.body.code).toBe('TYPED_CONFIRMATION_REQUIRED');
    expect(blocked.body.details.guard.etaMinutes).toBeGreaterThan(90);

    const confirmed = await request(app)
      .post(`/api/v1/admin/jobs/${job.id}/assign`)
      .set(auth('admin'))
      .send({ technicianUserId: users.fresh.id, acknowledgeWarning: true, confirmText: 'ASSIGN' })
      .expect(200);
    expect(confirmed.body.job.status).toBe('ACCEPTED');
    expect(confirmed.body.job.dispatchAttempts.at(-1).note).toMatch(/confirmed despite/);
  });

  it('will not offer to an offline technician', async () => {
    const job = await waitingJob({ lat: SPOT.lat + 2 * KM, lng: SPOT.lng });
    await prisma.technicianProfile.update({
      where: { userId: users.fresh.id },
      data: { isOnline: false },
    });
    const res = await request(app)
      .post(`/api/v1/admin/jobs/${job.id}/offer`)
      .set(auth('admin'))
      .send({ technicianUserId: users.fresh.id })
      .expect(409);
    expect(res.body.code).toBe('TECHNICIAN_OFFLINE');
  });

  it('lists candidates with the guard level and location age', async () => {
    const job = await waitingJob(FAR);
    const res = await request(app)
      .get(`/api/v1/admin/jobs/${job.id}/candidates`)
      .set(auth('admin'))
      .expect(200);
    const byName = Object.fromEntries(
      res.body.candidates.map((c: { name: string }) => [c.name, c])
    );
    expect(byName.fresh.guard.level).toBe('confirm');
    expect(byName.stale.guard.locationAgeMins).toBe(11);
    expect(byName.fresh.offerable).toBe(true);
  });
});

describe('map tiles', () => {
  it('sends a Referer policy that OpenStreetMap accepts', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });
});
