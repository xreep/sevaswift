import { z } from 'zod';

export const availabilitySchema = z.object({
  body: z.object({ isOnline: z.boolean() }),
});

export const skillsSchema = z.object({
  body: z.object({ serviceIds: z.array(z.string().min(1).max(64)).max(20) }),
});

export const locationSchema = z.object({
  body: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
});

export type SkillsInput = z.infer<typeof skillsSchema>['body'];
export type LocationInput = z.infer<typeof locationSchema>['body'];
