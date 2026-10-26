import {
  addDecimalStrings,
  compareDecimalStrings,
  computeSale,
  roundDecimalString,
  SaleMathError,
  subtractDecimalStrings,
} from '@mafk/shared';
import type {
  CreateSaleInput,
  CreateSaleReturnInput,
  PosProductSearchQuery,
  ReceiptFormat,
  SaleListQuery,
} from '@mafk/validation';
import type { Repositories } from '../domain/ports.js';
import {
  CreditLimitExceededError,
  DomainError,
  InsufficientStockError,
  InvalidSaleRelationshipError,
  ReturnNotAllowedError,
  SaleConcurrencyError,
  SaleNotFoundError,
  type ProductSummary,
  type ReceiptDocument,
  type RecordSaleInput,
  type SaleDetail,
  type SaleListResult,
  type SaleReturnDetail,
} from '../domain/types.js';
import type { Actor } from './category.service.js';
import {
  buildRefundReceipt,
  buildSaleReceipt,
  renderReceiptPdf,
  renderReceiptText,
} from './receipt.js';

/** The signed-in user plus the permissions from the verified token (never from the request body). */
export interface SaleActor extends Actor {
  permissions: ReadonlySet<string>;
}

export interface PosProduct {
  id: string;
  name: string;
  sku: string;
  barcodes: string[];
  unit: string;
  sellingPrice: string;
  taxRate: string;
  /** Stock at the selected branch. */
  stock: string;
}

const hasNonZero = (v: string | undefined): boolean => v !== undefined && /[1-9]/.test(v);

export class SaleService {
  constructor(private readonly repos: Repositories) {}

  private async requireStore(tenantId: string, storeId: string) {
    const stores = await this.repos.stores.listByTenant(tenantId);
    const store = stores.find((s) => s.id === storeId);
    if (!store) throw new DomainError('VALIDATION_ERROR', 'Selected branch does not exist.', 422);
    return store;
  }

  /** Product search for the POS screen: exact barcode match first, then name/SKU search; each with branch stock. */
  async searchProducts(tenantId: string, q: PosProductSearchQuery): Promise<PosProduct[]> {
    await this.requireStore(tenantId, q.storeId);
    const found = new Map<string, ProductSummary>();
    const byBarcode = await this.repos.barcodes.findProductIdByCode(tenantId, q.search);
    if (byBarcode) {
      const p = await this.repos.products.findById(byBarcode, tenantId);
      if (p) found.set(p.id, p);
    }
    const list = await this.repos.products.list(tenantId, {
      search: q.search,
      status: 'ACTIVE',
      page: 1,
      pageSize: 20,
    });
    for (const p of list.items) found.set(p.id, p);
    const out: PosProduct[] = [];
    for (const p of found.values()) {
      if (p.status !== 'ACTIVE') continue;
      const inv = await this.repos.inventory.findByStoreAndProduct(q.storeId, p.id);
      out.push({
        id: p.id,
        name: p.name,
        sku: p.sku,
        barcodes: p.barcodes,
        unit: p.unit,
        sellingPrice: p.sellingPrice,
        taxRate: p.taxRate,
        stock: inv?.quantity ?? '0.000',
      });
    }
    return out;
  }

