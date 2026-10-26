// DATABASE STATUS (Phase 6): exercised by tests/integration/phase6.pg.test.ts (see docs/PHASE-6.md for what passed).
import { addDecimalStrings, roundDecimalString } from '@mafk/shared';
import type { Prisma, PrismaClient } from '@mafk/database';
import type { EmployeeRepository, ExpenseRepository } from '../../domain/ports.js';
import {
  EmployeeUserConflictError,
  type CashMethod,
  type CreateEmployeeRecord,
  type CreateExpenseRecord,
  type EmployeeListFilter,
  type EmployeeListResult,
  type EmployeeRecord,
  type EmployeeStatusValue,
  type ExpenseListFilter,
  type ExpenseListResult,
  type ExpenseRecord,
  type TransactionalAudit,
  type UpdateEmployeeRecord,
  type UpdateExpenseRecord,
} from '../../domain/types.js';
import { auditMeta } from './audit-meta.js';

const money = (d: Prisma.Decimal): string => d.toFixed(2);

const toExpense = (r: {
  id: string;
  tenantId: string;
  storeId: string;
  category: string;
  description: string | null;
  amount: Prisma.Decimal;
  expenseDate: Date;
  method: string;
  createdById: string;
  createdAt: Date;
}): ExpenseRecord => ({
  id: r.id,
  tenantId: r.tenantId,
  storeId: r.storeId,
  category: r.category,
  description: r.description,
  amount: money(r.amount),
  expenseDate: r.expenseDate,
  method: r.method as CashMethod,
  createdById: r.createdById,
  createdAt: r.createdAt,
});

export class PrismaExpenseRepository implements ExpenseRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateExpenseRecord): Promise<ExpenseRecord> {
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          tenantId: input.tenantId,
          storeId: input.storeId,
          category: input.category,
          description: input.description ?? null,
          amount: roundDecimalString(input.amount, 2),
          expenseDate: input.expenseDate,
          method: input.method,
          createdById: input.createdById,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          userId: input.audit.userId,
          action: input.audit.action,
          entity: 'Expense',
          entityId: created.id,
          metadata: auditMeta(input.audit),
        },
      });
      return created;
    });
    return toExpense(row);
  }

  async findById(id: string, tenantId: string): Promise<ExpenseRecord | null> {
    const row = await this.prisma.expense.findFirst({ where: { id, tenantId } });
    return row ? toExpense(row) : null;
  }

  async list(tenantId: string, f: ExpenseListFilter): Promise<ExpenseListResult> {
    const where: Prisma.ExpenseWhereInput = {
      tenantId,
      ...(f.storeId ? { storeId: f.storeId } : {}),
      ...(f.category ? { category: f.category } : {}),
      ...(f.from || f.to
        ? { expenseDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } }
        : {}),
    };
    const [rows, total, agg] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
      }),
      this.prisma.expense.count({ where }),
      this.prisma.expense.aggregate({ where, _sum: { amount: true } }),
    ]);
    return {
      items: rows.map(toExpense),
      total,
      totalAmount: agg._sum.amount ? money(agg._sum.amount) : '0.00',
      page: f.page,
      pageSize: f.pageSize,
    };
  }

  async update(
    id: string,
    tenantId: string,
    patch: UpdateExpenseRecord,
    audit: TransactionalAudit,
  ): Promise<ExpenseRecord | null> {
    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.expense.findFirst({ where: { id, tenantId } });
      if (!existing) return null;
      const updated = await tx.expense.update({
        where: { id },
        data: {
          ...(patch.category !== undefined ? { category: patch.category } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.amount !== undefined ? { amount: roundDecimalString(patch.amount, 2) } : {}),
          ...(patch.expenseDate !== undefined ? { expenseDate: patch.expenseDate } : {}),
          ...(patch.method !== undefined ? { method: patch.method } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: audit.userId,
          action: audit.action,
          entity: 'Expense',
          entityId: id,
          metadata: auditMeta(audit),
        },
      });
      return updated;
    });
    return row ? toExpense(row) : null;
  }

  async delete(id: string, tenantId: string, audit: TransactionalAudit): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const gone = await tx.expense.deleteMany({ where: { id, tenantId } });
      if (gone.count !== 1) return false;
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: audit.userId,
          action: audit.action,
          entity: 'Expense',
          entityId: id,
          metadata: auditMeta(audit),
        },
      });
      return true;
    });
  }
}

