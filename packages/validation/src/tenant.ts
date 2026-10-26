import { z } from 'zod';
import { loginIdSchema, passwordSchema } from './auth.js';

export const tenantCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, 'Tenant code must be 2-20 chars, letters/numbers/dash');

export const createTenantSchema = z.object({
  code: tenantCodeSchema,
  name: z.string().trim().min(2).max(120),
  legalName: z.string().trim().max(160).optional(),
  contactEmail: z.string().trim().email().optional(),
  contactPhone: z.string().trim().max(32).optional(),
  address: z.string().trim().max(240).optional(),
  currency: z.string().trim().length(3).optional(),
  timezone: z.string().trim().max(64).optional(),
  defaultStoreName: z.string().trim().min(2).max(120).default('Main Branch'),
  masterAdmin: z.object({
    loginId: loginIdSchema,
    password: passwordSchema,
    displayName: z.string().trim().min(2).max(120),
    email: z.string().trim().email().optional(),
  }),
  license: z.object({
    planCode: z.string().trim().min(2).max(40),
    expiresAt: z.coerce.date(),
    maxUsers: z.number().int().positive().max(10000),
    maxDevices: z.number().int().positive().max(10000),
    maxStores: z.number().int().positive().max(1000),
    enabledModules: z.array(z.string().trim().min(1)).default([]),
  }),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;
