import http from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { io as ioClient, type Socket } from 'socket.io-client';
import { createApp } from '@/app';
import { config } from '@/config/index';
import { prisma } from '@/common/prisma';
import { attachRealtime, type Realtime } from '@/modules/realtime/realtime.gateway';

const DOMAIN = '@realtime.test';
const SERVICE_ID = 'realtime_test_service';
// An empty spot in the Gulf of Guinea, far from other tests' technicians.
const JOB = { lat: 2.0, lng: 4.0 };
const KM = 1 / 111; // degrees of latitude per km

const server = http.createServer(createApp());
let realtime: Realtime;
let baseUrl: string;
const sockets: Socket[] = [];
const users: Record<string, { id: string; token: string }> = {};

async function makeUser(key: string, role: Role) {
  const user = await prisma.user.create({
    data: { name: key, email: `${key}${DOMAIN}`, passwordHash: 'x', role },
  });
  const token = jwt.sign({ sub: user.id, email: user.email, role }, config.jwt.accessSecret);
  users[key] = { id: user.id, token };
  return user;
}

function auth(key: string) {
  return { Authorization: `Bearer ${users[key].token}` };
}

function connect(token?: string): Socket {
  const socket = ioClient(baseUrl, {
    auth: token ? { token } : {},
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  sockets.push(socket);
  return socket;
}

async function connectAs(key: string): Promise<Socket> {
  const socket = connect(users[key].token);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  return socket;
}

function next<T = Record<string, unknown>>(socket: Socket, event: string, ms = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function subscribe(socket: Socket, jobId: string): Promise<{ ok: boolean; code?: string }> {
  return socket.timeout(2000).emitWithAck('job:subscribe', { jobId });
}

async function raiseJob() {
  const res = await request(server)
    .post('/api/v1/jobs')
    .set(auth('customer'))
    .send({ serviceId: SERVICE_ID, ...JOB, address: '1 Socket Street', priority: 'URGENT' })
    .expect(201);
  return res.body.job as { id: string; status: string };
}

async function cleanup() {
  await prisma.jobRequest.deleteMany({ where: { customer: { email: { endsWith: DOMAIN } } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.service.deleteMany({ where: { id: SERVICE_ID } });
}

beforeAll(async () => {
  await cleanup();
  await prisma.service.create({
    data: { id: SERVICE_ID, name: 'Realtime Test Plumbing', category: 'Test', baseFee: 49900 },
  });
  await makeUser('customer', 'CUSTOMER');
  await makeUser('stranger', 'CUSTOMER');
  await makeUser('admin', 'ADMIN');
  const tech = await makeUser('tech', 'TECHNICIAN');
  await prisma.technicianProfile.create({
    data: {
      userId: tech.id,
      verificationStatus: 'VERIFIED',
      isOnline: true,
      lastLat: JOB.lat + 5 * KM,
      lastLng: JOB.lng,
      skills: { create: { serviceId: SERVICE_ID } },
    },
  });

  realtime = attachRealtime(server);
  await new Promise<void>(resolve => server.listen(0, resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await prisma.jobRequest.deleteMany({ where: { customer: { email: { endsWith: DOMAIN } } } });
});

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.disconnect();
});

afterAll(async () => {
  await realtime.close();
  await cleanup();
  await prisma.$disconnect();
});

describe('socket authentication', () => {
  it('rejects a connection without an access token', async () => {
    const err = await next<Error>(connect(), 'connect_error');
    expect(err.message).toBe('MISSING_TOKEN');
  });

  it('rejects a connection with an invalid access token', async () => {
    const err = await next<Error>(connect('not-a-jwt'), 'connect_error');
    expect(err.message).toBe('INVALID_TOKEN');
  });

  it('accepts a connection with a valid access token', async () => {
    const socket = await connectAs('customer');
    expect(socket.connected).toBe(true);
  });
});

describe('real-time dispatch workflow', () => {
  it('pushes a new offer to the technician and closes it on accept', async () => {
    const techSocket = await connectAs('tech');
    const offerPromise = next<{ jobId: string; expiresAt: string }>(techSocket, 'offer:new');

    const job = await raiseJob();
    const offer = await offerPromise;
    expect(offer.jobId).toBe(job.id);
    expect(new Date(offer.expiresAt).getTime()).toBeGreaterThan(0);

    const closed = next<{ jobId: string; reason: string }>(techSocket, 'offer:closed');
    await request(server).post(`/api/v1/jobs/${job.id}/accept`).set(auth('tech')).expect(200);
    expect(await closed).toMatchObject({ jobId: job.id, reason: 'ACCEPTED' });
  });

  it('pushes status changes to the customer and to admins', async () => {
    const customerSocket = await connectAs('customer');
    const adminSocket = await connectAs('admin');
    const job = await raiseJob();

    const customerSees = next(customerSocket, 'job:status');
    const adminSees = next(adminSocket, 'job:status');
    await request(server).post(`/api/v1/jobs/${job.id}/accept`).set(auth('tech')).expect(200);

    expect(await customerSees).toMatchObject({ jobId: job.id, from: 'MATCHED', to: 'ACCEPTED' });
    expect(await adminSees).toMatchObject({ jobId: job.id, to: 'ACCEPTED' });
  });

  it('streams the technician location and ETA to subscribers of the job', async () => {
    const job = await raiseJob();
    await request(server).post(`/api/v1/jobs/${job.id}/accept`).set(auth('tech')).expect(200);

    const customerSocket = await connectAs('customer');
    expect(await subscribe(customerSocket, job.id)).toEqual({ ok: true });

    const located = next<{ jobId: string; lat: number; lng: number; eta: { distanceKm: number } }>(
      customerSocket,
      'job:location'
    );
    await request(server)
      .post('/api/v1/technicians/me/location')
      .set(auth('tech'))
      .send({ lat: JOB.lat + 2 * KM, lng: JOB.lng })
      .expect(204);

    const frame = await located;
    expect(frame.jobId).toBe(job.id);
    expect(frame.lat).toBeCloseTo(JOB.lat + 2 * KM);
    expect(frame.eta.distanceKm).toBeCloseTo(2, 0);
  });

  it('refuses job subscriptions from users who cannot see the job', async () => {
    const job = await raiseJob();
    const strangerSocket = await connectAs('stranger');
    expect(await subscribe(strangerSocket, job.id)).toEqual({ ok: false, code: 'JOB_NOT_FOUND' });
  });

  it('pushes technician locations to admins', async () => {
    const adminSocket = await connectAs('admin');
    const seen = next<{ technicianId: string }>(adminSocket, 'technician:location');
    await request(server)
      .post('/api/v1/technicians/me/location')
      .set(auth('tech'))
      .send({ lat: JOB.lat, lng: JOB.lng })
      .expect(204);
    expect((await seen).technicianId).toBe(users.tech.id);
  });
});
