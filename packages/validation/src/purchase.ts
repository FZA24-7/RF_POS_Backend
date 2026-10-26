import { z } from 'zod';
import { decimalString } from './catalog.js';

export const createSupplierSchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().max(32).optional(),
  email: z.string().trim().email().optional(),
  address: z.string().trim().max(240).optional(),
  /** What we already owed this supplier before using the system. */
  openingBalance: z
    .string()
    .trim()
    .regex(/^\d{1,14}(\.\d{1,2})?$/, 'Amount must be a plain number with at most 2 decimals')
    .optional(),
});
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

export const supplierListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
});
export type SupplierListQuery = z.infer<typeof supplierListQuerySchema>;

const paymentMethodValues = ['CASH', 'CARD', 'BANK_TRANSFER', 'CUSTOMER_CREDIT'] as const;

/**
 * A line item may discount by percent OR by a fixed amount, never both at
 * once - see docs/API.md "Phase 4: discount rules" for why this prevents
 * accidental double-discounting rather than disallowing discounts.
 */
const discountFields = {
  discountPercent: decimalString().optional(),
  discountAmount: decimalString().optional(),
};

const refineNoDoubleDiscount = <T extends { discountPercent?: string; discountAmount?: string }>(
  data: T,
  ctx: z.RefinementCtx,
) => {
  const hasPercent = data.discountPercent !== undefined && data.discountPercent !== '0';
  const hasAmount = data.discountAmount !== undefined && data.discountAmount !== '0';
  if (hasPercent && hasAmount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide either a discount percentage or a fixed discount amount, not both.',
      path: ['discountAmount'],
    });
  }
};

export const purchaseLineItemSchema = z
  .object({
    productId: z.string().trim().min(1),
    quantity: decimalString(),
    costPrice: decimalString(),
    taxRate: decimalString().default('0'),
    ...discountFields,
  })
  .superRefine(refineNoDoubleDiscount);
export type PurchaseLineItemInput = z.infer<typeof purchaseLineItemSchema>;

export const createPurchaseSchema = z
  .object({
    supplierId: z.string().trim().min(1),
    storeId: z.string().trim().min(1),
    invoiceNo: z.string().trim().min(1).max(64),
    purchaseDate: z.coerce.date(),
    items: z
      .array(purchaseLineItemSchema)
      .min(1, 'A purchase must have at least one line item')
      .max(200),
    ...discountFields,
    initialPayment: z
      .object({ amount: decimalString(), method: z.enum(paymentMethodValues) })
      .optional(),
  })
  .superRefine(refineNoDoubleDiscount);
export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;

export const purchaseListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  supplierId: z.string().trim().min(1).optional(),
  storeId: z.string().trim().min(1).optional(),
  paymentStatus: z.enum(['UNPAID', 'PARTIAL', 'PAID']).optional(),
  page: z.coerce.number().int().positive().max(100_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
export type PurchaseListQuery = z.infer<typeof purchaseListQuerySchema>;

export const recordPurchasePaymentSchema = z.object({
  amount: decimalString(),
  method: z.enum(paymentMethodValues),
});
export type RecordPurchasePaymentInputBody = z.infer<typeof recordPurchasePaymentSchema>;
