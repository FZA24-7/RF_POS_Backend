import { isNonNegativeDecimalString, compareDecimalStrings } from '@mafk/shared';
import type { CreateProductInput, ProductListQuery, UpdateProductInput } from '@mafk/validation';
import type {
  CreateProductInput as RepoCreateProductInput,
  Repositories,
} from '../domain/ports.js';
import {
  DomainError,
  type ProductListResult,
  type ProductSummary,
  type RecordStatus,
} from '../domain/types.js';
import type { Actor } from './category.service.js';

const validatePricing = (input: {
  costPrice: string;
  sellingPrice: string;
  minStock: string;
  maxStock?: string;
}) => {
  if (
    !isNonNegativeDecimalString(input.costPrice, 4) ||
    !isNonNegativeDecimalString(input.sellingPrice, 4)
  ) {
    throw new DomainError('VALIDATION_ERROR', 'Prices must not be negative.', 422);
  }
  if (!isNonNegativeDecimalString(input.minStock, 3)) {
    throw new DomainError('VALIDATION_ERROR', 'Minimum stock must not be negative.', 422);
  }
  if (input.maxStock !== undefined) {
    if (!isNonNegativeDecimalString(input.maxStock, 3)) {
      throw new DomainError('VALIDATION_ERROR', 'Maximum stock must not be negative.', 422);
    }
    if (compareDecimalStrings(input.maxStock, input.minStock, 3) < 0) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Maximum stock cannot be lower than minimum stock.',
        422,
      );
    }
  }
};

export class ProductService {
  constructor(private readonly repos: Repositories) {}

  async list(tenantId: string, query: ProductListQuery): Promise<ProductListResult> {
    return this.repos.products.list(tenantId, {
      search: query.search,
      categoryId: query.categoryId,
      subDepartmentId: query.subDepartmentId,
      brandId: query.brandId,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  private async requireProduct(id: string, tenantId: string): Promise<ProductSummary> {
    const product = await this.repos.products.findById(id, tenantId);
    if (!product) throw new DomainError('NOT_FOUND', 'Product not found.', 404);
    return product;
  }

  async getById(id: string, tenantId: string): Promise<ProductSummary> {
    return this.requireProduct(id, tenantId);
  }

  /**
   * Server-side proof that the chosen Sub-Department genuinely belongs to the
   * chosen Category - the spec is explicit that a frontend dropdown filter is
   * not sufficient. Also backed by the database's composite foreign key (see
   * `docs/DATABASE.md`), but a friendly 422 here means the error is caught
   * before ever reaching Prisma, and the in-memory fakes (which have no real
   * FK enforcement) are still fully protected.
   */
  private async requireConsistentCategory(
    categoryId: string,
    subDepartmentId: string,
    tenantId: string,
  ) {
    const category = await this.repos.categories.findById(categoryId, tenantId);
    if (!category)
      throw new DomainError('VALIDATION_ERROR', 'Selected Category does not exist.', 422);
    const subDepartment = await this.repos.subDepartments.findById(subDepartmentId, tenantId);
    if (!subDepartment)
      throw new DomainError('VALIDATION_ERROR', 'Selected Sub-Department does not exist.', 422);
    if (subDepartment.categoryId !== categoryId) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'The selected Sub-Department does not belong to the selected Category.',
        422,
      );
    }
  }

  async create(actor: Actor, input: CreateProductInput): Promise<ProductSummary> {
    validatePricing(input);
    await this.requireConsistentCategory(input.categoryId, input.subDepartmentId, actor.tenantId);

    if (await this.repos.products.existsBySku(actor.tenantId, input.sku)) {
      throw new DomainError('CONFLICT', `SKU "${input.sku}" is already in use.`, 409);
    }
    for (const code of input.barcodes ?? []) {
      if (await this.repos.barcodes.existsByCode(actor.tenantId, code)) {
        throw new DomainError('CONFLICT', `Barcode "${code}" is already in use.`, 409);
      }
    }

    const repoInput: RepoCreateProductInput = {
      name: input.name,
      sku: input.sku,
      categoryId: input.categoryId,
      subDepartmentId: input.subDepartmentId,
      brandId: input.brandId ?? null,
      supplierId: input.supplierId ?? null,
      costPrice: input.costPrice,
      sellingPrice: input.sellingPrice,
      wholesalePrice: input.wholesalePrice ?? null,
      taxRate: input.taxRate,
      unit: input.unit,
      minStock: input.minStock,
      maxStock: input.maxStock ?? null,
      imageUrl: input.imageUrl ?? null,
      description: input.description ?? null,
      barcodes: input.barcodes ?? [],
    };
    const created = await this.repos.products.create(actor.tenantId, repoInput);

    await this.repos.auditLogs.record({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'PRODUCT_CREATED',
      entity: 'Product',
      entityId: created.id,
      metadata: { sku: input.sku, name: input.name },
    });
    return created;
  }

  async update(actor: Actor, id: string, patch: UpdateProductInput): Promise<ProductSummary> {
    const before = await this.requireProduct(id, actor.tenantId);

    const categoryId = patch.categoryId ?? before.categoryId;
    const subDepartmentId = patch.subDepartmentId ?? before.subDepartmentId;
    if (patch.categoryId || patch.subDepartmentId) {
      await this.requireConsistentCategory(categoryId, subDepartmentId, actor.tenantId);
    }

    validatePricing({
      costPrice: patch.costPrice ?? before.costPrice,
      sellingPrice: patch.sellingPrice ?? before.sellingPrice,
      minStock: patch.minStock ?? before.minStock,
      maxStock: patch.maxStock ?? before.maxStock ?? undefined,
    });

    await this.repos.products.update(id, actor.tenantId, patch);
    await this.repos.auditLogs.record({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'PRODUCT_UPDATED',
      entity: 'Product',
      entityId: id,
      metadata: { patch },
    });
    return this.requireProduct(id, actor.tenantId);
  }

  async updateStatus(actor: Actor, id: string, status: RecordStatus): Promise<ProductSummary> {
    const before = await this.requireProduct(id, actor.tenantId);
    await this.repos.products.updateStatus(id, actor.tenantId, status);
    await this.repos.auditLogs.record({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'PRODUCT_STATUS_CHANGED',
      entity: 'Product',
      entityId: id,
      metadata: { from: before.status, to: status },
    });
    return this.requireProduct(id, actor.tenantId);
  }
}
