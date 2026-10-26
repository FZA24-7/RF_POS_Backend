import type { NextFunction, Request, Response } from 'express';
import { hasAllPermissions } from '../../rbac/check.js';

/**
 * Enforces permissions on the SERVER, as required by the spec - never trust a
 * frontend-only check. Must run after `requireAuth`.
 */
export const requirePermission =
  (...required: readonly string[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res
        .status(401)
        .json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } });
      return;
    }
    if (!hasAllPermissions(req.auth.permissions, required)) {
      res.status(403).json({ error: { code: 'PERMISSION_DENIED', message: 'Permission denied.' } });
      return;
    }
    next();
  };

/** Requires the caller to belong to a tenant (i.e. rejects platform-level Master Admin tokens). */
export const requireTenant = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.auth) {
    res
      .status(401)
      .json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } });
    return;
  }
  if (!req.auth.tenantId) {
    res.status(403).json({
      error: { code: 'TENANT_REQUIRED', message: 'This action requires a tenant context.' },
    });
    return;
  }
  next();
};
