import { Router } from 'express';

/**
 * Liveness only. Deliberately does not touch the database, so it remains a
 * meaningful signal ("is the process up and serving HTTP") even in the
 * current environment where Prisma Client generation is blocked. A separate
 * /health/db-backed check can be added once Prisma engine access is restored.
 */
export const healthRoutes = (): Router => {
  const router = Router();
  router.get('/health', (_req, res) => {
    res
      .status(200)
      .json({ status: 'ok', uptimeSeconds: process.uptime(), timestamp: new Date().toISOString() });
  });
  return router;
};
