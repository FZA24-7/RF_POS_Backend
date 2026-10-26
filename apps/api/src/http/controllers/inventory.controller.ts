import type { Request, Response } from 'express';
import type { AdjustStockInput, InventoryListQuery, OpeningStockInput } from '@mafk/validation';
import type { InventoryService } from '../../services/inventory.service.js';
import { DomainError } from '../../domain/types.js';
import type { Actor } from '../../services/category.service.js';

const actorFrom = (req: Request): Actor => {
  if (!req.auth?.tenantId)
    throw new DomainError('TENANT_REQUIRED', 'This action requires a tenant context.', 403);
  return { id: req.auth.userId, tenantId: req.auth.tenantId };
};

export const createInventoryController = (inventory: InventoryService) => ({
  async list(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as InventoryListQuery;
    res.status(200).json(await inventory.list(actorFrom(req).tenantId, query));
  },
  async lowStock(req: Request, res: Response): Promise<void> {
    const storeId = typeof req.query.storeId === 'string' ? req.query.storeId : undefined;
    res.status(200).json(await inventory.listLowStock(actorFrom(req).tenantId, storeId));
  },
  async movements(req: Request, res: Response): Promise<void> {
    const { productId } = req.params as { productId: string };
    res.status(200).json(await inventory.listMovements(actorFrom(req).tenantId, productId));
  },
  async setOpeningStock(req: Request, res: Response): Promise<void> {
    const input = req.body as OpeningStockInput;
    res.status(201).json(await inventory.setOpeningStock(actorFrom(req), input));
  },
  async adjust(req: Request, res: Response): Promise<void> {
    const input = req.body as AdjustStockInput;
    res.status(201).json(await inventory.adjustStock(actorFrom(req), input));
  },
});
