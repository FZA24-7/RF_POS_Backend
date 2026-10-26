import { randomUUID } from 'node:crypto';
import { buildLedger, summariseOutstanding } from '../../src/services/ledger.js';
import { FakeSaleRepository } from './fake-sale-repository.js';
import {
  FakeCustomerRepository,
  FakeEmployeeRepository,
  FakeExpenseRepository,
  FakeReportRepository,
} from './fake-phase6-repositories.js';
import {
  addDecimalStrings,
  compareDecimalStrings,
  DEFAULT_ROLE_PERMISSIONS,
  roundDecimalString,
} from '@mafk/shared';
import {
  computeLine,
  computeTotals,
  resolvePaymentStatus,
} from '../../src/services/purchase-calculations.js';
import type {
  AuditLogRepository,
  BarcodeRepository,
  BrandRepository,
  CategoryRepository,
  CreateProductInput,
  InventoryRepository,
  LicenseRepository,
  LoginAttemptRepository,
  LoginIdHistoryRepository,
  ProductRepository,
  PurchaseRepository,
  Repositories,
  RoleRepository,
  SessionRepository,
  StoreRepository,
  SubDepartmentRepository,
  SupplierRepository,
  SystemHealthRepository,
  TenantProvisioningRepository,
  TenantRepository,
  UserRepository,
} from '../../src/domain/ports.js';
import {
  DuplicatePurchaseError,
  InsufficientStockError,
  InvalidPurchaseRelationshipError,
  PaymentExceedsBalanceError,
  ProvisioningConflictError,
  type ApplyMovementInput,
  type ApplyMovementResult,
  type AuditLogEntry,
  type AuditLogInput,
  type AuthUser,
  type BrandSummary,
  type CategorySummary,
  type CreateSessionInput,
  type InventoryListFilter,
  type InventoryListResult,
  type InventoryMovementRecord,
  type InventoryRecord,
  type LicenseSummary,
  type ProductListFilter,
  type ProductListResult,
  type ProductSummary,
  type ProvisionTenantInput,
  type ProvisionTenantResult,
  type PurchaseDetail,
  type PurchaseListFilter,
  type PurchaseListResult,
  type PurchaseSummary,
  type RecordLoginAttemptInput,
  type RecordPurchaseInput,
  type RecordPurchasePaymentInput,
  type RecordStatus,
  type RoleSummary,
  type SessionRecord,
  type StockLevel,
  type StoreSummary,
  type SubDepartmentSummary,
  type SupplierSummary,
  type TenantDetail,
  type TenantListFilter,
  type TenantListResult,
  type TenantSummary,
  type UserSummary,
  type Ledger,
  type LedgerEntry,
  type Outstanding,
} from '../../src/domain/types.js';

/**
 * Plain in-memory test doubles. These exist ONLY under tests/ and are never
 * imported by production code (src/composition/production.ts wires the real
 * Prisma adapters instead). Using them here is standard dependency-injection
 * testing practice, not a substitute for real database verification -
 * Prisma-backed integration tests remain separately tracked as blocked.
 */
export class FakeUserRepository implements UserRepository {
  readonly users = new Map<string, AuthUser>();

  async findByLoginId(loginId: string): Promise<AuthUser | null> {
    return [...this.users.values()].find((u) => u.loginId === loginId) ?? null;
  }
  async findById(id: string): Promise<AuthUser | null> {
    return this.users.get(id) ?? null;
  }
  async existsByLoginId(loginId: string): Promise<boolean> {
    return [...this.users.values()].some((u) => u.loginId === loginId);
  }
  async updateLoginId(userId: string, newLoginId: string): Promise<void> {
    const u = this.users.get(userId);
    if (u) this.users.set(userId, { ...u, loginId: newLoginId });
  }
  async touchLastLogin(): Promise<void> {
    // no-op for tests
  }

  // Phase 2 additions:
  async listByTenant(tenantId: string): Promise<UserSummary[]> {
    return [...this.users.values()]
      .filter((u) => u.tenantId === tenantId)
      .map((u) => this.toSummary(u));
  }
  async updateStatus(userId: string, status: 'ACTIVE' | 'DISABLED'): Promise<void> {
    const u = this.users.get(userId);
    if (u) this.users.set(userId, { ...u, status });
  }
  async resetPassword(userId: string, newPasswordHash: string): Promise<void> {
    const u = this.users.get(userId);
    if (u) this.users.set(userId, { ...u, passwordHash: newPasswordHash });
  }
  async countAllByStatus(): Promise<{ active: number; disabled: number; total: number }> {
    const all = [...this.users.values()];
    const active = all.filter((u) => u.status === 'ACTIVE').length;
    const disabled = all.filter((u) => u.status === 'DISABLED').length;
    return { active, disabled, total: all.length };
  }

  private toSummary(u: AuthUser): UserSummary {
    return {
      id: u.id,
      tenantId: u.tenantId,
      loginId: u.loginId,
      displayName: u.displayName,
      email: null,
      systemRole: u.systemRole,
      status: u.status,
      lastLoginAt: null,
      createdAt: this.createdAt.get(u.id) ?? new Date(),
    };
  }

  private readonly createdAt = new Map<string, Date>();

  seed(user: AuthUser): AuthUser {
    this.users.set(user.id, user);
    if (!this.createdAt.has(user.id)) this.createdAt.set(user.id, new Date());
    return user;
  }
}

export class FakeRoleRepository implements RoleRepository {
  readonly roles = new Map<string, RoleSummary>();

  async findById(id: string, tenantId: string | null): Promise<RoleSummary | null> {
    const role = this.roles.get(id);
    if (!role || role.tenantId !== tenantId) return null;
    return role;
  }

  seed(role: RoleSummary): RoleSummary {
    this.roles.set(role.id, role);
    return role;
  }
}

export class FakeTenantRepository implements TenantRepository {
  readonly tenants = new Map<string, TenantDetail>();

  async findById(id: string): Promise<TenantSummary | null> {
    const t = this.tenants.get(id);
    return t ? { id: t.id, code: t.code, name: t.name, status: t.status } : null;
  }

