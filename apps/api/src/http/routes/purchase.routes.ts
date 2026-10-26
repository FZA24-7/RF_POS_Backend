import { Router } from 'express';
import {
  createPurchaseSchema,
  idParamSchema,
  purchaseListQuerySchema,
  recordPurchasePaymentSchema,
} from '@mafk/validation';
import type { AccessTokenService } from '../../security/jwt.js';
import type { createPurchaseController } from '../controllers/purchase.controller.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requirePermission, requireTenant } from '../middleware/require-permission.js';

type PurchaseController = ReturnType<typeof createPurchaseController>;

export const purchaseRoutes = (
  controller: PurchaseController,
  accessTokens: AccessTokenService,
): Router => {
  const router = Router();
  // Scoped to '/purchases' - see master-admin.routes.ts's comment on why an
  // unscoped `router.use()` would be a real bug in a multi-router app.
  router.use('/purchases', requireAuth(accessTokens), requireTenant);

  router.get(
    '/purchases',
    requirePermission('purchases.view'),
    validate(purchaseListQuerySchema, 'query'),
    controller.list,
  );
  router.post(
    '/purchases',
    requirePermission('purchases.create'),
    validate(createPurchaseSchema),
    controller.record,
  );
  router.get(
    '/purchases/:id',
    requirePermission('purchases.view'),
    validate(idParamSchema, 'params'),
    controller.getById,
  );
  router.get(
    '/purchases/:id/invoice',
    requirePermission('purchases.view'),
    validate(idParamSchema, 'params'),
    controller.getInvoice,
  );
  router.get(
    '/purchases/:id/invoice.pdf',
    requirePermission('purchases.print'),
    validate(idParamSchema, 'params'),
    controller.downloadInvoicePdf,
  );
  router.post(
    '/purchases/:id/payments',
    requirePermission('purchases.edit'),
    validate(idParamSchema, 'params'),
    validate(recordPurchasePaymentSchema),
    controller.recordPayment,
  );

  return router;
};
