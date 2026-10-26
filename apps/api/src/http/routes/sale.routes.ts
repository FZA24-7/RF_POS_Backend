import { Router } from 'express';
import {
  createSaleReturnSchema,
  createSaleSchema,
  idParamSchema,
  posProductSearchSchema,
  receiptQuerySchema,
  saleListQuerySchema,
} from '@mafk/validation';
import type { AccessTokenService } from '../../security/jwt.js';
import type { createSaleController } from '../controllers/sale.controller.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requirePermission, requireTenant } from '../middleware/require-permission.js';

type SaleController = ReturnType<typeof createSaleController>;

export const saleRoutes = (
  controller: SaleController,
  accessTokens: AccessTokenService,
): Router => {
  const router = Router();
  // Scoped per prefix (see master-admin.routes.ts: an unscoped router.use would guard every later router).
  for (const prefix of ['/pos', '/sales', '/sale-returns']) {
    router.use(prefix, requireAuth(accessTokens), requireTenant);
  }

  router.get(
    '/pos/products',
    requirePermission('pos.view'),
    validate(posProductSearchSchema, 'query'),
    controller.searchProducts,
  );

  router.post(
    '/sales',
    requirePermission('pos.create'),
    validate(createSaleSchema),
    controller.create,
  );
  router.get(
    '/sales',
    requirePermission('sales.view'),
    validate(saleListQuerySchema, 'query'),
    controller.list,
  );
  router.get(
    '/sales/:id',
    requirePermission('sales.view'),
    validate(idParamSchema, 'params'),
    controller.getById,
  );
  router.get(
    '/sales/:id/receipt',
    requirePermission('sales.print'),
    validate(idParamSchema, 'params'),
    validate(receiptQuerySchema, 'query'),
    controller.receipt,
  );
  router.get(
    '/sales/:id/receipt.pdf',
    requirePermission('sales.print'),
    validate(idParamSchema, 'params'),
    validate(receiptQuerySchema, 'query'),
    controller.receiptPdf,
  );
  router.post(
    '/sales/:id/returns',
    requirePermission('sale.refund'),
    validate(idParamSchema, 'params'),
    validate(createSaleReturnSchema),
    controller.refund,
  );

  router.get(
    '/sale-returns/:id',
    requirePermission('sale_returns.view'),
    validate(idParamSchema, 'params'),
    controller.getReturn,
  );
  router.get(
    '/sale-returns/:id/receipt',
    requirePermission('sale_returns.print'),
    validate(idParamSchema, 'params'),
    validate(receiptQuerySchema, 'query'),
    controller.returnReceipt,
  );
  router.get(
    '/sale-returns/:id/receipt.pdf',
    requirePermission('sale_returns.print'),
    validate(idParamSchema, 'params'),
    validate(receiptQuerySchema, 'query'),
    controller.returnReceiptPdf,
  );

  return router;
};
