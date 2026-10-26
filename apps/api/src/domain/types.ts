import type { SystemRole } from '@mafk/shared';

/** The authenticated identity, independent of how it was persisted. */
export interface AuthUser {
  id: string;
  tenantId: string | null;
  storeId: string | null;
  roleId: string;
  systemRole: SystemRole;
  loginId: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  passwordHash: string;
}

export interface TenantSummary {
  id: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
}

export interface RoleSummary {
  id: string;
  tenantId: string | null;
  systemRole: SystemRole;
  permissionKeys: readonly string[];
}

/** The fully resolved security context attached to every authenticated request. */
export interface SecurityContext {
  userId: string;
  tenantId: string | null;
  storeId: string | null;
  systemRole: SystemRole;
  permissions: ReadonlySet<string>;
  sessionId: string;
}

export interface CreateSessionInput {
  userId: string;
  tenantId: string | null;
  deviceId?: string | null;
  refreshTokenHash: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  expiresAt: Date;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tenantId: string | null;
  refreshTokenHash: string;
  previousRefreshTokenHash: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface RecordLoginAttemptInput {
  loginId: string;
  userId: string | null;
  tenantId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  success: boolean;
  failureReason?: string;
}

export interface AuditLogInput {
  tenantId: string | null;
  userId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

// ───────────────────────────── Phase 2: Master Admin domain types ─────────────────────────────

export interface StoreSummary {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
}

export interface LicenseSummary {
  id: string;
  tenantId: string;
  planCode: string;
  status: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'REVOKED';
  startsAt: Date;
  expiresAt: Date;
  maxUsers: number;
  maxDevices: number;
  maxStores: number;
  enabledModules: readonly string[];
  createdAt: Date;
}

export interface TenantDetail extends TenantSummary {
  legalName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  /** Optional business logo URL/data-URI shown on printed documents. */
  logoUrl?: string | null;
  /** IANA zone (e.g. Asia/Karachi): report days are calendar days in this zone. */
  timezone?: string;
  currency?: string;
  createdAt: Date;
}

export interface TenantListFilter {
  search?: string;
  status?: TenantSummary['status'];
  page: number;
  pageSize: number;
}

export interface TenantListResult {
  items: TenantDetail[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserSummary {
  id: string;
  tenantId: string | null;
  loginId: string;
  displayName: string;
  email: string | null;
  systemRole: SystemRole;
  status: 'ACTIVE' | 'DISABLED';
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface AuditLogEntry {
  id: string;
  tenantId: string | null;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface ProvisionTenantInput {
  code: string;
  name: string;
  legalName?: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  currency?: string;
  timezone?: string;
  defaultStoreName: string;
  masterAdmin: { loginId: string; passwordHash: string; displayName: string; email?: string };
  license: {
    planCode: string;
    expiresAt: Date;
    maxUsers: number;
    maxDevices: number;
    maxStores: number;
    enabledModules: readonly string[];
  };
}

export interface ProvisionTenantResult {
  tenantId: string;
  storeId: string;
  clientAdminUserId: string;
  licenseId: string;
}

/** Thrown by TenantProvisioningRepository when a uniqueness check fails BEFORE any row is written. */
export class ProvisioningConflictError extends Error {
  constructor(
    public readonly field: 'code' | 'loginId',
    message: string,
  ) {
    super(message);
    this.name = 'ProvisioningConflictError';
  }
}

export interface PlatformStats {
  tenants: { total: number; active: number; suspended: number; archived: number };
  licenses: {
    total: number;
    active: number;
    expiringSoon: number;
    expired: number;
    suspended: number;
    revoked: number;
  };
  users: { total: number; active: number; disabled: number };
  databaseReachable: boolean;
}

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number = 400,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

// ───────────────────────────── Phase 3: Catalog & Inventory domain types ─────────────────────────────

export type RecordStatus = 'ACTIVE' | 'INACTIVE';

export interface CategorySummary {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: RecordStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubDepartmentSummary {
  id: string;
  tenantId: string;
  categoryId: string;
  name: string;
  description: string | null;
  status: RecordStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface BrandSummary {
  id: string;
  tenantId: string;
  name: string;
  status: RecordStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Money fields are kept as decimal STRINGS end-to-end (never parsed to a JS
 * `number`) - this is what "never use floating point as the authoritative
 * representation" means in a Prisma-less context: the value is validated by
 * regex (see `@mafk/validation`'s `decimalString`) and passed through
 * unchanged. Phase 4/5 (Purchases/POS), which actually need to add and
 * multiply these values, will use Prisma's `Decimal` type directly once the
 * engine is unblocked - no arithmetic on money happens anywhere in Phase 3.
 */
export interface ProductSummary {
  id: string;
  tenantId: string;
  name: string;
  sku: string;
  categoryId: string;
  subDepartmentId: string;
  brandId: string | null;
  supplierId: string | null;
  costPrice: string;
  sellingPrice: string;
  wholesalePrice: string | null;
  taxRate: string;
  unit: string;
  minStock: string;
  maxStock: string | null;
  imageUrl: string | null;
  description: string | null;
  status: RecordStatus;
  barcodes: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductListFilter {
  search?: string;
  categoryId?: string;
  subDepartmentId?: string;
  brandId?: string;
  status?: RecordStatus;
  page: number;
  pageSize: number;
}

export interface ProductListResult {
  items: ProductSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export type InventoryMovementType =
  | 'OPENING'
  | 'PURCHASE'
  | 'SALE'
  | 'SALE_RETURN'
  | 'PURCHASE_RETURN'
  | 'ADJUSTMENT'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT';

export interface InventoryRecord {
  id: string;
  tenantId: string;
  storeId: string;
  productId: string;
  quantity: string;
  updatedAt: Date;
}

export interface InventoryMovementRecord {
  id: string;
  tenantId: string;
  storeId: string;
  productId: string;
  type: InventoryMovementType;
  quantityChange: string;
  balanceAfter: string;
  reason: string | null;
  createdById: string | null;
  createdAt: Date;
}

export interface StockLevel extends InventoryRecord {
  productName: string;
  sku: string;
  minStock: string;
  maxStock: string | null;
  stockStatus: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'NORMAL';
}

export interface InventoryListFilter {
  storeId?: string;
  search?: string;
  stockStatus?: StockLevel['stockStatus'];
  page: number;
  pageSize: number;
}

export interface InventoryListResult {
  items: StockLevel[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApplyMovementInput {
  tenantId: string;
  storeId: string;
  productId: string;
  type: InventoryMovementType;
  /** Signed decimal string - positive increases stock, negative decreases it. */
  quantityChange: string;
  reason?: string;
  createdById: string | null;
  referenceType?: string;
  referenceId?: string;
  /** Unit cost at the time of the movement (purchases); stored on the movement row. */
  unitCost?: string;
}

export interface ApplyMovementResult {
  inventory: InventoryRecord;
  movement: InventoryMovementRecord;
}

export class InsufficientStockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientStockError';
  }
}

// ───────────────────────────── Phase 4: Supplier & Purchase domain types ─────────────────────────────

export interface SupplierSummary {
  id: string;
  tenantId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  /** What we already owed this supplier before using the system. */
  openingBalance: string;
  isActive: boolean;
  createdAt: Date;
}

export type PaymentMethod = 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'CUSTOMER_CREDIT';
export type PurchasePaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export interface PurchaseLineInput {
  productId: string;
  quantity: string;
  costPrice: string;
  /** Mutually exclusive with discountAmount - see docs/API.md "Phase 4: discount rules". */
  discountPercent?: string;
  discountAmount?: string;
  taxRate?: string;
}

export interface PurchaseLineResult extends PurchaseLineInput {
  id: string;
  productName: string;
  sku: string;
  barcodes: string[];
  discountPercent: string;
  discountAmount: string;
  taxRate: string;
  taxAmount: string;
  lineTotal: string;
}

/**
 * An audit record that MUST commit or roll back together with the operation it
 * describes. The repository performing the atomic operation writes it inside
 * its own database transaction (entity is always `Purchase`, entityId the
 * purchase id; the repository also adds `purchaseNo`, `total`, and for payments
 * `paymentStatusAfter` to the metadata, since only it knows those values at
 * write time). Writing the audit AFTER the transaction commits would let a
 * failed audit write leave an un-audited committed purchase.
 */
export interface TransactionalAudit {
  userId: string | null;
  action: string;
  metadata?: Record<string, unknown>;
}

export interface RecordPurchaseInput {
  tenantId: string;
  storeId: string;
  supplierId: string;
  invoiceNo: string;
  purchaseDate: Date;
  items: PurchaseLineInput[];
  /** Mutually exclusive with purchaseDiscountAmount. */
  purchaseDiscountPercent?: string;
  purchaseDiscountAmount?: string;
  initialPayment?: { amount: string; method: PaymentMethod };
  createdById: string;
  /** Written inside the same transaction as the purchase, its stock movements and the initial payment. */
  audit: TransactionalAudit;
}

export interface PurchaseSummary {
  id: string;
  tenantId: string;
  storeId: string;
  supplierId: string;
  purchaseNo: string;
  invoiceNo: string;
  purchaseDate: Date;
  subtotal: string;
  discountPercent: string;
  discountAmount: string;
  taxTotal: string;
  total: string;
  paidAmount: string;
  paymentStatus: PurchasePaymentStatus;
  createdById: string;
  createdAt: Date;
}

export interface PurchaseDetail extends PurchaseSummary {
  items: PurchaseLineResult[];
}

export interface PurchaseListFilter {
  search?: string;
  supplierId?: string;
  storeId?: string;
  paymentStatus?: PurchasePaymentStatus;
  page: number;
  pageSize: number;
}

export interface PurchaseListResult {
  items: PurchaseSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RecordPurchasePaymentInput {
  purchaseId: string;
  tenantId: string;
  amount: string;
  method: PaymentMethod;
  createdById: string;
  /** Written inside the same transaction as the supplier payment and the purchase balance update. */
  audit: TransactionalAudit;
}

/** Thrown when a purchase references a supplier/store/product that doesn't exist or isn't in this tenant. */
export class InvalidPurchaseRelationshipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPurchaseRelationshipError';
  }
}

/** Thrown on a duplicate (tenantId, supplierId, invoiceNo) - the idempotency/duplicate-submission guard. */
export class DuplicatePurchaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicatePurchaseError';
  }
}

/** Thrown when a payment would exceed the purchase's outstanding balance. */
/**
 * Thrown when a concurrent writer changed the same purchase between our read and
 * our write (optimistic-concurrency check on payments). The caller should retry.
 */
export class PurchaseConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurchaseConcurrencyError';
  }
}

export class PaymentExceedsBalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentExceedsBalanceError';
  }
}

// ───────────────────────────── Phase 4: Purchase invoice ─────────────────────────────

/**
 * Everything the purchase invoice screen / print view / PDF needs, assembled
 * ONLY from saved records (tenant, branch, supplier, creating user, and the
 * stored Purchase + PurchaseItems). Nothing here is recomputed from the
 * client's original input: `amountPaid`/`outstanding` come from the stored
 * `paidAmount` and `total`.
 */
export interface PurchaseInvoice {
  business: {
    name: string;
    legalName: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    logoUrl: string | null;
  };
  branch: { id: string; code: string; name: string };
  supplier: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
  };
  createdBy: { id: string; displayName: string } | null;
  purchase: PurchaseDetail;
  amountPaid: string;
  outstanding: string;
}

// ───────────────────────────── Phase 5: POS sales, refunds, receipts ─────────────────────────────

export type SaleStatus = 'COMPLETED' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'VOID';
/** Methods a SALE / REFUND may use. CUSTOMER_CREDIT = on the customer's account (Phase 6). */
export type TenderMethod = 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'CUSTOMER_CREDIT';
/** Methods that move real money (customer payments, expenses). */
export type CashMethod = 'CASH' | 'CARD' | 'BANK_TRANSFER';

/** A priced, fully computed sale line, ready to be written. All money is a decimal string. */
export interface SaleLineInput {
  productId: string;
  productName: string;
  sku: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  discountAmount: string;
  taxRate: string;
  taxAmount: string;
  /** taxable + tax, where taxable already includes this line's share of the cart discount. */
  lineTotal: string;
}

export interface SalePaymentInput {
  method: TenderMethod;
  amount: string;
  reference?: string;
}

export interface RecordSaleInput {
  tenantId: string;
  storeId: string;
  clientRequestId: string;
  cashierId: string;
  items: SaleLineInput[];
  subtotal: string;
  itemDiscountTotal: string;
  cartDiscountPercent: string;
  cartDiscountAmount: string;
  taxTotal: string;
  grandTotal: string;
  payments: SalePaymentInput[];
  paidTotal: string;
  changeDue: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
  /** Written inside the same transaction as the sale, its stock movements and its payments. */
  audit: TransactionalAudit;
}

export interface SaleItemRecord extends SaleLineInput {
  id: string;
  returnedQuantity: string;
}

export interface SalePaymentRecord {
  id: string;
  method: TenderMethod;
  amount: string;
  reference: string | null;
}

export interface SaleReturnItemRecord {
  id: string;
  saleItemId: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: string;
  unitRefund: string;
  lineTotal: string;
}

export interface SaleReturnDetail {
  id: string;
  tenantId: string;
  storeId: string;
  saleId: string;
  returnNo: string;
  processedById: string;
  refundMethod: TenderMethod;
  refundTotal: string;
  reason: string | null;
  createdAt: Date;
  items: SaleReturnItemRecord[];
}

export interface SaleSummary {
  id: string;
  tenantId: string;
  storeId: string;
  invoiceNo: string;
  cashierId: string;
  status: SaleStatus;
  grandTotal: string;
  paidTotal: string;
  changeDue: string;
  customerId: string | null;
  customerName: string | null;
  soldAt: Date;
}

export interface SaleDetail extends SaleSummary {
  clientRequestId: string | null;
  customerPhone: string | null;
  subtotal: string;
  itemDiscountTotal: string;
  cartDiscountPercent: string;
  cartDiscountAmount: string;
  taxTotal: string;
  notes: string | null;
  items: SaleItemRecord[];
  payments: SalePaymentRecord[];
  returns: SaleReturnDetail[];
}

export interface RecordSaleResult {
  sale: SaleDetail;
  /** True when the clientRequestId had already been used: the stored sale is returned and nothing new is written. */
  replayed: boolean;
}

export interface SaleListFilter {
  search?: string;
  storeId?: string;
  customerId?: string;
  status?: SaleStatus;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export interface SaleListResult {
  items: SaleSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RecordReturnInput {
  tenantId: string;
  saleId: string;
  processedById: string;
  refundMethod: TenderMethod;
  reason?: string;
  /** Raw requested lines; the repository computes refunds in-transaction from the stored sale (race-free). */
  items: { saleItemId: string; quantity: string }[];
  audit: TransactionalAudit;
}

export class SaleNotFoundError extends Error {
  constructor(message = 'Sale not found.') {
    super(message);
    this.name = 'SaleNotFoundError';
  }
}
export class InvalidSaleRelationshipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSaleRelationshipError';
  }
}
export class SaleConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaleConcurrencyError';
  }
}
export class ReturnNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReturnNotAllowedError';
  }
}

