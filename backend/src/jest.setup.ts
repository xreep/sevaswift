import { setClock } from '@/common/utils/clock';

beforeAll(() => {
  setClock({ now: () => new Date('2026-10-07T12:00:00.000Z').getTime() });
});

afterAll(() => {
  setClock({ now: () => Date.now() });
});

// Set required environment variables for tests
process.env.DATABASE_URL = 'postgresql://sevaswift:sevaswift_dev@localhost:5432/sevaswift_test?schema=public';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-key-for-testing-only-32chars';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-key-for-testing-only-32chars';
process.env.NODE_ENV = 'test';
process.env.PORT = '4000';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.KAFKA_BROKERS = 'localhost:9092';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.UPLOAD_DIR = './uploads';