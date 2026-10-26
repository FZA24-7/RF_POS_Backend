import { randomUUID } from 'node:crypto';
import { addDecimalStrings, compareDecimalStrings } from '@mafk/shared';
import type { SaleRepository } from '../../src/domain/ports.js';
import {
  CreditLimitExceededError,
  InvalidSaleRelationshipError,
  SaleNotFoundError,
  type RecordReturnInput,
  type RecordSaleInput,
  type RecordSaleResult,
  type SaleDetail,
  type SaleListFilter,
  type SaleListResult,
  type SaleReturnDetail,
  type CustomerSummary,
} from '../../src/domain/types.js';
import { formatQuantity, formatRate, formatUnitPrice } from '../../src/services/format.js';
import { planReturn } from '../../src/services/return-planner.js';
import type {
  FakeAuditLogRepository,
  FakeInventoryRepository,
  FakeProductRepository,
  FakeStoreRepository,
} from './in-memory-repositories.js';

const clone = <T>(v: T): T => structuredClone(v);

/**
 * In-memory model of PrismaSaleRepository for fast service/HTTP tests: serialised writes with snapshot/rollback
 * (a MODEL of a DB transaction - the real guarantee is proven against PostgreSQL in tests/integration).
 */
export class FakeSaleRepository implements SaleRepository {
  readonly sales = new Map<string, SaleDetail>();
  private readonly sequences = new Map<string, number>();
  private lock: Promise<unknown> = Promise.resolve();
  /** Test hook: runs after the sale row exists, before stock/payments/audit. */
  afterSaleInsert: (() => void) | null = null;
  /** unitCost captured at sale time per sale item (the DB keeps it on SaleItem; used by profit reports). */
  readonly itemCosts = new Map<string, string>();
  /** Set by FakeCustomerRepository: customer lookup + derived balance, for the credit-limit check. */
  credit: {
    find(id: string, tenantId: string): CustomerSummary | undefined;
    balanceOf(id: string): string;
  } | null = null;
  /** Other fakes that take part in the same "transaction" register a snapshotter returning their restore fn. */
  private readonly snapshotters: (() => () => void)[] = [];

  registerSnapshotter(fn: () => () => void): void {
    this.snapshotters.push(fn);
  }

  constructor(
    private readonly stores: FakeStoreRepository,
    private readonly products: FakeProductRepository,
    private readonly inventory: FakeInventoryRepository,
    private readonly audit: FakeAuditLogRepository,
  ) {}

