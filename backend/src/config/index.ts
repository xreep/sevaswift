import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DISPATCH_RADIUS_KM: z.coerce.number().positive().default(15),
  OFFER_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(60),
  MAX_DISPATCH_ROUNDS: z.coerce.number().int().positive().default(3),
  AVERAGE_SPEED_KMPH: z.coerce.number().positive().default(25),
  ORS_API_KEY: z.string().optional(),
});

const env = envSchema.parse(process.env);

export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  jwt: {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessExpiry: env.JWT_ACCESS_EXPIRY,
    refreshExpiry: env.JWT_REFRESH_EXPIRY,
  },
  corsOrigin: env.CORS_ORIGIN,
  dispatch: {
    radiusKm: env.DISPATCH_RADIUS_KM,
    offerTimeoutSeconds: env.OFFER_TIMEOUT_SECONDS,
    maxRounds: env.MAX_DISPATCH_ROUNDS,
    averageSpeedKmph: env.AVERAGE_SPEED_KMPH,
  },
  orsApiKey: env.ORS_API_KEY || undefined,
} as const;

export type Config = typeof config;
