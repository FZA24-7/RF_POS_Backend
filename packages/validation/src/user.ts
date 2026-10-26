import { z } from 'zod';
import { CLIENT_STAFF_ROLES } from '@mafk/shared';
import { loginIdSchema, passwordSchema } from './auth.js';

export const createStaffUserSchema = z.object({
  loginId: loginIdSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().max(32).optional(),
  storeId: z.string().trim().min(1).optional(),
  role: z.enum(CLIENT_STAFF_ROLES as unknown as [string, ...string[]]),
});
export type CreateStaffUserInput = z.infer<typeof createStaffUserSchema>;

export const idParamSchema = z.object({ id: z.string().trim().min(1) });
