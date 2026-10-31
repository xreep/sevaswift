import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { createApp } from '@/app';
import { config } from '@/config/index';
import { prisma } from '@/common/prisma';
import { getClock, setClock } from '@/common/utils/clock';

const app = createApp();
const DOMAIN = '@admin.test';
const SERVICE_ID = 'admin_test_service';
const LONELY_SERVICE_ID = 'admin_test_lonely';
// Open ocean, far from every other suite's fixtures.
const SPOT = { lat: -40.0, lng: -120.0 };
const FAR_SPOT = { lat: -45.0, lng: -125.0 };
const KM = 1 / 111;

const START = new Date('2026-10-07T12:00:00.000Z').getTime();
let clockMs = START;
const at = (ms: number) => {
  clockMs = ms;
};

const users: Record<string, { id: string; token: string; profileId?: string }> = {};

async function makeUser(key: string, role: Role, name = key) {
  const user = await prisma.user.create({
    data: { name, email: `${key}${DOMAIN}`, passwordHash: 'x', role, emailVerified: true },
  });
  const token = jwt.sign({ sub: user.id, email: user.email, role }, config.jwt.accessSecret);
  users[key] = { id: user.id, token };
  return user;
}

async function makeTech(key: string, km: number) {
  const user = await makeUser(key, 'TECHNICIAN');
  const profile = await prisma.technicianProfile.create({
    data: {
      userId: user.id,
      verificationStatus: 'VERIFIED',
      isOnline: true,
      ratingAvg: 4.5,
      locationUpdatedAt: new Date(getClock().now()),
      lastLat: SPOT.lat + km * KM,
      lastLng: SPOT.lng,
      skills: { create: { serviceId: SERVICE_ID } },
    },
  });
  users[key].profileId = profile.id;
}

const auth = (key: string) => ({ Authorization: `Bearer ${users[key].token}` });

async function raise(customer: string, opts: { at: number; spot?: typeof SPOT; service?: string }) {
  at(opts.at);
  const res = await request(app)
    .post('/api/v1/jobs')
    .set(auth(customer))
    .send({
      serviceId: opts.service ?? SERVICE_ID,
      ...(opts.spot ?? SPOT),
      address: '7 Admin Lane',
      priority: 'URGENT',
    })
    .expect(201);
  return res.body.job;
}

async function post(path: string, key: string, body: object = {}, status = 200) {
  return request(app).post(path).set(auth(key)).send(body).expect(status);
}

