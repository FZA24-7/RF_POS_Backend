export interface AuthUser {
  id: string;
  tenantId: string | null;
  loginId: string;
  displayName: string;
  systemRole: string;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
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

export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

export interface TenantDetail {
  id: string;
  code: string;
  name: string;
  status: TenantStatus;
  legalName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  createdAt: string;
}

export interface TenantListResult {
  items: TenantDetail[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StoreSummary {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
}

export type LicenseStatus = 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'REVOKED';

export interface LicenseSummary {
  id: string;
  tenantId: string;
  planCode: string;
  status: LicenseStatus;
  startsAt: string;
  expiresAt: string;
  maxUsers: number;
  maxDevices: number;
  maxStores: number;
  enabledModules: string[];
  createdAt: string;
}

export interface UserSummary {
  id: string;
  tenantId: string | null;
  loginId: string;
  displayName: string;
  email: string | null;
  systemRole: string;
  status: 'ACTIVE' | 'DISABLED';
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  tenantId: string | null;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// ───────────────────────────── Phase 3: Catalog & Inventory ─────────────────────────────

export type RecordStatus = 'ACTIVE' | 'INACTIVE';

export interface CategorySummary {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SubDepartmentSummary {
  id: string;
  tenantId: string;
  categoryId: string;
  name: string;
  description: string | null;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BrandSummary {
  id: string;
  tenantId: string;
  name: string;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProductSummary {
  id: string;
  tenantId: string;
  name: string;
  sku: string;
  categoryId: string;
  subDepartmentId: string;
  brandId: string | null;
  costPrice: string;
  sellingPrice: string;
  wholesalePrice: string | null;
  taxRate: string;
  unit: string;
  minStock: string;
  maxStock: string | null;
  status: RecordStatus;
  barcodes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductListResult {
  items: ProductSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export type StockStatus = 'OUT_OF_STOCK' | 'LOW_STOCK' | 'NORMAL';

export interface StockLevel {
  id: string;
  tenantId: string;
  storeId: string;
  productId: string;
  quantity: string;
  productName: string;
  sku: string;
  minStock: string;
  maxStock: string | null;
  stockStatus: StockStatus;
  updatedAt: string;
}

export interface InventoryMovement {
  id: string;
  type: string;
  quantityChange: string;
  balanceAfter: string;
  reason: string | null;
  createdAt: string;
}

export interface CreateTenantPayload {
  code: string;
  name: string;
  defaultStoreName: string;
  masterAdmin: { loginId: string; password: string; displayName: string };
  license: {
    planCode: string;
    expiresAt: string;
    maxUsers: number;
    maxDevices: number;
    maxStores: number;
    enabledModules: string[];
  };
}

// ───────────────────────────── Phase 4: Suppliers & Purchases ─────────────────────────────

export interface SupplierSummary {
  openingBalance: string;
  id: string;
  tenantId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: string;
}

export type PaymentMethod = 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'CUSTOMER_CREDIT';
export type PurchasePaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export interface PurchaseLineResult {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  barcodes: string[];
  quantity: string;
  costPrice: string;
  discountPercent: string;
  discountAmount: string;
  taxRate: string;
  taxAmount: string;
  lineTotal: string;
}

export interface PurchaseSummary {
  id: string;
  storeId: string;
  supplierId: string;
  purchaseNo: string;
  invoiceNo: string;
  purchaseDate: string;
  subtotal: string;
  discountPercent: string;
  discountAmount: string;
  taxTotal: string;
  total: string;
  paidAmount: string;
  paymentStatus: PurchasePaymentStatus;
  createdById: string;
  createdAt: string;
}

export interface PurchaseDetail extends PurchaseSummary {
  items: PurchaseLineResult[];
}

export interface PurchaseListResult {
  items: PurchaseSummary[];
  total: number;
  page: number;
  pageSize: number;
}

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

// ───────────────────────────── Phase 5: POS, sales, refunds, receipts ─────────────────────────────

export type SaleStatus = 'COMPLETED' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'VOID';
export type TenderMethod = 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'CUSTOMER_CREDIT';
export type CashMethod = 'CASH' | 'CARD' | 'BANK_TRANSFER';
export type ReceiptFormat = '58mm' | '80mm' | 'a4';

export interface PosProduct {
  id: string;
  name: string;
  sku: string;
  barcodes: string[];
  unit: string;
  sellingPrice: string;
  taxRate: string;
  stock: string;
}

export interface SaleItemRecord {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: string;
  returnedQuantity: string;
  unitPrice: string;
  discountPercent: string;
  discountAmount: string;
  taxRate: string;
  taxAmount: string;
  lineTotal: string;
}

export interface SaleReturnItemRecord {
  id: string;
  saleItemId: string;
  productName: string;
  sku: string;
  quantity: string;
  unitRefund: string;
  lineTotal: string;
}

export interface SaleReturnDetail {
  id: string;
  saleId: string;
  returnNo: string;
  refundMethod: TenderMethod;
  refundTotal: string;
  reason: string | null;
  createdAt: string;
  items: SaleReturnItemRecord[];
}

export interface SaleSummary {
  id: string;
  invoiceNo: string;
  status: SaleStatus;
  grandTotal: string;
  paidTotal: string;
  changeDue: string;
  customerId: string | null;
  customerName: string | null;
  soldAt: string;
}

export interface SaleDetail extends SaleSummary {
  storeId: string;
  subtotal: string;
  itemDiscountTotal: string;
  cartDiscountPercent: string;
  cartDiscountAmount: string;
  taxTotal: string;
  notes: string | null;
  items: SaleItemRecord[];
  payments: { id: string; method: TenderMethod; amount: string; reference: string | null }[];
  returns: SaleReturnDetail[];
}

export interface SaleListResult {
  items: SaleSummary[];
  total: number;
  page: number;
  pageSize: number;
}

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
  relatedNumber: string | null;
  date: string;
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

export interface ReceiptResponse {
  format: ReceiptFormat;
  receipt: ReceiptDocument;
  /** Fixed-width text for 58mm / 80mm; null for A4. */
  text: string | null;
}

// ── Phase 6 ──────────────────────────────────────────────────────────────────
export interface CustomerWithBalance {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  customerType: 'RETAIL' | 'WHOLESALE';
  openingBalance: string;
  creditLimit: string | null;
  isActive: boolean;
  /** What the customer owes. Negative = the shop owes them. */
  balance: string;
}
export interface CustomerListResult {
  items: CustomerWithBalance[];
  total: number;
  page: number;
  pageSize: number;
}
export interface LedgerEntry {
  date: string;
  type: string;
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
export interface ExpenseView {
  id: string;
  storeId: string;
  category: string;
  description: string | null;
  amount: string;
  expenseDay: string;
  method: CashMethod;
}
export interface ExpenseListResult {
  items: ExpenseView[];
  total: number;
  totalAmount: string;
  page: number;
  pageSize: number;
}
export interface EmployeeView {
  id: string;
  fullName: string;
  phone: string | null;
  designation: string | null;
  nationalId: string | null;
  hireDate: string | null;
  salary: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'TERMINATED';
  storeId: string | null;
}
export interface EmployeeListResult {
  items: EmployeeView[];
  total: number;
  page: number;
  pageSize: number;
}
export interface ReportMeta {
  from: string;
  to: string;
  storeId: string | null;
  timeZone: string;
  currency: string;
}
export interface SalesSummary {
  saleCount: number;
  grossSales: string;
  itemDiscounts: string;
  cartDiscounts: string;
  tax: string;
  netSales: string;
  refundCount: number;
  refunds: string;
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
export interface AnalyticsOverview {
  meta: ReportMeta;
  summary: SalesSummary;
  previous: { from: string; to: string; summary: SalesSummary };
  netSalesChangePercent: string | null;
  daily: DailyPoint[];
  hourly: HourlyPoint[];
  topProducts: ProductPerformance[];
  byCategory: { categoryId: string; categoryName: string; quantitySold: string; revenue: string }[];
}