  // Phase 2 additions:
  async findDetailById(id: string): Promise<TenantDetail | null> {
    const t = this.tenants.get(id);
    return t ? { timezone: 'Asia/Karachi', currency: 'PKR', ...t } : null;
  }
  async existsByCode(code: string): Promise<boolean> {
    return [...this.tenants.values()].some((t) => t.code === code);
  }
  async list(filter: TenantListFilter): Promise<TenantListResult> {
    let items = [...this.tenants.values()];
    if (filter.status) items = items.filter((t) => t.status === filter.status);
    if (filter.search) {
      const q = filter.search.toLowerCase();
      items = items.filter(
        (t) => t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q),
      );
    }
    const total = items.length;
    const start = (filter.page - 1) * filter.pageSize;
    return {
      items: items.slice(start, start + filter.pageSize),
      total,
      page: filter.page,
      pageSize: filter.pageSize,
    };
  }
  async listAll(): Promise<TenantDetail[]> {
    return [...this.tenants.values()];
  }
  async update(id: string, patch: Partial<TenantDetail>): Promise<void> {
    const t = this.tenants.get(id);
    if (t) this.tenants.set(id, { ...t, ...patch });
  }
  async updateStatus(id: string, status: TenantSummary['status']): Promise<void> {
    const t = this.tenants.get(id);
    if (t) this.tenants.set(id, { ...t, status });
  }

  seed(tenant: Partial<TenantDetail> & TenantSummary): TenantDetail {
    const detail: TenantDetail = {
      legalName: null,
      contactEmail: null,
      contactPhone: null,
      address: null,
      createdAt: new Date(),
      ...tenant,
    };
    this.tenants.set(tenant.id, detail);
    return detail;
  }
}

export class FakeStoreRepository implements StoreRepository {
  readonly stores = new Map<string, StoreSummary>();

  async listByTenant(tenantId: string): Promise<StoreSummary[]> {
    return [...this.stores.values()].filter((s) => s.tenantId === tenantId);
  }

  seed(store: StoreSummary): StoreSummary {
    this.stores.set(store.id, store);
    return store;
  }
}

export class FakeLicenseRepository implements LicenseRepository {
  readonly licenses = new Map<string, LicenseSummary>();

  async findById(id: string): Promise<LicenseSummary | null> {
    return this.licenses.get(id) ?? null;
  }
  async findActiveByTenant(tenantId: string): Promise<LicenseSummary | null> {
    return (
      [...this.licenses.values()]
        .filter((l) => l.tenantId === tenantId && l.status === 'ACTIVE')
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
    );
  }
  async listByTenant(tenantId: string): Promise<LicenseSummary[]> {
    return [...this.licenses.values()].filter((l) => l.tenantId === tenantId);
  }
  async listAll(): Promise<LicenseSummary[]> {
    return [...this.licenses.values()];
  }
  async create(
    tenantId: string,
    input: {
      planCode: string;
      expiresAt: Date;
      maxUsers: number;
      maxDevices: number;
      maxStores: number;
      enabledModules: readonly string[];
    },
  ): Promise<LicenseSummary> {
    const license: LicenseSummary = {
      id: randomUUID(),
      tenantId,
      planCode: input.planCode,
      status: 'ACTIVE',
      startsAt: new Date(),
      expiresAt: input.expiresAt,
      maxUsers: input.maxUsers,
      maxDevices: input.maxDevices,
      maxStores: input.maxStores,
      enabledModules: [...input.enabledModules],
      createdAt: new Date(),
    };
    this.licenses.set(license.id, license);
    return license;
  }
  async update(
    id: string,
    patch: Partial<{
      planCode: string;
      expiresAt: Date;
      maxUsers: number;
      maxDevices: number;
      maxStores: number;
    }>,
  ): Promise<void> {
    const l = this.licenses.get(id);
    if (l) this.licenses.set(id, { ...l, ...patch });
  }
  async updateStatus(id: string, status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED'): Promise<void> {
    const l = this.licenses.get(id);
    if (l) this.licenses.set(id, { ...l, status });
  }
  async updateModules(id: string, enabledModules: readonly string[]): Promise<void> {
    const l = this.licenses.get(id);
    if (l) this.licenses.set(id, { ...l, enabledModules: [...enabledModules] });
  }

  seed(license: LicenseSummary): LicenseSummary {
    this.licenses.set(license.id, license);
    return license;
  }
}

export class FakeSystemHealthRepository implements SystemHealthRepository {
  reachable = true;
  async checkDatabase(): Promise<boolean> {
    return this.reachable;
  }
}

/**
 * Composes the other fakes to genuinely emulate an atomic, all-or-nothing
 * provisioning operation: every uniqueness check runs BEFORE anything is
 * written to any of the underlying maps, and writing happens only after every
 * check has passed. This is what lets the test suite prove "no partial tenant
 * is ever left behind on failure" against this fake, in exactly the same way
 * the real Prisma adapter proves it via `$transaction`.
 */
export class FakeTenantProvisioningRepository implements TenantProvisioningRepository {
  constructor(
    private readonly tenants: FakeTenantRepository,
    private readonly stores: FakeStoreRepository,
    private readonly roles: FakeRoleRepository,
    private readonly users: FakeUserRepository,
    private readonly licenses: FakeLicenseRepository,
  ) {}