/** One printable document (a sale receipt or a refund slip) independent of paper size. */
export interface ReceiptDocument {
  kind: 'SALE' | 'REFUND';
  business: {
    name: string;
    legalName: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  };
  branch: { code: string; name: string };
  title: string;
  number: string;
  /** For refunds: the original invoice. */
  relatedNumber: string | null;
  date: Date;
  cashier: string | null;
  customer: string | null;
  lines: {
    name: string;
    sku: string;
    quantity: string;
    unitPrice: string;
    discount: string;
    lineTotal: string;
  }[];
  totals: { label: string; value: string; strong?: boolean }[];
  payments: { label: string; value: string }[];
  footer: string;
}

// ───────────────────────────── Phase 6: customers, ledgers, expenses, employees, reports ─────────────────────────────

export class CustomerOverpaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomerOverpaymentError';
  }
}
export class CustomerNotFoundError extends Error {
  constructor(message = 'Customer not found.') {
    super(message);
    this.name = 'CustomerNotFoundError';
  }
}
export class CreditLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreditLimitExceededError';
  }
}

export interface CustomerSummary {
  id: string;
  tenantId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  customerType: 'RETAIL' | 'WHOLESALE';
  openingBalance: string;
  /** null or 0 = no credit allowed. */
  creditLimit: string | null;
  isActive: boolean;
  createdAt: Date;
}

