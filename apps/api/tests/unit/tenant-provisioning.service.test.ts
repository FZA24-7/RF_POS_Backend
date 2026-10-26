import { describe, expect, it } from 'vitest';
import { MODULE_CATALOG } from '@mafk/shared';
import type { CreateTenantInput } from '@mafk/validation';
import { TenantProvisioningService } from '../../src/services/tenant-provisioning.service.js';
import { PasswordHasher } from '../../src/security/password.js';
import { createFakeRepositories } from '../fakes/in-memory-repositories.js';

const hasher = new PasswordHasher({ memoryCostKib: 19456, timeCost: 2 });
const actor = { id: 'master-1' };

const validInput = (overrides: Partial<CreateTenantInput> = {}): CreateTenantInput => ({
  code: 'ACME',
  name: 'Acme Retail',
  defaultStoreName: 'Acme Main Branch',
  masterAdmin: { loginId: 'acme.admin', password: 'AcmeAdminPass123', displayName: 'Acme Admin' },
  license: {
    planCode: 'STANDARD',
    expiresAt: new Date(Date.now() + 365 * 86_400_000),
    maxUsers: 10,
    maxDevices: 5,
    maxStores: 3,
    enabledModules: [...MODULE_CATALOG],
  },
  ...overrides,
});

describe('TenantProvisioningService.createTenant', () => {
  it('creates a Tenant + default Store + 4 default Roles + Client Master Admin + License, atomically', async () => {
    const repos = createFakeRepositories();
    const service = new TenantProvisioningService(repos, hasher);

    const result = await service.createTenant(actor, validInput());

    expect(await repos.tenants.findById(result.tenantId)).toMatchObject({
      code: 'ACME',
      status: 'ACTIVE',
    });
    const stores = await repos.stores.listByTenant(result.tenantId);
    expect(stores).toHaveLength(1);
    expect(stores[0]).toMatchObject({ isDefault: true, name: 'Acme Main Branch' });

    const roles = [...repos.roles.roles.values()].filter((r) => r.tenantId === result.tenantId);
    expect(roles.map((r) => r.systemRole).sort()).toEqual(
      ['CASHIER', 'CLIENT_MASTER_ADMIN', 'INVENTORY_STAFF', 'MANAGER'].sort(),
    );

    const admin = await repos.users.findById(result.clientAdminUserId);
    expect(admin).toMatchObject({
      loginId: 'acme.admin',
      systemRole: 'CLIENT_MASTER_ADMIN',
      tenantId: result.tenantId,
    });
    // The password was actually hashed, not stored in plaintext.
    expect(admin?.passwordHash).not.toBe('AcmeAdminPass123');
    expect(admin?.passwordHash.length).toBeGreaterThan(20);

    const license = await repos.licenses.findById(result.licenseId);
    expect(license).toMatchObject({
      tenantId: result.tenantId,
      planCode: 'STANDARD',
      status: 'ACTIVE',
    });

    expect(repos.auditLogs.entries).toContainEqual(
      expect.objectContaining({ action: 'TENANT_CREATED', entityId: result.tenantId }),
    );
  });

  it('rejects a duplicate tenant code and leaves NOTHING behind (no tenant, no store, no roles, no user, no license)', async () => {
    const repos = createFakeRepositories();
    const service = new TenantProvisioningService(repos, hasher);
    await service.createTenant(actor, validInput());

    const beforeTenants = repos.tenants.tenants.size;
    const beforeUsers = repos.users.users.size;
    const beforeLicenses = repos.licenses.licenses.size;
    const beforeStores = repos.stores.stores.size;
    const beforeRoles = repos.roles.roles.size;

    await expect(
      service.createTenant(
        actor,
        validInput({
          masterAdmin: {
            loginId: 'someone.else',
            password: 'AnotherPass123',
            displayName: 'Someone',
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // Nothing was added by the failed attempt - true rollback, not a partial write.
    expect(repos.tenants.tenants.size).toBe(beforeTenants);
    expect(repos.users.users.size).toBe(beforeUsers);
    expect(repos.licenses.licenses.size).toBe(beforeLicenses);
    expect(repos.stores.stores.size).toBe(beforeStores);
    expect(repos.roles.roles.size).toBe(beforeRoles);
  });

  it('rejects a duplicate Client Master Admin Login ID and leaves NOTHING behind', async () => {
    const repos = createFakeRepositories();
    const service = new TenantProvisioningService(repos, hasher);
    await service.createTenant(actor, validInput());

    const beforeTenants = repos.tenants.tenants.size;

    await expect(
      service.createTenant(actor, validInput({ code: 'OTHER' })), // same masterAdmin.loginId as before
    ).rejects.toMatchObject({ code: 'LOGIN_ID_TAKEN' });

    expect(repos.tenants.tenants.size).toBe(beforeTenants);
    expect(await repos.tenants.existsByCode('OTHER')).toBe(false);
  });

  it('normalizes the tenant code to uppercase and the Login ID to lowercase', async () => {
    const repos = createFakeRepositories();
    const service = new TenantProvisioningService(repos, hasher);
    const result = await service.createTenant(
      actor,
      validInput({
        code: 'lowercase-co',
        masterAdmin: { loginId: 'MixedCase.Admin', password: 'Pass12345678', displayName: 'X' },
      }),
    );
    expect(await repos.tenants.existsByCode('LOWERCASE-CO')).toBe(true);
    const admin = await repos.users.findById(result.clientAdminUserId);
    expect(admin?.loginId).toBe('mixedcase.admin');
  });
});
