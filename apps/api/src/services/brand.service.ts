import type { CreateBrandInput, ListQuery, UpdateBrandInput } from '@mafk/validation';
import type { Repositories } from '../domain/ports.js';
import { DomainError, type BrandSummary, type RecordStatus } from '../domain/types.js';
import type { Actor } from './category.service.js';

export class BrandService {
  constructor(private readonly repos: Repositories) {}

  async list(tenantId: string, query: ListQuery): Promise<BrandSummary[]> {
    return this.repos.brands.list(tenantId, { search: query.search, status: query.status });
  }

  private async requireBrand(id: string, tenantId: string): Promise<BrandSummary> {
    const brand = await this.repos.brands.findById(id, tenantId);
    if (!brand) throw new DomainError('NOT_FOUND', 'Brand not found.', 404);
    return brand;
  }

  async getById(id: string, tenantId: string): Promise<BrandSummary> {
    return this.requireBrand(id, tenantId);
  }

  async create(actor: Actor, input: CreateBrandInput): Promise<BrandSummary> {
    if (await this.repos.brands.existsByName(actor.tenantId, input.name)) {
      throw new DomainError('CONFLICT', `A brand named "${input.name}" already exists.`, 409);
    }
    const created = await this.repos.brands.create(actor.tenantId, input);
    await this.repos.auditLogs.record({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'BRAND_CREATED',
      entity: 'Brand',
      entityId: created.id,
      metadata: { name: input.name },
    });
    return created;
  }

  async update(actor: Actor, id: string, patch: UpdateBrandInput): Promise<BrandSummary> {
    await this.requireBrand(id, actor.tenantId);
    if (patch.name && (await this.repos.brands.existsByName(actor.tenantId, patch.name, id))) {
      throw new DomainError('CONFLICT', `A brand named "${patch.name}" already exists.`, 409);
    }
    await this.repos.brands.update(id, actor.tenantId, patch);
    await this.repos.auditLogs.record({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'BRAND_UPDATED',
      entity: 'Brand',
      entityId: id,
      metadata: { patch },
    });
    return this.requireBrand(id, actor.tenantId);
  }

  async updateStatus(actor: Actor, id: string, status: RecordStatus): Promise<BrandSummary> {
    const before = await this.requireBrand(id, actor.tenantId);
    await this.repos.brands.updateStatus(id, actor.tenantId, status);
    await this.repos.auditLogs.record({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'BRAND_STATUS_CHANGED',
      entity: 'Brand',
      entityId: id,
      metadata: { from: before.status, to: status },
    });
    return this.requireBrand(id, actor.tenantId);
  }
}