  async provision(input: ProvisionTenantInput): Promise<ProvisionTenantResult> {
    if (await this.tenants.existsByCode(input.code)) {
      throw new ProvisioningConflictError('code', `Tenant code "${input.code}" is already in use.`);
    }
    if (await this.users.existsByLoginId(input.masterAdmin.loginId)) {
      throw new ProvisioningConflictError(
        'loginId',
        `Login ID "${input.masterAdmin.loginId}" is already in use.`,
      );
    }

    // All checks passed - now, and only now, commit every write.
    const tenantId = randomUUID();
    const storeId = randomUUID();
    const clientAdminUserId = randomUUID();
    const licenseId = randomUUID();

    this.tenants.seed({
      id: tenantId,
      code: input.code,
      name: input.name,
      status: 'ACTIVE',
      legalName: input.legalName ?? null,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      address: input.address ?? null,
    });

    this.stores.seed({
      id: storeId,
      tenantId,
      code: 'MAIN',
      name: input.defaultStoreName,
      isDefault: true,
      isActive: true,
    });

    const roleIds: Record<string, string> = {};
    for (const systemRole of [
      'CLIENT_MASTER_ADMIN',
      'MANAGER',
      'CASHIER',
      'INVENTORY_STAFF',
    ] as const) {
      const roleId = randomUUID();
      this.roles.seed({
        id: roleId,
        tenantId,
        systemRole,
        permissionKeys: DEFAULT_ROLE_PERMISSIONS[systemRole],
      });
      roleIds[systemRole] = roleId;
    }

    this.users.seed({
      id: clientAdminUserId,
      tenantId,
      storeId,
      roleId: roleIds.CLIENT_MASTER_ADMIN!,
      systemRole: 'CLIENT_MASTER_ADMIN',
      loginId: input.masterAdmin.loginId,
      displayName: input.masterAdmin.displayName,
      status: 'ACTIVE',
      passwordHash: input.masterAdmin.passwordHash,
    });

    this.licenses.seed({
      id: licenseId,
      tenantId,
      planCode: input.license.planCode,
      status: 'ACTIVE',
      startsAt: new Date(),
      expiresAt: input.license.expiresAt,
      maxUsers: input.license.maxUsers,
      maxDevices: input.license.maxDevices,
      maxStores: input.license.maxStores,
      enabledModules: [...input.license.enabledModules],
      createdAt: new Date(),
    });

    return { tenantId, storeId, clientAdminUserId, licenseId };
  }

  async addClientAdmin(
    tenantId: string,
    input: { loginId: string; passwordHash: string; displayName: string; email?: string },
  ): Promise<{ id: string }> {
    const role = [...this.roles.roles.values()].find(
      (r) => r.tenantId === tenantId && r.systemRole === 'CLIENT_MASTER_ADMIN',
    );
    if (!role) throw new Error(`Tenant ${tenantId} has no Client Master Admin role.`);
    const id = randomUUID();
    this.users.seed({
      id,
      tenantId,
      storeId: null,
      roleId: role.id,
      systemRole: 'CLIENT_MASTER_ADMIN',
      loginId: input.loginId,
      displayName: input.displayName,
      status: 'ACTIVE',
      passwordHash: input.passwordHash,
    });
    return { id };
  }
}

export class FakeSessionRepository implements SessionRepository {
  readonly sessions = new Map<string, SessionRecord>();

  async create(input: CreateSessionInput): Promise<SessionRecord> {
    const record: SessionRecord = {
      id: randomUUID(),
      userId: input.userId,
      tenantId: input.tenantId,
      refreshTokenHash: input.refreshTokenHash,
      previousRefreshTokenHash: null,
      expiresAt: input.expiresAt,
      revokedAt: null,
    };
    this.sessions.set(record.id, record);
    return record;
  }
  async findByRefreshTokenHash(hash: string): Promise<SessionRecord | null> {
    return [...this.sessions.values()].find((s) => s.refreshTokenHash === hash) ?? null;
  }
  async rotate(sessionId: string, newHash: string, expiresAt: Date): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.sessions.set(sessionId, {
      ...s,
      previousRefreshTokenHash: s.refreshTokenHash,
      refreshTokenHash: newHash,
      expiresAt,
    });
  }
  async revoke(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (s) this.sessions.set(sessionId, { ...s, revokedAt: new Date() });
  }
  async revokeAllForUser(userId: string): Promise<void> {
    for (const [id, s] of this.sessions) {
      if (s.userId === userId) this.sessions.set(id, { ...s, revokedAt: new Date() });
    }
  }
}

export class FakeLoginAttemptRepository implements LoginAttemptRepository {
  readonly attempts: (RecordLoginAttemptInput & { createdAt: Date })[] = [];

  async record(input: RecordLoginAttemptInput): Promise<void> {
    this.attempts.push({ ...input, createdAt: new Date() });
  }
  async countRecentFailures(loginId: string, sinceMs: number): Promise<number> {
    return this.attempts.filter(
      (a) => a.loginId === loginId && !a.success && a.createdAt.getTime() >= sinceMs,
    ).length;
  }
}

export class FakeAuditLogRepository implements AuditLogRepository {
  readonly entries: (AuditLogInput & { id: string; createdAt: Date })[] = [];

  /** Test hook: when set, the next-and-every `record` call throws it (simulates the audit INSERT failing). */
  failWith: Error | null = null;

  async record(input: AuditLogInput): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.entries.push({ ...input, id: randomUUID(), createdAt: new Date() });
  }

  // Phase 2 addition:
  async listByTenant(tenantId: string, limit: number): Promise<AuditLogEntry[]> {
    return this.entries
      .filter((e) => e.tenantId === tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((e) => ({
        id: e.id,
        tenantId: e.tenantId,
        userId: e.userId,
        action: e.action,
        entity: e.entity,
        entityId: e.entityId ?? null,
        metadata: e.metadata ?? null,
        createdAt: e.createdAt,
      }));
  }
}

export class FakeLoginIdHistoryRepository implements LoginIdHistoryRepository {
  readonly entries: {
    tenantId: string | null;
    userId: string;
    oldLoginId: string;
    newLoginId: string;
    changedById: string;
    reason?: string;
  }[] = [];

  async record(entry: {
    tenantId: string | null;
    userId: string;
    oldLoginId: string;
    newLoginId: string;
    changedById: string;
    reason?: string;
  }): Promise<void> {
    this.entries.push(entry);
  }
}

export class FakeCategoryRepository implements CategoryRepository {
  readonly categories = new Map<string, CategorySummary>();