export interface CustomerWithBalance extends CustomerSummary {
  /** What the customer owes (opening + credit sales - credit refunds - payments). Negative = store owes them. */
  balance: string;
}

export interface CreateCustomerRecord {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  customerType: 'RETAIL' | 'WHOLESALE';
  openingBalance: string;
  creditLimit?: string;
}

export interface UpdateCustomerRecord {
  name?: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  customerType?: 'RETAIL' | 'WHOLESALE';
  creditLimit?: string | null;
  isActive?: boolean;
}

export interface CustomerListFilter {
  search?: string;
  isActive?: boolean;
  withBalanceOnly?: boolean;
  page: number;
  pageSize: number;
}
export interface CustomerListResult {
  items: CustomerWithBalance[];
  total: number;
  page: number;
  pageSize: number;
}

/** One line of a running ledger. `increase` raises the balance (what is owed), `decrease` lowers it. */
export interface LedgerEntry {
  date: Date;
  type:
    | 'OPENING'
    | 'CREDIT_SALE'
    | 'CREDIT_REFUND'
    | 'CUSTOMER_PAYMENT'
    | 'PURCHASE'
    | 'SUPPLIER_PAYMENT';
  reference: string;
  description: string | null;
  increase: string;
  decrease: string;
  balance: string;
}

