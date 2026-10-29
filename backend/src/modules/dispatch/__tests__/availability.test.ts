import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { createApp } from '@/app';
import { config } from '@/config/index';
import { prisma } from '@/common/prisma';

const app = createApp();
const DOMAIN = '@availability.test';
const SERVICE_ID = 'availability_test_service';
// Southern Indian Ocean, far from every other suite's fixtures.
const SPOT = { lat: -50.0, lng: 80.0 };
const KM = 1 / 111;

let customerToken = '';

async function makeUser(key: string, role: Role) {
  const user = await prisma.user.create({
    data: { name: key, email: `${key}${DOMAIN}`, passwordHash: 'x', role },
  });
  return {
    user,
    token: jwt.sign({ sub: user.id, email: user.email, role }, config.jwt.accessSecret),
  };
}

async function makeTech(key: string, km: number, opts: { online?: boolean; skill?: boolean } = {}) {
  const { user } = await makeUser(key, 'TECHNICIAN');
  await prisma.technicianProfile.create({
    data: {
      userId: user.id,
      verificationStatus: 'VERIFIED',
      isOnline: opts.online ?? true,
      lastLat: SPOT.lat + km * KM,
      lastLng: SPOT.lng,
      ...(opts.skill !== false && { skills: { create: { serviceId: SERVICE_ID } } }),
    },
  });
  return user;
}

async function cleanup() {
  await prisma.jobRequest.deleteMany({ where: { customer: { email: { endsWith: DOMAIN } } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.service.deleteMany({ where: { id: SERVICE_ID } });
}

beforeAll(async () => {
  await cleanup();
  await prisma.service.create({
    data: { id: SERVICE_ID, name: 'Availability Test', category: 'Test', baseFee: 49900 },
  });
  const customer = await makeUser('customer', 'CUSTOMER');
  customerToken = customer.token;

  await makeTech('near', 2);
  await makeTech('far', 9);
  await makeTech('offline', 1, { online: false });
  await makeTech('unskilled', 3, { skill: false });
  await makeTech('outside', 40);
  const busy = await makeTech('busy', 1);
  await prisma.jobRequest.create({
    data: {
      customerId: customer.user.id,
      technicianId: busy.id,
      serviceId: SERVICE_ID,
      ...SPOT,
      address: 'Busy Street',
      status: 'EN_ROUTE',
    },
  });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const get = (query: string) =>
  request(app).get(`/api/v1/availability${query}`).set('Authorization', `Bearer ${customerToken}`);

describe('GET /availability', () => {
  it('requires a signed-in user', async () => {
    await request(app).get('/api/v1/availability').expect(401);
  });

  it('counts free technicians with the skill inside the dispatch radius, nearest first', async () => {
    const res = await get(`?lat=${SPOT.lat}&lng=${SPOT.lng}&serviceId=${SERVICE_ID}`).expect(200);
    // near, far and busy are on duty in range; busy is not free; offline, unskilled, outside excluded.
    expect(res.body.availability).toEqual({
      radiusKm: 15,
      onDuty: 3,
      available: 2,
      nearestKm: 2,
      nearestEtaMins: 5,
    });
  });

  it('includes every skill when no service is given', async () => {
    const res = await get(`?lat=${SPOT.lat}&lng=${SPOT.lng}`).expect(200);
    expect(res.body.availability).toMatchObject({ onDuty: 4, available: 3, nearestKm: 2 });
  });

  it('rejects half a coordinate', async () => {
    await get(`?lat=${SPOT.lat}`).expect(400);
  });
});
