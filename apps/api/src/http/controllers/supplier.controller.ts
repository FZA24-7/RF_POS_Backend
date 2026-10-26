import type { Request, Response } from 'express';
import type { CreateSupplierInput, SupplierListQuery } from '@mafk/validation';
import type { SupplierService } from '../../services/supplier.service.js';
import { DomainError } from '../../domain/types.js';
import type { Actor } from '../../services/category.service.js';

const actorFrom = (req: Request): Actor => {
  if (!req.auth?.tenantId)
    throw new DomainError('TENANT_REQUIRED', 'This action requires a tenant context.', 403);
  return { id: req.auth.userId, tenantId: req.auth.tenantId };
};

export const createSupplierController = (suppliers: SupplierService) => ({
  async list(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as SupplierListQuery;
    res.status(200).json(await suppliers.list(actorFrom(req).tenantId, query));
  },
  async getById(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    res.status(200).json(await suppliers.getById(id, actorFrom(req).tenantId));
  },
  async ledger(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    res.status(200).json(await suppliers.ledger(id, actorFrom(req).tenantId));
  },
  async create(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateSupplierInput;
    res.status(201).json(await suppliers.create(actorFrom(req), input));
  },
});
