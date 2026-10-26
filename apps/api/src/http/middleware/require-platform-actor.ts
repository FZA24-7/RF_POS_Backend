import type { NextFunction, Request, Response } from 'express';

/**
 * Belt-and-suspenders check for every Master Admin route, IN ADDITION to
 * `requirePermission`. Permission grants are the primary defence (and tenant
 * roles can never be granted a platform permission - see
 * `@mafk/shared` `TENANT_FORBIDDEN_PERMISSIONS`), but this middleware adds a
 * second, independent guard: the caller's token must actually carry
 * `systemRole === 'MASTER_ADMIN'` AND `tenantId === null`. A bug that somehow
 * let a tenant-scoped token acquire a platform permission key would still be
 * stopped here - privilege escalation across the platform/tenant boundary
 * requires two independent failures, not one.
 */
export const requirePlatformActor = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.auth) {
    res
      .status(401)
      .json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } });
    return;
  }
  if (req.auth.systemRole !== 'MASTER_ADMIN' || req.auth.tenantId !== null) {
    res
      .status(403)
      .json({ error: { code: 'FORBIDDEN', message: 'Master Admin access required.' } });
    return;
  }
  next();
};
