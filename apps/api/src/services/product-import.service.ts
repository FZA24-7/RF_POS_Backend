import { createProductSchema } from '@mafk/validation';
import type { Repositories } from '../domain/ports.js';
import type { ProductSummary } from '../domain/types.js';
import { ProductService } from './product.service.js';
import type { Actor } from './category.service.js';
import { DomainError } from '../domain/types.js';
import { parseCsvWithHeader, toCsv } from './csv.js';

export interface ImportRowError {
  row: number;
  errors: string[];
}

export interface ImportResult {
  totalRows: number;
  successCount: number;
  failedCount: number;
  rowErrors: ImportRowError[];
  createdProductIds: string[];
}

const REQUIRED_COLUMNS = [
  'name',
  'sku',
  'categoryId',
  'subDepartmentId',
  'costPrice',
  'sellingPrice',
] as const;

/**
 * Row-level semantics (explicitly documented, per the spec's "do not
 * partially import invalid data unless the behavior is explicitly
 * transactional and documented" requirement): each CSV row is independent.
 * A valid row is created as its own single `ProductService.create` call
 * (which is itself atomic - one product, created or not). An invalid row is
 * REJECTED and reported with its row number and every validation error found
 * for it; it is never partially written, and it never blocks other valid
 * rows in the same file from importing. The file as a whole is therefore
 * NOT a single all-or-nothing transaction - that is a deliberate choice
 * (so one typo in a 500-row file doesn't block the other 499), not an
 * accident, and is reported back via `ImportResult` so the caller always
 * knows exactly what happened.
 */
export class ProductImportService {
  private readonly productService: ProductService;

  constructor(private readonly repos: Repositories) {
    this.productService = new ProductService(repos);
  }

  async importCsv(actor: Actor, csvText: string): Promise<ImportResult> {
    const rows = parseCsvWithHeader(csvText);
    const result: ImportResult = {
      totalRows: rows.length,
      successCount: 0,
      failedCount: 0,
      rowErrors: [],
      createdProductIds: [],
    };

    if (rows.length > 0) {
      const columns = Object.keys(rows[0]!);
      const missing = REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
      if (missing.length > 0) {
        throw new DomainError(
          'VALIDATION_ERROR',
          `CSV is missing required column(s): ${missing.join(', ')}`,
          422,
        );
      }
    }

    for (const [index, rawRow] of rows.entries()) {
      const rowNumber = index + 2; // +1 for 1-based, +1 for the header row
      const candidate = {
        name: rawRow.name,
        sku: rawRow.sku,
        categoryId: rawRow.categoryId,
        subDepartmentId: rawRow.subDepartmentId,
        brandId: rawRow.brandId || undefined,
        supplierId: rawRow.supplierId || undefined,
        costPrice: rawRow.costPrice,
        sellingPrice: rawRow.sellingPrice,
        wholesalePrice: rawRow.wholesalePrice || undefined,
        taxRate: rawRow.taxRate || '0',
        unit: rawRow.unit || 'pcs',
        minStock: rawRow.minStock || '0',
        maxStock: rawRow.maxStock || undefined,
        description: rawRow.description || undefined,
        barcodes: rawRow.barcode ? [rawRow.barcode] : undefined,
      };

      const parsed = createProductSchema.safeParse(candidate);
      if (!parsed.success) {
        result.failedCount += 1;
        result.rowErrors.push({
          row: rowNumber,
          errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
        continue;
      }

      try {
        const created = await this.productService.create(actor, parsed.data);
        result.successCount += 1;
        result.createdProductIds.push(created.id);
      } catch (err) {
        result.failedCount += 1;
        result.rowErrors.push({
          row: rowNumber,
          errors: [err instanceof DomainError ? err.message : 'Unknown error creating product.'],
        });
      }
    }

    await this.repos.auditLogs.record({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'PRODUCTS_IMPORTED',
      entity: 'Product',
      metadata: {
        totalRows: result.totalRows,
        successCount: result.successCount,
        failedCount: result.failedCount,
      },
    });

    return result;
  }

  async exportCsv(tenantId: string): Promise<string> {
    const header = [
      'name',
      'sku',
      'categoryId',
      'subDepartmentId',
      'brandId',
      'costPrice',
      'sellingPrice',
      'wholesalePrice',
      'taxRate',
      'unit',
      'minStock',
      'maxStock',
      'status',
    ];
    const all: ProductSummary[] = [];
    let page = 1;
    // Export respects tenant scope implicitly (list() is always tenant-scoped) - paginate through everything.
    for (;;) {
      const { items, total } = await this.repos.products.list(tenantId, { page, pageSize: 200 });
      all.push(...items);
      if (all.length >= total || items.length === 0) break;
      page += 1;
    }
    const rows = all.map((p) => [
      p.name,
      p.sku,
      p.categoryId,
      p.subDepartmentId,
      p.brandId ?? '',
      p.costPrice,
      p.sellingPrice,
      p.wholesalePrice ?? '',
      p.taxRate,
      p.unit,
      p.minStock,
      p.maxStock ?? '',
      p.status,
    ]);
    return toCsv([header, ...rows]);
  }
}
