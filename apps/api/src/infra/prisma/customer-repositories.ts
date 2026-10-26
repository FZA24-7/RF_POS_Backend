// DATABASE STATUS (Phase 6): see tests/integration/phase6.pg.test.ts for the real-PostgreSQL results.
import {
  addDecimalStrings,
  compareDecimalStrings,
  roundDecimalString,
  subtractDecimalStrings,
} from '@mafk/shared';
import type { Prisma, PrismaClient } from '@mafk/database';
import { auditMeta } from './audit-meta.js';
import { buildLedger, summariseOutstanding } from '../../services/ledger.js';
import type { CustomerRepository } from '../../domain/ports.js';
import {
  CustomerNotFoundError,
  CustomerOverpaymentError,
  type CashMethod,
  type CreateCustomerRecord,
  type CustomerListFilter,
  type CustomerListResult,
  type CustomerPaymentRecord,
  type CustomerWithBalance,
  type Ledger,
  type LedgerEntry,
  type Outstanding,
  type RecordCustomerPaymentInput,
  type TransactionalAudit,
  type UpdateCustomerRecord,
} from '../../domain/types.js';

const money = (d: Prisma.Decimal): string => d.toFixed(2);
const sumOf = (d: Prisma.Decimal | null | undefined): string => (d ? d.toFixed(2) : '0.00');

type Db = PrismaClient | Prisma.TransactionClient;

/** opening + credit sales - credit refunds - payments, read with three exact SQL aggregates (sequential: safe in a tx). */
export async function customerBalance(
  db: Db,
  tenantId: string,
  customerId: string,
  opening: string,
): Promise<string> {
  const credit = await db.payment.aggregate({
    _sum: { amount: true },
    where: { tenantId, method: 'CUSTOMER_CREDIT', sale: { customerId, tenantId } },
  });
  const refunds = await db.saleReturn.aggregate({
    _sum: { refundTotal: true },
    where: { tenantId, refundMethod: 'CUSTOMER_CREDIT', sale: { customerId, tenantId } },
  });
  const paid = await db.customerPayment.aggregate({
    _sum: { amount: true },
    where: { tenantId, customerId },
  });
  return subtractDecimalStrings(
    subtractDecimalStrings(
      addDecimalStrings(opening, sumOf(credit._sum.amount), 2),
      sumOf(refunds._sum.refundTotal),
      2,
    ),
    sumOf(paid._sum.amount),
    2,
  );
}

const toBase = (row: {
  id: string;
  tenantId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  customerType: string;
  openingBalance: Prisma.Decimal;
  creditLimit: Prisma.Decimal | null;
  isActive: boolean;
  createdAt: Date;
}) => ({
  id: row.id,
  tenantId: row.tenantId,
  name: row.name,
  phone: row.phone,
  email: row.email,
  address: row.address,
  customerType: row.customerType as 'RETAIL' | 'WHOLESALE',
  openingBalance: money(row.openingBalance),
  creditLimit: row.creditLimit ? money(row.creditLimit) : null,
  isActive: row.isActive,
  createdAt: row.createdAt,
});

