import { Router } from 'express';
import { changeLoginIdSchema, idParamSchema } from '@mafk/validation';
import type { AccessTokenService } from '../../security/jwt.js';
import type { UsersController } from '../types.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requirePermission } from '../middleware/require-permission.js';

export const usersRoutes = (
  controller: UsersController,
  accessTokens: AccessTokenService,
): Router => {
  const router = Router();
  // Scoped to '/users' - see master-admin.routes.ts's comment for why an
  // unscoped `router.use()` here would incorrectly gate every other router
  // mounted alongside this one at the same '/api' prefix.
  router.use('/users', requireAuth(accessTokens));

  router.get(
    '/users/:id/login-id/edit-state',
    validate(idParamSchema, 'params'),
    controller.loginIdEditState,
  );

  router.patch(
    '/users/:id/login-id',
    requirePermission('users.manage'),
    validate(idParamSchema, 'params'),
    validate(changeLoginIdSchema, 'body'),
    controller.changeLoginId,
  );

  return router;
};
