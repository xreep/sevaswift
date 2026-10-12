import { z } from 'zod';

const jobIdParams = z.object({ id: z.string().uuid() });

export const createJobSchema = z.object({
  body: z.object({
    serviceId: z.string().min(1).max(64),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    address: z.string().trim().min(3).max(300),
    description: z.string().trim().max(1000).optional(),
    priority: z.enum(['NORMAL', 'URGENT']).default('NORMAL'),
    photoUrls: z.array(z.string().url().startsWith('https://')).max(3).default([]),
  }),
});

export const listJobsSchema = z.object({
  query: z.object({
    status: z
      .enum([
        'CREATED',
        'MATCHED',
        'ACCEPTED',
        'EN_ROUTE',
        'ARRIVED',
        'IN_PROGRESS',
        'COMPLETED',
        'CANCELLED',
        'EXPIRED',
      ])
      .optional(),
    active: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
});

export const jobIdSchema = z.object({ params: jobIdParams });

export const updateStatusSchema = z.object({
  params: jobIdParams,
  body: z.object({
    status: z.enum(['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED']),
  }),
});

export const cancelJobSchema = z.object({
  params: jobIdParams,
  body: z.object({ reason: z.string().trim().max(300).optional() }).default({}),
});

export const reviewJobSchema = z.object({
  params: jobIdParams,
  body: z.object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(1000).optional(),
  }),
});

export type CreateJobInput = z.infer<typeof createJobSchema>['body'];
export type ListJobsQuery = z.infer<typeof listJobsSchema>['query'];
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>['body'];
export type CancelJobInput = z.infer<typeof cancelJobSchema>['body'];
export type ReviewJobInput = z.infer<typeof reviewJobSchema>['body'];
