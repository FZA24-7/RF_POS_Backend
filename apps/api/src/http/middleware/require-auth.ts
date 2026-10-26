import type { NextFunction, Request, Response } from 'express';
import type { AccessTokenService } from '../../security/jwt.js';

/**
 * Verifies the `Authorization: Bearer <token>` header and attaches a
 * `SecurityContext` to `req.auth`. Every route that needs an authenticated
 * user (i.e. everything except /health and /api/auth/*) uses this.
 */
export const requireAuth =
  (accessTokens: AccessTokenService) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      res
        .status(401)
        .json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } });
      return;
    }
    const token = header.slice('Bearer '.length).trim();
    try {
      const claims = await accessTokens.verify(token);
      req.auth = {
        userId: claims.sub,
        tenantId: claims.tid,
        storeId: null,
        systemRole: claims.role,
        permissions: new Set(claims.perms),
        sessionId: claims.sid,
      };
      next();
    } catch {
      res
        .status(401)
        .json({ error: { code: 'TOKEN_INVALID', message: 'Invalid or expired token.' } });
    }
  };
