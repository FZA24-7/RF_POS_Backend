// DATABASE STATUS (Phase 4.2): recordPurchase / recordPayment / findById / list and the all-or-nothing behaviour
// (audit, movement and payment failures roll everything back; duplicate and concurrent submissions) are covered by
// tests/integration/purchase-integrity.pg.test.ts and PASSED against PostgreSQL 16 in the Phase 4.2 sandbox.
// NOT yet exercised against a database: PrismaSupplierRepository and the purchase invoice/PDF read paths.
// Windows verification of the same suite is still pending.
//
// Real production adapters for Phase 4, written against `packages/database/prisma/schema.prisma`
// (Purchase, PurchaseItem, Supplier, SupplierPayment). Phase 4.1 made Purchase.purchaseNo unique per branch and moved
// the audit write inside the transaction.
import {
  addDecimalStrings,
  compareDecimalStrings,
  roundDecimalString,
  subtractDecimalStrings,
} from '@mafk/shared';
import type { Prisma, PrismaClient } from '@mafk/database';
import type { PurchaseRepository, SupplierRepository } from '../../domain/ports.js';
import {
  DuplicatePurchaseError,
  InvalidPurchaseRelationshipError,
  PaymentExceedsBalanceError,
  PurchaseConcurrencyError,
  type PurchaseDetail,
  type PurchaseListFilter,
  type PurchaseListResult,
  type PurchasePaymentStatus,
  type RecordPurchaseInput,
  type RecordPurchasePaymentInput,
  type Ledger,
  type LedgerEntry,
  type Outstanding,
  type SupplierSummary,
} from '../../domain/types.js';
import { buildLedger, summariseOutstanding } from '../../services/ledger.js';
import {
  computeLine,
  computeTotals,
  resolvePaymentStatus,
} from '../../services/purchase-calculations.js';
import { applyMovementInTx } from './inventory-ops.js';

const toSupplierSummary = (row: {
  id: string;
  tenantId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  openingBalance: Prisma.Decimal;
  isActive: boolean;
  createdAt: Date;
}): SupplierSummary => ({
  id: row.id,
  tenantId: row.tenantId,
  name: row.name,
  phone: row.phone,
  email: row.email,
  address: row.address,
  openingBalance: row.openingBalance.toFixed(2),
  isActive: row.isActive,
  createdAt: row.createdAt,
});

export class PrismaSupplierRepository implements SupplierRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    tenantId: string,
    input: {
      name: string;
      phone?: string;
      email?: string;
      address?: string;
      openingBalance?: string;
    },
  ): Promise<SupplierSummary> {
    const row = await this.prisma.supplier.create({
      data: {
        tenantId,
        name: input.name,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        openingBalance: roundDecimalString(input.openingBalance ?? '0', 2),
      },
    });
    return toSupplierSummary(row);
  }

  async findById(id: string, tenantId: string): Promise<SupplierSummary | null> {
    const row = await this.prisma.supplier.findFirst({ where: { id, tenantId } });
    return row ? toSupplierSummary(row) : null;
  }

  async ledger(id: string, tenantId: string): Promise<Ledger | null> {
    const supplier = await this.prisma.supplier.findFirst({ where: { id, tenantId } });
    if (!supplier) return null;
    const [purchases, payments] = await Promise.all([
      this.prisma.purchase.findMany({ where: { tenantId, supplierId: id } }),
      this.prisma.supplierPayment.findMany({ where: { tenantId, supplierId: id } }),
    ]);
    const raw: Omit<LedgerEntry, 'balance'>[] = [
      ...purchases.map((p) => ({
        date: p.purchaseDate,
        type: 'PURCHASE' as const,
        reference: p.purchaseNo,
        description: `Invoice ${p.invoiceNo}`,
        increase: money(p.total),
        decrease: '0.00',
      })),
      ...payments.map((p) => ({
        date: p.paidAt,
        type: 'SUPPLIER_PAYMENT' as const,
        reference: p.reference ?? p.id,
        description: p.note ?? `Payment (${p.method.toLowerCase().replace('_', ' ')})`,
        increase: '0.00',
        decrease: money(p.amount),
      })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.reference.localeCompare(b.reference));
    return buildLedger(money(supplier.openingBalance), supplier.createdAt, raw);
  }

  async outstanding(tenantId: string): Promise<Outstanding> {
    const suppliers = await this.prisma.supplier.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
    const [purchases, payments] = await Promise.all([
      this.prisma.purchase.groupBy({
        by: ['supplierId'],
        where: { tenantId },
        _sum: { total: true },
      }),
      this.prisma.supplierPayment.groupBy({
        by: ['supplierId'],
        where: { tenantId },
        _sum: { amount: true },
      }),
    ]);
    const bought = new Map(
      purchases.map((p) => [p.supplierId, p._sum.total ? money(p._sum.total) : '0.00']),
    );
    const paid = new Map(
      payments.map((p) => [p.supplierId, p._sum.amount ? money(p._sum.amount) : '0.00']),
    );
    return summariseOutstanding(
      suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        phone: s.phone,
        balance: subtractDecimalStrings(
          addDecimalStrings(money(s.openingBalance), bought.get(s.id) ?? '0.00', 2),
          paid.get(s.id) ?? '0.00',
          2,
        ),
      })),
    );
  }

  async existsByName(tenantId: string, name: string): Promise<boolean> {
    const count = await this.prisma.supplier.count({ where: { tenantId, name } });
    return count > 0;
  }

  async list(tenantId: string, filter: { search?: string }): Promise<SupplierSummary[]> {
    const rows = await this.prisma.supplier.findMany({
      where: {
        tenantId,
        isActive: true,
        ...(filter.search ? { name: { contains: filter.search, mode: 'insensitive' } } : {}),
      },
      orderBy: { name: 'asc' },
    });
    return rows.map(toSupplierSummary);
  }
}

