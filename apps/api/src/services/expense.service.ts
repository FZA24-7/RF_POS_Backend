import { addDaysToYmd, localDateString, startOfLocalDay } from '@mafk/shared';
import type { CreateExpenseInput, ExpenseListQuery, UpdateExpenseInput } from '@mafk/validation';
import type { Repositories } from '../domain/ports.js';
import { DomainError, type ExpenseRecord } from '../domain/types.js';
import type { Actor } from './category.service.js';

export interface ExpenseView extends ExpenseRecord {
  /** Calendar day (YYYY-MM-DD) in the business's time zone. */
  expenseDay: string;
}
export interface ExpenseListView {
  items: ExpenseView[];
  total: number;
  totalAmount: string;
  page: number;
  pageSize: number;
}

export class ExpenseService {
  constructor(private readonly repos: Repositories) {}

  private async tz(tenantId: string): Promise<string> {
    return (await this.repos.tenants.findDetailById(tenantId))?.timezone ?? 'Asia/Karachi';
  }

  private view(e: ExpenseRecord, tz: string): ExpenseView {
    return { ...e, expenseDay: localDateString(e.expenseDate, tz) };
  }

  private async requireStore(tenantId: string, storeId: string): Promise<void> {
    const stores = await this.repos.stores.listByTenant(tenantId);
    if (!stores.some((s) => s.id === storeId)) {
      throw new DomainError('VALIDATION_ERROR', 'Selected branch does not exist.', 422);
    }
  }

  async create(actor: Actor, input: CreateExpenseInput): Promise<ExpenseView> {
    await this.requireStore(actor.tenantId, input.storeId);
    const tz = await this.tz(actor.tenantId);
    const created = await this.repos.expenses.create({
      tenantId: actor.tenantId,
      storeId: input.storeId,
      category: input.category,
      description: input.description,
      amount: input.amount,
      expenseDate: startOfLocalDay(input.expenseDate, tz),
      method: input.method,
      createdById: actor.id,
      audit: {
        userId: actor.id,
        action: 'EXPENSE_CREATED',
        metadata: { category: input.category, amount: input.amount },
      },
    });
    return this.view(created, tz);
  }

  async getById(id: string, tenantId: string): Promise<ExpenseView> {
    const e = await this.repos.expenses.findById(id, tenantId);
    if (!e) throw new DomainError('NOT_FOUND', 'Expense not found.', 404);
    return this.view(e, await this.tz(tenantId));
  }

  async list(tenantId: string, q: ExpenseListQuery): Promise<ExpenseListView> {
    const tz = await this.tz(tenantId);
    const result = await this.repos.expenses.list(tenantId, {
      storeId: q.storeId,
      category: q.category,
      from: q.from ? startOfLocalDay(q.from, tz) : undefined,
      to: q.to ? startOfLocalDay(addDaysToYmd(q.to, 1), tz) : undefined,
      page: q.page,
      pageSize: q.pageSize,
    });
    return { ...result, items: result.items.map((e) => this.view(e, tz)) };
  }

  async update(actor: Actor, id: string, patch: UpdateExpenseInput): Promise<ExpenseView> {
    const tz = await this.tz(actor.tenantId);
    const updated = await this.repos.expenses.update(
      id,
      actor.tenantId,
      {
        category: patch.category,
        description: patch.description,
        amount: patch.amount,
        expenseDate: patch.expenseDate ? startOfLocalDay(patch.expenseDate, tz) : undefined,
        method: patch.method,
      },
      { userId: actor.id, action: 'EXPENSE_UPDATED', metadata: { fields: Object.keys(patch) } },
    );
    if (!updated) throw new DomainError('NOT_FOUND', 'Expense not found.', 404);
    return this.view(updated, tz);
  }

  async delete(actor: Actor, id: string): Promise<void> {
    const ok = await this.repos.expenses.delete(id, actor.tenantId, {
      userId: actor.id,
      action: 'EXPENSE_DELETED',
    });
    if (!ok) throw new DomainError('NOT_FOUND', 'Expense not found.', 404);
  }
}