  async create(
    tenantId: string,
    input: { name: string; description?: string },
  ): Promise<CategorySummary> {
    const now = new Date();
    const category: CategorySummary = {
      id: randomUUID(),
      tenantId,
      name: input.name,
      description: input.description ?? null,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };
    this.categories.set(category.id, category);
    return category;
  }
  async findById(id: string, tenantId: string): Promise<CategorySummary | null> {
    const c = this.categories.get(id);
    return c && c.tenantId === tenantId ? c : null;
  }
  async existsByName(tenantId: string, name: string, excludeId?: string): Promise<boolean> {
    return [...this.categories.values()].some(
      (c) => c.tenantId === tenantId && c.name === name && c.id !== excludeId,
    );
  }
  async list(
    tenantId: string,
    filter: { search?: string; status?: RecordStatus },
  ): Promise<CategorySummary[]> {
    return [...this.categories.values()].filter((c) => {
      if (c.tenantId !== tenantId) return false;
      if (filter.status && c.status !== filter.status) return false;
      if (filter.search && !c.name.toLowerCase().includes(filter.search.toLowerCase()))
        return false;
      return true;
    });
  }
  async update(
    id: string,
    tenantId: string,
    patch: { name?: string; description?: string },
  ): Promise<void> {
    const c = this.categories.get(id);
    if (c && c.tenantId === tenantId)
      this.categories.set(id, { ...c, ...patch, updatedAt: new Date() });
  }
  async updateStatus(id: string, tenantId: string, status: RecordStatus): Promise<void> {
    const c = this.categories.get(id);
    if (c && c.tenantId === tenantId)
      this.categories.set(id, { ...c, status, updatedAt: new Date() });
  }

  seed(category: CategorySummary): CategorySummary {
    this.categories.set(category.id, category);
    return category;
  }
}

export class FakeSubDepartmentRepository implements SubDepartmentRepository {
  readonly subDepartments = new Map<string, SubDepartmentSummary>();

  async create(
    tenantId: string,
    input: { categoryId: string; name: string; description?: string },
  ): Promise<SubDepartmentSummary> {
    const now = new Date();
    const sub: SubDepartmentSummary = {
      id: randomUUID(),
      tenantId,
      categoryId: input.categoryId,
      name: input.name,
      description: input.description ?? null,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };
    this.subDepartments.set(sub.id, sub);
    return sub;
  }
  async findById(id: string, tenantId: string): Promise<SubDepartmentSummary | null> {
    const s = this.subDepartments.get(id);
    return s && s.tenantId === tenantId ? s : null;
  }
  async existsByName(
    tenantId: string,
    categoryId: string,
    name: string,
    excludeId?: string,
  ): Promise<boolean> {
    return [...this.subDepartments.values()].some(
      (s) =>
        s.tenantId === tenantId &&
        s.categoryId === categoryId &&
        s.name === name &&
        s.id !== excludeId,
    );
  }
  async list(
    tenantId: string,
    filter: { categoryId?: string; search?: string; status?: RecordStatus },
  ): Promise<SubDepartmentSummary[]> {
    return [...this.subDepartments.values()].filter((s) => {
      if (s.tenantId !== tenantId) return false;
      if (filter.categoryId && s.categoryId !== filter.categoryId) return false;
      if (filter.status && s.status !== filter.status) return false;
      if (filter.search && !s.name.toLowerCase().includes(filter.search.toLowerCase()))
        return false;
      return true;
    });
  }
  async update(
    id: string,
    tenantId: string,
    patch: { name?: string; description?: string },
  ): Promise<void> {
    const s = this.subDepartments.get(id);
    if (s && s.tenantId === tenantId)
      this.subDepartments.set(id, { ...s, ...patch, updatedAt: new Date() });
  }
  async updateStatus(id: string, tenantId: string, status: RecordStatus): Promise<void> {
    const s = this.subDepartments.get(id);
    if (s && s.tenantId === tenantId)
      this.subDepartments.set(id, { ...s, status, updatedAt: new Date() });
  }

  seed(sub: SubDepartmentSummary): SubDepartmentSummary {
    this.subDepartments.set(sub.id, sub);
    return sub;
  }
}

export class FakeBrandRepository implements BrandRepository {
  readonly brands = new Map<string, BrandSummary>();

  async create(tenantId: string, input: { name: string }): Promise<BrandSummary> {
    const now = new Date();
    const brand: BrandSummary = {
      id: randomUUID(),
      tenantId,
      name: input.name,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };
    this.brands.set(brand.id, brand);
    return brand;
  }
  async findById(id: string, tenantId: string): Promise<BrandSummary | null> {
    const b = this.brands.get(id);
    return b && b.tenantId === tenantId ? b : null;
  }
  async existsByName(tenantId: string, name: string, excludeId?: string): Promise<boolean> {
    return [...this.brands.values()].some(
      (b) => b.tenantId === tenantId && b.name === name && b.id !== excludeId,
    );
  }
  async list(
    tenantId: string,
    filter: { search?: string; status?: RecordStatus },
  ): Promise<BrandSummary[]> {
    return [...this.brands.values()].filter((b) => {
      if (b.tenantId !== tenantId) return false;
      if (filter.status && b.status !== filter.status) return false;
      if (filter.search && !b.name.toLowerCase().includes(filter.search.toLowerCase()))
        return false;
      return true;
    });
  }
  async update(id: string, tenantId: string, patch: { name?: string }): Promise<void> {
    const b = this.brands.get(id);
    if (b && b.tenantId === tenantId)
      this.brands.set(id, { ...b, ...patch, updatedAt: new Date() });
  }
  async updateStatus(id: string, tenantId: string, status: RecordStatus): Promise<void> {
    const b = this.brands.get(id);
    if (b && b.tenantId === tenantId) this.brands.set(id, { ...b, status, updatedAt: new Date() });
  }

  seed(brand: BrandSummary): BrandSummary {
    this.brands.set(brand.id, brand);
    return brand;
  }
}

export class FakeBarcodeRepository implements BarcodeRepository {
  /** code -> { tenantId, productId } */
  readonly codes = new Map<string, { tenantId: string; productId: string }>();

  async existsByCode(tenantId: string, code: string): Promise<boolean> {
    const entry = this.codes.get(code);
    return !!entry && entry.tenantId === tenantId;
  }
  async addToProduct(
    tenantId: string,
    productId: string,
    code: string,
    _isPrimary?: boolean,
  ): Promise<void> {
    this.codes.set(code, { tenantId, productId });
  }
  async findProductIdByCode(tenantId: string, code: string): Promise<string | null> {
    const entry = this.codes.get(code);
    return entry && entry.tenantId === tenantId ? entry.productId : null;
  }
  async listForProduct(tenantId: string, productId: string): Promise<string[]> {
    return [...this.codes.entries()]
      .filter(([, v]) => v.tenantId === tenantId && v.productId === productId)
      .map(([code]) => code);
  }
}

export class FakeProductRepository implements ProductRepository {
  readonly products = new Map<string, Omit<ProductSummary, 'barcodes'>>();