  transact<T>(work: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const restores = this.snapshotters.map((f) => f());
      const costs = new Map(this.itemCosts);
      const snap = {
        sales: clone([...this.sales]),
        sequences: new Map(this.sequences),
        inventories: new Map(this.inventory.inventories),
        movements: this.inventory.movements.length,
        audit: this.audit.entries.length,
      };
      try {
        return await work();
      } catch (err) {
        this.sales.clear();
        snap.sales.forEach(([k, v]) => this.sales.set(k, v));
        this.sequences.clear();
        snap.sequences.forEach((v, k) => this.sequences.set(k, v));
        this.inventory.inventories.clear();
        snap.inventories.forEach((v, k) => this.inventory.inventories.set(k, v));
        this.inventory.movements.length = snap.movements;
        this.audit.entries.length = snap.audit;
        this.itemCosts.clear();
        costs.forEach((v, k) => this.itemCosts.set(k, v));
        restores.forEach((r) => r());
        throw err;
      }
    };
    const result = this.lock.then(run, run);
    this.lock = result.catch(() => undefined);
    return result;
  }

  private nextNo(
    tenantId: string,
    storeId: string,
    kind: 'SALE' | 'RETURN',
    storeCode: string,
  ): string {
    const key = `${tenantId}:${storeId}:${kind}`;
    const n = this.sequences.get(key) ?? 1;
    this.sequences.set(key, n + 1);
    return `${kind === 'SALE' ? 'INV' : 'RET'}-${storeCode}-${String(n).padStart(6, '0')}`;
  }

  async findById(id: string, tenantId: string): Promise<SaleDetail | null> {
    const s = this.sales.get(id);
    return s && s.tenantId === tenantId ? clone(s) : null;
  }

  async list(tenantId: string, f: SaleListFilter): Promise<SaleListResult> {
    let rows = [...this.sales.values()].filter((s) => s.tenantId === tenantId);
    if (f.storeId) rows = rows.filter((s) => s.storeId === f.storeId);
    if (f.status) rows = rows.filter((s) => s.status === f.status);
    if (f.customerId) rows = rows.filter((s) => s.customerId === f.customerId);
    if (f.from) rows = rows.filter((s) => s.soldAt >= f.from!);
    if (f.to) rows = rows.filter((s) => s.soldAt <= f.to!);
    if (f.search) {
      const q = f.search.toLowerCase();
      rows = rows.filter(
        (s) =>
          s.invoiceNo.toLowerCase().includes(q) || (s.customerName ?? '').toLowerCase().includes(q),
      );
    }
    rows.sort((a, b) => b.soldAt.getTime() - a.soldAt.getTime());
    const start = (f.page - 1) * f.pageSize;
    return {
      items: rows.slice(start, start + f.pageSize).map((s) => ({
        id: s.id,
        tenantId: s.tenantId,
        storeId: s.storeId,
        invoiceNo: s.invoiceNo,
        cashierId: s.cashierId,
        status: s.status,
        grandTotal: s.grandTotal,
        paidTotal: s.paidTotal,
        changeDue: s.changeDue,
        customerId: s.customerId,
        customerName: s.customerName,
        soldAt: s.soldAt,
      })),
      total: rows.length,
      page: f.page,
      pageSize: f.pageSize,
    };
  }

  async findReturnById(id: string, tenantId: string): Promise<SaleReturnDetail | null> {
    for (const s of this.sales.values()) {
      if (s.tenantId !== tenantId) continue;
      const r = s.returns.find((x) => x.id === id);
      if (r) return clone(r);
    }
    return null;
  }

  recordSale(input: RecordSaleInput): Promise<RecordSaleResult> {
    return this.transact(async () => {
      const existing = [...this.sales.values()].find(
        (s) => s.tenantId === input.tenantId && s.clientRequestId === input.clientRequestId,
      );
      if (existing) return { sale: clone(existing), replayed: true };

      const store = (await this.stores.listByTenant(input.tenantId)).find(
        (s) => s.id === input.storeId,
      );
      if (!store) throw new InvalidSaleRelationshipError('Selected branch does not exist.');
      for (const item of input.items) {
        const p = this.products.products.get(item.productId);
        if (!p || p.tenantId !== input.tenantId) {
          throw new InvalidSaleRelationshipError(
            'One or more products do not exist in this tenant.',
          );
        }
      }

      const creditAmount = input.payments
        .filter((p) => p.method === 'CUSTOMER_CREDIT')
        .reduce((acc, p) => addDecimalStrings(acc, p.amount, 2), '0.00');
      if (input.customerId) {
        const customer = this.credit?.find(input.customerId, input.tenantId);
        if (!customer) throw new InvalidSaleRelationshipError('Selected customer does not exist.');
        if (compareDecimalStrings(creditAmount, '0', 2) > 0) {
          if (!customer.isActive)
            throw new InvalidSaleRelationshipError('This customer is inactive.');
          const limit = customer.creditLimit ?? '0.00';
          if (compareDecimalStrings(limit, '0', 2) <= 0) {
            throw new CreditLimitExceededError('Credit is not enabled for this customer.');
          }
          const balance = this.credit!.balanceOf(customer.id);
          const after = addDecimalStrings(balance, creditAmount, 2);
          if (compareDecimalStrings(after, limit, 2) > 0) {
            throw new CreditLimitExceededError(
              `Credit limit exceeded: balance ${balance} + ${creditAmount} is over the limit of ${limit}.`,
            );
          }
        }
      } else if (compareDecimalStrings(creditAmount, '0', 2) > 0) {
        throw new InvalidSaleRelationshipError('Sale on account needs a customer.');
      }

      const id = randomUUID();
      const invoiceNo = this.nextNo(input.tenantId, input.storeId, 'SALE', store.code);
      const sale: SaleDetail = {
        id,
        tenantId: input.tenantId,
        storeId: input.storeId,
        invoiceNo,
        clientRequestId: input.clientRequestId,
        cashierId: input.cashierId,
        status: 'COMPLETED',
        grandTotal: input.grandTotal,
        paidTotal: input.paidTotal,
        changeDue: input.changeDue,
        customerId: input.customerId ?? null,
        customerName: input.customerName ?? null,
        customerPhone: input.customerPhone ?? null,
        subtotal: input.subtotal,
        itemDiscountTotal: input.itemDiscountTotal,
        cartDiscountPercent: formatRate(input.cartDiscountPercent),
        cartDiscountAmount: input.cartDiscountAmount,
        taxTotal: input.taxTotal,
        notes: input.notes ?? null,
        soldAt: new Date(),
        items: input.items.map((i) => ({
          ...i,
          id: randomUUID(),
          quantity: formatQuantity(i.quantity),
          unitPrice: formatUnitPrice(i.unitPrice),
          discountPercent: formatRate(i.discountPercent),
          taxRate: formatRate(i.taxRate),
          returnedQuantity: '0.000',
        })),
        payments: input.payments.map((p) => ({
          id: randomUUID(),
          method: p.method,
          amount: p.amount,
          reference: p.reference ?? null,
        })),
        returns: [],
      };
      this.sales.set(id, sale);
      sale.items.forEach((it) =>
        this.itemCosts.set(it.id, this.products.products.get(it.productId)!.costPrice),
      );
      this.afterSaleInsert?.();

      for (const item of input.items) {
        await this.inventory.applyMovement({
          tenantId: input.tenantId,
          storeId: input.storeId,
          productId: item.productId,
          type: 'SALE',
          quantityChange: `-${item.quantity}`,
          createdById: input.cashierId,
          referenceType: 'Sale',
          referenceId: id,
        });
      }
      await this.audit.record({
        tenantId: input.tenantId,
        userId: input.audit.userId,
        action: input.audit.action,
        entity: 'Sale',
        entityId: id,
        metadata: { ...(input.audit.metadata ?? {}), invoiceNo, grandTotal: input.grandTotal },
      });
      return { sale: clone(sale), replayed: false };
    });
  }

  recordReturn(input: RecordReturnInput): Promise<SaleReturnDetail> {
    return this.transact(async () => {
      const sale = this.sales.get(input.saleId);
      if (!sale || sale.tenantId !== input.tenantId) throw new SaleNotFoundError();
      if (input.refundMethod === 'CUSTOMER_CREDIT' && !sale.customerId) {
        throw new InvalidSaleRelationshipError(
          'A refund to account needs a sale that has a customer.',
        );
      }
      const plan = planReturn(sale, input.items);
      const store = (await this.stores.listByTenant(input.tenantId)).find(
        (s) => s.id === sale.storeId,
      );
      const id = randomUUID();
      const returnNo = this.nextNo(input.tenantId, sale.storeId, 'RETURN', store?.code ?? 'X');
      const ret: SaleReturnDetail = {
        id,
        tenantId: input.tenantId,
        storeId: sale.storeId,
        saleId: sale.id,
        returnNo,
        processedById: input.processedById,
        refundMethod: input.refundMethod,
        refundTotal: plan.refundTotal,
        reason: input.reason ?? null,
        createdAt: new Date(),
        items: plan.lines.map((l) => ({
          id: randomUUID(),
          saleItemId: l.item.id,
          productId: l.item.productId,
          productName: l.item.productName,
          sku: l.item.sku,
          quantity: formatQuantity(l.quantity),
          unitRefund: l.unitRefund,
          lineTotal: l.lineRefund,
        })),
      };
      for (const l of plan.lines) {
        const item = sale.items.find((i) => i.id === l.item.id)!;
        item.returnedQuantity = addDecimalStrings(item.returnedQuantity, l.quantity, 3);
        await this.inventory.applyMovement({
          tenantId: input.tenantId,
          storeId: sale.storeId,
          productId: l.item.productId,
          type: 'SALE_RETURN',
          quantityChange: l.quantity,
          createdById: input.processedById,
          referenceType: 'SaleReturn',
          referenceId: id,
        });
      }
      sale.returns.push(ret);
      sale.status = plan.fullyReturned ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      await this.audit.record({
        tenantId: input.tenantId,
        userId: input.audit.userId,
        action: input.audit.action,
        entity: 'Sale',
        entityId: sale.id,
        metadata: { ...(input.audit.metadata ?? {}), returnNo, refundTotal: plan.refundTotal },
      });
      return clone(ret);
    });
  }
}
