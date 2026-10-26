import { z } from 'zod';
import { tenderMethods } from './sale.js';

const money = z
  .string()
  .trim()
  .regex(/^\d{1,14}(\.\d{1,2})?$/, 'Amount must be a plain number with at most 2 decimals');
const positiveMoney = money.refine((v) => /[1-9]/.test(v), 'Amount must be greater than zero');
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));
// A real calendar day: "2026-02-30" has the right shape but does not exist (it would silently roll over to March).
const isRealDay = (v: string): boolean => {
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine(isRealDay, 'Not a real calendar date');
const pageFields = {
  page: z.coerce.number().int().positive().max(100_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
};

// ── Customers ────────────────────────────────────────────────────────────────
export const createCustomerSchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: optionalText(32),
  email: z.string().trim().email().optional(),
  address: optionalText(240),
  customerType: z.enum(['RETAIL', 'WHOLESALE']).default('RETAIL'),
  openingBalance: money.default('0'),
  /** Maximum amount the customer may owe. Empty/0 = sales on account are NOT allowed for this customer. */
  creditLimit: money.optional(),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    phone: optionalText(32).nullable(),
    email: z.string().trim().email().nullable(),
    address: optionalText(240).nullable(),
    customerType: z.enum(['RETAIL', 'WHOLESALE']),
    creditLimit: money.nullable(),
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const customerListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  withBalanceOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  ...pageFields,
});
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;

export const customerPaymentSchema = z.object({
  amount: positiveMoney,
  method: z.enum(tenderMethods),
  reference: optionalText(64),
  note: optionalText(300),
});
export type CustomerPaymentInput = z.infer<typeof customerPaymentSchema>;

// ── Supplier ledger (opening balance on create) ──────────────────────────────
export const supplierOpeningBalanceSchema = z.object({ openingBalance: money.optional() });

// ── Expenses ─────────────────────────────────────────────────────────────────
export const expensePaymentMethods = ['CASH', 'CARD', 'BANK_TRANSFER'] as const;
export const createExpenseSchema = z.object({
  storeId: z.string().trim().min(1),
  category: z.string().trim().min(2).max(60),
  description: optionalText(300),
  amount: positiveMoney,
  expenseDate: ymd,
  method: z.enum(expensePaymentMethods),
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = createExpenseSchema
  .omit({ storeId: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export const expenseListQuerySchema = z.object({
  storeId: z.string().trim().min(1).optional(),
  category: z.string().trim().max(60).optional(),
  from: ymd.optional(),
  to: ymd.optional(),
  ...pageFields,
});
export type ExpenseListQuery = z.infer<typeof expenseListQuerySchema>;

// ── Employees ────────────────────────────────────────────────────────────────
export const createEmployeeSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  phone: optionalText(32),
  designation: optionalText(80),
  nationalId: optionalText(32),
  hireDate: ymd.optional(),
  salary: money.optional(),
  storeId: z.string().trim().min(1).optional(),
  /** Link to an existing login user of the same tenant (an employee does not need to log in). */
  userId: z.string().trim().min(1).optional(),
});
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = z
  .object({
    fullName: z.string().trim().min(2).max(160),
    phone: optionalText(32).nullable(),
    designation: optionalText(80).nullable(),
    nationalId: optionalText(32).nullable(),
    hireDate: ymd.nullable(),
    salary: money.nullable(),
    storeId: z.string().trim().min(1).nullable(),
    userId: z.string().trim().min(1).nullable(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'TERMINATED']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const employeeListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'TERMINATED']).optional(),
  storeId: z.string().trim().min(1).optional(),
  ...pageFields,
});
export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;

// ── Reports & analytics ──────────────────────────────────────────────────────
/** Dates are calendar days in the TENANT's time zone. At most 366 days per request. */
export const reportRangeSchema = z
  .object({
    from: ymd,
    to: ymd,
    storeId: z.string().trim().min(1).optional(),
  })
  .refine((v) => v.from <= v.to, { message: '"from" must not be after "to"', path: ['to'] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 < 366, {
    message: 'Range cannot exceed 366 days',
    path: ['to'],
  });
export type ReportRangeQuery = z.infer<typeof reportRangeSchema>;

export const reportExportQuerySchema = z
  .object({
    from: ymd,
    to: ymd,
    storeId: z.string().trim().min(1).optional(),
    format: z.enum(['json', 'csv']).default('json'),
    limit: z.coerce.number().int().positive().max(100).default(10),
  })
  .refine((v) => v.from <= v.to, { message: '"from" must not be after "to"', path: ['to'] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 < 366, {
    message: 'Range cannot exceed 366 days',
    path: ['to'],
  });
export type ReportExportQuery = z.infer<typeof reportExportQuerySchema>;

export const stockValuationQuerySchema = z.object({
  storeId: z.string().trim().min(1).optional(),
  format: z.enum(['json', 'csv']).default('json'),
});
export type StockValuationQuery = z.infer<typeof stockValuationQuerySchema>;