async function cleanup() {
  await prisma.jobRequest.deleteMany({ where: { customer: { email: { endsWith: DOMAIN } } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.service.deleteMany({ where: { id: { in: [SERVICE_ID, LONELY_SERVICE_ID] } } });
}

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);

beforeAll(async () => {
  setClock({ now: () => clockMs });
  await cleanup();
  await prisma.service.createMany({
    data: [
      { id: SERVICE_ID, name: 'Admin Test Plumbing', category: 'Test', baseFee: 49900 },
      { id: LONELY_SERVICE_ID, name: 'Admin Test Lonely', category: 'Test', baseFee: 49900 },
    ],
  });
  await makeUser('admin', 'ADMIN');
  await makeUser('admin2', 'ADMIN');
  await makeUser('customer', 'CUSTOMER', '=HYPERLINK("x")');
  await makeUser('quiet', 'CUSTOMER');
  await makeTech('alpha', 1);
  await makeTech('bravo', 2);
  // Both came online five hours before the reporting point.
  await prisma.availabilityLog.createMany({
    data: ['alpha', 'bravo'].map(k => ({
      technicianId: users[k].profileId as string,
      isOnline: true,
      at: new Date(START - 5 * 3600_000),
    })),
  });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('access control', () => {
  it('rejects anonymous and non-admin callers', async () => {
    await request(app).get('/api/v1/admin/overview').expect(401);
    await request(app).get('/api/v1/admin/overview').set(auth('customer')).expect(403);
    await request(app).get('/api/v1/admin/analytics').set(auth('alpha')).expect(403);
  });
});

describe('analytics', () => {
  const T0 = START - 2 * 3600_000;
  const T1 = START - 3600_000;
  const T2 = START - 30 * 60_000;
  const ids: string[] = [];

  beforeAll(async () => {
    // Job 1: first offer accepted after 50 s, completed with a 5-star rating.
    const job1 = await raise('customer', { at: T0 });
    ids.push(job1.id);
    at(T0 + 50_000);
    await post(`/api/v1/jobs/${job1.id}/accept`, 'alpha');
    at(T0 + 120_000);
    await post(`/api/v1/jobs/${job1.id}/status`, 'alpha', { status: 'EN_ROUTE' });
    at(T0 + 650_000);
    await post(`/api/v1/jobs/${job1.id}/status`, 'alpha', { status: 'ARRIVED' });
    at(T0 + 700_000);
    await post(`/api/v1/jobs/${job1.id}/status`, 'alpha', { status: 'IN_PROGRESS' });
    at(T0 + 2_450_000);
    await post(`/api/v1/jobs/${job1.id}/status`, 'alpha', { status: 'COMPLETED' });
    at(T0 + 3_000_000);
    await post(`/api/v1/jobs/${job1.id}/review`, 'customer', { rating: 5 }, 201);

    // Job 2: nearest declines, second offer accepted 80 s after the request; still in progress.
    const job2 = await raise('customer', { at: T1 });
    ids.push(job2.id);
    at(T1 + 30_000);
    await post(`/api/v1/jobs/${job2.id}/reject`, 'alpha', {}, 204);
    at(T1 + 80_000);
    await post(`/api/v1/jobs/${job2.id}/accept`, 'bravo');

    // Job 3: cancelled by the customer while offered.
    const job3 = await raise('customer', { at: T2 });
    ids.push(job3.id);
    at(T2 + 60_000);
    await post(`/api/v1/jobs/${job3.id}/cancel`, 'customer', { reason: 'Fixed it myself' });

    at(START);
  });

  it('computes response, completion, dispatch and satisfaction KPIs', async () => {
    const res = await request(app)
      .get('/api/v1/admin/analytics?days=1')
      .set(auth('admin'))
      .expect(200);
    const { kpis, daily, hourly, byService, technicians } = res.body.analytics;

    expect(kpis).toMatchObject({
      requests: 3,
      urgentRequests: 3,
      completed: 1,
      cancelled: 1,
      expired: 0,
      open: 1,
      completionRate: 0.5,
      avgResponseSecs: 65,
      p90ResponseSecs: 77,
      prevAvgResponseSecs: null,
      responseTimeChange: null,
      avgArrivalMins: 10,
      avgServiceMins: 30,
      avgResolutionMins: 40.8,
      dispatchAccuracy: 0.5,
      autoAssignRate: 1,
      offerAcceptanceRate: 0.667,
      csat: { avgRating: 5, ratings: 1, positiveShare: 1 },
    });
    // Busy 40 + 58.7 minutes out of 2 × 5 hours online.
    expect(kpis.utilization).toBe(0.164);

    expect(daily.map((d: { day: string }) => d.day)).toEqual(['2026-10-06', '2026-10-07']);
    expect(daily[1]).toMatchObject({ requests: 3, completed: 1, unfulfilled: 1 });
    // 10:00, 11:00 and 11:30 UTC are 15:30, 16:30 and 17:00 in India.
    expect(hourly[15].requests).toBe(1);
    expect(hourly[16].requests).toBe(1);
    expect(hourly[17].requests).toBe(1);

    expect(byService).toEqual([
      expect.objectContaining({ serviceId: SERVICE_ID, requests: 3, completed: 1 }),
    ]);

    const alpha = technicians.find((t: { id: string }) => t.id === users.alpha.id);
    expect(alpha).toMatchObject({
      completedJobs: 1,
      offersAccepted: 1,
      offersRejected: 1,
      acceptanceRate: 0.5,
      avgAcceptSecs: 50,
      avgRating: 5,
      utilization: 0.133,
    });
  });

  it('exports the period as CSV with formula-safe cells', async () => {
    const res = await request(app)
      .get('/api/v1/admin/reports/jobs.csv?days=1')
      .set(auth('admin'))
      .expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="sevaswift-jobs-1d/);
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toMatch(/^Request ID,Created,Service,Priority,Status/);
    expect(lines).toHaveLength(4);
    for (const id of ids) expect(res.text).toContain(id);
    expect(res.text).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('validates the reporting window', async () => {
    await request(app).get('/api/v1/admin/analytics?days=0').set(auth('admin')).expect(400);
    await request(app).get('/api/v1/admin/analytics?days=91').set(auth('admin')).expect(400);
  });
});

describe('live operations', () => {
  it('summarises the fleet and open work', async () => {
    const res = await request(app).get('/api/v1/admin/overview').set(auth('admin')).expect(200);
    expect(res.body.overview.technicians).toMatchObject({ online: 2, busy: 1, available: 1 });
    expect(res.body.overview.jobs.open).toBe(1);
  });

  it('returns technician positions with their active job for the map', async () => {
    const res = await request(app).get('/api/v1/admin/live').set(auth('admin')).expect(200);
    const bravo = res.body.technicians.find((t: { id: string }) => t.id === users.bravo.id);
    expect(bravo.activeJobId).toEqual(expect.any(String));
    expect(bravo).toMatchObject({ isOnline: true, lat: SPOT.lat + 2 * KM, lng: SPOT.lng });
    expect(res.body.jobs.some((j: { id: string }) => j.id === bravo.activeJobId)).toBe(true);
  });
});

describe('manual assignment', () => {
  let expiredJobId: string;

  beforeAll(async () => {
    // Nobody within range of FAR_SPOT, so the job expires immediately.
    const job = await raise('customer', { at: START + 3600_000, spot: FAR_SPOT });
    expect(job.status).toBe('EXPIRED');
    expiredJobId = job.id;
  });

  it('lists skilled technicians nearest first, flagging who is busy', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/jobs/${expiredJobId}/candidates`)
      .set(auth('admin'))
      .expect(200);
    const mine = res.body.candidates.filter((c: { id: string }) =>
      [users.alpha.id, users.bravo.id].includes(c.id)
    );
    expect(mine).toHaveLength(2);
    expect(mine.find((c: { id: string }) => c.id === users.alpha.id).assignable).toBe(true);
    expect(mine.find((c: { id: string }) => c.id === users.bravo.id)).toMatchObject({
      busy: true,
      assignable: false,
    });
  });

  it('refuses a busy technician', async () => {
    const res = await post(
      `/api/v1/admin/jobs/${expiredJobId}/assign`,
      'admin',
      { technicianUserId: users.bravo.id, acknowledgeWarning: true, confirmText: 'ASSIGN' },
      409
    );
    expect(res.body.code).toBe('TECHNICIAN_BUSY');
  });

  it('demands a typed confirmation for an assignment far outside emergency limits', async () => {
    at(START + 3600_000 + 300_000);
    const blocked = await post(
      `/api/v1/admin/jobs/${expiredJobId}/assign`,
      'admin',
      { technicianUserId: users.alpha.id, acknowledgeWarning: true },
      409
    );
    expect(blocked.body.code).toBe('TYPED_CONFIRMATION_REQUIRED');
    expect(blocked.body.details.guard.level).toBe('confirm');
    expect(blocked.body.details.guard.distanceKm).toBeGreaterThan(400);
    expect(blocked.body.details.guard.reasons.join(' ')).toMatch(/beyond 40 km, the furthest auto-dispatch searches/);
  });

  it('assigns an expired job once confirmed and records who did it', async () => {
    at(START + 3600_000 + 300_000);
    const res = await post(`/api/v1/admin/jobs/${expiredJobId}/assign`, 'admin', {
      technicianUserId: users.alpha.id,
      acknowledgeWarning: true,
      confirmText: 'assign',
    });
    expect(res.body.job).toMatchObject({ status: 'ACCEPTED', responseTimeSecs: 300 });
    expect(res.body.job.technician.id).toBe(users.alpha.id);
    expect(res.body.job.timeline.at(-1).note).toBe('Manually assigned to alpha by admin');

    // The technician now sees it as their job.
    const mine = await request(app).get(`/api/v1/jobs/${expiredJobId}`).set(auth('alpha'));
    expect(mine.status).toBe(200);
  });

  it('refuses jobs that are not waiting for a technician', async () => {
    const res = await post(
      `/api/v1/admin/jobs/${expiredJobId}/assign`,
      'admin',
      { technicianUserId: users.alpha.id, acknowledgeWarning: true, confirmText: 'ASSIGN' },
      409
    );
    expect(res.body.code).toBe('NOT_ASSIGNABLE');
  });
});

describe('workforce management', () => {
  let newTechToken: string;
  let newTechId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Newbie Tech',
        email: `newbie${DOMAIN}`,
        password: 'Password123',
        role: 'TECHNICIAN',
      })
      .expect(201);
    newTechToken = res.body.accessToken;
    newTechId = res.body.user.id;
  });

  const techAuth = () => ({ Authorization: `Bearer ${newTechToken}` });

  it('lists technicians waiting for verification', async () => {
    const res = await request(app)
      .get('/api/v1/admin/technicians?verification=PENDING')
      .set(auth('admin'))
      .expect(200);
    const ids = res.body.technicians.map((t: { id: string }) => t.id);
    expect(ids).toContain(newTechId);
    expect(
      res.body.technicians.every(
        (t: { verificationStatus: string }) => t.verificationStatus === 'PENDING'
      )
    ).toBe(true);
  });

  it('keeps unverified technicians offline', async () => {
    const res = await request(app)
      .patch('/api/v1/technicians/me/availability')
      .set(techAuth())
      .send({ isOnline: true })
      .expect(403);
    expect(res.body.code).toBe('NOT_VERIFIED');
  });

  it('requires a reason to reject and stores it', async () => {
    await request(app)
      .patch(`/api/v1/admin/technicians/${newTechId}/verification`)
      .set(auth('admin'))
      .send({ status: 'REJECTED' })
      .expect(400);
    const res = await request(app)
      .patch(`/api/v1/admin/technicians/${newTechId}/verification`)
      .set(auth('admin'))
      .send({ status: 'REJECTED', reason: 'ID document unreadable' })
      .expect(200);
    expect(res.body.technician).toMatchObject({
      verificationStatus: 'REJECTED',
      rejectionReason: 'ID document unreadable',
    });
  });

  it('verifies a technician, who can then go online (logged for utilization)', async () => {
    await request(app)
      .patch(`/api/v1/admin/technicians/${newTechId}/verification`)
      .set(auth('admin'))
      .send({ status: 'VERIFIED' })
      .expect(200);
    // No location shared yet: going on duty is refused.
    const noLocation = await request(app)
      .patch('/api/v1/technicians/me/availability')
      .set(techAuth())
      .send({ isOnline: true })
      .expect(409);
    expect(noLocation.body.code).toBe('LOCATION_REQUIRED');
    await request(app)
      .post('/api/v1/technicians/me/location')
      .set(techAuth())
      .send(SPOT)
      .expect(204);
    const res = await request(app)
      .patch('/api/v1/technicians/me/availability')
      .set(techAuth())
      .send({ isOnline: true })
      .expect(200);
    expect(res.body.profile).toMatchObject({ isOnline: true, rejectionReason: null });
    const logs = await prisma.availabilityLog.count({
      where: { technician: { userId: newTechId }, isOnline: true },
    });
    expect(logs).toBe(1);

    // Repeating the same state does not add another log row.
    await request(app)
      .patch('/api/v1/technicians/me/availability')
      .set(techAuth())
      .send({ isOnline: true })
      .expect(200);
    expect(
      await prisma.availabilityLog.count({ where: { technician: { userId: newTechId } } })
    ).toBe(1);
  });

  it('gives technicians their own performance stats', async () => {
    const res = await request(app)
      .get('/api/v1/technicians/me/stats')
      .set(auth('alpha'))
      .expect(200);
    expect(res.body.stats.lifetime).toMatchObject({ completedJobs: 1, avgRating: 5 });
    expect(res.body.stats.activeJobId).toEqual(expect.any(String));
  });

  it('will not suspend a customer with open jobs, admins, or yourself', async () => {
    const open = await request(app)
      .patch(`/api/v1/admin/users/${users.customer.id}/status`)
      .set(auth('admin'))
      .send({ status: 'SUSPENDED' })
      .expect(409);
    expect(open.body.code).toBe('HAS_OPEN_JOBS');
    await request(app)
      .patch(`/api/v1/admin/users/${users.admin2.id}/status`)
      .set(auth('admin'))
      .send({ status: 'SUSPENDED' })
      .expect(403);
    await request(app)
      .patch(`/api/v1/admin/users/${users.admin.id}/status`)
      .set(auth('admin'))
      .send({ status: 'SUSPENDED' })
      .expect(403);
  });

  it('suspends and reactivates an account, cutting off access immediately', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/users/${users.quiet.id}/status`)
      .set(auth('admin'))
      .send({ status: 'SUSPENDED' })
      .expect(200);
    expect(res.body.user).toMatchObject({ id: users.quiet.id, status: 'SUSPENDED' });
    await request(app).get('/api/v1/users/me').set(auth('quiet')).expect(401);

    await request(app)
      .patch(`/api/v1/admin/users/${users.quiet.id}/status`)
      .set(auth('admin'))
      .send({ status: 'ACTIVE' })
      .expect(200);
    await request(app).get('/api/v1/users/me').set(auth('quiet')).expect(200);
  });

  it('searches users by role and text', async () => {
    const res = await request(app)
      .get('/api/v1/admin/users?role=CUSTOMER&q=quiet')
      .set(auth('admin'))
      .expect(200);
    expect(res.body.users.map((u: { id: string }) => u.id)).toEqual([users.quiet.id]);
  });
});

describe('profile management', () => {
  let token: string;
  let cookie: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Profile Person',
        email: `profile${DOMAIN}`,
        password: 'Password123',
        role: 'CUSTOMER',
      })
      .expect(201);
    token = res.body.accessToken;
    cookie = res.headers['set-cookie'][0];
  });

  const me = () => ({ Authorization: `Bearer ${token}` });

  it('returns the account with a history summary', async () => {
    const res = await request(app).get('/api/v1/users/me').set(me()).expect(200);
    expect(res.body.user).toMatchObject({
      name: 'Profile Person',
      role: 'CUSTOMER',
      stats: { totalJobs: 0, completedJobs: 0 },
    });
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('updates name and phone, and clears the phone with an empty string', async () => {
    let res = await request(app)
      .patch('/api/v1/users/me')
      .set(me())
      .send({ name: '  Renamed Person ', phone: '+919876543210' })
      .expect(200);
    expect(res.body.user).toMatchObject({ name: 'Renamed Person', phone: '+919876543210' });
    res = await request(app).patch('/api/v1/users/me').set(me()).send({ phone: '' }).expect(200);
    expect(res.body.user.phone).toBeNull();
    await request(app).patch('/api/v1/users/me').set(me()).send({ phone: 'abc' }).expect(400);
    await request(app).patch('/api/v1/users/me').set(me()).send({}).expect(400);
  });

  it('changes the password only with the current one, signing out other sessions', async () => {
    const wrong = await request(app)
      .post('/api/v1/users/me/password')
      .set(me())
      .send({ currentPassword: 'nope-nope', newPassword: 'NewPassword456' })
      .expect(400);
    expect(wrong.body.code).toBe('INVALID_PASSWORD');

    await request(app)
      .post('/api/v1/users/me/password')
      .set(me())
      .send({ currentPassword: 'Password123', newPassword: 'NewPassword456' })
      .expect(200);

    await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `profile${DOMAIN}`, password: 'NewPassword456' })
      .expect(200);
  });
});

