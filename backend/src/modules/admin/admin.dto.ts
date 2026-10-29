import { z } from 'zod';

const userIdParams = z.object({ id: z.string().uuid() });
const search = z.string().trim().max(100).optional();

export const listTechniciansSchema = z.object({
  query: z.object({
    verification: z.enum(['UNSUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED']).optional(),
    online: z.enum(['true', 'false']).optional(),
    q: search,
  }),
});

export const verificationSchema = z.object({
  params: userIdParams,
  body: z
    .object({
      status: z.enum(['VERIFIED', 'REJECTED']),
      reason: z.string().trim().min(3).max(300).optional(),
    })
    .refine(b => b.status !== 'REJECTED' || !!b.reason, {
      message: 'A reason is required when rejecting',
      path: ['reason'],
    }),
});

export const listUsersSchema = z.object({
  query: z.object({
    role: z.enum(['CUSTOMER', 'TECHNICIAN', 'ADMIN']).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
    q: search,
    limit: z.coerce.number().int().min(1).max(200).default(100),
  }),
});

export const userStatusSchema = z.object({
  params: userIdParams,
  body: z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) }),
});

export const jobIdSchema = z.object({ params: z.object({ id: z.string().uuid() }) });

export const assignSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({ technicianUserId: z.string().uuid() }),
});

export const analyticsSchema = z.object({
  query: z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }),
});

export type ListTechniciansQuery = z.infer<typeof listTechniciansSchema>['query'];
export type VerificationInput = z.infer<typeof verificationSchema>['body'];
export type ListUsersQuery = z.infer<typeof listUsersSchema>['query'];
