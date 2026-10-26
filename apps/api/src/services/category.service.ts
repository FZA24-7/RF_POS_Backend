import type { CreateCategoryInput, ListQuery, UpdateCategoryInput } from '@mafk/validation';
import type { Repositories } from '../domain/ports.js';
import { DomainError, type CategorySummary, type RecordStatus } from '../domain/types.js';

export interface Actor {
  id: string;
  tenantId: string;
}

export class CategoryService {
  constructor(private readonly repos: Repositories) {}

  async list(tenantId: string, query: ListQuery): Promise<CategorySummary[]> {
    return this.repos.categories.list(tenantId, { search: query.search, status: query.status });
  }

  private async requireCategory(id: string, tenantId: string): Promise<CategorySummary> {
    const category = await this.repos.categories.findById(id, tenantId);
    if (!category) throw new DomainError('NOT_FOUND', 'Category not found.', 404);
    return category;
  }

  async getById(id: string, tenantId: string): Promise<CategorySummary> {
    return this.requireCategory(id, tenantId);
  }

  async create(actor: Actor, input: CreateCategoryInput): Promise<CategorySummary> {
    if (await this.repos.categories.existsByName(actor.tenantId, input.name)) {
      throw new DomainError('CONFLICT', `A category named "${input.name}" already exists.`, 409);
    }
    const created = await this.repos.categories.create(actor.tenantId, input);
    await this.repos.auditLogs.record({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'CATEGORY_CREATED',
      entity: 'Category',
      entityId: created.id,
      metadata: { name: input.name },
    });
    return created;
  }

  async update(actor: Actor, id: string, patch: UpdateCategoryInput): Promise<CategorySummary> {
    const before = await this.requireCategory(id, actor.tenantId);
    if (patch.name && (await this.repos.categories.existsByName(actor.tenantId, patch.name, id))) {
      throw new DomainError('CONFLICT', `A category named "${patch.name}" already exists.`, 409);
    }
    await this.repos.categories.update(id, actor.tenantId, patch);
    await this.repos.auditLogs.record({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'CATEGORY_UPDATED',
      entity: 'Category',
      entityId: id,
      metadata: { before: { name: before.name }, patch },
    });
    return this.requireCategory(id, actor.tenantId);
  }

  async updateStatus(actor: Actor, id: string, status: RecordStatus): Promise<CategorySummary> {
    const before = await this.requireCategory(id, actor.tenantId);
    await this.repos.categories.updateStatus(id, actor.tenantId, status);
    await this.repos.auditLogs.record({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'CATEGORY_STATUS_CHANGED',
      entity: 'Category',
      entityId: id,
      metadata: { from: before.status, to: status },
    });
    return this.requireCategory(id, actor.tenantId);
  }
}