  constructor(private readonly barcodes: FakeBarcodeRepository) {}

  private withBarcodes(p: Omit<ProductSummary, 'barcodes'>): ProductSummary {
    return {
      ...p,
      barcodes: [...this.barcodes.codes.entries()]
        .filter(([, v]) => v.productId === p.id)
        .map(([c]) => c),
    };
  }

  async create(tenantId: string, input: CreateProductInput): Promise<ProductSummary> {
    const now = new Date();
    const id = randomUUID();
    const product: Omit<ProductSummary, 'barcodes'> = {
      id,
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
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };
    this.products.set(id, product);
    for (const [i, code] of (input.barcodes ?? []).entries()) {
      await this.barcodes.addToProduct(tenantId, id, code, i === 0);
    }
    return this.withBarcodes(product);
  }
  async findById(id: string, tenantId: string): Promise<ProductSummary | null> {
    const p = this.products.get(id);
    return p && p.tenantId === tenantId ? this.withBarcodes(p) : null;
  }
  async findBySku(tenantId: string, sku: string): Promise<ProductSummary | null> {
    const p = [...this.products.values()].find((x) => x.tenantId === tenantId && x.sku === sku);
    return p ? this.withBarcodes(p) : null;
  }
  async existsBySku(tenantId: string, sku: string, excludeId?: string): Promise<boolean> {
    return [...this.products.values()].some(
      (p) => p.tenantId === tenantId && p.sku === sku && p.id !== excludeId,
    );
  }
  async list(tenantId: string, filter: ProductListFilter): Promise<ProductListResult> {
    let items = [...this.products.values()].filter((p) => p.tenantId === tenantId);
    if (filter.status) items = items.filter((p) => p.status === filter.status);
    if (filter.categoryId) items = items.filter((p) => p.categoryId === filter.categoryId);
    if (filter.subDepartmentId)
      items = items.filter((p) => p.subDepartmentId === filter.subDepartmentId);
    if (filter.brandId) items = items.filter((p) => p.brandId === filter.brandId);
    if (filter.search) {
      const q = filter.search.toLowerCase();
      items = items.filter(
        (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q),
      );
    }
    const total = items.length;
    const start = (filter.page - 1) * filter.pageSize;
    const page = items.slice(start, start + filter.pageSize).map((p) => this.withBarcodes(p));
    return { items: page, total, page: filter.page, pageSize: filter.pageSize };
  }
  async update(id: string, tenantId: string, patch: Partial<CreateProductInput>): Promise<void> {
    const p = this.products.get(id);
    if (p && p.tenantId === tenantId) {
      const { barcodes: _ignored, ...rest } = patch;
      this.products.set(id, { ...p, ...rest, updatedAt: new Date() });
    }
  }
  async updateStatus(id: string, tenantId: string, status: RecordStatus): Promise<void> {
    const p = this.products.get(id);
    if (p && p.tenantId === tenantId)
      this.products.set(id, { ...p, status, updatedAt: new Date() });
  }

  seed(product: ProductSummary): ProductSummary {
    const { barcodes, ...rest } = product;
    this.products.set(product.id, rest);
    for (const code of barcodes) {
      this.barcodes.codes.set(code, { tenantId: product.tenantId, productId: product.id });
    }
    return product;
  }
}

export class FakeInventoryRepository implements InventoryRepository {
  readonly inventories = new Map<string, InventoryRecord>(); // keyed by `${storeId}:${productId}`
  readonly movements: InventoryMovementRecord[] = [];
  /** Test hook: called at the start of every applyMovement; throw to simulate a movement write failing. */
  onApplyMovement: ((input: ApplyMovementInput) => void) | null = null;

  constructor(private readonly products: FakeProductRepository) {}

  private key(storeId: string, productId: string): string {
    return `${storeId}:${productId}`;
  }

  private productMeta(productId: string): {
    productName: string;
    sku: string;
    minStock: string;
    maxStock: string | null;
  } {
    const p = this.products.products.get(productId);
    return p
      ? { productName: p.name, sku: p.sku, minStock: p.minStock, maxStock: p.maxStock }
      : { productName: '', sku: '', minStock: '0', maxStock: null };
  }

  async findByStoreAndProduct(storeId: string, productId: string): Promise<InventoryRecord | null> {
    return this.inventories.get(this.key(storeId, productId)) ?? null;
  }

  async list(tenantId: string, filter: InventoryListFilter): Promise<InventoryListResult> {
    let items = [...this.inventories.values()].filter((i) => i.tenantId === tenantId);
    if (filter.storeId) items = items.filter((i) => i.storeId === filter.storeId);
    let stockLevels: StockLevel[] = items.map((i) => {
      const meta = this.productMeta(i.productId);
      return { ...i, ...meta, stockStatus: classifyStock(i.quantity, meta.minStock) };
    });
    if (filter.search) {
      const q = filter.search.toLowerCase();
      stockLevels = stockLevels.filter(
        (s) => s.productName.toLowerCase().includes(q) || s.sku.toLowerCase().includes(q),
      );
    }
    if (filter.stockStatus)
      stockLevels = stockLevels.filter((s) => s.stockStatus === filter.stockStatus);
    const total = stockLevels.length;
    const start = (filter.page - 1) * filter.pageSize;
    return {
      items: stockLevels.slice(start, start + filter.pageSize),
      total,
      page: filter.page,
      pageSize: filter.pageSize,
    };
  }

  async listLowStock(tenantId: string, storeId?: string): Promise<StockLevel[]> {
    let items = [...this.inventories.values()].filter((i) => i.tenantId === tenantId);
    if (storeId) items = items.filter((i) => i.storeId === storeId);
    return items
      .map((i) => {
        const meta = this.productMeta(i.productId);
        return { ...i, ...meta, stockStatus: classifyStock(i.quantity, meta.minStock) };
      })
      .filter((s) => s.stockStatus !== 'NORMAL');
  }

