// DATABASE STATUS (Phase 5): PrismaInventoryRepository.applyMovement / findByStoreAndProduct / listMovements (incl. the
// negative-stock rejection) are exercised by the real-PostgreSQL purchase and sale tests. PrismaProductRepository.create
// (with barcodes), findById and PrismaBarcodeRepository.findProductIdByCode are exercised by
// tests/integration/catalog-product.pg.test.ts and a browser run (Phase 5 found and fixed a nested-barcode tenantId bug).
// Category / sub-department / brand create paths ran during that browser run. Product update / list / import / export,
// brand and category edit paths and inventory listing are NOT yet exercised against a database.
import type { Prisma, PrismaClient } from '@mafk/database';
import type {
  BarcodeRepository,
  BrandRepository,
  CategoryRepository,
  CreateProductInput,
  InventoryRepository,
  ProductRepository,
  SubDepartmentRepository,
} from '../../domain/ports.js';
import {
  type ApplyMovementInput,
  type ApplyMovementResult,
  type BrandSummary,
  type CategorySummary,
  type InventoryListFilter,
  type InventoryListResult,
  type InventoryMovementRecord,
  type ProductListFilter,
  type ProductListResult,
  type ProductSummary,
  type RecordStatus,
  type StockLevel,
  type SubDepartmentSummary,
} from '../../domain/types.js';
import { compareDecimalStrings } from '@mafk/shared';
import { applyMovementInTx } from './inventory-ops.js';

