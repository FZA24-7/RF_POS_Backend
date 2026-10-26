import { describe, expect, it } from 'vitest';
import { TenantManagementService } from '../../src/services/tenant-management.service.js';
import { PasswordHasher } from '../../src/security/password.js';
import { buildScenario } from '../fakes/scenario.js';

const hasher = new PasswordHasher({ memoryCostKib: 19456, timeCost: 2 });
const masterActor = (scenario: Awaited<ReturnType<typeof buildScenario>>) => ({
  id: scenario.masterAdmin.id,
  tenantId: null,
});

describe('TenantManagementService.list / getDetail', () => {
  it('lists tenants and supports search + status filtering', async () => {
    const scenario = await buildScenario();
    const svc = new TenantManagementService(scenario.repos, hasher);

    const all = await svc.list({ search: undefined, status: undefined, page: 1, pageSize: 20 });
    expect(all.total).toBe(2);

    const byCode = await svc.list({ search: 'TEN-A', status: undefined, page: 1, pageSize: 20 });
    expect(byCode.items.map((t) => t.id)).toEqual([scenario.tenantA.id]);
  });

  it('getDetail throws NOT_FOUND for an unknown tenant', async () => {
    const scenario = await buildScenario();
    const svc = new TenantManagementService(scenario.repos, hasher);
    await expect(svc.getDetail('does-not-exist')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('TenantManagementService.updateStatus', () => {
  it('suspending a tenant revokes every session belonging to its users', async () => {
    const scenario = await buildScenario();
    const svc = new TenantManagementService(scenario.repos, hasher);

    // Give the tenant's manager a live session.
    const session = await scenario.repos.sessions.create({
      userId: scenario.tenantAManager.id,
      tenantId: scenario.tenantA.id,
      refreshTokenHash: 'hash-1',
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    await svc.updateStatus(masterActor(scenario), scenario.tenantA.id, 'SUSPENDED', 'non-payment');

    const after = await scenario.repos.sessions.findByRefreshTokenHash('hash-1');
    expect(after?.id).toBe(session.id);
    expect(after?.revokedAt).not.toBeNull();

    const tenant = await scenario.repos.tenants.findById(scenario.tenantA.id);
    expect(tenant?.status).toBe('SUSPENDED');

    expect(scenario.repos.auditLogs.entries).toContainEqual(
      expect.objectContaining({ action: 'TENANT_STATUS_CHANGED', entityId: scenario.tenantA.id }),
    );
  });

  it('does NOT touch Tenant B sessions when suspending Tenant A (tenant isolation)', async () => {
    const scenario = await buildScenario();
    const svc = new TenantManagementService(scenario.repos, hasher);
    const bSession = await scenario.repos.sessions.create({
      userId: scenario.tenantBClientAdmin.id,
      tenantId: scenario.tenantB.id,
      refreshTokenHash: 'hash-b',
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    await svc.updateStatus(masterActor(scenario), scenario.tenantA.id, 'SUSPENDED');

    const after = await scenario.repos.sessions.findByRefreshTokenHash('hash-b');
    expect(after?.id).toBe(bSession.id);
    expect(after?.revokedAt).toBeNull();
  });
});

describe('TenantManagementService.createClientAdmin', () => {
  it('creates an additional Client Master Admin for an existing tenant', async () => {
    const scenario = await buildScenario();
    const svc = new TenantManagementService(scenario.repos, hasher);
    const created = await svc.createClientAdmin(masterActor(scenario), scenario.tenantA.id, {
      loginId: 'a.admin2',
      password: 'SecondAdminPass123',
      displayName: 'Second Admin',
    });
    expect(created).toMatchObject({
      loginId: 'a.admin2',
      systemRole: 'CLIENT_MASTER_ADMIN',
      tenantId: scenario.tenantA.id,
    });
    expect(scenario.repos.auditLogs.entries).toContainEqual(
      expect.objectContaining({ action: 'CLIENT_ADMIN_CREATED' }),
    );
  });

  it('rejects a duplicate Login ID', async () => {
    const scenario = await buildScenario();
    const svc = new TenantManagementService(scenario.repos, hasher);
    await expect(
      svc.createClientAdmin(masterActor(scenario), scenario.tenantA.id, {
        loginId: scenario.tenantAManager.loginId,
        password: 'WhateverPass123',
        displayName: 'Dup',
      }),
    ).rejects.toMatchObject({ code: 'LOGIN_ID_TAKEN' });
  });
});

describe('TenantManagementService.setUserStatus', () => {
  it('disabling a user revokes their sessions and is audited', async () => {
    const scenario = await buildScenario();
    const svc = new TenantManagementService(scenario.repos, hasher);
    await scenario.repos.sessions.create({
      userId: scenario.tenantACashier.id,
      tenantId: scenario.tenantA.id,
      refreshTokenHash: 'cashier-hash',
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    await svc.setUserStatus(
      masterActor(scenario),
      scenario.tenantACashier.id,
      'DISABLED',
      'policy violation',
    );

    const user = await scenario.repos.users.findById(scenario.tenantACashier.id);
    expect(user?.status).toBe('DISABLED');
    const session = await scenario.repos.sessions.findByRefreshTokenHash('cashier-hash');
    expect(session?.revokedAt).not.toBeNull();
    expect(scenario.repos.auditLogs.entries).toContainEqual(
      expect.objectContaining({
        action: 'USER_STATUS_CHANGED',
        entityId: scenario.tenantACashier.id,
      }),
    );
  });
});

describe('TenantManagementService.resetPassword', () => {
  it('hashes the new password, revokes sessions, and audits the reset', async () => {
    const scenario = await buildScenario();
    const svc = new TenantManagementService(scenario.repos, hasher);
    await scenario.repos.sessions.create({
      userId: scenario.tenantAManager.id,
      tenantId: scenario.tenantA.id,
      refreshTokenHash: 'manager-hash',
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const before = (await scenario.repos.users.findById(scenario.tenantAManager.id))!.passwordHash;
    await svc.resetPassword(
      masterActor(scenario),
      scenario.tenantAManager.id,
      'BrandNewPassword123',
    );
    const after = (await scenario.repos.users.findById(scenario.tenantAManager.id))!.passwordHash;

    expect(after).not.toBe(before);
    expect(after).not.toBe('BrandNewPassword123');
    const session = await scenario.repos.sessions.findByRefreshTokenHash('manager-hash');
    expect(session?.revokedAt).not.toBeNull();
    expect(scenario.repos.auditLogs.entries).toContainEqual(
      expect.objectContaining({ action: 'USER_PASSWORD_RESET' }),
    );
  });

  it('refuses to let an actor reset their OWN password through this admin flow', async () => {
    const scenario = await buildScenario();
    const svc = new TenantManagementService(scenario.repos, hasher);
    await expect(
      svc.resetPassword(
        { id: scenario.masterAdmin.id, tenantId: null },
        scenario.masterAdmin.id,
        'SomeNewPass123',
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
