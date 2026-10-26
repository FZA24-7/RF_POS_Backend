import type {
  ApplyMovementInput,
  ApplyMovementResult,
  AuditLogEntry,
  AuditLogInput,
  AuthUser,
  BrandSummary,
  CategorySummary,
  CreateSessionInput,
  InventoryListFilter,
  InventoryListResult,
  InventoryMovementRecord,
  InventoryRecord,
  LicenseSummary,
  ProductListFilter,
  ProductListResult,
  ProductSummary,
  ProvisionTenantInput,
  ProvisionTenantResult,
  RecordLoginAttemptInput,
  RecordStatus,
  RoleSummary,
  SessionRecord,
  StockLevel,
  StoreSummary,
  SubDepartmentSummary,
  TenantDetail,
  TenantListFilter,
  TenantListResult,
  TenantSummary,
  UserSummary,
  SupplierSummary,
  PurchaseDetail,
  PurchaseListFilter,
  PurchaseListResult,
  RecordPurchaseInput,
  RecordPurchasePaymentInput,
  CreateCustomerRecord,
  CreateEmployeeRecord,
  CreateExpenseRecord,
  CustomerListFilter,
  CustomerListResult,
  CustomerPaymentRecord,
  CustomerWithBalance,
  DailyPoint,
  EmployeeListFilter,
  EmployeeListResult,
  EmployeeRecord,
  ExpenseListFilter,
  ExpenseListResult,
  ExpenseRecord,
  HourlyPoint,
  Ledger,
  Outstanding,
  ProductPerformance,
  CashierPerformance,
  CategoryPerformance,
  ProfitLoss,
  RecordCustomerPaymentInput,
  ReportRange,
  SalesSummary,
  StockValuation,
  UpdateCustomerRecord,
  UpdateEmployeeRecord,
  UpdateExpenseRecord,
  TransactionalAudit,
  RecordReturnInput,
  RecordSaleInput,
  RecordSaleResult,
  SaleDetail,
  SaleListFilter,
  SaleListResult,
  SaleReturnDetail,
} from './types.js';

/**
 * Ports (in the hexagonal-architecture sense). Services depend only on these
 * interfaces. `src/infra/prisma/*` implements them for real; `tests/fakes/*`
 * implements them in-memory for fast, DB-independent unit/HTTP tests.
 */

export interface UserRepository {
  findByLoginId(loginId: string): Promise<AuthUser | null>;
  findById(id: string): Promise<AuthUser | null>;
  existsByLoginId(loginId: string): Promise<boolean>;
  updateLoginId(userId: string, newLoginId: string): Promise<void>;
  touchLastLogin(userId: string): Promise<void>;
  // Phase 2 additions (additive):
  listByTenant(tenantId: string): Promise<UserSummary[]>;
  updateStatus(userId: string, status: 'ACTIVE' | 'DISABLED'): Promise<void>;
  resetPassword(userId: string, newPasswordHash: string): Promise<void>;
  countAllByStatus(): Promise<{ active: number; disabled: number; total: number }>;
}

export interface RoleRepository {
  findById(id: string, tenantId: string | null): Promise<RoleSummary | null>;
}

export interface TenantRepository {
  findById(id: string): Promise<TenantSummary | null>;
  // Phase 2 additions (additive - Phase 1's `findById` usage is unchanged):
  findDetailById(id: string): Promise<TenantDetail | null>;
  existsByCode(code: string): Promise<boolean>;
  list(filter: TenantListFilter): Promise<TenantListResult>;
  listAll(): Promise<TenantDetail[]>;
  update(
    id: string,
    patch: Partial<
      Pick<TenantDetail, 'name' | 'legalName' | 'contactEmail' | 'contactPhone' | 'address'>
    >,
  ): Promise<void>;
  updateStatus(id: string, status: TenantSummary['status']): Promise<void>;
}

