import type { Request, Response } from 'express';
import type {
  CreatePurchaseInput,
  PurchaseListQuery,
  RecordPurchasePaymentInputBody,
} from '@mafk/validation';
import type { PurchaseService } from '../../services/purchase.service.js';
import { DomainError } from '../../domain/types.js';
import type { Actor } from '../../services/category.service.js';

const actorFrom = (req: Request): Actor => {
  if (!req.auth?.tenantId)
    throw new DomainError('TENANT_REQUIRED', 'This action requires a tenant context.', 403);
  return { id: req.auth.userId, tenantId: req.auth.tenantId };
};

export const createPurchaseController = (purchases: PurchaseService) => ({
  async list(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as PurchaseListQuery;
    res.status(200).json(await purchases.list(actorFrom(req).tenantId, query));
  },

  /**
   * Doubles as both "open the invoice right after recording" and "reprint" -
   * both paths are simply a GET of the saved purchase. Reprinting therefore
   * can never recreate a transaction or recompute totals; it reads exactly
   * what was committed.
   */
  async getById(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    res.status(200).json(await purchases.getById(id, actorFrom(req).tenantId));
  },

  async getInvoice(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    res.status(200).json(await purchases.getInvoice(id, actorFrom(req).tenantId));
  },

  async downloadInvoicePdf(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    const { filename, pdf } = await purchases.exportInvoicePdf(actorFrom(req), id);
    res
      .status(200)
      .setHeader('Content-Type', 'application/pdf')
      .setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      .send(pdf);
  },

  async record(req: Request, res: Response): Promise<void> {
    const input = req.body as CreatePurchaseInput;
    const created = await purchases.recordPurchase(actorFrom(req), input);
    res.status(201).json(created);
  },

  async recordPayment(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    const body = req.body as RecordPurchasePaymentInputBody;
    res.status(200).json(await purchases.recordPayment(actorFrom(req), id, body));
  },
});
