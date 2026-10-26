import { Router } from 'express';
import {
  createClientAdminSchema,
  createLicenseSchema,
  createTenantSchema,
  idParamSchema,
  resetPasswordSchema,
  tenantListQuerySchema,
  updateLicenseSchema,
  updateLicenseStatusSchema,
  updateModulesSchema,
  updateTenantSchema,
  updateTenantStatusSchema,
  updateUserStatusSchema,
} from '@mafk/validation';
import { z } from 'zod';
import type { AccessTokenService } from '../../security/jwt.js';
import type { createMasterAdminController } from '../controllers/master-admin.controller.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requirePermission } from '../middleware/require-permission.js';
import { requirePlatformActor } from '../middleware/require-platform-actor.js';

type MasterAdminController = ReturnType<typeof createMasterAdminController>;

const licenseIdParamSchema = z.object({ licenseId: z.string().trim().min(1) });

export const masterAdminRoutes = (
  controller: MasterAdminController,
  accessTokens: AccessTokenService,
): Router => {
  const router = Router();

  // Every route below requires BOTH a valid token (requireAuth) AND a genuine
  // platform-level actor (requirePlatformActor) - see that middleware's doc
  // comment for why this is deliberately redundant with permission checks.
  //
  // CRITICAL: this must be scoped to '/master'. `app.use('/api', ...)` mounts
  // every route router at the SAME prefix, so an unscoped `router.use(fn)`
  // (no path argument) runs for EVERY request that reaches this router -
  // including ones destined for a completely different router mounted
  // alongside it (e.g. '/api/catalog/...', '/api/inventory/...') - because
  // Express only stops passing a request along once some middleware actually
  // sends a response or a route matches, not because the path "belongs" to a
  // different router. An earlier version of this file had this unscoped and
  // it silently 403'd every tenant-scoped route in the whole API.
  router.use('/master', requireAuth(accessTokens), requirePlatformActor);

  router.get('/master/stats', requirePermission('tenants.view'), controller.getStats);

  router.get(
    '/master/tenants',
    requirePermission('tenants.view'),
    validate(tenantListQuerySchema, 'query'),
    controller.listTenants,
  );
  router.post(
    '/master/tenants',
    requirePermission('tenants.create'),
    validate(createTenantSchema),
    controller.createTenant,
  );
  router.get(
    '/master/tenants/:id',
    requirePermission('tenants.view'),
    validate(idParamSchema, 'params'),
    controller.getTenant,
  );
  router.patch(
    '/master/tenants/:id',
    requirePermission('tenants.edit'),
    validate(idParamSchema, 'params'),
    validate(updateTenantSchema),
    controller.updateTenant,
  );
  router.patch(
    '/master/tenants/:id/status',
    requirePermission('tenants.approve'),
    validate(idParamSchema, 'params'),
    validate(updateTenantStatusSchema),
    controller.updateTenantStatus,
  );
  router.get(
    '/master/tenants/:id/stores',
    requirePermission('tenants.view'),
    validate(idParamSchema, 'params'),
    controller.listTenantStores,
  );
  router.get(
    '/master/tenants/:id/users',
    requirePermission('users.view'),
    validate(idParamSchema, 'params'),
    controller.listTenantUsers,
  );
  router.get(
    '/master/tenants/:id/audit-logs',
    requirePermission('audit.view'),
    validate(idParamSchema, 'params'),
    controller.listTenantAuditLogs,
  );
  router.post(
    '/master/tenants/:id/client-admins',
    requirePermission('users.manage'),
    validate(idParamSchema, 'params'),
    validate(createClientAdminSchema),
    controller.createClientAdmin,
  );

  router.get('/master/licenses', requirePermission('licenses.view'), controller.listAllLicenses);
  router.get(
    '/master/tenants/:id/licenses',
    requirePermission('licenses.view'),
    validate(idParamSchema, 'params'),
    controller.listTenantLicenses,
  );
  router.post(
    '/master/tenants/:id/licenses',
    requirePermission('licenses.manage'),
    validate(idParamSchema, 'params'),
    validate(createLicenseSchema),
    controller.createLicense,
  );
  router.patch(
    '/master/licenses/:licenseId',
    requirePermission('licenses.manage'),
    validate(licenseIdParamSchema, 'params'),
    validate(updateLicenseSchema),
    controller.updateLicense,
  );
  router.patch(
    '/master/licenses/:licenseId/status',
    requirePermission('licenses.manage'),
    validate(licenseIdParamSchema, 'params'),
    validate(updateLicenseStatusSchema),
    controller.updateLicenseStatus,
  );
  router.patch(
    '/master/licenses/:licenseId/modules',
    requirePermission('licenses.manage'),
    validate(licenseIdParamSchema, 'params'),
    validate(updateModulesSchema),
    controller.updateLicenseModules,
  );

  router.patch(
    '/master/users/:id/status',
    requirePermission('users.manage'),
    validate(idParamSchema, 'params'),
    validate(updateUserStatusSchema),
    controller.setUserStatus,
  );
  router.post(
    '/master/users/:id/reset-password',
    requirePermission('users.manage'),
    validate(idParamSchema, 'params'),
    validate(resetPasswordSchema),
    controller.resetPassword,
  );

  return router;
};