export interface Ledger {
  openingBalance: string;
  entries: LedgerEntry[];
  balance: string;
}

export interface RecordCustomerPaymentInput {
  tenantId: string;
  customerId: string;
  amount: string;
  method: CashMethod;
  reference?: string;
  note?: string;
  createdById: string;
  audit: TransactionalAudit;
}
export interface CustomerPaymentRecord {
  id: string;
  customerId: string;
  amount: string;
  method: CashMethod;
  reference: string | null;
  note: string | null;
  paidAt: Date;
}

export interface SupplierLedgerSummary {
  supplierId: string;
  openingBalance: string;
}

// Expenses
export interface ExpenseRecord {
  id: string;
  tenantId: string;
  storeId: string;
  category: string;
  description: string | null;
  amount: string;
  expenseDate: Date;
  method: CashMethod;
  createdById: string;
  createdAt: Date;
}
export interface CreateExpenseRecord {
  tenantId: string;
  storeId: string;
  category: string;
  description?: string;
  amount: string;
  expenseDate: Date;
  method: CashMethod;
  createdById: string;
  audit: TransactionalAudit;
}
export interface UpdateExpenseRecord {
  category?: string;
  description?: string;
  amount?: string;
  expenseDate?: Date;
  method?: CashMethod;
}
export interface ExpenseListFilter {
  storeId?: string;
  category?: string;
  from?: Date;
  /** Exclusive upper bound. */
  to?: Date;
  page: number;
  pageSize: number;
}
export interface ExpenseListResult {
  items: ExpenseRecord[];
  total: number;
  /** Sum over ALL matching rows (not just this page). */
  totalAmount: string;
  page: number;
  pageSize: number;
}