  async listMovements(
    tenantId: string,
    productId: string,
    limit: number,
  ): Promise<InventoryMovementRecord[]> {
    return this.movements
      .filter((m) => m.tenantId === tenantId && m.productId === productId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async applyMovement(input: ApplyMovementInput): Promise<ApplyMovementResult> {
    this.onApplyMovement?.(input);
    const key = this.key(input.storeId, input.productId);
    const existing = this.inventories.get(key);
    const currentQuantity = existing?.quantity ?? '0';
    const newQuantity = addDecimalStrings(currentQuantity, input.quantityChange, 3);

    const decreasingTypes = new Set(['ADJUSTMENT', 'SALE', 'TRANSFER_OUT']);
    if (decreasingTypes.has(input.type) && compareDecimalStrings(newQuantity, '0', 3) < 0) {
      throw new InsufficientStockError(
        `Cannot reduce stock below zero (current: ${currentQuantity}, change: ${input.quantityChange}).`,
      );
    }

    const inventory: InventoryRecord = {
      id: existing?.id ?? randomUUID(),
      tenantId: input.tenantId,
      storeId: input.storeId,
      productId: input.productId,
      quantity: newQuantity,
      updatedAt: new Date(),
    };
    this.inventories.set(key, inventory);

    const movement: InventoryMovementRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      storeId: input.storeId,
      productId: input.productId,
      type: input.type,
      quantityChange: input.quantityChange,
      balanceAfter: newQuantity,
      reason: input.reason ?? null,
      createdById: input.createdById,
      createdAt: new Date(),
    };
    this.movements.push(movement);

    return { inventory, movement };
  }

  /** Test helper so `list`/`listLowStock` can resolve product name/sku/minStock without a real join. */
  seed(record: InventoryRecord): InventoryRecord {
    this.inventories.set(this.key(record.storeId, record.productId), record);
    return record;
  }
}

function classifyStock(quantity: string, minStock: string): StockLevel['stockStatus'] {
  if (compareDecimalStrings(quantity, '0', 3) <= 0) return 'OUT_OF_STOCK';
  if (compareDecimalStrings(quantity, minStock, 3) <= 0) return 'LOW_STOCK';
  return 'NORMAL';
}

export class FakeSupplierRepository implements SupplierRepository {
  readonly suppliers = new Map<string, SupplierSummary>();

  async create(
    tenantId: string,
    input: {
      name: string;
      phone?: string;
      email?: string;
      address?: string;
      openingBalance?: string;
    },
  ): Promise<SupplierSummary> {
    const supplier: SupplierSummary = {
      id: randomUUID(),
      tenantId,
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
      openingBalance: roundDecimalString(input.openingBalance ?? '0', 2),
      isActive: true,
      createdAt: new Date(),
    };
    this.suppliers.set(supplier.id, supplier);
    return supplier;
  }
  async findById(id: string, tenantId: string): Promise<SupplierSummary | null> {
    const s = this.suppliers.get(id);
    return s && s.tenantId === tenantId ? s : null;
  }
  /** Wired by createFakeRepositories: purchases + payments are owned by FakePurchaseRepository. */
  purchasesRef: FakePurchaseRepository | null = null;

  async ledger(id: string, tenantId: string): Promise<Ledger | null> {
    const s = this.suppliers.get(id);
    if (!s || s.tenantId !== tenantId) return null;
    const purchases = [...(this.purchasesRef?.purchases.values() ?? [])].filter(
      (p) => p.tenantId === tenantId && p.supplierId === id,
    );
    const payments = (this.purchasesRef?.supplierPayments ?? []).filter(
      (p) => p.tenantId === tenantId && p.supplierId === id,
    );
    const raw: Omit<LedgerEntry, 'balance'>[] = [
      ...purchases.map((p) => ({
        date: p.purchaseDate,
        type: 'PURCHASE' as const,
        reference: p.purchaseNo,
        description: `Invoice ${p.invoiceNo}`,
        increase: p.total,
        decrease: '0.00',
      })),
      ...payments.map((p) => ({
        date: p.paidAt,
        type: 'SUPPLIER_PAYMENT' as const,
        reference: p.id,
        description: `Payment (${p.method.toLowerCase().replace('_', ' ')})`,
        increase: '0.00',
        decrease: p.amount,
      })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.reference.localeCompare(b.reference));
    return buildLedger(s.openingBalance, s.createdAt, raw);
  }

  async outstanding(tenantId: string): Promise<Outstanding> {
    const rows = [];
    for (const s of [...this.suppliers.values()].filter((x) => x.tenantId === tenantId)) {
      const l = await this.ledger(s.id, tenantId);
      rows.push({ id: s.id, name: s.name, phone: s.phone, balance: l!.balance });
    }
    return summariseOutstanding(rows);
  }

  async existsByName(tenantId: string, name: string): Promise<boolean> {
    return [...this.suppliers.values()].some((s) => s.tenantId === tenantId && s.name === name);
  }
  async list(tenantId: string, filter: { search?: string }): Promise<SupplierSummary[]> {
    return [...this.suppliers.values()].filter((s) => {
      if (s.tenantId !== tenantId || !s.isActive) return false;
      if (filter.search && !s.name.toLowerCase().includes(filter.search.toLowerCase()))
        return false;
      return true;
    });
  }

  seed(supplier: SupplierSummary): SupplierSummary {
    this.suppliers.set(supplier.id, supplier);
    return supplier;
  }
}

/**
 * Composes the Store/Product/Supplier/Inventory fakes to emulate the same
 * all-or-nothing contract as the real Prisma adapter: every relationship and
 * uniqueness check runs BEFORE any write, and the actual stock mutation
 * reuses `FakeInventoryRepository.applyMovement` directly (the same code
 * every other inventory-affecting operation uses) rather than duplicating
 * its logic - see `domain/ports.ts`'s `PurchaseRepository` doc comment.
 */
export class FakePurchaseRepository implements PurchaseRepository {
  readonly purchases = new Map<string, PurchaseDetail>();
  readonly supplierPayments: {
    id: string;
    tenantId: string;
    purchaseId: string;
    supplierId: string;
    amount: string;
    method: string;
    createdById: string;
    paidAt: Date;
  }[] = [];
  /** Purchase numbers are per branch, mirroring @@unique([tenantId, storeId, purchaseNo]). */
  private readonly sequences = new Map<string, number>();
  /** Serialises writes the way a DB serialises conflicting transactions (unique-constraint check + insert are atomic). */
  private lock: Promise<unknown> = Promise.resolve();
  /** Test hook: called after the purchase row is created, before stock/payment/audit writes. */
  afterPurchaseInsert: (() => void) | null = null;
  /** Test hook: called before the supplier payment row is written. */
  onPaymentWrite: (() => void) | null = null;

