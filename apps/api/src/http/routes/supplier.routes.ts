import { Router } from 'express';
import { createSupplierSchema, idParamSchema, supplierListQuerySchema } from '@mafk/validation';
import type { AccessTokenService } from '../../security/jwt.js';
import type { createSupplierController } from '../controllers/supplier.controller.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requirePermission, requireTenant } from '../middleware/require-permission.js';

type SupplierController = ReturnType<typeof createSupplierController>;

export const supplierRoutes = (
  controller: SupplierController,
  accessTokens: AccessTokenService,
): Router => {
  const router = Router();
  // Scoped to '/suppliers' - see master-admin.routes.ts's comment on why an
  // unscoped `router.use()` would be a real bug in a multi-router app.
  router.use('/suppliers', requireAuth(accessTokens), requireTenant);

  router.get(
    '/suppliers',
    requirePermission('suppliers.view'),
    validate(supplierListQuerySchema, 'query'),
    controller.list,
  );
  router.post(
    '/suppliers',
    requirePermission('suppliers.create'),
    validate(createSupplierSchema),
    controller.create,
  );
  router.get(
    '/suppliers/:id',
    requirePermission('suppliers.view'),
    validate(idParamSchema, 'params'),
    controller.getById,
  );
  router.get(
    '/suppliers/:id/ledger',
    requirePermission('suppliers.view'),
    validate(idParamSchema, 'params'),
    controller.ledger,
  );

  return router;
};