describe('photo uploads', () => {
  it('stores an image and serves it back', async () => {
    const res = await request(app)
      .post('/api/v1/uploads')
      .set(auth('customer'))
      .attach('file', PNG, { filename: 'leak.png', contentType: 'image/png' })
      .expect(201);
    expect(res.body.upload).toMatchObject({ mimeType: 'image/png', size: PNG.length });
    const file = await request(app).get(res.body.upload.url).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(file.body, PNG)).toBe(0);
  });

  it('rejects files that are not images, whatever they claim to be', async () => {
    const res = await request(app)
      .post('/api/v1/uploads')
      .set(auth('customer'))
      .attach('file', Buffer.from('<script>alert(1)</script>'), {
        filename: 'evil.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect(res.body.code).toBe('UNSUPPORTED_FILE');
    await request(app).post('/api/v1/uploads').set(auth('customer')).expect(400);
    await request(app)
      .post('/api/v1/uploads')
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
      .expect(401);
  });

  it('only lets customers attach their own uploads to a request', async () => {
    const theirs = await request(app)
      .post('/api/v1/uploads')
      .set(auth('quiet'))
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
      .expect(201);
    const mine = await request(app)
      .post('/api/v1/uploads')
      .set(auth('customer'))
      .attach('file', PNG, { filename: 'b.png', contentType: 'image/png' })
      .expect(201);

    const body = {
      serviceId: LONELY_SERVICE_ID,
      ...SPOT,
      address: '7 Admin Lane',
      priority: 'NORMAL',
    };
    // The customer is at their open-request limit after earlier tests, so use another one.
    const bad = await request(app)
      .post('/api/v1/jobs')
      .set(auth('quiet'))
      .send({ ...body, photoUrls: [mine.body.upload.url] })
      .expect(400);
    expect(bad.body.code).toBe('INVALID_PHOTO');

    await request(app)
      .post('/api/v1/jobs')
      .set(auth('quiet'))
      .send({ ...body, photoUrls: ['https://example.com/x.png'] })
      .expect(400);

    const ok = await request(app)
      .post('/api/v1/jobs')
      .set(auth('quiet'))
      .send({ ...body, photoUrls: [theirs.body.upload.url] })
      .expect(201);
    expect(ok.body.job.photoUrls).toEqual([theirs.body.upload.url]);
  });
});
