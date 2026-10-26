import type { CreateSupplierInput, SupplierListQuery } from '@mafk/validation';
import type { Repositories } from '../domain/ports.js';
import { DomainError, type Ledger, type SupplierSummary } from '../domain/types.js';
import type { Actor } from './category.service.js';

/** Supplier CRUD plus the payable ledger (opening balance + purchases - payments), added in Phase 6. */
export class SupplierService {
  constructor(private readonly repos: Repositories) {}

  async list(tenantId: string, query: SupplierListQuery): Promise<SupplierSummary[]> {
    return this.repos.suppliers.list(tenantId, { search: query.search });
  }

  async getById(id: string, tenantId: string): Promise<SupplierSummary> {
    const supplier = await this.repos.suppliers.findById(id, tenantId);
    if (!supplier) throw new DomainError('NOT_FOUND', 'Supplier not found.', 404);
    return supplier;
  }

  async ledger(id: string, tenantId: string): Promise<Ledger & { supplierId: string }> {
    const ledger = await this.repos.suppliers.ledger(id, tenantId);
    if (!ledger) throw new DomainError('NOT_FOUND', 'Supplier not found.', 404);
    return { supplierId: id, ...ledger };
  }

  async create(actor: Actor, input: CreateSupplierInput): Promise<SupplierSummary> {
    if (await this.repos.suppliers.existsByName(actor.tenantId, input.name)) {
      throw new DomainError('CONFLICT', `A supplier named "${input.name}" already exists.`, 409);
    }
    const created = await this.repos.suppliers.create(actor.tenantId, input);
    await this.repos.auditLogs.record({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'SUPPLIER_CREATED',
      entity: 'Supplier',
      entityId: created.id,
      metadata: { name: input.name, openingBalance: input.openingBalance ?? '0' },
    });
    return created;
  }
}
