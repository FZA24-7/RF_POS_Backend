import { Router } from 'express';
import { loginSchema } from '@mafk/validation';
import type { AuthController } from '../types.js';
import { validate } from '../middleware/validate.js';
import { loginRateLimiter } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/require-auth.js';
import type { AccessTokenService } from '../../security/jwt.js';

export const authRoutes = (
  controller: AuthController,
  accessTokens: AccessTokenService,
): Router => {
  const router = Router();
  router.post('/auth/login', loginRateLimiter, validate(loginSchema), controller.login);
  router.post('/auth/refresh', loginRateLimiter, controller.refresh);
  router.post('/auth/logout', controller.logout);
  router.get('/auth/me', requireAuth(accessTokens), controller.me);
  return router;
};
