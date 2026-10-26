import type {
  CreateSubDepartmentInput,
  SubDepartmentListQuery,
  UpdateSubDepartmentInput,
} from '@mafk/validation';
import type { Repositories } from '../domain/ports.js';
import { DomainError, type RecordStatus, type SubDepartmentSummary } from '../domain/types.js';
import type { Actor } from './category.service.js';

export class SubDepartmentService {
  constructor(private readonly repos: Repositories) {}

  async list(tenantId: string, query: SubDepartmentListQuery): Promise<SubDepartmentSummary[]> {
    return this.repos.subDepartments.list(tenantId, {
      categoryId: query.categoryId,
      search: query.search,
      status: query.status,
    });
  }

  private async requireSubDepartment(id: string, tenantId: string): Promise<SubDepartmentSummary> {
    const sub = await this.repos.subDepartments.findById(id, tenantId);
    if (!sub) throw new DomainError('NOT_FOUND', 'Sub-Department not found.', 404);
    return sub;
  }

  async getById(id: string, tenantId: string): Promise<SubDepartmentSummary> {
    return this.requireSubDepartment(id, tenantId);
  }

  /** The one place that enforces "Sub-Department must belong to Category" - never trust the frontend. */
  private async requireCategory(categoryId: string, tenantId: string) {
    const category = await this.repos.categories.findById(categoryId, tenantId);
    if (!category)
      throw new DomainError('VALIDATION_ERROR', 'Selected Category does not exist.', 422);
    return category;
  }

  async create(actor: Actor, input: CreateSubDepartmentInput): Promise<SubDepartmentSummary> {
    await this.requireCategory(input.categoryId, actor.tenantId);
    if (
      await this.repos.subDepartments.existsByName(actor.tenantId, input.categoryId, input.name)
    ) {
      throw new DomainError(
        'CONFLICT',
        `A Sub-Department named "${input.name}" already exists in this Category.`,
        409,
      );
    }
    const created = await this.repos.subDepartments.create(actor.tenantId, input);
    await this.repos.auditLogs.record({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'SUB_DEPARTMENT_CREATED',
      entity: 'SubDepartment',
      entityId: created.id,
      metadata: { name: input.name, categoryId: input.categoryId },
    });
    return created;
  }

  async update(
    actor: Actor,
    id: string,
    patch: UpdateSubDepartmentInput,
  ): Promise<SubDepartmentSummary> {
    const before = await this.requireSubDepartment(id, actor.tenantId);
    if (
      patch.name &&
      (await this.repos.subDepartments.existsByName(
        actor.tenantId,
        before.categoryId,
        patch.name,
        id,
      ))
    ) {
      throw new DomainError(
        'CONFLICT',
        `A Sub-Department named "${patch.name}" already exists in this Category.`,
        409,
      );
    }
    await this.repos.subDepartments.update(id, actor.tenantId, patch);
    await this.repos.auditLogs.record({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'SUB_DEPARTMENT_UPDATED',
      entity: 'SubDepartment',
      entityId: id,
      metadata: { patch },
    });
    return this.requireSubDepartment(id, actor.tenantId);
  }

  async updateStatus(
    actor: Actor,
    id: string,
    status: RecordStatus,
  ): Promise<SubDepartmentSummary> {
    const before = await this.requireSubDepartment(id, actor.tenantId);
    await this.repos.subDepartments.updateStatus(id, actor.tenantId, status);
    await this.repos.auditLogs.record({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'SUB_DEPARTMENT_STATUS_CHANGED',
      entity: 'SubDepartment',
      entityId: id,
      metadata: { from: before.status, to: status },
    });
    return this.requireSubDepartment(id, actor.tenantId);
  }
}
