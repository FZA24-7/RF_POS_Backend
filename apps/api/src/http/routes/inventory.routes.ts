import { Router } from 'express';
import { adjustStockSchema, inventoryListQuerySchema, openingStockSchema } from '@mafk/validation';
import { z } from 'zod';
import type { AccessTokenService } from '../../security/jwt.js';
import type { createInventoryController } from '../controllers/inventory.controller.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requirePermission, requireTenant } from '../middleware/require-permission.js';

type InventoryController = ReturnType<typeof createInventoryController>;

const productIdParamSchema = z.object({ productId: z.string().trim().min(1) });

export const inventoryRoutes = (
  controller: InventoryController,
  accessTokens: AccessTokenService,
): Router => {
  const router = Router();
  // Scoped to '/inventory' - see master-admin.routes.ts's comment.
  router.use('/inventory', requireAuth(accessTokens), requireTenant);

  router.get(
    '/inventory',
    requirePermission('inventory.view'),
    validate(inventoryListQuerySchema, 'query'),
    controller.list,
  );
  router.get('/inventory/low-stock', requirePermission('inventory.view'), controller.lowStock);
  router.get(
    '/inventory/:productId/movements',
    requirePermission('inventory.view'),
    validate(productIdParamSchema, 'params'),
    controller.movements,
  );
  router.post(
    '/inventory/opening-stock',
    requirePermission('inventory.create'),
    validate(openingStockSchema),
    controller.setOpeningStock,
  );
  router.post(
    '/inventory/adjust',
    requirePermission('stock.adjust'),
    validate(adjustStockSchema),
    controller.adjust,
  );

  return router;
};
