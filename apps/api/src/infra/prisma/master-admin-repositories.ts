// DATABASE STATUS (Phase 4.2): NOT yet exercised against a database (tenant provisioning, stores, licences, health).
// Typechecked against the generated client.
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_CATALOG } from '@mafk/shared';
import type { PrismaClient } from '@mafk/database';
import type {
  LicenseRepository,
  StoreRepository,
  SystemHealthRepository,
  TenantProvisioningRepository,
} from '../../domain/ports.js';
import {
  ProvisioningConflictError,
  type LicenseSummary,
  type ProvisionTenantInput,
  type ProvisionTenantResult,
  type StoreSummary,
} from '../../domain/types.js';

const toLicenseSummary = (row: {
  id: string;
  tenantId: string;
  planCode: string;
  status: string;
  startsAt: Date;
  expiresAt: Date;
  maxUsers: number;
  maxDevices: number;
  maxStores: number;
  enabledModules: string[];
  createdAt: Date;
}): LicenseSummary => ({
  id: row.id,
  tenantId: row.tenantId,
  planCode: row.planCode,
  status: row.status as LicenseSummary['status'],
  startsAt: row.startsAt,
  expiresAt: row.expiresAt,
  maxUsers: row.maxUsers,
  maxDevices: row.maxDevices,
  maxStores: row.maxStores,
  enabledModules: row.enabledModules,
  createdAt: row.createdAt,
});

const toStoreSummary = (row: {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
}): StoreSummary => ({
  id: row.id,
  tenantId: row.tenantId,
  code: row.code,
  name: row.name,
  isDefault: row.isDefault,
  isActive: row.isActive,
});

export class PrismaTenantProvisioningRepository implements TenantProvisioningRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async provision(input: ProvisionTenantInput): Promise<ProvisionTenantResult> {
    try {
      // The permission catalog is GLOBAL (not per tenant). Make sure it exists BEFORE opening the transaction, so
      // creating a client never depends on `pnpm db:seed` having been run, and so the transaction itself stays short.
      await this.prisma.permission.createMany({
        data: PERMISSION_CATALOG.map((key) => {
          const [resource, ...rest] = key.split('.');
          return { key, resource: resource ?? key, action: rest.join('.') || 'view' };
        }),
        skipDuplicates: true,
      });
      const permissionRows = await this.prisma.permission.findMany({
        select: { id: true, key: true },
      });
      const permissionIdByKey = new Map(permissionRows.map((p) => [p.key, p.id]));

      return await this.prisma.$transaction(
        async (tx) => {
          const tenant = await tx.tenant.create({
            data: {
              code: input.code,
              name: input.name,
              legalName: input.legalName ?? null,
              contactEmail: input.contactEmail ?? null,
              contactPhone: input.contactPhone ?? null,
              address: input.address ?? null,
              currency: input.currency ?? 'PKR',
              timezone: input.timezone ?? 'Asia/Karachi',
            },
          });

          const store = await tx.store.create({
            data: {
              tenantId: tenant.id,
              code: 'MAIN',
              name: input.defaultStoreName,
              isDefault: true,
            },
          });

          // Create all four default tenant roles up front, so later phases can immediately assign
          // Manager/Cashier/Inventory Staff without a separate "initialize roles" step. Role permissions are
          // inserted in ONE bulk statement per role (not one INSERT per permission), because this runs over a
          // network connection to a hosted database and must finish well inside the transaction timeout.
          const roleEntries = (
            ['CLIENT_MASTER_ADMIN', 'MANAGER', 'CASHIER', 'INVENTORY_STAFF'] as const
          ).map((systemRole) => ({
            key: systemRole.toLowerCase().replace(/_/g, '-'),
            systemRole,
            permissions: DEFAULT_ROLE_PERMISSIONS[systemRole],
          }));

          const createdRoles: Record<string, { id: string }> = {};
          for (const entry of roleEntries) {
            const role = await tx.role.create({
              data: {
                tenantId: tenant.id,
                key: entry.key,
                name: entry.systemRole,
                systemRole: entry.systemRole,
                isSystem: true,
              },
            });
            createdRoles[entry.systemRole] = { id: role.id };

            const links = entry.permissions.map((key) => {
              const permissionId = permissionIdByKey.get(key);
              if (!permissionId) {
                throw new Error(`Permission "${key}" is missing from the permissions table.`);
              }
              return { roleId: role.id, permissionId };
            });
            await tx.rolePermission.createMany({ data: links, skipDuplicates: true });
          }

          const clientAdminRole = createdRoles.CLIENT_MASTER_ADMIN;
          if (!clientAdminRole) {
            throw new Error(
              'Client Master Admin role was not created - this is a bug, not a validation failure.',
            );
          }

          const clientAdmin = await tx.user.create({
            data: {
              tenantId: tenant.id,
              storeId: store.id,
              roleId: clientAdminRole.id,
              loginId: input.masterAdmin.loginId,
              displayName: input.masterAdmin.displayName,
              email: input.masterAdmin.email ?? null,
              passwordHash: input.masterAdmin.passwordHash,
              status: 'ACTIVE',
            },
          });

          const license = await tx.license.create({
            data: {
              tenantId: tenant.id,
              planCode: input.license.planCode,
              licenseKey: `${tenant.code}-${tenant.id.slice(0, 8)}`,
              expiresAt: input.license.expiresAt,
              maxUsers: input.license.maxUsers,
              maxDevices: input.license.maxDevices,
              maxStores: input.license.maxStores,
              enabledModules: [...input.license.enabledModules],
            },
          });

          return {
            tenantId: tenant.id,
            storeId: store.id,
            clientAdminUserId: clientAdmin.id,
            licenseId: license.id,
          };
        },
        // Prisma's default is a 5 s interactive-transaction timeout / 2 s maxWait, which a hosted database
        // (e.g. Supabase over the internet) can exceed - that surfaced as "Transaction already closed".
        { maxWait: 20_000, timeout: 60_000 },
      );
    } catch (err) {
      // Prisma's unique-constraint violation code. Translated to the domain
      // error so the service layer doesn't need to know about Prisma error
      // shapes. The transaction above guarantees nothing was partially
      // written before this point - $transaction rolls back the entire block.
      if (isUniqueConstraintError(err, 'code')) {
        throw new ProvisioningConflictError(
          'code',
          `Tenant code "${input.code}" is already in use.`,
        );
      }
      if (isUniqueConstraintError(err, 'loginId')) {
        throw new ProvisioningConflictError(
          'loginId',
          `Login ID "${input.masterAdmin.loginId}" is already in use.`,
        );
      }
      throw err;
    }
  }

  async addClientAdmin(
    tenantId: string,
    input: { loginId: string; passwordHash: string; displayName: string; email?: string },
  ): Promise<{ id: string }> {
    const role = await this.prisma.role.findFirst({
      where: { tenantId, systemRole: 'CLIENT_MASTER_ADMIN' },
    });
    if (!role)
      throw new Error(
        `Tenant ${tenantId} has no Client Master Admin role - was it provisioned correctly?`,
      );
    const user = await this.prisma.user.create({
      data: {
        tenantId,
        roleId: role.id,
        loginId: input.loginId,
        displayName: input.displayName,
        email: input.email ?? null,
        passwordHash: input.passwordHash,
        status: 'ACTIVE',
      },
    });
    return { id: user.id };
  }
}