// Employees
export type EmployeeStatusValue = 'ACTIVE' | 'INACTIVE' | 'TERMINATED';
export interface EmployeeRecord {
  id: string;
  tenantId: string;
  userId: string | null;
  storeId: string | null;
  fullName: string;
  phone: string | null;
  designation: string | null;
  nationalId: string | null;
  hireDate: Date | null;
  salary: string | null;
  status: EmployeeStatusValue;
  createdAt: Date;
}
export interface CreateEmployeeRecord {
  fullName: string;
  phone?: string;
  designation?: string;
  nationalId?: string;
  hireDate?: Date;
  salary?: string;
  storeId?: string;
  userId?: string;
}
export interface UpdateEmployeeRecord {
  fullName?: string;
  phone?: string | null;
  designation?: string | null;
  nationalId?: string | null;
  hireDate?: Date | null;
  salary?: string | null;
  storeId?: string | null;
  userId?: string | null;
  status?: EmployeeStatusValue;
}
export interface EmployeeListFilter {
  search?: string;
  status?: EmployeeStatusValue;
  storeId?: string;
  page: number;
  pageSize: number;
}
export interface EmployeeListResult {
  items: EmployeeRecord[];
  total: number;
  page: number;
  pageSize: number;
}
export class EmployeeUserConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmployeeUserConflictError';
  }
}

