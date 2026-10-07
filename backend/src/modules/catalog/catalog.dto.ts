import { z } from 'zod';

export const createServiceSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(100),
    category: z.string().min(1).max(50),
    baseFee: z.number().int().positive(),
    icon: z.string().optional(),
    description: z.string().optional(),
  }),
});

export const updateServiceSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    name: z.string().min(1).max(100).optional(),
    category: z.string().min(1).max(50).optional(),
    baseFee: z.number().int().positive().optional(),
    icon: z.string().optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const getServiceSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export const deleteServiceSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export type CreateServiceInput = z.infer<typeof createServiceSchema>['body'];
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>['body'];
export type GetServiceInput = z.infer<typeof getServiceSchema>['params'];
export type DeleteServiceInput = z.infer<typeof deleteServiceSchema>['params'];