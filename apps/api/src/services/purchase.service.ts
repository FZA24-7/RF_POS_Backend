import {
  compareDecimalStrings,
  isNonNegativeDecimalString,
  subtractDecimalStrings,
} from '@mafk/shared';
import type {
  CreatePurchaseInput,
  PurchaseListQuery,
  RecordPurchasePaymentInputBody,
} from '@mafk/validation';
import type { Repositories } from '../domain/ports.js';
import {
  DomainError,
  DuplicatePurchaseError,
  InvalidPurchaseRelationshipError,
  PaymentExceedsBalanceError,
  PurchaseConcurrencyError,
  type PurchaseDetail,
  type PurchaseInvoice,
  type PurchaseListResult,
  type RecordPurchaseInput,
} from '../domain/types.js';
import type { Actor } from './category.service.js';
import { computeLine, computeTotals } from './purchase-calculations.js';
import { renderPurchaseInvoicePdf } from './purchase-invoice-pdf.js';

export class PurchaseService {
  constructor(private readonly repos: Repositories) {}

  private async requirePurchase(id: string, tenantId: string): Promise<PurchaseDetail> {
    const purchase = await this.repos.purchases.findById(id, tenantId);
    if (!purchase) throw new DomainError('NOT_FOUND', 'Purchase not found.', 404);
    return purchase;
  }

  async getById(id: string, tenantId: string): Promise<PurchaseDetail> {
    return this.requirePurchase(id, tenantId);
  }

  /**
   * Builds the invoice view from SAVED records only. This is the single source
   * for the post-record auto-open, "View purchase", print, PDF and reprint:
   * all of them read the committed purchase, so a reprint can never create a
   * transaction or recompute different totals.
   */
  async getInvoice(id: string, tenantId: string): Promise<PurchaseInvoice> {
    const purchase = await this.requirePurchase(id, tenantId);
    const [tenant, stores, supplier, creator] = await Promise.all([
      this.repos.tenants.findDetailById(tenantId),
      this.repos.stores.listByTenant(tenantId),
      this.repos.suppliers.findById(purchase.supplierId, tenantId),
      this.repos.users.findById(purchase.createdById),
    ]);
    const store = stores.find((s) => s.id === purchase.storeId);
    if (!tenant || !store || !supplier) {
      throw new DomainError('NOT_FOUND', 'Purchase records are incomplete.', 404);
    }
    return {
      business: {
        name: tenant.name,
        legalName: tenant.legalName,
        address: tenant.address,
        phone: tenant.contactPhone,
        email: tenant.contactEmail,
        logoUrl: tenant.logoUrl ?? null,
      },
      branch: { id: store.id, code: store.code, name: store.name },
      supplier: {
        id: supplier.id,
        name: supplier.name,
        phone: supplier.phone,
        email: supplier.email,
        address: supplier.address,
      },
      createdBy:
        creator && creator.tenantId === tenantId
          ? { id: creator.id, displayName: creator.displayName }
          : null,
      purchase,
      amountPaid: purchase.paidAmount,
      outstanding: subtractDecimalStrings(purchase.total, purchase.paidAmount, 2),
    };
  }

  /** Generates the invoice PDF from the saved purchase and audits the export. */
  async exportInvoicePdf(actor: Actor, id: string): Promise<{ filename: string; pdf: Buffer }> {
    const invoice = await this.getInvoice(id, actor.tenantId);
    const pdf = await renderPurchaseInvoicePdf(invoice);
    await this.repos.auditLogs.record({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'PURCHASE_INVOICE_PDF_EXPORTED',
      entity: 'Purchase',
      entityId: id,
      metadata: { purchaseNo: invoice.purchase.purchaseNo },
    });
    return { filename: `purchase-invoice-${invoice.purchase.purchaseNo}.pdf`, pdf };
  }

