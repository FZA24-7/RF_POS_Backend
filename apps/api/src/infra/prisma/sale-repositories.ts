// DATABASE STATUS (Phase 5): recordSale, recordReturn, findById, findReturnById and list(default filters) PASSED the
// 13-test sale/refund integrity contract against PostgreSQL 16 in the Phase 5 sandbox (all-or-nothing rollback on audit and
// movement faults, idempotent replay incl. concurrent, no overselling under 5 concurrent sales, per-branch numbering,
// concurrent over-refund prevention) and a headless-browser run. NOT exercised: list() with date/status/search filters.
// Not yet run on the author's Windows machine. Writes are single transactions: sale + items + payments + stock movements
// + document number + audit.
import { addDecimalStrings, compareDecimalStrings, roundDecimalString } from '@mafk/shared';
import type { Prisma, PrismaClient } from '@mafk/database';
import type { SaleRepository } from '../../domain/ports.js';
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
  type SaleStatus,
  type TenderMethod,
  SaleConcurrencyError,
} from '../../domain/types.js';
import { formatQuantity, formatRate, formatUnitPrice } from '../../services/format.js';
import { planReturn } from '../../services/return-planner.js';
import { applyMovementInTx } from './inventory-ops.js';
import { customerBalance } from './customer-repositories.js';

const money = (d: Prisma.Decimal): string => d.toFixed(2);

const SALE_INCLUDE = {
  items: { orderBy: { id: 'asc' as const } },
  payments: { orderBy: { id: 'asc' as const } },
  returns: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      items: {
        orderBy: { id: 'asc' as const },
        include: { saleItem: { select: { productName: true, sku: true } } },
      },
    },
  },
} satisfies Prisma.SaleInclude;

type SaleRow = Prisma.SaleGetPayload<{ include: typeof SALE_INCLUDE }>;
type ReturnRow = SaleRow['returns'][number];

const toReturnDetail = (r: ReturnRow): SaleReturnDetail => ({
  id: r.id,
  tenantId: r.tenantId,
  storeId: r.storeId,
  saleId: r.saleId,
  returnNo: r.returnNo,
  processedById: r.processedById,
  refundMethod: r.refundMethod as TenderMethod,
  refundTotal: money(r.refundTotal),
  reason: r.reason,
  createdAt: r.createdAt,
  items: r.items.map((i) => ({
    id: i.id,
    saleItemId: i.saleItemId,
    productId: i.productId,
    productName: i.saleItem.productName,
    sku: i.saleItem.sku,
    quantity: formatQuantity(i.quantity.toFixed(3)),
    unitRefund: i.unitRefund.toFixed(4),
    lineTotal: money(i.lineTotal),
  })),
});

const toSaleDetail = (row: SaleRow): SaleDetail => ({
  id: row.id,
  tenantId: row.tenantId,
  storeId: row.storeId,
  invoiceNo: row.invoiceNo,
  clientRequestId: row.clientRequestId,
  cashierId: row.cashierId,
  status: row.status as SaleStatus,
  grandTotal: money(row.grandTotal),
  paidTotal: money(row.paidTotal),
  changeDue: money(row.changeDue),
  customerId: row.customerId,
  customerName: row.customerNameSnapshot,
  customerPhone: row.customerPhoneSnapshot,
  subtotal: money(row.subtotal),
  itemDiscountTotal: money(row.itemDiscountTotal),
  cartDiscountPercent: formatRate(row.cartDiscountPercent.toFixed(4)),
  cartDiscountAmount: money(row.cartDiscountAmount),
  taxTotal: money(row.taxTotal),
  notes: row.notes,
  soldAt: row.soldAt,
  items: row.items.map((i) => ({
    id: i.id,
    productId: i.productId,
    productName: i.productName,
    sku: i.sku,
    quantity: i.quantity.toFixed(3),
    returnedQuantity: i.returnedQuantity.toFixed(3),
    unitPrice: formatUnitPrice(i.unitPrice.toFixed(4)),
    discountPercent: formatRate(i.discountPercent.toFixed(4)),
    discountAmount: money(i.discountAmount),
    taxRate: formatRate(i.taxRate.toFixed(4)),
    taxAmount: money(i.taxAmount),
    lineTotal: money(i.lineTotal),
  })),
  payments: row.payments.map((p) => ({
    id: p.id,
    method: p.method as TenderMethod,
    amount: money(p.amount),
    reference: p.reference,
  })),
  returns: row.returns.map(toReturnDetail),
});