const toEmployee = (r: {
  id: string;
  tenantId: string;
  userId: string | null;
  storeId: string | null;
  fullName: string;
  phone: string | null;
  designation: string | null;
  nationalId: string | null;
  hireDate: Date | null;
  salary: Prisma.Decimal | null;
  status: string;
  createdAt: Date;
}): EmployeeRecord => ({
  id: r.id,
  tenantId: r.tenantId,
  userId: r.userId,
  storeId: r.storeId,
  fullName: r.fullName,
  phone: r.phone,
  designation: r.designation,
  nationalId: r.nationalId,
  hireDate: r.hireDate,
  salary: r.salary ? money(r.salary) : null,
  status: r.status as EmployeeStatusValue,
  createdAt: r.createdAt,
});

const isUserUnique = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; meta?: unknown; message?: unknown };
  return (
    e.code === 'P2002' &&
    `${JSON.stringify(e.meta ?? {})} ${String(e.message ?? '')}`.toLowerCase().includes('userid')
  );
};

export class PrismaEmployeeRepository implements EmployeeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    tenantId: string,
    input: CreateEmployeeRecord,
    audit: TransactionalAudit,
  ): Promise<EmployeeRecord> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.employee.create({
          data: {
            tenantId,
            fullName: input.fullName,
            phone: input.phone ?? null,
            designation: input.designation ?? null,
            nationalId: input.nationalId ?? null,
            hireDate: input.hireDate ?? null,
            salary: input.salary ? roundDecimalString(input.salary, 2) : null,
            storeId: input.storeId ?? null,
            userId: input.userId ?? null,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId,
            userId: audit.userId,
            action: audit.action,
            entity: 'Employee',
            entityId: created.id,
            metadata: auditMeta(audit),
          },
        });
        return created;
      });
      return toEmployee(row);
    } catch (err) {
      if (isUserUnique(err))
        throw new EmployeeUserConflictError('This login is already linked to another employee.');
      throw err;
    }
  }

  async findById(id: string, tenantId: string): Promise<EmployeeRecord | null> {
    const row = await this.prisma.employee.findFirst({ where: { id, tenantId } });
    return row ? toEmployee(row) : null;
  }

  async list(tenantId: string, f: EmployeeListFilter): Promise<EmployeeListResult> {
    const where: Prisma.EmployeeWhereInput = {
      tenantId,
      ...(f.status ? { status: f.status } : {}),
      ...(f.storeId ? { storeId: f.storeId } : {}),
      ...(f.search
        ? {
            OR: [
              { fullName: { contains: f.search, mode: 'insensitive' as const } },
              { phone: { contains: f.search } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        orderBy: { fullName: 'asc' },
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
      }),
      this.prisma.employee.count({ where }),
    ]);
    return { items: rows.map(toEmployee), total, page: f.page, pageSize: f.pageSize };
  }

  async update(
    id: string,
    tenantId: string,
    patch: UpdateEmployeeRecord,
    audit: TransactionalAudit,
  ): Promise<EmployeeRecord | null> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.employee.findFirst({ where: { id, tenantId } });
        if (!existing) return null;
        const updated = await tx.employee.update({
          where: { id },
          data: {
            ...(patch.fullName !== undefined ? { fullName: patch.fullName } : {}),
            ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
            ...(patch.designation !== undefined ? { designation: patch.designation } : {}),
            ...(patch.nationalId !== undefined ? { nationalId: patch.nationalId } : {}),
            ...(patch.hireDate !== undefined ? { hireDate: patch.hireDate } : {}),
            ...(patch.salary !== undefined
              ? { salary: patch.salary === null ? null : roundDecimalString(patch.salary, 2) }
              : {}),
            ...(patch.storeId !== undefined ? { storeId: patch.storeId } : {}),
            ...(patch.userId !== undefined ? { userId: patch.userId } : {}),
            ...(patch.status !== undefined ? { status: patch.status } : {}),
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId,
            userId: audit.userId,
            action: audit.action,
            entity: 'Employee',
            entityId: id,
            metadata: auditMeta(audit),
          },
        });
        return updated;
      });
      return row ? toEmployee(row) : null;
    } catch (err) {
      if (isUserUnique(err))
        throw new EmployeeUserConflictError('This login is already linked to another employee.');
      throw err;
    }
  }
}

export const sumMoney = (xs: string[]): string =>
  xs.reduce((a, x) => addDecimalStrings(a, x, 2), '0.00');