  async list(tenantId: string, query: PurchaseListQuery): Promise<PurchaseListResult> {
    return this.repos.purchases.list(tenantId, {
      search: query.search,
      supplierId: query.supplierId,
      storeId: query.storeId,
      paymentStatus: query.paymentStatus,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  /**
   * Validates every relationship server-side (supplier, branch, and every
   * line's product must exist IN THIS TENANT), computes the financial totals
   * with the pure, fully-tested calculator in `purchase-calculations.ts`,
   * pre-checks the duplicate-submission guard for a friendly error, then
   * delegates the actual atomic write to `PurchaseRepository.recordPurchase`
   * - see that port's doc comment for why it is one method instead of
   * separate create-purchase / create-items / apply-inventory calls.
   */
  async recordPurchase(actor: Actor, input: CreatePurchaseInput): Promise<PurchaseDetail> {
    const supplier = await this.repos.suppliers.findById(input.supplierId, actor.tenantId);
    if (!supplier)
      throw new DomainError('VALIDATION_ERROR', 'Selected supplier does not exist.', 422);

    const stores = await this.repos.stores.listByTenant(actor.tenantId);
    if (!stores.some((s) => s.id === input.storeId)) {
      throw new DomainError('VALIDATION_ERROR', 'Selected branch does not exist.', 422);
    }

    for (const item of input.items) {
      const product = await this.repos.products.findById(item.productId, actor.tenantId);
      if (!product)
        throw new DomainError('VALIDATION_ERROR', `Product ${item.productId} does not exist.`, 422);
      if (!isNonNegativeDecimalString(item.quantity, 3) || item.quantity === '0') {
        throw new DomainError('VALIDATION_ERROR', 'Quantity must be greater than zero.', 422);
      }
      if (!isNonNegativeDecimalString(item.costPrice, 4)) {
        throw new DomainError('VALIDATION_ERROR', 'Cost price must not be negative.', 422);
      }
    }

    // Compute the full financial picture up front (pure, no I/O) so that if
    // the discount/tax math is invalid (e.g. a discount exceeding the line
    // amount), we fail BEFORE touching the database at all.
    const computedLines = input.items.map((item) => computeLine(item));
    const totals = computeTotals(computedLines, {
      discountPercent: input.discountPercent,
      discountAmount: input.discountAmount,
    });

    if (input.initialPayment) {
      if (
        !isNonNegativeDecimalString(input.initialPayment.amount, 2) ||
        input.initialPayment.amount === '0'
      ) {
        throw new DomainError(
          'VALIDATION_ERROR',
          'Initial payment amount must be greater than zero.',
          422,
        );
      }
      if (compareDecimalStrings(input.initialPayment.amount, totals.total, 2) > 0) {
        throw new DomainError(
          'VALIDATION_ERROR',
          'Initial payment cannot exceed the purchase total.',
          422,
        );
      }
    }

    if (
      await this.repos.purchases.existsByInvoiceNo(
        actor.tenantId,
        input.supplierId,
        input.invoiceNo,
      )
    ) {
      throw new DomainError(
        'CONFLICT',
        `A purchase with invoice number "${input.invoiceNo}" already exists for this supplier. If you are retrying a previous submission, it may have already been recorded - check the purchase list before submitting again.`,
        409,
      );
    }

    const recordInput: RecordPurchaseInput = {
      tenantId: actor.tenantId,
      storeId: input.storeId,
      supplierId: input.supplierId,
      invoiceNo: input.invoiceNo,
      purchaseDate: input.purchaseDate,
      items: input.items,
      purchaseDiscountPercent: input.discountPercent,
      purchaseDiscountAmount: input.discountAmount,
      initialPayment: input.initialPayment,
      createdById: actor.id,
      // Written by the repository INSIDE the purchase transaction (all-or-nothing with stock + payment).
      audit: {
        userId: actor.id,
        action: 'PURCHASE_RECORDED',
        metadata: { invoiceNo: input.invoiceNo, itemCount: input.items.length },
      },
    };

    let purchase: PurchaseDetail;
    try {
      purchase = await this.repos.purchases.recordPurchase(recordInput);
    } catch (err) {
      if (err instanceof DuplicatePurchaseError) {
        throw new DomainError('CONFLICT', err.message, 409);
      }
      if (err instanceof InvalidPurchaseRelationshipError) {
        throw new DomainError('VALIDATION_ERROR', err.message, 422);
      }
      throw err;
    }

    return purchase;
  }

  async recordPayment(
    actor: Actor,
    purchaseId: string,
    body: RecordPurchasePaymentInputBody,
  ): Promise<PurchaseDetail> {
    await this.requirePurchase(purchaseId, actor.tenantId); // 404 if not in this tenant (IDOR guard)
    if (!isNonNegativeDecimalString(body.amount, 2) || body.amount === '0') {
      throw new DomainError('VALIDATION_ERROR', 'Payment amount must be greater than zero.', 422);
    }

    let updated: PurchaseDetail;
    try {
      updated = await this.repos.purchases.recordPayment({
        purchaseId,
        tenantId: actor.tenantId,
        amount: body.amount,
        method: body.method,
        createdById: actor.id,
        audit: {
          userId: actor.id,
          action: 'PURCHASE_PAYMENT_RECORDED',
          metadata: { amount: body.amount, method: body.method },
        },
      });
    } catch (err) {
      if (err instanceof PaymentExceedsBalanceError || err instanceof PurchaseConcurrencyError) {
        throw new DomainError('CONFLICT', err.message, 409);
      }
      throw err;
    }

    return updated;
  }
}