const toCategorySummary = (row: {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): CategorySummary => ({ ...row, status: row.status as RecordStatus });

export class PrismaCategoryRepository implements CategoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    tenantId: string,
    input: { name: string; description?: string },
  ): Promise<CategorySummary> {
    const row = await this.prisma.category.create({
      data: { tenantId, name: input.name, description: input.description ?? null },
    });
    return toCategorySummary(row);
  }
  async findById(id: string, tenantId: string): Promise<CategorySummary | null> {
    const row = await this.prisma.category.findFirst({ where: { id, tenantId } });
    return row ? toCategorySummary(row) : null;
  }
  async existsByName(tenantId: string, name: string, excludeId?: string): Promise<boolean> {
    const count = await this.prisma.category.count({
      where: { tenantId, name, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    return count > 0;
  }
  async list(
    tenantId: string,
    filter: { search?: string; status?: RecordStatus },
  ): Promise<CategorySummary[]> {
    const rows = await this.prisma.category.findMany({
      where: {
        tenantId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.search ? { name: { contains: filter.search, mode: 'insensitive' } } : {}),
      },
      orderBy: { name: 'asc' },
    });
    return rows.map(toCategorySummary);
  }
  async update(
    id: string,
    tenantId: string,
    patch: { name?: string; description?: string },
  ): Promise<void> {
    await this.prisma.category.update({ where: { id, tenantId }, data: patch });
  }
  async updateStatus(id: string, tenantId: string, status: RecordStatus): Promise<void> {
    await this.prisma.category.update({ where: { id, tenantId }, data: { status } });
  }
}

const toSubDepartmentSummary = (row: {
  id: string;
  tenantId: string;
  categoryId: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): SubDepartmentSummary => ({ ...row, status: row.status as RecordStatus });

export class PrismaSubDepartmentRepository implements SubDepartmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    tenantId: string,
    input: { categoryId: string; name: string; description?: string },
  ): Promise<SubDepartmentSummary> {
    const row = await this.prisma.subDepartment.create({
      data: {
        tenantId,
        categoryId: input.categoryId,
        name: input.name,
        description: input.description ?? null,
      },
    });
    return toSubDepartmentSummary(row);
  }
  async findById(id: string, tenantId: string): Promise<SubDepartmentSummary | null> {
    const row = await this.prisma.subDepartment.findFirst({ where: { id, tenantId } });
    return row ? toSubDepartmentSummary(row) : null;
  }
  async existsByName(
    tenantId: string,
    categoryId: string,
    name: string,
    excludeId?: string,
  ): Promise<boolean> {
    const count = await this.prisma.subDepartment.count({
      where: { tenantId, categoryId, name, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    return count > 0;
  }
  async list(
    tenantId: string,
    filter: { categoryId?: string; search?: string; status?: RecordStatus },
  ): Promise<SubDepartmentSummary[]> {
    const rows = await this.prisma.subDepartment.findMany({
      where: {
        tenantId,
        ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.search ? { name: { contains: filter.search, mode: 'insensitive' } } : {}),
      },
      orderBy: { name: 'asc' },
    });
    return rows.map(toSubDepartmentSummary);
  }
  async update(
    id: string,
    tenantId: string,
    patch: { name?: string; description?: string },
  ): Promise<void> {
    await this.prisma.subDepartment.update({ where: { id, tenantId }, data: patch });
  }
  async updateStatus(id: string, tenantId: string, status: RecordStatus): Promise<void> {
    await this.prisma.subDepartment.update({ where: { id, tenantId }, data: { status } });
  }
}

const toBrandSummary = (row: {
  id: string;
  tenantId: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): BrandSummary => ({ ...row, status: row.status as RecordStatus });

export class PrismaBrandRepository implements BrandRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(tenantId: string, input: { name: string }): Promise<BrandSummary> {
    const row = await this.prisma.brand.create({ data: { tenantId, name: input.name } });
    return toBrandSummary(row);
  }
  async findById(id: string, tenantId: string): Promise<BrandSummary | null> {
    const row = await this.prisma.brand.findFirst({ where: { id, tenantId } });
    return row ? toBrandSummary(row) : null;
  }
  async existsByName(tenantId: string, name: string, excludeId?: string): Promise<boolean> {
    const count = await this.prisma.brand.count({
      where: { tenantId, name, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    return count > 0;
  }
  async list(
    tenantId: string,
    filter: { search?: string; status?: RecordStatus },
  ): Promise<BrandSummary[]> {
    const rows = await this.prisma.brand.findMany({
      where: {
        tenantId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.search ? { name: { contains: filter.search, mode: 'insensitive' } } : {}),
      },
      orderBy: { name: 'asc' },
    });
    return rows.map(toBrandSummary);
  }
  async update(id: string, tenantId: string, patch: { name?: string }): Promise<void> {
    await this.prisma.brand.update({ where: { id, tenantId }, data: patch });
  }
  async updateStatus(id: string, tenantId: string, status: RecordStatus): Promise<void> {
    await this.prisma.brand.update({ where: { id, tenantId }, data: { status } });
  }
}

const toProductSummary = (row: {
  id: string;
  tenantId: string;
  name: string;
  sku: string;
  categoryId: string;
  subDepartmentId: string;
  brandId: string | null;
  supplierId: string | null;
  costPrice: Prisma.Decimal;
  sellingPrice: Prisma.Decimal;
  wholesalePrice: Prisma.Decimal | null;
  taxRate: Prisma.Decimal;
  unit: string;
  minStock: Prisma.Decimal;
  maxStock: Prisma.Decimal | null;
  imageUrl: string | null;
  description: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  barcodes?: { code: string }[];
}): ProductSummary => ({
  id: row.id,
  tenantId: row.tenantId,
  name: row.name,
  sku: row.sku,
  categoryId: row.categoryId,
  subDepartmentId: row.subDepartmentId,
  brandId: row.brandId,
  supplierId: row.supplierId,
  costPrice: row.costPrice.toString(),
  sellingPrice: row.sellingPrice.toString(),
  wholesalePrice: row.wholesalePrice?.toString() ?? null,
  taxRate: row.taxRate.toString(),
  unit: row.unit,
  minStock: row.minStock.toString(),
  maxStock: row.maxStock?.toString() ?? null,
  imageUrl: row.imageUrl,
  description: row.description,
  status: row.status as RecordStatus,
  barcodes: (row.barcodes ?? []).map((b) => b.code),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export class PrismaProductRepository implements ProductRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(tenantId: string, input: CreateProductInput): Promise<ProductSummary> {
    const row = await this.prisma.product.create({
      data: {
        tenantId,
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
        // tenantId is not set on nested barcodes: it comes from the parent product via the composite FK.
        barcodes: input.barcodes?.length
          ? { create: input.barcodes.map((code, i) => ({ code, isPrimary: i === 0 })) }
          : undefined,
      },
      include: { barcodes: { select: { code: true } } },
    });
    return toProductSummary(row);
  }

  async findById(id: string, tenantId: string): Promise<ProductSummary | null> {
    const row = await this.prisma.product.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { barcodes: { select: { code: true } } },
    });
    return row ? toProductSummary(row) : null;
  }

  async findBySku(tenantId: string, sku: string): Promise<ProductSummary | null> {
    const row = await this.prisma.product.findFirst({
      where: { tenantId, sku, deletedAt: null },
      include: { barcodes: { select: { code: true } } },
    });
    return row ? toProductSummary(row) : null;
  }

  async existsBySku(tenantId: string, sku: string, excludeId?: string): Promise<boolean> {
    const count = await this.prisma.product.count({
      where: { tenantId, sku, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    return count > 0;
  }

  async list(tenantId: string, filter: ProductListFilter): Promise<ProductListResult> {
    const where = {
      tenantId,
      deletedAt: null,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
      ...(filter.subDepartmentId ? { subDepartmentId: filter.subDepartmentId } : {}),
      ...(filter.brandId ? { brandId: filter.brandId } : {}),
      ...(filter.search
        ? {
            OR: [
              { name: { contains: filter.search, mode: 'insensitive' as const } },
              { sku: { contains: filter.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: { barcodes: { select: { code: true } } },
        orderBy: { name: 'asc' },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    return {
      items: rows.map(toProductSummary),
      total,
      page: filter.page,
      pageSize: filter.pageSize,
    };
  }

  async update(id: string, tenantId: string, patch: Partial<CreateProductInput>): Promise<void> {
    await this.prisma.product.update({
      where: { id, tenantId },
      data: {
        ...patch,
        barcodes: undefined, // barcode changes go through BarcodeRepository, not a product update
      },
    });
  }

  async updateStatus(id: string, tenantId: string, status: RecordStatus): Promise<void> {
    await this.prisma.product.update({ where: { id, tenantId }, data: { status } });
  }
}

export class PrismaBarcodeRepository implements BarcodeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async existsByCode(tenantId: string, code: string): Promise<boolean> {
    const count = await this.prisma.barcode.count({ where: { tenantId, code } });
    return count > 0;
  }
  async addToProduct(
    tenantId: string,
    productId: string,
    code: string,
    isPrimary: boolean,
  ): Promise<void> {
    await this.prisma.barcode.create({ data: { tenantId, productId, code, isPrimary } });
  }
  async findProductIdByCode(tenantId: string, code: string): Promise<string | null> {
    const row = await this.prisma.barcode.findFirst({
      where: { tenantId, code },
      select: { productId: true },
    });
    return row?.productId ?? null;
  }
  async listForProduct(tenantId: string, productId: string): Promise<string[]> {
    const rows = await this.prisma.barcode.findMany({
      where: { tenantId, productId },
      select: { code: true },
    });
    return rows.map((r) => r.code);
  }
}

export class PrismaInventoryRepository implements InventoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByStoreAndProduct(storeId: string, productId: string) {
    const row = await this.prisma.inventory.findUnique({
      where: { storeId_productId: { storeId, productId } },
    });
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenantId,
      storeId: row.storeId,
      productId: row.productId,
      quantity: row.quantity.toString(),
      updatedAt: row.updatedAt,
    };
  }

  async list(tenantId: string, filter: InventoryListFilter): Promise<InventoryListResult> {
    const where = {
      tenantId,
      ...(filter.storeId ? { storeId: filter.storeId } : {}),
      ...(filter.search
        ? { product: { name: { contains: filter.search, mode: 'insensitive' as const } } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.inventory.findMany({
        where,
        include: { product: { select: { name: true, sku: true, minStock: true, maxStock: true } } },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.inventory.count({ where }),
    ]);
    const items: StockLevel[] = rows
      .map((row) => {
        const quantity = row.quantity.toString();
        const minStock = row.product.minStock.toString();
        const stockStatus = classifyStock(quantity, minStock);
        return {
          id: row.id,
          tenantId: row.tenantId,
          storeId: row.storeId,
          productId: row.productId,
          quantity,
          updatedAt: row.updatedAt,
          productName: row.product.name,
          sku: row.product.sku,
          minStock,
          maxStock: row.product.maxStock?.toString() ?? null,
          stockStatus,
        };
      })
      .filter((item) => !filter.stockStatus || item.stockStatus === filter.stockStatus);
    return { items, total, page: filter.page, pageSize: filter.pageSize };
  }

  async listLowStock(tenantId: string, storeId?: string): Promise<StockLevel[]> {
    const rows = await this.prisma.inventory.findMany({
      where: { tenantId, ...(storeId ? { storeId } : {}) },
      include: { product: { select: { name: true, sku: true, minStock: true, maxStock: true } } },
    });
    return rows
      .map((row) => {
        const quantity = row.quantity.toString();
        const minStock = row.product.minStock.toString();
        return {
          id: row.id,
          tenantId: row.tenantId,
          storeId: row.storeId,
          productId: row.productId,
          quantity,
          updatedAt: row.updatedAt,
          productName: row.product.name,
          sku: row.product.sku,
          minStock,
          maxStock: row.product.maxStock?.toString() ?? null,
          stockStatus: classifyStock(quantity, minStock),
        };
      })
      .filter((item) => item.stockStatus !== 'NORMAL');
  }

  async listMovements(
    tenantId: string,
    productId: string,
    limit: number,
  ): Promise<InventoryMovementRecord[]> {
    const rows = await this.prisma.inventoryMovement.findMany({
      where: { tenantId, productId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      storeId: r.storeId,
      productId: r.productId,
      type: r.type as InventoryMovementRecord['type'],
      quantityChange: r.quantityChange.toString(),
      balanceAfter: r.balanceAfter.toString(),
      reason: r.reason,
      createdById: r.createdById,
      createdAt: r.createdAt,
    }));
  }

  async applyMovement(input: ApplyMovementInput): Promise<ApplyMovementResult> {
    return this.prisma.$transaction((tx) => applyMovementInTx(tx, input));
  }
}

function classifyStock(quantity: string, minStock: string): StockLevel['stockStatus'] {
  if (compareDecimalStrings(quantity, '0', 3) <= 0) return 'OUT_OF_STOCK';
  if (compareDecimalStrings(quantity, minStock, 3) <= 0) return 'LOW_STOCK';
  return 'NORMAL';
}
