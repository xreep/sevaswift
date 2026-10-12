import request from 'supertest';
import bcrypt from 'bcrypt';
import { createApp } from '@/app';
import { prisma } from '@/common/prisma';

const app = createApp();
const ADMIN_EMAIL = 'admin@catalog.test';
const SERVICE_ID = 'catalog_test_service';

let adminToken: string;

beforeAll(async () => {
  await prisma.service.deleteMany({ where: { name: { startsWith: 'Catalog Test' } } });
  await prisma.user.deleteMany({ where: { email: ADMIN_EMAIL } });
  await prisma.user.create({
    data: {
      name: 'Catalog Admin',
      email: ADMIN_EMAIL,
      passwordHash: await bcrypt.hash('password123', 10),
      role: 'ADMIN',
    },
  });
  await prisma.service.upsert({
    where: { id: SERVICE_ID },
    update: { isActive: true },
    create: { id: SERVICE_ID, name: 'Catalog Test Seeded', category: 'Test', baseFee: 49900 },
  });

  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: ADMIN_EMAIL, password: 'password123' });
  adminToken = res.body.accessToken;
});

afterAll(async () => {
  await prisma.service.deleteMany({ where: { name: { startsWith: 'Catalog Test' } } });
  await prisma.user.deleteMany({ where: { email: ADMIN_EMAIL } });
  await prisma.$disconnect();
});

describe('catalog', () => {
  it('lists active services publicly', async () => {
    const res = await request(app).get('/api/v1/services').expect(200);
    expect(res.body.services.some((s: { id: string }) => s.id === SERVICE_ID)).toBe(true);
  });

  it('fetches a service by its slug id (as used by the seed)', async () => {
    const res = await request(app).get(`/api/v1/services/${SERVICE_ID}`).expect(200);
    expect(res.body.service.baseFee).toBe(49900);
  });

  it('returns 404 for an unknown service', async () => {
    const res = await request(app).get('/api/v1/services/does_not_exist').expect(404);
    expect(res.body.code).toBe('SERVICE_NOT_FOUND');
  });

  it('lets an admin create, update and delete a service', async () => {
    const created = await request(app)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Catalog Test New', category: 'Test', baseFee: 10000 })
      .expect(201);
    const id = created.body.service.id;

    const updated = await request(app)
      .patch(`/api/v1/services/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ baseFee: 12000 })
      .expect(200);
    expect(updated.body.service.baseFee).toBe(12000);

    await request(app)
      .delete(`/api/v1/services/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
  });

  it('rejects a non-integer fee (money is integer paise)', async () => {
    const res = await request(app)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Catalog Test Float', category: 'Test', baseFee: 499.5 })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});
