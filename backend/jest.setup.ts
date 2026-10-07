import { setClock } from './src/common/utils/clock.js';

beforeAll(() => {
  setClock({ now: () => new Date('2026-10-07T12:00:00.000Z').getTime() });
});

afterAll(() => {
  setClock({ now: () => Date.now() });
});