/**
 * True when `err` is Prisma's unique-constraint violation (P2002) on the purchase's
 * invoice number - i.e. a concurrent duplicate submission slipped past the pre-check
 * and the database unique index (tenantId, supplierId, invoiceNo) caught it. Matched
 * by duck-typing the error code + target so it works regardless of how the driver
 * adapter shapes `meta`. NOT VERIFIED against a live database.
 */
const isInvoiceUniqueViolation = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; meta?: unknown; message?: unknown };
  if (e.code !== 'P2002') return false;
  const haystack = `${JSON.stringify(e.meta ?? {})} ${String(e.message ?? '')}`.toLowerCase();
  return haystack.includes('invoiceno') || haystack.includes('invoice_no');
};

/** Generates the branch-scoped, human-readable Purchase number (e.g. "PO-000123"); unique per (tenant, branch) - see the schema. */
async function nextPurchaseNo(
  tx: Prisma.TransactionClient,
  tenantId: string,
  storeId: string,
): Promise<string> {
  const seq = await tx.documentSequence.upsert({
    where: { tenantId_storeId_type: { tenantId, storeId, type: 'PURCHASE' } },
    create: { tenantId, storeId, type: 'PURCHASE', prefix: 'PO', nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  const value = seq.nextValue - 1; // the value we just claimed, before the increment that prepared the next one
  return `${seq.prefix}-${String(value).padStart(6, '0')}`;
}

/** Money is always returned as a fixed 2-decimal string ('5100.00'), never Decimal's trimmed '5100'. */
const money = (d: Prisma.Decimal): string => d.toFixed(2);

const toPurchaseDetail = (row: {
  id: string;
  tenantId: string;
  storeId: string;
  supplierId: string;
  purchaseNo: string;
  invoiceNo: string;
  purchaseDate: Date;
  subtotal: Prisma.Decimal;
  discountPercent: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  total: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  paymentStatus: string;
  createdById: string;
  createdAt: Date;
  items: {
    id: string;
    productId: string;
    quantity: Prisma.Decimal;
    costPrice: Prisma.Decimal;
    discountPercent: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    taxRate: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
    product: { name: string; sku: string; barcodes: { code: string }[] };
  }[];
}): PurchaseDetail => ({
  id: row.id,
  tenantId: row.tenantId,
  storeId: row.storeId,
  supplierId: row.supplierId,
  purchaseNo: row.purchaseNo,
  invoiceNo: row.invoiceNo,
  purchaseDate: row.purchaseDate,
  subtotal: money(row.subtotal),
  discountPercent: row.discountPercent.toString(),
  discountAmount: money(row.discountAmount),
  taxTotal: money(row.taxTotal),
  total: money(row.total),
  paidAmount: money(row.paidAmount),
  paymentStatus: row.paymentStatus as PurchasePaymentStatus,
  createdById: row.createdById,
  createdAt: row.createdAt,
  items: row.items.map((item) => ({
    id: item.id,
    productId: item.productId,
    productName: item.product.name,
    sku: item.product.sku,
    barcodes: item.product.barcodes.map((b) => b.code),
    quantity: item.quantity.toString(),
    costPrice: item.costPrice.toString(),
    discountPercent: item.discountPercent.toString(),
    discountAmount: money(item.discountAmount),
    taxRate: item.taxRate.toString(),
    taxAmount: money(item.taxAmount),
    lineTotal: money(item.lineTotal),
  })),
});

const PURCHASE_INCLUDE = {
  items: {
    include: {
      product: { select: { name: true, sku: true, barcodes: { select: { code: true } } } },
    },
  },
} as const;

export class PrismaPurchaseRepository implements PurchaseRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string, tenantId: string): Promise<PurchaseDetail | null> {
    const row = await this.prisma.purchase.findFirst({
      where: { id, tenantId },
      include: PURCHASE_INCLUDE,
    });
    return row ? toPurchaseDetail(row) : null;
  }

  async existsByInvoiceNo(
    tenantId: string,
    supplierId: string,
    invoiceNo: string,
  ): Promise<boolean> {
    const count = await this.prisma.purchase.count({ where: { tenantId, supplierId, invoiceNo } });
    return count > 0;
  }

  async list(tenantId: string, filter: PurchaseListFilter): Promise<PurchaseListResult> {
    const where = {
      tenantId,
      ...(filter.supplierId ? { supplierId: filter.supplierId } : {}),
      ...(filter.storeId ? { storeId: filter.storeId } : {}),
      ...(filter.paymentStatus ? { paymentStatus: filter.paymentStatus } : {}),
      ...(filter.search
        ? {
            OR: [
              { invoiceNo: { contains: filter.search, mode: 'insensitive' as const } },
              { purchaseNo: { contains: filter.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.purchase.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      this.prisma.purchase.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        storeId: r.storeId,
        supplierId: r.supplierId,
        purchaseNo: r.purchaseNo,
        invoiceNo: r.invoiceNo,
        purchaseDate: r.purchaseDate,
        subtotal: r.subtotal.toString(),
        discountPercent: r.discountPercent.toString(),
        discountAmount: r.discountAmount.toString(),
        taxTotal: r.taxTotal.toString(),
        total: r.total.toString(),
        paidAmount: r.paidAmount.toString(),
        paymentStatus: r.paymentStatus as PurchasePaymentStatus,
        createdById: r.createdById,
        createdAt: r.createdAt,
      })),
      total,
      page: filter.page,
      pageSize: filter.pageSize,
    };
  }

  /**
   * The entire workflow in ONE Prisma `$transaction`: validate relationships,
   * create the Purchase + PurchaseItems, apply a `PURCHASE` stock movement for
   * every line (through the shared `applyMovementInTx` - the same code
   * `PrismaInventoryRepository.applyMovement` uses), optionally record the
   * initial SupplierPayment, and write the AUDIT record. All of it commits
   * together or none of it does - a failure in ANY step (including the audit
   * insert) rolls the whole transaction back.
   */
  async recordPurchase(input: RecordPurchaseInput): Promise<PurchaseDetail> {
    let result;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const supplier = await tx.supplier.findFirst({
          where: { id: input.supplierId, tenantId: input.tenantId },
        });
        if (!supplier)
          throw new InvalidPurchaseRelationshipError('Selected supplier does not exist.');
        const store = await tx.store.findFirst({
          where: { id: input.storeId, tenantId: input.tenantId },
        });
        if (!store) throw new InvalidPurchaseRelationshipError('Selected branch does not exist.');

        // Friendly pre-check; the DB unique (tenantId, supplierId, invoiceNo) is the real guard
        // against concurrent duplicates (mapped below).
        const existingInvoice = await tx.purchase.findFirst({
          where: {
            tenantId: input.tenantId,
            supplierId: input.supplierId,
            invoiceNo: input.invoiceNo,
          },
        });
        if (existingInvoice) {
          throw new DuplicatePurchaseError(
            `Invoice "${input.invoiceNo}" was already recorded for this supplier.`,
          );
        }

        const products = await tx.product.findMany({
          where: { id: { in: input.items.map((i) => i.productId) }, tenantId: input.tenantId },
        });
        if (products.length !== new Set(input.items.map((i) => i.productId)).size) {
          throw new InvalidPurchaseRelationshipError(
            'One or more products do not exist in this tenant.',
          );
        }

        const computedLines = input.items.map((item) => computeLine(item));
        const totals = computeTotals(computedLines, {
          discountPercent: input.purchaseDiscountPercent,
          discountAmount: input.purchaseDiscountAmount,
        });
        const paidAmount = roundDecimalString(input.initialPayment?.amount ?? '0', 2);
        const paymentStatus = resolvePaymentStatus(totals.total, paidAmount);

        const purchaseNo = await nextPurchaseNo(tx, input.tenantId, input.storeId);

        const purchase = await tx.purchase.create({
          data: {
            tenantId: input.tenantId,
            storeId: input.storeId,
            supplierId: input.supplierId,
            purchaseNo,
            invoiceNo: input.invoiceNo,
            purchaseDate: input.purchaseDate,
            subtotal: totals.subtotal,
            discountPercent: totals.discountPercent,
            discountAmount: totals.discountAmount,
            taxTotal: totals.taxTotal,
            total: totals.total,
            paidAmount,
            paymentStatus,
            createdById: input.createdById,
            items: {
              // tenantId is deliberately NOT set here: it is part of the composite FK (purchaseId, tenantId) and is
              // taken from the parent purchase. Passing it is rejected by Prisma at runtime.
              create: input.items.map((item, i) => ({
                productId: item.productId,
                quantity: item.quantity,
                costPrice: item.costPrice,
                discountPercent: computedLines[i]!.discountPercent,
                discountAmount: computedLines[i]!.discountAmount,
                taxRate: computedLines[i]!.taxRate,
                taxAmount: computedLines[i]!.taxAmount,
                lineTotal: computedLines[i]!.lineTotal,
              })),
            },
          },
          include: PURCHASE_INCLUDE,
        });

        // Sequential on purpose: one interactive transaction runs on a single connection.
        for (const item of input.items) {
          await applyMovementInTx(tx, {
            tenantId: input.tenantId,
            storeId: input.storeId,
            productId: item.productId,
            type: 'PURCHASE',
            quantityChange: item.quantity,
            unitCost: item.costPrice,
            createdById: input.createdById,
            referenceType: 'Purchase',
            referenceId: purchase.id,
          });
        }

        if (
          input.initialPayment &&
          compareDecimalStrings(input.initialPayment.amount, '0', 2) > 0
        ) {
          await tx.supplierPayment.create({
            data: {
              tenantId: input.tenantId,
              supplierId: input.supplierId,
              purchaseId: purchase.id,
              amount: roundDecimalString(input.initialPayment.amount, 2),
              method: input.initialPayment.method,
              createdById: input.createdById,
            },
          });
        }

        await tx.auditLog.create({
          data: {
            tenantId: input.tenantId,
            userId: input.audit.userId,
            action: input.audit.action,
            entity: 'Purchase',
            entityId: purchase.id,
            metadata: {
              ...(input.audit.metadata ?? {}),
              purchaseNo,
              total: totals.total,
              paymentStatus,
            },
          },
        });

        return purchase;
      });
    } catch (err) {
      if (isInvoiceUniqueViolation(err)) {
        throw new DuplicatePurchaseError(
          `Invoice "${input.invoiceNo}" was already recorded for this supplier.`,
        );
      }
      throw err;
    }

    return toPurchaseDetail(result);
  }

  /**
   * Payment + purchase balance update + audit in one transaction. The balance update is
   * an optimistic-concurrency write (`WHERE paidAmount = <value we read>`): if another
   * payment landed in between, 0 rows match and we throw `PurchaseConcurrencyError`
   * instead of overwriting it, so two concurrent payments can never jointly overpay.
   */
  async recordPayment(input: RecordPurchasePaymentInput): Promise<PurchaseDetail> {
    const result = await this.prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findFirst({
        where: { id: input.purchaseId, tenantId: input.tenantId },
      });
      if (!purchase) throw new InvalidPurchaseRelationshipError('Purchase not found.');

      const newPaidAmount = addDecimalStrings(purchase.paidAmount.toString(), input.amount, 2);
      if (compareDecimalStrings(newPaidAmount, purchase.total.toString(), 2) > 0) {
        throw new PaymentExceedsBalanceError('Payment would exceed the outstanding balance.');
      }
      const paymentStatus = resolvePaymentStatus(purchase.total.toString(), newPaidAmount);

      const claimed = await tx.purchase.updateMany({
        where: { id: purchase.id, tenantId: input.tenantId, paidAmount: purchase.paidAmount },
        data: { paidAmount: newPaidAmount, paymentStatus },
      });
      if (claimed.count !== 1) {
        throw new PurchaseConcurrencyError(
          'This purchase was changed by another request. Please retry.',
        );
      }

      await tx.supplierPayment.create({
        data: {
          tenantId: input.tenantId,
          supplierId: purchase.supplierId,
          purchaseId: purchase.id,
          amount: roundDecimalString(input.amount, 2),
          method: input.method,
          createdById: input.createdById,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          userId: input.audit.userId,
          action: input.audit.action,
          entity: 'Purchase',
          entityId: purchase.id,
          metadata: {
            ...(input.audit.metadata ?? {}),
            purchaseNo: purchase.purchaseNo,
            total: purchase.total.toString(),
            paymentStatusAfter: paymentStatus,
          },
        },
      });

      return tx.purchase.findFirstOrThrow({
        where: { id: purchase.id, tenantId: input.tenantId },
        include: PURCHASE_INCLUDE,
      });
    });

    return toPurchaseDetail(result);
  }
}
