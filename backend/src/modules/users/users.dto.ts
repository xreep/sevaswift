import { z } from 'zod';

export const updateProfileSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(2).max(100).optional(),
      // Empty string clears the phone number.
      phone: z.union([z.string().regex(/^\+?[1-9]\d{1,14}$/), z.literal('')]).optional(),
    })
    .refine(b => b.name !== undefined || b.phone !== undefined, {
      message: 'Nothing to update',
    }),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(128),
  }),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>['body'];
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>['body'];