  constructor(
    private readonly stores: FakeStoreRepository,
    private readonly products: FakeProductRepository,
    private readonly suppliers: FakeSupplierRepository,
    private readonly inventory: FakeInventoryRepository,
    private readonly barcodes: FakeBarcodeRepository,
    private readonly audit: FakeAuditLogRepository,
  ) {}

  /**
   * Runs `work` as an all-or-nothing unit: serialised, and every in-memory collection a purchase touches is
   * snapshotted first and restored if `work` throws. This is a MODEL of a DB transaction for fast unit tests;
   * the real guarantee is proven by tests/integration against PostgreSQL.
   */
  private transact<T>(work: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const snap = {
        purchases: new Map(this.purchases),
        sequences: new Map(this.sequences),
        payments: this.supplierPayments.length,
        inventories: new Map(this.inventory.inventories),
        movements: this.inventory.movements.length,
        audit: this.audit.entries.length,
      };
      try {
        return await work();
      } catch (err) {
        this.purchases.clear();
        snap.purchases.forEach((v, k) => this.purchases.set(k, v));
        this.sequences.clear();
        snap.sequences.forEach((v, k) => this.sequences.set(k, v));
        this.supplierPayments.length = snap.payments;
        this.inventory.inventories.clear();
        snap.inventories.forEach((v, k) => this.inventory.inventories.set(k, v));
        this.inventory.movements.length = snap.movements;
        this.audit.entries.length = snap.audit;
        throw err;
      }
    };
    const result = this.lock.then(run, run);
    this.lock = result.catch(() => undefined);
    return result;
  }

  async findById(id: string, tenantId: string): Promise<PurchaseDetail | null> {
    const p = this.purchases.get(id);
    return p && p.tenantId === tenantId ? p : null;
  }

  async existsByInvoiceNo(
    tenantId: string,
    supplierId: string,
    invoiceNo: string,
  ): Promise<boolean> {
    return [...this.purchases.values()].some(
      (p) => p.tenantId === tenantId && p.supplierId === supplierId && p.invoiceNo === invoiceNo,
    );
  }

  async list(tenantId: string, filter: PurchaseListFilter): Promise<PurchaseListResult> {
    let items = [...this.purchases.values()].filter((p) => p.tenantId === tenantId);
    if (filter.supplierId) items = items.filter((p) => p.supplierId === filter.supplierId);
    if (filter.storeId) items = items.filter((p) => p.storeId === filter.storeId);
    if (filter.paymentStatus) items = items.filter((p) => p.paymentStatus === filter.paymentStatus);
    if (filter.search) {
      const q = filter.search.toLowerCase();
      items = items.filter(
        (p) => p.invoiceNo.toLowerCase().includes(q) || p.purchaseNo.toLowerCase().includes(q),
      );
    }
    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = items.length;
    const start = (filter.page - 1) * filter.pageSize;
    const page: PurchaseSummary[] = items.slice(start, start + filter.pageSize).map((p) => {
      const { items: _lineItems, ...summary } = p;
      return summary;
    });
    return { items: page, total, page: filter.page, pageSize: filter.pageSize };
  }

  recordPurchase(input: RecordPurchaseInput): Promise<PurchaseDetail> {
    return this.transact(() => this.recordPurchaseInTx(input));
  }

  private async recordPurchaseInTx(input: RecordPurchaseInput): Promise<PurchaseDetail> {
    // 1. Validate every relationship BEFORE writing anything.
    const supplier = this.suppliers.suppliers.get(input.supplierId);
    if (!supplier || supplier.tenantId !== input.tenantId) {
      throw new InvalidPurchaseRelationshipError('Selected supplier does not exist.');
    }
    const store = this.stores.stores.get(input.storeId);
    if (!store || store.tenantId !== input.tenantId) {
      throw new InvalidPurchaseRelationshipError('Selected branch does not exist.');
    }
    for (const item of input.items) {
      const product = this.products.products.get(item.productId);
      if (!product || product.tenantId !== input.tenantId) {
        throw new InvalidPurchaseRelationshipError(`Product ${item.productId} does not exist.`);
      }
    }
    if (await this.existsByInvoiceNo(input.tenantId, input.supplierId, input.invoiceNo)) {
      throw new DuplicatePurchaseError(
        `Invoice "${input.invoiceNo}" was already recorded for this supplier.`,
      );
    }

    // 2. Compute totals (pure, no I/O - the exact same calculator the Prisma adapter uses).
    const computedLines = input.items.map((item) => computeLine(item));
    const totals = computeTotals(computedLines, {
      discountPercent: input.purchaseDiscountPercent,
      discountAmount: input.purchaseDiscountAmount,
    });
    const paidAmount = roundDecimalString(input.initialPayment?.amount ?? '0', 2);
    const paymentStatus = resolvePaymentStatus(totals.total, paidAmount);

    // 3. Only now, with every check passed, commit every write.
    const id = randomUUID();
    const seq = (this.sequences.get(input.storeId) ?? 0) + 1;
    this.sequences.set(input.storeId, seq);
    const purchaseNo = `PO-${String(seq).padStart(6, '0')}`;
    this.afterPurchaseInsert?.();

    // Sequential (like the Prisma adapter): lines apply in order inside the one transaction.
    const lineResults = [];
    for (const [i, item] of input.items.entries()) {
      {
        const computed = computedLines[i]!;
        const product = this.products.products.get(item.productId)!;
        await this.inventory.applyMovement({
          tenantId: input.tenantId,
          storeId: input.storeId,
          productId: item.productId,
          type: 'PURCHASE',
          quantityChange: item.quantity,
          unitCost: item.costPrice,
          createdById: input.createdById,
          referenceType: 'Purchase',
          referenceId: id,
        });
        lineResults.push({
          id: randomUUID(),
          productId: item.productId,
          productName: product.name,
          sku: product.sku,
          barcodes: [...this.barcodes.codes.entries()]
            .filter(([, v]) => v.productId === item.productId)
            .map(([code]) => code),
          quantity: item.quantity,
          costPrice: item.costPrice,
          discountPercent: computed.discountPercent,
          discountAmount: computed.discountAmount,
          taxRate: computed.taxRate,
          taxAmount: computed.taxAmount,
          lineTotal: computed.lineTotal,
        });
      }
    }

    const purchase: PurchaseDetail = {
      id,
      tenantId: input.tenantId,
      storeId: input.storeId,
      supplierId: input.supplierId,
      purchaseNo,
      invoiceNo: input.invoiceNo,
      purchaseDate: input.purchaseDate,
      subtotal: totals.subtotal,
      discountPercent: totals.discountPercent,
      discountAmount: totals.discountAmount,
      taxTotal: totals.taxTotal,
      total: totals.total,
      paidAmount,
      paymentStatus,
      createdById: input.createdById,
      createdAt: new Date(),
      items: lineResults,
    };
    this.purchases.set(id, purchase);

    if (input.initialPayment) {
      this.onPaymentWrite?.();
      this.supplierPayments.push({
        id: randomUUID(),
        tenantId: input.tenantId,
        purchaseId: id,
        supplierId: input.supplierId,
        amount: paidAmount,
        method: input.initialPayment.method,
        createdById: input.createdById,
        paidAt: new Date(),
      });
    }

    await this.audit.record({
      tenantId: input.tenantId,
      userId: input.audit.userId,
      action: input.audit.action,
      entity: 'Purchase',
      entityId: id,
      metadata: {
        ...input.audit.metadata,
        purchaseNo,
        total: totals.total,
        paymentStatus,
      },
    });

    return purchase;
  }