const uniqueViolationOn = (err: unknown, ...needles: string[]): boolean => {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; meta?: unknown; message?: unknown };
  if (e.code !== 'P2002') return false;
  const haystack = `${JSON.stringify(e.meta ?? {})} ${String(e.message ?? '')}`.toLowerCase();
  return needles.some((n) => haystack.includes(n.toLowerCase()));
};

const isSequenceRace = (err: unknown): boolean =>
  uniqueViolationOn(err, 'document_sequences', 'tenantId_storeId_type', 'storeId', 'type');

/**
 * Claims the next number for (tenant, branch, kind). Numbers are tenant-unique because the branch code is part of
 * them (the schema's unique key is (tenantId, invoiceNo)). The upsert is atomic; the only race is two transactions
 * creating the row for the very first time, which the caller retries.
 */
async function nextDocumentNo(
  tx: Prisma.TransactionClient,
  tenantId: string,
  storeId: string,
  storeCode: string,
  type: 'SALE' | 'SALE_RETURN',
): Promise<string> {
  const prefix = type === 'SALE' ? 'INV' : 'RET';
  const seq = await tx.documentSequence.upsert({
    where: { tenantId_storeId_type: { tenantId, storeId, type } },
    create: { tenantId, storeId, type, prefix, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  return `${seq.prefix}-${storeCode}-${String(seq.nextValue - 1).padStart(6, '0')}`;
}

export class PrismaSaleRepository implements SaleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string, tenantId: string): Promise<SaleDetail | null> {
    const row = await this.prisma.sale.findFirst({
      where: { id, tenantId },
      include: SALE_INCLUDE,
    });
    return row ? toSaleDetail(row) : null;
  }

  async findReturnById(id: string, tenantId: string): Promise<SaleReturnDetail | null> {
    const row = await this.prisma.saleReturn.findFirst({
      where: { id, tenantId },
      include: {
        items: {
          orderBy: { id: 'asc' },
          include: { saleItem: { select: { productName: true, sku: true } } },
        },
      },
    });
    return row ? toReturnDetail(row) : null;
  }

  async list(tenantId: string, f: SaleListFilter): Promise<SaleListResult> {
    const where: Prisma.SaleWhereInput = {
      tenantId,
      ...(f.storeId ? { storeId: f.storeId } : {}),
      ...(f.status ? { status: f.status } : {}),
      ...(f.customerId ? { customerId: f.customerId } : {}),
      ...(f.from || f.to
        ? { soldAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } }
        : {}),
      ...(f.search
        ? {
            OR: [
              { invoiceNo: { contains: f.search, mode: 'insensitive' as const } },
              { customerNameSnapshot: { contains: f.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        orderBy: { soldAt: 'desc' },
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
      }),
      this.prisma.sale.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        storeId: r.storeId,
        invoiceNo: r.invoiceNo,
        cashierId: r.cashierId,
        status: r.status as SaleStatus,
        grandTotal: money(r.grandTotal),
        paidTotal: money(r.paidTotal),
        changeDue: money(r.changeDue),
        customerId: r.customerId,
        customerName: r.customerNameSnapshot,
        soldAt: r.soldAt,
      })),
      total,
      page: f.page,
      pageSize: f.pageSize,
    };
  }

  /** Retries only the benign first-use race on the document sequence row; every other error propagates. */
  private async withSequenceRetry<T>(work: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await work();
      } catch (err) {
        if (attempt < 4 && isSequenceRace(err) && !uniqueViolationOn(err, 'clientRequestId'))
          continue;
        throw err;
      }
    }
  }

  async recordSale(input: RecordSaleInput): Promise<RecordSaleResult> {
    try {
      const row = await this.withSequenceRetry(() =>
        this.prisma.$transaction(async (tx) => {
          const existing = await tx.sale.findFirst({
            where: { tenantId: input.tenantId, clientRequestId: input.clientRequestId },
            include: SALE_INCLUDE,
          });
          if (existing) return { row: existing, replayed: true };

          const store = await tx.store.findFirst({
            where: { id: input.storeId, tenantId: input.tenantId },
          });
          if (!store) throw new InvalidSaleRelationshipError('Selected branch does not exist.');
          const products = await tx.product.findMany({
            where: { id: { in: input.items.map((i) => i.productId) }, tenantId: input.tenantId },
          });
          const byId = new Map(products.map((p) => [p.id, p]));
          if (byId.size !== new Set(input.items.map((i) => i.productId)).size) {
            throw new InvalidSaleRelationshipError(
              'One or more products do not exist in this tenant.',
            );
          }

          const creditAmount = input.payments
            .filter((p) => p.method === 'CUSTOMER_CREDIT')
            .reduce((acc, p) => addDecimalStrings(acc, p.amount, 2), '0.00');
          if (input.customerId) {
            // Lock the customer so two concurrent credit sales cannot both pass the limit check.
            const locked = await tx.$queryRaw<{ id: string }[]>`
              SELECT id FROM customers WHERE id = ${input.customerId} AND "tenantId" = ${input.tenantId} FOR UPDATE`;
            if (locked.length !== 1)
              throw new InvalidSaleRelationshipError('Selected customer does not exist.');
            const customer = await tx.customer.findFirstOrThrow({
              where: { id: input.customerId, tenantId: input.tenantId },
            });
            if (compareDecimalStrings(creditAmount, '0', 2) > 0) {
              if (!customer.isActive)
                throw new InvalidSaleRelationshipError('This customer is inactive.');
              const limit = customer.creditLimit ? money(customer.creditLimit) : '0.00';
              if (compareDecimalStrings(limit, '0', 2) <= 0) {
                throw new CreditLimitExceededError('Credit is not enabled for this customer.');
              }
              const balance = await customerBalance(
                tx,
                input.tenantId,
                customer.id,
                money(customer.openingBalance),
              );
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

          const invoiceNo = await nextDocumentNo(
            tx,
            input.tenantId,
            input.storeId,
            store.code,
            'SALE',
          );
          const sale = await tx.sale.create({
            data: {
              tenantId: input.tenantId,
              storeId: input.storeId,
              invoiceNo,
              clientRequestId: input.clientRequestId,
              cashierId: input.cashierId,
              customerId: input.customerId ?? null,
              customerNameSnapshot: input.customerName ?? null,
              customerPhoneSnapshot: input.customerPhone ?? null,
              subtotal: input.subtotal,
              itemDiscountTotal: input.itemDiscountTotal,
              cartDiscountPercent: input.cartDiscountPercent,
              cartDiscountAmount: input.cartDiscountAmount,
              taxTotal: input.taxTotal,
              grandTotal: input.grandTotal,
              paidTotal: input.paidTotal,
              changeDue: input.changeDue,
              notes: input.notes ?? null,
              // tenantId is not set on nested rows: it comes from the parent through the composite FK.
              items: {
                create: input.items.map((i) => ({
                  productId: i.productId,
                  productName: i.productName,
                  sku: i.sku,
                  quantity: i.quantity,
                  unitPrice: i.unitPrice,
                  unitCost: byId.get(i.productId)!.costPrice,
                  discountPercent: i.discountPercent,
                  discountAmount: i.discountAmount,
                  taxRate: i.taxRate,
                  taxAmount: i.taxAmount,
                  lineTotal: i.lineTotal,
                })),
              },
              payments: {
                create: input.payments.map((p) => ({
                  method: p.method,
                  amount: roundDecimalString(p.amount, 2),
                  reference: p.reference ?? null,
                })),
              },
            },
          });

          for (const item of input.items) {
            await applyMovementInTx(tx, {
              tenantId: input.tenantId,
              storeId: input.storeId,
              productId: item.productId,
              type: 'SALE',
              quantityChange: `-${item.quantity}`,
              unitCost: byId.get(item.productId)!.costPrice.toString(),
              createdById: input.cashierId,
              referenceType: 'Sale',
              referenceId: sale.id,
            });
          }

          await tx.auditLog.create({
            data: {
              tenantId: input.tenantId,
              userId: input.audit.userId,
              action: input.audit.action,
              entity: 'Sale',
              entityId: sale.id,
              metadata: {
                ...(input.audit.metadata ?? {}),
                invoiceNo,
                grandTotal: input.grandTotal,
              },
            },
          });

          const full = await tx.sale.findFirstOrThrow({
            where: { id: sale.id, tenantId: input.tenantId },
            include: SALE_INCLUDE,
          });
          return { row: full, replayed: false };
        }),
      );
      return { sale: toSaleDetail(row.row), replayed: row.replayed };
    } catch (err) {
      // A concurrent request with the same clientRequestId committed first: return its sale.
      if (uniqueViolationOn(err, 'clientRequestId', 'client_request_id')) {
        const existing = await this.prisma.sale.findFirst({
          where: { tenantId: input.tenantId, clientRequestId: input.clientRequestId },
          include: SALE_INCLUDE,
        });
        if (existing) return { sale: toSaleDetail(existing), replayed: true };
      }
      throw err;
    }
  }

  async recordReturn(input: RecordReturnInput): Promise<SaleReturnDetail> {
    const created = await this.withSequenceRetry(() =>
      this.prisma.$transaction(async (tx) => {
        // Serialise returns of the same sale: the row lock makes the over-return check below race-free.
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM sales WHERE id = ${input.saleId} AND "tenantId" = ${input.tenantId} FOR UPDATE`;
        if (locked.length !== 1) throw new SaleNotFoundError();

        const row = await tx.sale.findFirstOrThrow({
          where: { id: input.saleId, tenantId: input.tenantId },
          include: SALE_INCLUDE,
        });
        const sale = toSaleDetail(row);
        if (input.refundMethod === 'CUSTOMER_CREDIT' && !row.customerId) {
          throw new InvalidSaleRelationshipError(
            'A refund to account needs a sale that has a customer.',
          );
        }
        const plan = planReturn(sale, input.items);
        const store = await tx.store.findFirstOrThrow({
          where: { id: sale.storeId, tenantId: input.tenantId },
        });
        const returnNo = await nextDocumentNo(
          tx,
          input.tenantId,
          sale.storeId,
          store.code,
          'SALE_RETURN',
        );

        const ret = await tx.saleReturn.create({
          data: {
            tenantId: input.tenantId,
            storeId: sale.storeId,
            saleId: sale.id,
            returnNo,
            processedById: input.processedById,
            refundMethod: input.refundMethod,
            refundTotal: plan.refundTotal,
            reason: input.reason ?? null,
            items: {
              create: plan.lines.map((l) => ({
                saleItemId: l.item.id,
                productId: l.item.productId,
                quantity: l.quantity,
                unitRefund: l.unitRefund,
                lineTotal: l.lineRefund,
              })),
            },
          },
        });

        for (const l of plan.lines) {
          const claimed = await tx.saleItem.updateMany({
            where: {
              id: l.item.id,
              tenantId: input.tenantId,
              returnedQuantity: l.item.returnedQuantity,
            },
            data: { returnedQuantity: addDecimalStrings(l.item.returnedQuantity, l.quantity, 3) },
          });
          if (claimed.count !== 1) {
            throw new SaleConcurrencyError(
              'This sale was changed by another request. Please retry.',
            );
          }
          await applyMovementInTx(tx, {
            tenantId: input.tenantId,
            storeId: sale.storeId,
            productId: l.item.productId,
            type: 'SALE_RETURN',
            quantityChange: l.quantity,
            createdById: input.processedById,
            referenceType: 'SaleReturn',
            referenceId: ret.id,
          });
        }

        await tx.sale.update({
          where: { id_tenantId: { id: sale.id, tenantId: input.tenantId } },
          data: { status: plan.fullyReturned ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
        });

        await tx.auditLog.create({
          data: {
            tenantId: input.tenantId,
            userId: input.audit.userId,
            action: input.audit.action,
            entity: 'Sale',
            entityId: sale.id,
            metadata: { ...(input.audit.metadata ?? {}), returnNo, refundTotal: plan.refundTotal },
          },
        });

        return tx.saleReturn.findFirstOrThrow({
          where: { id: ret.id, tenantId: input.tenantId },
          include: {
            items: {
              orderBy: { id: 'asc' },
              include: { saleItem: { select: { productName: true, sku: true } } },
            },
          },
        });
      }),
    );
    return toReturnDetail(created as ReturnRow);
  }
}
