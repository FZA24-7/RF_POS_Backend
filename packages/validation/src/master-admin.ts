import { z } from 'zod';
import { CLIENT_STAFF_ROLES, MODULE_CATALOG } from '@mafk/shared';
import { loginIdSchema, passwordSchema } from './auth.js';

// Re-exported here only so this file is self-contained about which literal
// strings are valid; the actual enum lives in the Prisma schema.
const tenantStatusValues = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;
const licenseStatusValues = ['ACTIVE', 'SUSPENDED', 'REVOKED'] as const; // EXPIRED is derived, never set directly

export const tenantListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(tenantStatusValues).optional(),
  page: z.coerce.number().int().positive().max(100_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
export type TenantListQuery = z.infer<typeof tenantListQuerySchema>;

export const updateTenantSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  legalName: z.string().trim().max(160).optional(),
  contactEmail: z.string().trim().email().optional(),
  contactPhone: z.string().trim().max(32).optional(),
  address: z.string().trim().max(240).optional(),
});
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

export const updateTenantStatusSchema = z.object({
  status: z.enum(tenantStatusValues),
  reason: z.string().trim().max(240).optional(),
});
export type UpdateTenantStatusInput = z.infer<typeof updateTenantStatusSchema>;

export const createClientAdminSchema = z.object({
  loginId: loginIdSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().optional(),
});
export type CreateClientAdminInput = z.infer<typeof createClientAdminSchema>;

export const createStaffForTenantSchema = z.object({
  loginId: loginIdSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().optional(),
  role: z.enum(CLIENT_STAFF_ROLES as unknown as [string, ...string[]]),
});
export type CreateStaffForTenantInput = z.infer<typeof createStaffForTenantSchema>;

export const updateUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'DISABLED']),
  reason: z.string().trim().max(240).optional(),
});
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;

export const resetPasswordSchema = z.object({
  newPassword: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const createLicenseSchema = z.object({
  planCode: z.string().trim().min(2).max(40),
  expiresAt: z.coerce.date(),
  maxUsers: z.number().int().positive().max(10_000),
  maxDevices: z.number().int().positive().max(10_000),
  maxStores: z.number().int().positive().max(1_000),
  enabledModules: z.array(z.enum(MODULE_CATALOG as unknown as [string, ...string[]])).default([]),
});
export type CreateLicenseInput = z.infer<typeof createLicenseSchema>;

export const updateLicenseSchema = z.object({
  planCode: z.string().trim().min(2).max(40).optional(),
  expiresAt: z.coerce.date().optional(),
  maxUsers: z.number().int().positive().max(10_000).optional(),
  maxDevices: z.number().int().positive().max(10_000).optional(),
  maxStores: z.number().int().positive().max(1_000).optional(),
});
export type UpdateLicenseInput = z.infer<typeof updateLicenseSchema>;

export const updateLicenseStatusSchema = z.object({
  status: z.enum(licenseStatusValues),
  reason: z.string().trim().max(240).optional(),
});
export type UpdateLicenseStatusInput = z.infer<typeof updateLicenseStatusSchema>;

export const updateModulesSchema = z.object({
  enabledModules: z.array(z.enum(MODULE_CATALOG as unknown as [string, ...string[]])),
});
export type UpdateModulesInput = z.infer<typeof updateModulesSchema>;
