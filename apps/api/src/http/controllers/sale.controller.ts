import type { Request, Response } from 'express';
import type {
  CreateSaleInput,
  CreateSaleReturnInput,
  PosProductSearchQuery,
  ReceiptQuery,
  SaleListQuery,
} from '@mafk/validation';
import type { SaleActor, SaleService } from '../../services/sale.service.js';
import { DomainError } from '../../domain/types.js';

const actorFrom = (req: Request): SaleActor => {
  if (!req.auth?.tenantId)
    throw new DomainError('TENANT_REQUIRED', 'This action requires a tenant context.', 403);
  return { id: req.auth.userId, tenantId: req.auth.tenantId, permissions: req.auth.permissions };
};

const pdfResponse = (res: Response, filename: string, pdf: Buffer): void => {
  res
    .status(200)
    .setHeader('Content-Type', 'application/pdf')
    .setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    .send(pdf);
};

export const createSaleController = (sales: SaleService) => ({
  async searchProducts(req: Request, res: Response): Promise<void> {
    const q = req.query as unknown as PosProductSearchQuery;
    res.status(200).json({ items: await sales.searchProducts(actorFrom(req).tenantId, q) });
  },

  async create(req: Request, res: Response): Promise<void> {
    const { sale, replayed } = await sales.createSale(actorFrom(req), req.body as CreateSaleInput);
    // 201 for a new sale; 200 + header when the idempotency key matched an existing sale (nothing was written).
    res
      .status(replayed ? 200 : 201)
      .setHeader('Idempotent-Replayed', String(replayed))
      .json(sale);
  },

  async list(req: Request, res: Response): Promise<void> {
    res
      .status(200)
      .json(await sales.list(actorFrom(req).tenantId, req.query as unknown as SaleListQuery));
  },

  async getById(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    res.status(200).json(await sales.getById(id, actorFrom(req).tenantId));
  },

  async receipt(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    const { format } = req.query as unknown as ReceiptQuery;
    const doc = await sales.saleReceipt(id, actorFrom(req).tenantId);
    res.status(200).json({
      format,
      receipt: doc,
      text: format === 'a4' ? null : await sales.renderText(doc, format),
    });
  },

  async receiptPdf(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    const { format } = req.query as unknown as ReceiptQuery;
    const actor = actorFrom(req);
    const doc = await sales.saleReceipt(id, actor.tenantId);
    const { filename, pdf } = await sales.renderPdf(actor, doc, format, 'Sale', id);
    pdfResponse(res, filename, pdf);
  },

  async refund(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    res.status(201).json(await sales.refund(actorFrom(req), id, req.body as CreateSaleReturnInput));
  },

  async getReturn(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    res.status(200).json(await sales.getReturn(id, actorFrom(req).tenantId));
  },

  async returnReceipt(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    const { format } = req.query as unknown as ReceiptQuery;
    const doc = await sales.refundReceipt(id, actorFrom(req).tenantId);
    res.status(200).json({
      format,
      receipt: doc,
      text: format === 'a4' ? null : await sales.renderText(doc, format),
    });
  },

  async returnReceiptPdf(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    const { format } = req.query as unknown as ReceiptQuery;
    const actor = actorFrom(req);
    const doc = await sales.refundReceipt(id, actor.tenantId);
    const { filename, pdf } = await sales.renderPdf(actor, doc, format, 'SaleReturn', id);
    pdfResponse(res, filename, pdf);
  },
});
