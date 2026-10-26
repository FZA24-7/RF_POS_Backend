import type { CreateEmployeeInput, EmployeeListQuery, UpdateEmployeeInput } from '@mafk/validation';
import type { Repositories } from '../domain/ports.js';
import { DomainError, EmployeeUserConflictError, type EmployeeRecord } from '../domain/types.js';
import type { SaleActor } from './sale.service.js';

/** hireDate is a calendar date; salary and national ID are only visible to people who may edit employees. */
export interface EmployeeView extends Omit<EmployeeRecord, 'hireDate'> {
  hireDate: string | null;
}
export interface EmployeeListView {
  items: EmployeeView[];
  total: number;
  page: number;
  pageSize: number;
}

const toDate = (ymd: string): Date => new Date(`${ymd}T00:00:00.000Z`);

export class EmployeeService {
  constructor(private readonly repos: Repositories) {}

  private view(e: EmployeeRecord, canSeePrivate: boolean): EmployeeView {
    return {
      ...e,
      hireDate: e.hireDate ? e.hireDate.toISOString().slice(0, 10) : null,
      salary: canSeePrivate ? e.salary : null,
      nationalId: canSeePrivate ? e.nationalId : null,
    };
  }

  private async validateLinks(
    tenantId: string,
    storeId?: string | null,
    userId?: string | null,
  ): Promise<void> {
    if (storeId) {
      const stores = await this.repos.stores.listByTenant(tenantId);
      if (!stores.some((s) => s.id === storeId)) {
        throw new DomainError('VALIDATION_ERROR', 'Selected branch does not exist.', 422);
      }
    }
    if (userId) {
      const user = await this.repos.users.findById(userId);
      if (!user || user.tenantId !== tenantId) {
        throw new DomainError('VALIDATION_ERROR', 'Selected user does not exist.', 422);
      }
    }
  }

  async create(actor: SaleActor, input: CreateEmployeeInput): Promise<EmployeeView> {
    await this.validateLinks(actor.tenantId, input.storeId, input.userId);
    try {
      const created = await this.repos.employees.create(
        actor.tenantId,
        { ...input, hireDate: input.hireDate ? toDate(input.hireDate) : undefined },
        { userId: actor.id, action: 'EMPLOYEE_CREATED', metadata: { fullName: input.fullName } },
      );
      return this.view(created, true);
    } catch (err) {
      if (err instanceof EmployeeUserConflictError)
        throw new DomainError('CONFLICT', err.message, 409);
      throw err;
    }
  }

  async getById(actor: SaleActor, id: string): Promise<EmployeeView> {
    const e = await this.repos.employees.findById(id, actor.tenantId);
    if (!e) throw new DomainError('NOT_FOUND', 'Employee not found.', 404);
    return this.view(e, actor.permissions.has('employees.edit'));
  }

  async list(actor: SaleActor, q: EmployeeListQuery): Promise<EmployeeListView> {
    const r = await this.repos.employees.list(actor.tenantId, q);
    const priv = actor.permissions.has('employees.edit');
    return { ...r, items: r.items.map((e) => this.view(e, priv)) };
  }

  async update(actor: SaleActor, id: string, patch: UpdateEmployeeInput): Promise<EmployeeView> {
    await this.validateLinks(actor.tenantId, patch.storeId, patch.userId);
    try {
      const updated = await this.repos.employees.update(
        id,
        actor.tenantId,
        {
          ...patch,
          hireDate:
            patch.hireDate === undefined
              ? undefined
              : patch.hireDate === null
                ? null
                : toDate(patch.hireDate),
        },
        { userId: actor.id, action: 'EMPLOYEE_UPDATED', metadata: { fields: Object.keys(patch) } },
      );
      if (!updated) throw new DomainError('NOT_FOUND', 'Employee not found.', 404);
      return this.view(updated, true);
    } catch (err) {
      if (err instanceof EmployeeUserConflictError)
        throw new DomainError('CONFLICT', err.message, 409);
      throw err;
    }
  }
}
