import { z } from 'zod';

/** Decimal money/quantity values are validated as TEXT, never coerced to a JS number. */
export const decimalString = (opts: { allowNegative?: boolean } = {}) =>
  z
    .string()
    .trim()
    .regex(
      opts.allowNegative ? /^-?\d+(\.\d{1,4})?$/ : /^\d+(\.\d{1,4})?$/,
      'Must be a plain decimal number (up to 4 decimal places)',
    );

const statusValues = ['ACTIVE', 'INACTIVE'] as const;

export const listQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(statusValues).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const updateStatusSchema = z.object({ status: z.enum(statusValues) });
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;

// ───────────────────────────── Category ─────────────────────────────

export const createCategorySchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = createCategorySchema.partial();
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

// ───────────────────────────── Sub-Department ─────────────────────────────

export const createSubDepartmentSchema = z.object({
  categoryId: z.string().trim().min(1),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
});
export type CreateSubDepartmentInput = z.infer<typeof createSubDepartmentSchema>;

export const updateSubDepartmentSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).optional(),
});
export type UpdateSubDepartmentInput = z.infer<typeof updateSubDepartmentSchema>;

export const subDepartmentListQuerySchema = listQuerySchema.extend({
  categoryId: z.string().trim().min(1).optional(),
});
export type SubDepartmentListQuery = z.infer<typeof subDepartmentListQuerySchema>;

// ───────────────────────────── Brand ─────────────────────────────

export const createBrandSchema = z.object({ name: z.string().trim().min(2).max(120) });
export type CreateBrandInput = z.infer<typeof createBrandSchema>;

export const updateBrandSchema = createBrandSchema.partial();
export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;

// ───────────────────────────── Product ─────────────────────────────

export const createProductSchema = z.object({
  name: z.string().trim().min(2).max(160),
  sku: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, 'SKU may contain letters, numbers, dot, dash, underscore only'),
  categoryId: z.string().trim().min(1),
  subDepartmentId: z.string().trim().min(1),
  brandId: z.string().trim().min(1).optional(),
  supplierId: z.string().trim().min(1).optional(),
  costPrice: decimalString(),
  sellingPrice: decimalString(),
  wholesalePrice: decimalString().optional(),
  taxRate: decimalString().default('0'),
  unit: z.string().trim().min(1).max(20).default('pcs'),
  minStock: decimalString().default('0'),
  maxStock: decimalString().optional(),
  imageUrl: z.string().trim().url().optional(),
  description: z.string().trim().max(2000).optional(),
  barcodes: z.array(z.string().trim().min(1).max(64)).max(10).optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema
  .omit({ sku: true, barcodes: true })
  .partial();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const productListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  categoryId: z.string().trim().min(1).optional(),
  subDepartmentId: z.string().trim().min(1).optional(),
  brandId: z.string().trim().min(1).optional(),
  status: z.enum(statusValues).optional(),
  page: z.coerce.number().int().positive().max(100_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const barcodeCodeParamSchema = z.object({ code: z.string().trim().min(1).max(64) });

// ───────────────────────────── Inventory ─────────────────────────────

export const inventoryListQuerySchema = z.object({
  storeId: z.string().trim().min(1).optional(),
  search: z.string().trim().max(120).optional(),
  stockStatus: z.enum(['OUT_OF_STOCK', 'LOW_STOCK', 'NORMAL']).optional(),
  page: z.coerce.number().int().positive().max(100_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
export type InventoryListQuery = z.infer<typeof inventoryListQuerySchema>;

export const adjustStockSchema = z.object({
  storeId: z.string().trim().min(1),
  productId: z.string().trim().min(1),
  /** Signed: positive to increase, negative to decrease. */
  quantityChange: decimalString({ allowNegative: true }),
  reason: z.string().trim().min(2).max(240),
});
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

export const openingStockSchema = z.object({
  storeId: z.string().trim().min(1),
  productId: z.string().trim().min(1),
  quantity: decimalString(),
});
export type OpeningStockInput = z.infer<typeof openingStockSchema>;