// Reports
export interface ReportRange {
  /** Inclusive start instant. */
  start: Date;
  /** Exclusive end instant. */
  end: Date;
  storeId?: string;
  timeZone: string;
}

export interface SalesSummary {
  saleCount: number;
  /** sum of line subtotals before any discount. */
  grossSales: string;
  itemDiscounts: string;
  cartDiscounts: string;
  tax: string;
  /** sum of grand totals of sales made in the range (before refunds). */
  netSales: string;
  refundCount: number;
  /** refunds PROCESSED in the range (against any sale). */
  refunds: string;
  /** netSales - refunds. */
  netAfterRefunds: string;
  averageSale: string;
  paymentsByMethod: { method: TenderMethod; amount: string }[];
  refundsByMethod: { method: TenderMethod; amount: string }[];
}

export interface DailyPoint {
  date: string;
  saleCount: number;
  netSales: string;
}
export interface HourlyPoint {
  hour: number;
  saleCount: number;
  netSales: string;
}
export interface ProductPerformance {
  productId: string;
  productName: string;
  sku: string;
  quantitySold: string;
  quantityReturned: string;
  revenue: string;
}
export interface CashierPerformance {
  cashierId: string;
  saleCount: number;
  netSales: string;
}
export interface CategoryPerformance {
  categoryId: string;
  categoryName: string;
  quantitySold: string;
  revenue: string;
}

export interface ProfitLoss {
  /** Sales ex-tax and net of discounts, after removing refunded units' share. */
  revenue: string;
  /** unitCost x units kept (sold - returned). */
  costOfGoods: string;
  grossProfit: string;
  expenses: string;
  netProfit: string;
  expensesByCategory: { category: string; amount: string }[];
}

export interface StockValuationRow {
  storeId: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: string;
  costPrice: string;
  sellingPrice: string;
  costValue: string;
  retailValue: string;
}
export interface StockValuation {
  rows: StockValuationRow[];
  totalCostValue: string;
  totalRetailValue: string;
}

export interface BalanceRow {
  id: string;
  name: string;
  phone: string | null;
  balance: string;
}
export interface Outstanding {
  rows: BalanceRow[];
  total: string;
}