/**
 * Narrow check for Prisma's P2002 unique-constraint error on a given field, without importing Prisma's error class
 * directly. With driver adapters (PrismaPg) `meta.target` is not always populated, so the constraint's field list,
 * the adapter's own error details and finally the message text are inspected as well.
 */
function isUniqueConstraintError(err: unknown, field: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as {
    code?: string;
    message?: string;
    meta?: {
      target?: string[] | string;
      driverAdapterError?: { cause?: { constraint?: { fields?: string[] } } };
    };
  };
  if (e.code !== 'P2002') return false;
  const target = e.meta?.target;
  const fromTarget = Array.isArray(target) ? target : typeof target === 'string' ? [target] : [];
  const fromAdapter = e.meta?.driverAdapterError?.cause?.constraint?.fields ?? [];
  const haystack = [...fromTarget, ...fromAdapter, e.message ?? ''];
  return haystack.some((t) => t.toLowerCase().includes(field.toLowerCase()));
}

export class PrismaStoreRepository implements StoreRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listByTenant(tenantId: string): Promise<StoreSummary[]> {
    const rows = await this.prisma.store.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toStoreSummary);
  }
}

export class PrismaLicenseRepository implements LicenseRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<LicenseSummary | null> {
    const row = await this.prisma.license.findUnique({ where: { id } });
    return row ? toLicenseSummary(row) : null;
  }

  async findActiveByTenant(tenantId: string): Promise<LicenseSummary | null> {
    const row = await this.prisma.license.findFirst({
      where: { tenantId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toLicenseSummary(row) : null;
  }

  async listByTenant(tenantId: string): Promise<LicenseSummary[]> {
    const rows = await this.prisma.license.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toLicenseSummary);
  }

  async listAll(): Promise<LicenseSummary[]> {
    const rows = await this.prisma.license.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(toLicenseSummary);
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
    const row = await this.prisma.license.create({
      data: {
        tenantId,
        planCode: input.planCode,
        licenseKey: `${tenantId.slice(0, 8)}-${Date.now()}`,
        expiresAt: input.expiresAt,
        maxUsers: input.maxUsers,
        maxDevices: input.maxDevices,
        maxStores: input.maxStores,
        enabledModules: [...input.enabledModules],
      },
    });
    return toLicenseSummary(row);
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
    await this.prisma.license.update({ where: { id }, data: patch });
  }

  async updateStatus(id: string, status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED'): Promise<void> {
    await this.prisma.license.update({ where: { id }, data: { status } });
  }

  async updateModules(id: string, enabledModules: readonly string[]): Promise<void> {
    await this.prisma.license.update({
      where: { id },
      data: { enabledModules: [...enabledModules] },
    });
  }
}

export class PrismaSystemHealthRepository implements SystemHealthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