  /**
   * Prices every line from the SERVER's catalogue (the client cannot set a price without `price.change`, nor a
   * discount without `discount.apply`), computes the sale with the shared exact money math, checks the tender, then
   * hands one all-or-nothing write to the repository.
   */
  async createSale(
    actor: SaleActor,
    input: CreateSaleInput,
  ): Promise<{ sale: SaleDetail; replayed: boolean }> {
    await this.requireStore(actor.tenantId, input.storeId);

    const wantsDiscount =
      hasNonZero(input.discountPercent) ||
      hasNonZero(input.discountAmount) ||
      input.items.some((i) => hasNonZero(i.discountPercent) || hasNonZero(i.discountAmount));
    if (wantsDiscount && !actor.permissions.has('discount.apply')) {
      throw new DomainError('PERMISSION_DENIED', 'You are not allowed to apply discounts.', 403);
    }

    const products: ProductSummary[] = [];
    for (const item of input.items) {
      const product = await this.repos.products.findById(item.productId, actor.tenantId);
      if (!product || product.status !== 'ACTIVE') {
        throw new DomainError(
          'VALIDATION_ERROR',
          `Product ${item.productId} is not available for sale.`,
          422,
        );
      }
      if (item.unitPrice !== undefined) {
        const overridden = compareDecimalStrings(item.unitPrice, product.sellingPrice, 4) !== 0;
        if (overridden && !actor.permissions.has('price.change')) {
          throw new DomainError('PERMISSION_DENIED', 'You are not allowed to change prices.', 403);
        }
      }
      products.push(product);
    }

    // A named customer (needed for sales on account). Their name/phone are copied onto the sale as a snapshot.
    let customerName = input.customerName;
    let customerPhone = input.customerPhone;
    if (input.customerId) {
      const customer = await this.repos.customers.findById(input.customerId, actor.tenantId);
      if (!customer)
        throw new DomainError('VALIDATION_ERROR', 'Selected customer does not exist.', 422);
      customerName = customer.name;
      customerPhone = customer.phone ?? undefined;
    }

    let computed;
    try {
      computed = computeSale(
        input.items.map((item, i) => ({
          quantity: item.quantity,
          unitPrice: item.unitPrice ?? products[i]!.sellingPrice,
          discountPercent: item.discountPercent,
          discountAmount: item.discountAmount,
          taxRate: products[i]!.taxRate,
        })),
        { discountPercent: input.discountPercent, discountAmount: input.discountAmount },
      );
    } catch (err) {
      if (err instanceof SaleMathError) throw new DomainError('VALIDATION_ERROR', err.message, 422);
      throw err;
    }
    const { lines, totals } = computed;

    // Tender: must cover the total; any excess (change) must be returnable out of cash.
    let paid = '0.00';
    let cash = '0.00';
    let credit = '0.00';
    for (const p of input.payments) {
      const amount = roundDecimalString(p.amount, 2);
      if (compareDecimalStrings(amount, '0', 2) <= 0) {
        throw new DomainError(
          'VALIDATION_ERROR',
          'Payment amounts must be greater than zero.',
          422,
        );
      }
      paid = addDecimalStrings(paid, amount, 2);
      if (p.method === 'CASH') cash = addDecimalStrings(cash, amount, 2);
      if (p.method === 'CUSTOMER_CREDIT') credit = addDecimalStrings(credit, amount, 2);
    }
    if (compareDecimalStrings(credit, '0', 2) > 0) {
      if (!input.customerId) {
        throw new DomainError('VALIDATION_ERROR', 'A sale on account needs a customer.', 422);
      }
      const nonCredit = subtractDecimalStrings(paid, credit, 2);
      const maxCredit = subtractDecimalStrings(totals.grandTotal, nonCredit, 2);
      if (maxCredit.startsWith('-') || compareDecimalStrings(credit, maxCredit, 2) > 0) {
        throw new DomainError(
          'VALIDATION_ERROR',
          'The amount on account cannot be more than the part of the total not paid by other methods.',
          422,
        );
      }
    }
    if (compareDecimalStrings(paid, totals.grandTotal, 2) < 0) {
      throw new DomainError(
        'PAYMENT_INSUFFICIENT',
        `Payments (${paid}) do not cover the total (${totals.grandTotal}).`,
        422,
      );
    }
    const changeDue = subtractDecimalStrings(paid, totals.grandTotal, 2);
    if (compareDecimalStrings(changeDue, cash, 2) > 0) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Change can only be given from cash payments.',
        422,
      );
    }

    const recordInput: RecordSaleInput = {
      tenantId: actor.tenantId,
      storeId: input.storeId,
      clientRequestId: input.clientRequestId,
      cashierId: actor.id,
      items: input.items.map((item, i) => ({
        productId: products[i]!.id,
        productName: products[i]!.name,
        sku: products[i]!.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice ?? products[i]!.sellingPrice,
        discountPercent: lines[i]!.discountPercent,
        discountAmount: lines[i]!.discountAmount,
        taxRate: lines[i]!.taxRate,
        taxAmount: lines[i]!.taxAmount,
        lineTotal: lines[i]!.lineTotal,
      })),
      subtotal: totals.subtotal,
      itemDiscountTotal: totals.itemDiscountTotal,
      cartDiscountPercent: totals.cartDiscountPercent,
      cartDiscountAmount: totals.cartDiscountAmount,
      taxTotal: totals.taxTotal,
      grandTotal: totals.grandTotal,
      payments: input.payments.map((p) => ({
        method: p.method,
        amount: roundDecimalString(p.amount, 2),
        reference: p.reference,
      })),
      paidTotal: paid,
      changeDue,
      customerId: input.customerId,
      customerName,
      customerPhone,
      notes: input.notes,
      audit: {
        userId: actor.id,
        action: 'SALE_RECORDED',
        metadata: { itemCount: input.items.length },
      },
    };

    try {
      return await this.repos.sales.recordSale(recordInput);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  private mapError(err: unknown): unknown {
    if (err instanceof InsufficientStockError)
      return new DomainError('INSUFFICIENT_STOCK', err.message, 409);
    if (err instanceof InvalidSaleRelationshipError)
      return new DomainError('VALIDATION_ERROR', err.message, 422);
    if (err instanceof SaleNotFoundError) return new DomainError('NOT_FOUND', err.message, 404);
    if (err instanceof ReturnNotAllowedError)
      return new DomainError('RETURN_NOT_ALLOWED', err.message, 409);
    if (err instanceof CreditLimitExceededError)
      return new DomainError('CREDIT_LIMIT_EXCEEDED', err.message, 409);
    if (err instanceof SaleConcurrencyError) return new DomainError('CONFLICT', err.message, 409);
    if (err instanceof SaleMathError) return new DomainError('VALIDATION_ERROR', err.message, 422);
    return err;
  }

  async getById(id: string, tenantId: string): Promise<SaleDetail> {
    const sale = await this.repos.sales.findById(id, tenantId);
    if (!sale) throw new DomainError('NOT_FOUND', 'Sale not found.', 404);
    return sale;
  }

  async list(tenantId: string, query: SaleListQuery): Promise<SaleListResult> {
    return this.repos.sales.list(tenantId, query);
  }

  async refund(
    actor: SaleActor,
    saleId: string,
    input: CreateSaleReturnInput,
  ): Promise<SaleReturnDetail> {
    const seen = new Set<string>();
    for (const i of input.items) {
      if (seen.has(i.saleItemId)) {
        throw new DomainError(
          'VALIDATION_ERROR',
          'Each sale item may appear only once per return.',
          422,
        );
      }
      seen.add(i.saleItemId);
    }
    try {
      return await this.repos.sales.recordReturn({
        tenantId: actor.tenantId,
        saleId,
        processedById: actor.id,
        refundMethod: input.refundMethod,
        reason: input.reason,
        items: input.items,
        audit: {
          userId: actor.id,
          action: 'SALE_REFUNDED',
          metadata: { itemCount: input.items.length },
        },
      });
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async getReturn(id: string, tenantId: string): Promise<SaleReturnDetail> {
    const ret = await this.repos.sales.findReturnById(id, tenantId);
    if (!ret) throw new DomainError('NOT_FOUND', 'Return not found.', 404);
    return ret;
  }

  private async party(tenantId: string, storeId: string, cashierId: string) {
    const [tenant, stores, cashier] = await Promise.all([
      this.repos.tenants.findDetailById(tenantId),
      this.repos.stores.listByTenant(tenantId),
      this.repos.users.findById(cashierId),
    ]);
    const store = stores.find((s) => s.id === storeId);
    if (!tenant || !store) throw new DomainError('NOT_FOUND', 'Sale records are incomplete.', 404);
    return {
      business: {
        name: tenant.name,
        legalName: tenant.legalName,
        address: tenant.address,
        phone: tenant.contactPhone,
        email: tenant.contactEmail,
      },
      branch: { code: store.code, name: store.name },
      cashier: cashier && cashier.tenantId === tenantId ? cashier.displayName : null,
    };
  }

  async saleReceipt(id: string, tenantId: string): Promise<ReceiptDocument> {
    const sale = await this.getById(id, tenantId);
    return buildSaleReceipt(sale, await this.party(tenantId, sale.storeId, sale.cashierId));
  }

  async refundReceipt(returnId: string, tenantId: string): Promise<ReceiptDocument> {
    const ret = await this.getReturn(returnId, tenantId);
    const sale = await this.getById(ret.saleId, tenantId);
    return buildRefundReceipt(
      ret,
      sale,
      await this.party(tenantId, ret.storeId, ret.processedById),
    );
  }

  /** Rendered output for a receipt document: plain text for thermal widths, a real PDF for any size. */
  async renderText(doc: ReceiptDocument, format: Exclude<ReceiptFormat, 'a4'>): Promise<string> {
    return renderReceiptText(doc, format);
  }

  async renderPdf(
    actor: Actor,
    doc: ReceiptDocument,
    format: ReceiptFormat,
    entity: 'Sale' | 'SaleReturn',
    entityId: string,
  ) {
    const pdf = await renderReceiptPdf(doc, format);
    await this.repos.auditLogs.record({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'RECEIPT_PRINTED',
      entity,
      entityId,
      metadata: { number: doc.number, format },
    });
    return {
      filename: `${doc.kind === 'SALE' ? 'receipt' : 'refund'}-${doc.number}-${format}.pdf`,
      pdf,
    };
  }
}
