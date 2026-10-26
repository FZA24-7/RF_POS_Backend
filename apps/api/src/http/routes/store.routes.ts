import { Router } from 'express';
import type { AccessTokenService } from '../../security/jwt.js';
import type { createStoreController } from '../controllers/store.controller.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requirePermission, requireTenant } from '../middleware/require-permission.js';

type StoreController = ReturnType<typeof createStoreController>;

export const storeRoutes = (
  controller: StoreController,
  accessTokens: AccessTokenService,
): Router => {
  const router = Router();
  // Scoped to '/stores' - see master-admin.routes.ts's comment on why an
  // unscoped `router.use()` would be a real bug in a multi-router app.
  router.use('/stores', requireAuth(accessTokens), requireTenant);
  router.get('/stores', requirePermission('stores.view'), controller.list);
  return router;
};
