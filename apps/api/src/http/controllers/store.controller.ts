import type { Request, Response } from 'express';
import type { StoreService } from '../../services/store.service.js';
import { DomainError } from '../../domain/types.js';

export const createStoreController = (stores: StoreService) => ({
  async list(req: Request, res: Response): Promise<void> {
    if (!req.auth?.tenantId)
      throw new DomainError('TENANT_REQUIRED', 'This action requires a tenant context.', 403);
    res.status(200).json(await stores.list(req.auth.tenantId));
  },
});
