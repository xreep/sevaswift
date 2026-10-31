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
    // Paths returned by POST /uploads; ownership is checked when the job is created.
    photoUrls: z
      .array(z.string().regex(/^\/api\/v1\/uploads\/[0-9a-f-]{36}$/, 'Upload the photo first'))
      .max(3)
      .default([]),
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
    // "Arrived" more than 1 km from the customer's pin must be confirmed by the technician.
    confirmFar: z.boolean().optional(),
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