  recordPayment(input: RecordPurchasePaymentInput): Promise<PurchaseDetail> {
    return this.transact(() => this.recordPaymentInTx(input));
  }

  private async recordPaymentInTx(input: RecordPurchasePaymentInput): Promise<PurchaseDetail> {
    const purchase = this.purchases.get(input.purchaseId);
    if (!purchase || purchase.tenantId !== input.tenantId) {
      throw new InvalidPurchaseRelationshipError('Purchase not found.');
    }
    const newPaidAmount = addDecimalStrings(purchase.paidAmount, input.amount, 2);
    if (compareDecimalStrings(newPaidAmount, purchase.total, 2) > 0) {
      throw new PaymentExceedsBalanceError('Payment would exceed the outstanding balance.');
    }
    const updated: PurchaseDetail = {
      ...purchase,
      paidAmount: newPaidAmount,
      paymentStatus: resolvePaymentStatus(purchase.total, newPaidAmount),
    };
    this.purchases.set(purchase.id, updated);
    this.onPaymentWrite?.();
    this.supplierPayments.push({
      id: randomUUID(),
      tenantId: input.tenantId,
      purchaseId: purchase.id,
      supplierId: purchase.supplierId,
      amount: input.amount,
      method: input.method,
      createdById: input.createdById,
      paidAt: new Date(),
    });
    await this.audit.record({
      tenantId: input.tenantId,
      userId: input.audit.userId,
      action: input.audit.action,
      entity: 'Purchase',
      entityId: purchase.id,
      metadata: {
        ...input.audit.metadata,
        purchaseNo: purchase.purchaseNo,
        total: purchase.total,
        paymentStatusAfter: updated.paymentStatus,
      },
    });
    return updated;
  }
}

export interface FakeRepositories extends Repositories {
  users: FakeUserRepository;
  roles: FakeRoleRepository;
  tenants: FakeTenantRepository;
  sessions: FakeSessionRepository;
  loginAttempts: FakeLoginAttemptRepository;
  auditLogs: FakeAuditLogRepository;
  loginIdHistory: FakeLoginIdHistoryRepository;
  tenantProvisioning: FakeTenantProvisioningRepository;
  stores: FakeStoreRepository;
  licenses: FakeLicenseRepository;
  systemHealth: FakeSystemHealthRepository;
  categories: FakeCategoryRepository;
  subDepartments: FakeSubDepartmentRepository;
  brands: FakeBrandRepository;
  products: FakeProductRepository;
  barcodes: FakeBarcodeRepository;
  inventory: FakeInventoryRepository;
  suppliers: FakeSupplierRepository;
  purchases: FakePurchaseRepository;
  sales: FakeSaleRepository;
  customers: FakeCustomerRepository;
  expenses: FakeExpenseRepository;
  employees: FakeEmployeeRepository;
  reports: FakeReportRepository;
}

export const createFakeRepositories = (): FakeRepositories => {
  const users = new FakeUserRepository();
  const roles = new FakeRoleRepository();
  const tenants = new FakeTenantRepository();
  const stores = new FakeStoreRepository();
  const licenses = new FakeLicenseRepository();
  const barcodes = new FakeBarcodeRepository();
  const products = new FakeProductRepository(barcodes);
  const inventoryRepo = new FakeInventoryRepository(products);
  const suppliers = new FakeSupplierRepository();
  const auditLogs = new FakeAuditLogRepository();
  const categories = new FakeCategoryRepository();
  const sales = new FakeSaleRepository(stores, products, inventoryRepo, auditLogs);
  const expenses = new FakeExpenseRepository(sales, auditLogs);
  const purchases = new FakePurchaseRepository(
    stores,
    products,
    suppliers,
    inventoryRepo,
    barcodes,
    auditLogs,
  );
  suppliers.purchasesRef = purchases;
  return {
    users,
    roles,
    tenants,
    sessions: new FakeSessionRepository(),
    loginAttempts: new FakeLoginAttemptRepository(),
    auditLogs,
    loginIdHistory: new FakeLoginIdHistoryRepository(),
    tenantProvisioning: new FakeTenantProvisioningRepository(
      tenants,
      stores,
      roles,
      users,
      licenses,
    ),
    stores,
    licenses,
    systemHealth: new FakeSystemHealthRepository(),
    categories,
    subDepartments: new FakeSubDepartmentRepository(),
    brands: new FakeBrandRepository(),
    products,
    barcodes,
    inventory: inventoryRepo,
    suppliers,
    purchases,
    sales,
    customers: new FakeCustomerRepository(sales, auditLogs),
    expenses,
    employees: new FakeEmployeeRepository(sales, auditLogs),
    reports: new FakeReportRepository(sales, products, categories, inventoryRepo, expenses),
  };
};
