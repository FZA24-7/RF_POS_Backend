import { z } from 'zod';
import { LOGIN_ID_REGEX } from '@mafk/shared';

export const loginIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Login ID must be at least 3 characters')
  .max(32, 'Login ID must be at most 32 characters')
  .regex(LOGIN_ID_REGEX, 'Login ID may contain letters, numbers, dot, dash, underscore only');

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((v) => /[a-z]/.test(v), 'Password must contain a lowercase letter')
  .refine((v) => /[A-Z]/.test(v), 'Password must contain an uppercase letter')
  .refine((v) => /[0-9]/.test(v), 'Password must contain a digit');

export const loginSchema = z.object({
  loginId: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changeLoginIdSchema = z.object({
  newLoginId: loginIdSchema,
});
export type ChangeLoginIdInput = z.infer<typeof changeLoginIdSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).optional(),
});