/**
 * Phase 2. Creates a Tenant + default Store + the tenant's four default Roles
 * (with permission grants) + the first Client Master Admin User + the initial
 * License, as a single atomic unit. Both implementations (the real Prisma
 * adapter via `$transaction`, and the in-memory test fake) guarantee: either
 * every row exists afterwards, or NONE of them do - there is no code path
 * that leaves a half-created tenant.
 */
export interface TenantProvisioningRepository {
  provision(input: ProvisionTenantInput): Promise<ProvisionTenantResult>;
  /** Adds an ADDITIONAL Client Master Admin to an already-provisioned tenant. */
  addClientAdmin(
    tenantId: string,
    input: { loginId: string; passwordHash: string; displayName: string; email?: string },
  ): Promise<{ id: string }>;
}

export interface StoreRepository {
  listByTenant(tenantId: string): Promise<StoreSummary[]>;
}

export interface LicenseRepository {
  findById(id: string): Promise<LicenseSummary | null>;
  findActiveByTenant(tenantId: string): Promise<LicenseSummary | null>;
  listByTenant(tenantId: string): Promise<LicenseSummary[]>;
  listAll(): Promise<LicenseSummary[]>;
  create(
    tenantId: string,
    input: {
      planCode: string;
      expiresAt: Date;
      maxUsers: number;
      maxDevices: number;
      maxStores: number;
      enabledModules: readonly string[];
    },
  ): Promise<LicenseSummary>;
  update(
    id: string,
    patch: Partial<{
      planCode: string;
      expiresAt: Date;
      maxUsers: number;
      maxDevices: number;
      maxStores: number;
    }>,
  ): Promise<void>;
  updateStatus(id: string, status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED'): Promise<void>;
  updateModules(id: string, enabledModules: readonly string[]): Promise<void>;
}

export interface SystemHealthRepository {
  checkDatabase(): Promise<boolean>;
}

// ───────────────────────────── Phase 4: Supplier & Purchase ports ─────────────────────────────

export interface SupplierRepository {
  create(
    tenantId: string,
    input: {
      name: string;
      phone?: string;
      email?: string;
      address?: string;
      /** What we already owed this supplier before using the system. */
      openingBalance?: string;
    },
  ): Promise<SupplierSummary>;
  /** Running payable ledger: opening + purchases - payments. Positive balance = we owe the supplier. */
  ledger(id: string, tenantId: string): Promise<Ledger | null>;
  /** Suppliers whose balance is not zero (payables), largest first. */
  outstanding(tenantId: string): Promise<Outstanding>;
  findById(id: string, tenantId: string): Promise<SupplierSummary | null>;
  existsByName(tenantId: string, name: string): Promise<boolean>;
  list(tenantId: string, filter: { search?: string }): Promise<SupplierSummary[]>;
}

/**
 * The entire "Record Purchase" workflow lives behind ONE port method,
 * `recordPurchase`, for the same reason `TenantProvisioningRepository.
 * provision` and `InventoryRepository.applyMovement` are each a single
 * method: the operation (create Purchase + PurchaseItems + increase stock at
 * the branch for every line + write an InventoryMovement per line + an
 * optional initial SupplierPayment) must be all-or-nothing. The real Prisma
 * adapter wraps the whole thing in one `$transaction`; it does NOT call
 * `InventoryRepository.applyMovement` as a nested transaction (Prisma
 * interactive transactions don't nest), but performs the IDENTICAL
 * read-current→compute→write-inventory→write-movement steps, using the same
 * `@mafk/shared` decimal helpers, inside its own transaction - see that
 * adapter's doc comment for the full explanation. The in-memory fake, which
 * has no such constraint, calls the real `FakeInventoryRepository.
 * applyMovement` directly for each line, so there is truly only one
 * stock-mutation code path in the test double.
 */
export interface PurchaseRepository {
  recordPurchase(input: RecordPurchaseInput): Promise<PurchaseDetail>;
  findById(id: string, tenantId: string): Promise<PurchaseDetail | null>;
  existsByInvoiceNo(tenantId: string, supplierId: string, invoiceNo: string): Promise<boolean>;
  list(tenantId: string, filter: PurchaseListFilter): Promise<PurchaseListResult>;
  recordPayment(input: RecordPurchasePaymentInput): Promise<PurchaseDetail>;
}

export interface SessionRepository {
  create(input: CreateSessionInput): Promise<SessionRecord>;
  findByRefreshTokenHash(hash: string): Promise<SessionRecord | null>;
  rotate(sessionId: string, newHash: string, expiresAt: Date): Promise<void>;
  revoke(sessionId: string, reason: string): Promise<void>;
  revokeAllForUser(userId: string, reason: string): Promise<void>;
}

export interface LoginAttemptRepository {
  record(input: RecordLoginAttemptInput): Promise<void>;
  countRecentFailures(loginId: string, sinceMs: number): Promise<number>;
}

export interface AuditLogRepository {
  record(input: AuditLogInput): Promise<void>;
  // Phase 2 addition (additive):
  listByTenant(tenantId: string, limit: number): Promise<AuditLogEntry[]>;
}

export interface LoginIdHistoryRepository {
  record(entry: {
    tenantId: string | null;
    userId: string;
    oldLoginId: string;
    newLoginId: string;
    changedById: string;
    reason?: string;
  }): Promise<void>;
}

/** Aggregate of every port a service layer might need. Passed to service factories. */
export interface Repositories {
  users: UserRepository;
  roles: RoleRepository;
  tenants: TenantRepository;
  sessions: SessionRepository;
  loginAttempts: LoginAttemptRepository;
  auditLogs: AuditLogRepository;
  loginIdHistory: LoginIdHistoryRepository;
  // Phase 2 additions:
  tenantProvisioning: TenantProvisioningRepository;
  stores: StoreRepository;
  licenses: LicenseRepository;
  systemHealth: SystemHealthRepository;
  // Phase 3 additions:
  categories: CategoryRepository;
  subDepartments: SubDepartmentRepository;
  brands: BrandRepository;
  products: ProductRepository;
  barcodes: BarcodeRepository;
  inventory: InventoryRepository;
  // Phase 4 additions:
  suppliers: SupplierRepository;
  purchases: PurchaseRepository;
  // Phase 5 additions:
  sales: SaleRepository;
  // Phase 6 additions:
  customers: CustomerRepository;
  expenses: ExpenseRepository;
  employees: EmployeeRepository;
  reports: ReportRepository;
}

export type { PlatformStats } from './types.js';

// ───────────────────────────── Phase 3: Catalog & Inventory ports ─────────────────────────────

export interface CategoryRepository {
  create(tenantId: string, input: { name: string; description?: string }): Promise<CategorySummary>;
  findById(id: string, tenantId: string): Promise<CategorySummary | null>;
  existsByName(tenantId: string, name: string, excludeId?: string): Promise<boolean>;
  list(
    tenantId: string,
    filter: { search?: string; status?: RecordStatus },
  ): Promise<CategorySummary[]>;
  update(
    id: string,
    tenantId: string,
    patch: { name?: string; description?: string },
  ): Promise<void>;
  updateStatus(id: string, tenantId: string, status: RecordStatus): Promise<void>;
}

export interface SubDepartmentRepository {
  create(
    tenantId: string,
    input: { categoryId: string; name: string; description?: string },
  ): Promise<SubDepartmentSummary>;
  findById(id: string, tenantId: string): Promise<SubDepartmentSummary | null>;
  existsByName(
    tenantId: string,
    categoryId: string,
    name: string,
    excludeId?: string,
  ): Promise<boolean>;
  list(
    tenantId: string,
    filter: { categoryId?: string; search?: string; status?: RecordStatus },
  ): Promise<SubDepartmentSummary[]>;
  update(
    id: string,
    tenantId: string,
    patch: { name?: string; description?: string },
  ): Promise<void>;
  updateStatus(id: string, tenantId: string, status: RecordStatus): Promise<void>;
}

export interface BrandRepository {
  create(tenantId: string, input: { name: string }): Promise<BrandSummary>;
  findById(id: string, tenantId: string): Promise<BrandSummary | null>;
  existsByName(tenantId: string, name: string, excludeId?: string): Promise<boolean>;
  list(
    tenantId: string,
    filter: { search?: string; status?: RecordStatus },
  ): Promise<BrandSummary[]>;
  update(id: string, tenantId: string, patch: { name?: string }): Promise<void>;
  updateStatus(id: string, tenantId: string, status: RecordStatus): Promise<void>;
}

export interface CreateProductInput {
  name: string;
  sku: string;
  categoryId: string;
  subDepartmentId: string;
  brandId?: string | null;
  supplierId?: string | null;
  costPrice: string;
  sellingPrice: string;
  wholesalePrice?: string | null;
  taxRate: string;
  unit: string;
  minStock: string;
  maxStock?: string | null;
  imageUrl?: string | null;
  description?: string | null;
  barcodes?: string[];
}

export interface ProductRepository {
  create(tenantId: string, input: CreateProductInput): Promise<ProductSummary>;
  findById(id: string, tenantId: string): Promise<ProductSummary | null>;
  findBySku(tenantId: string, sku: string): Promise<ProductSummary | null>;
  existsBySku(tenantId: string, sku: string, excludeId?: string): Promise<boolean>;
  list(tenantId: string, filter: ProductListFilter): Promise<ProductListResult>;
  update(id: string, tenantId: string, patch: Partial<CreateProductInput>): Promise<void>;
  updateStatus(id: string, tenantId: string, status: RecordStatus): Promise<void>;
}

export interface BarcodeRepository {
  existsByCode(tenantId: string, code: string): Promise<boolean>;
  addToProduct(
    tenantId: string,
    productId: string,
    code: string,
    isPrimary: boolean,
  ): Promise<void>;
  findProductIdByCode(tenantId: string, code: string): Promise<string | null>;
  listForProduct(tenantId: string, productId: string): Promise<string[]>;
}

export interface InventoryRepository {
  findByStoreAndProduct(storeId: string, productId: string): Promise<InventoryRecord | null>;
  list(tenantId: string, filter: InventoryListFilter): Promise<InventoryListResult>;
  listLowStock(tenantId: string, storeId?: string): Promise<StockLevel[]>;
  listMovements(
    tenantId: string,
    productId: string,
    limit: number,
  ): Promise<InventoryMovementRecord[]>;
  /**
   * The single, atomic entry point for every stock-changing operation:
   * read current quantity → compute new quantity → write inventory → write
   * the InventoryMovement record, all-or-nothing. See
   * `docs/ARCHITECTURE.md` "Transaction safety" for why this is one port
   * method rather than three separate ones the service would have to
   * sequence itself.
   */
  applyMovement(input: ApplyMovementInput): Promise<ApplyMovementResult>;
}

// ───────────────────────────── Phase 5: Sales ─────────────────────────────

/**
 * Like `PurchaseRepository`, each write is ONE method so the sale/refund, every stock movement, the payments, the
 * document-number claim and the audit record commit or roll back together.
 */
export interface SaleRepository {
  /**
   * Idempotent on (tenantId, clientRequestId): a repeat returns the stored sale with `replayed: true` and writes
   * nothing. Throws InsufficientStockError (nothing is written), InvalidSaleRelationshipError.
   */
  recordSale(input: RecordSaleInput): Promise<RecordSaleResult>;
  findById(id: string, tenantId: string): Promise<SaleDetail | null>;
  list(tenantId: string, filter: SaleListFilter): Promise<SaleListResult>;
  /**
   * Refund: computes each line's refund from the STORED sale inside the transaction, guards `returnedQuantity`
   * against concurrent returns (SaleConcurrencyError), restocks (SALE_RETURN movement), updates the sale status and
   * writes the audit. Throws SaleNotFoundError, ReturnNotAllowedError.
   */
  recordReturn(input: RecordReturnInput): Promise<SaleReturnDetail>;
  findReturnById(id: string, tenantId: string): Promise<SaleReturnDetail | null>;
}

// ───────────────────────────── Phase 6 ports ─────────────────────────────

export interface CustomerRepository {
  create(
    tenantId: string,
    input: CreateCustomerRecord,
    audit: TransactionalAudit,
  ): Promise<CustomerWithBalance>;
  findById(id: string, tenantId: string): Promise<CustomerWithBalance | null>;
  list(tenantId: string, filter: CustomerListFilter): Promise<CustomerListResult>;
  update(
    id: string,
    tenantId: string,
    patch: UpdateCustomerRecord,
    audit: TransactionalAudit,
  ): Promise<CustomerWithBalance | null>;
  /** Running receivable ledger: opening + credit sales - credit refunds - payments. */
  ledger(id: string, tenantId: string): Promise<Ledger | null>;
  /**
   * Records a payment received from the customer. The customer row is locked while the balance is read and the
   * payment written, so concurrent payments cannot jointly exceed the balance. Throws CustomerNotFoundError, or
   * CustomerOverpaymentError when the amount is more than the customer owes.
   */
  recordPayment(
    input: RecordCustomerPaymentInput,
  ): Promise<{ payment: CustomerPaymentRecord; balance: string }>;
  /** Customers who owe money (balance > 0), largest first. */
  outstanding(tenantId: string): Promise<Outstanding>;
}

export interface ExpenseRepository {
  create(input: CreateExpenseRecord): Promise<ExpenseRecord>;
  findById(id: string, tenantId: string): Promise<ExpenseRecord | null>;
  list(tenantId: string, filter: ExpenseListFilter): Promise<ExpenseListResult>;
  update(
    id: string,
    tenantId: string,
    patch: UpdateExpenseRecord,
    audit: TransactionalAudit,
  ): Promise<ExpenseRecord | null>;
  delete(id: string, tenantId: string, audit: TransactionalAudit): Promise<boolean>;
}

export interface EmployeeRepository {
  create(
    tenantId: string,
    input: CreateEmployeeRecord,
    audit: TransactionalAudit,
  ): Promise<EmployeeRecord>;
  findById(id: string, tenantId: string): Promise<EmployeeRecord | null>;
  list(tenantId: string, filter: EmployeeListFilter): Promise<EmployeeListResult>;
  update(
    id: string,
    tenantId: string,
    patch: UpdateEmployeeRecord,
    audit: TransactionalAudit,
  ): Promise<EmployeeRecord | null>;
}

/**
 * Read-only aggregates. Every method is tenant-scoped and takes a half-open instant range already converted from the
 * tenant's calendar days. All money is exact (SQL numeric / BigInt), returned as 2-decimal strings.
 */
export interface ReportRepository {
  salesSummary(tenantId: string, range: ReportRange): Promise<SalesSummary>;
  dailySales(tenantId: string, range: ReportRange): Promise<DailyPoint[]>;
  hourlySales(tenantId: string, range: ReportRange): Promise<HourlyPoint[]>;
  topProducts(tenantId: string, range: ReportRange, limit: number): Promise<ProductPerformance[]>;
  salesByCashier(tenantId: string, range: ReportRange): Promise<CashierPerformance[]>;
  salesByCategory(tenantId: string, range: ReportRange): Promise<CategoryPerformance[]>;
  profitLoss(tenantId: string, range: ReportRange): Promise<ProfitLoss>;
  stockValuation(tenantId: string, storeId?: string): Promise<StockValuation>;
}