export class PrismaCustomerRepository implements CustomerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async withBalance(
    row: Parameters<typeof toBase>[0],
    db: Db = this.prisma,
  ): Promise<CustomerWithBalance> {
    const base = toBase(row);
    return {
      ...base,
      balance: await customerBalance(db, row.tenantId, row.id, base.openingBalance),
    };
  }

  async create(
    tenantId: string,
    input: CreateCustomerRecord,
    audit: TransactionalAudit,
  ): Promise<CustomerWithBalance> {
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.customer.create({
        data: {
          tenantId,
          name: input.name,
          phone: input.phone ?? null,
          email: input.email ?? null,
          address: input.address ?? null,
          customerType: input.customerType,
          openingBalance: roundDecimalString(input.openingBalance, 2),
          creditLimit: input.creditLimit ? roundDecimalString(input.creditLimit, 2) : null,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: audit.userId,
          action: audit.action,
          entity: 'Customer',
          entityId: created.id,
          metadata: auditMeta(audit),
        },
      });
      return created;
    });
    return this.withBalance(row);
  }

  async findById(id: string, tenantId: string): Promise<CustomerWithBalance | null> {
    const row = await this.prisma.customer.findFirst({ where: { id, tenantId } });
    return row ? this.withBalance(row) : null;
  }

  async list(tenantId: string, f: CustomerListFilter): Promise<CustomerListResult> {
    const where: Prisma.CustomerWhereInput = {
      tenantId,
      ...(f.isActive !== undefined ? { isActive: f.isActive } : {}),
      ...(f.search
        ? {
            OR: [
              { name: { contains: f.search, mode: 'insensitive' as const } },
              { phone: { contains: f.search } },
            ],
          }
        : {}),
    };
    if (f.withBalanceOnly) {
      // Balance is derived, so filter after computing (receivables lists are small relative to sales volume).
      const rows = await this.prisma.customer.findMany({ where, orderBy: { name: 'asc' } });
      const all = (await Promise.all(rows.map((r) => this.withBalance(r)))).filter(
        (c) => compareDecimalStrings(c.balance, '0', 2) !== 0,
      );
      const start = (f.page - 1) * f.pageSize;
      return {
        items: all.slice(start, start + f.pageSize),
        total: all.length,
        page: f.page,
        pageSize: f.pageSize,
      };
    }
    const [rows, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
      }),
      this.prisma.customer.count({ where }),
    ]);
    return {
      items: await Promise.all(rows.map((r) => this.withBalance(r))),
      total,
      page: f.page,
      pageSize: f.pageSize,
    };
  }

  async update(
    id: string,
    tenantId: string,
    patch: UpdateCustomerRecord,
    audit: TransactionalAudit,
  ): Promise<CustomerWithBalance | null> {
    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.customer.findFirst({ where: { id, tenantId } });
      if (!existing) return null;
      const updated = await tx.customer.update({
        where: { id_tenantId: { id, tenantId } },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
          ...(patch.email !== undefined ? { email: patch.email } : {}),
          ...(patch.address !== undefined ? { address: patch.address } : {}),
          ...(patch.customerType !== undefined ? { customerType: patch.customerType } : {}),
          ...(patch.creditLimit !== undefined
            ? {
                creditLimit:
                  patch.creditLimit === null ? null : roundDecimalString(patch.creditLimit, 2),
              }
            : {}),
          ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: audit.userId,
          action: audit.action,
          entity: 'Customer',
          entityId: id,
          metadata: auditMeta(audit),
        },
      });
      return updated;
    });
    return row ? this.withBalance(row) : null;
  }

  async ledger(id: string, tenantId: string): Promise<Ledger | null> {
    const customer = await this.prisma.customer.findFirst({ where: { id, tenantId } });
    if (!customer) return null;
    const [sales, refunds, payments] = await Promise.all([
      this.prisma.payment.findMany({
        where: { tenantId, method: 'CUSTOMER_CREDIT', sale: { customerId: id, tenantId } },
        include: { sale: { select: { invoiceNo: true, soldAt: true } } },
      }),
      this.prisma.saleReturn.findMany({
        where: { tenantId, refundMethod: 'CUSTOMER_CREDIT', sale: { customerId: id, tenantId } },
        include: { sale: { select: { invoiceNo: true } } },
      }),
      this.prisma.customerPayment.findMany({ where: { tenantId, customerId: id } }),
    ]);
    const raw: Omit<LedgerEntry, 'balance'>[] = [
      ...sales.map((p) => ({
        date: p.sale.soldAt,
        type: 'CREDIT_SALE' as const,
        reference: p.sale.invoiceNo,
        description: 'Sale on account',
        increase: money(p.amount),
        decrease: '0.00',
      })),
      ...refunds.map((r) => ({
        date: r.createdAt,
        type: 'CREDIT_REFUND' as const,
        reference: r.returnNo,
        description: `Refund to account (${r.sale.invoiceNo})`,
        increase: '0.00',
        decrease: money(r.refundTotal),
      })),
      ...payments.map((p) => ({
        date: p.paidAt,
        type: 'CUSTOMER_PAYMENT' as const,
        reference: p.reference ?? p.id,
        description: p.note ?? `Payment received (${p.method.toLowerCase().replace('_', ' ')})`,
        increase: '0.00',
        decrease: money(p.amount),
      })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.reference.localeCompare(b.reference));
    return buildLedger(money(customer.openingBalance), customer.createdAt, raw);
  }

  async recordPayment(
    input: RecordCustomerPaymentInput,
  ): Promise<{ payment: CustomerPaymentRecord; balance: string }> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM customers WHERE id = ${input.customerId} AND "tenantId" = ${input.tenantId} FOR UPDATE`;
      if (locked.length !== 1) throw new CustomerNotFoundError();
      const customer = await tx.customer.findFirstOrThrow({
        where: { id: input.customerId, tenantId: input.tenantId },
      });
      const balance = await customerBalance(
        tx,
        input.tenantId,
        customer.id,
        money(customer.openingBalance),
      );
      const amount = roundDecimalString(input.amount, 2);
      if (compareDecimalStrings(amount, balance, 2) > 0) {
        throw new CustomerOverpaymentError(
          `Payment (${amount}) is more than the customer owes (${balance}).`,
        );
      }
      const payment = await tx.customerPayment.create({
        data: {
          tenantId: input.tenantId,
          customerId: customer.id,
          amount,
          method: input.method,
          reference: input.reference ?? null,
          note: input.note ?? null,
          createdById: input.createdById,
        },
      });
      const after = subtractDecimalStrings(balance, amount, 2);
      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          userId: input.audit.userId,
          action: input.audit.action,
          entity: 'Customer',
          entityId: customer.id,
          metadata: auditMeta(input.audit, { amount, balanceAfter: after }),
        },
      });
      return {
        payment: {
          id: payment.id,
          customerId: payment.customerId,
          amount: money(payment.amount),
          method: payment.method as CashMethod,
          reference: payment.reference,
          note: payment.note,
          paidAt: payment.paidAt,
        },
        balance: after,
      };
    });
  }

  async outstanding(tenantId: string): Promise<Outstanding> {
    const rows = await this.prisma.customer.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
    const withBal = await Promise.all(rows.map((r) => this.withBalance(r)));
    return summariseOutstanding(
      withBal.map((c) => ({ id: c.id, name: c.name, phone: c.phone, balance: c.balance })),
    );
  }
}
