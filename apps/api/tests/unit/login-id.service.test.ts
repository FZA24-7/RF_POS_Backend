import { describe, expect, it } from 'vitest';
import type { PolicyActor } from '@mafk/shared';
import { LoginIdService } from '../../src/services/login-id.service.js';
import { buildScenario } from '../fakes/scenario.js';

const actorOf = (
  u: { id: string; tenantId: string | null },
  systemRole: PolicyActor['systemRole'],
): PolicyActor => ({
  id: u.id,
  tenantId: u.tenantId,
  systemRole,
});

const meta = { ipAddress: '127.0.0.1', userAgent: 'vitest' };

describe('LoginIdService - self-edit is always forbidden', () => {
  it('Client Master Admin cannot edit their own Login ID', async () => {
    const scenario = await buildScenario();
    const svc = new LoginIdService(scenario.repos);
    const actor = actorOf(scenario.tenantAClientAdmin, 'CLIENT_MASTER_ADMIN');
    await expect(
      svc.changeLoginId({
        actor,
        targetUserId: scenario.tenantAClientAdmin.id,
        newLoginId: 'new.id',
        ...meta,
      }),
    ).rejects.toMatchObject({ code: 'LOGIN_ID_SELF_EDIT_FORBIDDEN' });
  });

  it('Manager cannot edit their own Login ID', async () => {
    const scenario = await buildScenario();
    const svc = new LoginIdService(scenario.repos);
    const actor = actorOf(scenario.tenantAManager, 'MANAGER');
    await expect(
      svc.changeLoginId({
        actor,
        targetUserId: scenario.tenantAManager.id,
        newLoginId: 'new.id',
        ...meta,
      }),
    ).rejects.toMatchObject({ code: 'LOGIN_ID_SELF_EDIT_FORBIDDEN' });
  });

  it('Cashier cannot edit their own Login ID', async () => {
    const scenario = await buildScenario();
    const svc = new LoginIdService(scenario.repos);
    const actor = actorOf(scenario.tenantACashier, 'CASHIER');
    await expect(
      svc.changeLoginId({
        actor,
        targetUserId: scenario.tenantACashier.id,
        newLoginId: 'new.id',
        ...meta,
      }),
    ).rejects.toMatchObject({ code: 'LOGIN_ID_SELF_EDIT_FORBIDDEN' });
  });

  it('Master Admin cannot edit their own Login ID either', async () => {
    const scenario = await buildScenario();
    const svc = new LoginIdService(scenario.repos);
    const actor = actorOf(scenario.masterAdmin, 'MASTER_ADMIN');
    await expect(
      svc.changeLoginId({
        actor,
        targetUserId: scenario.masterAdmin.id,
        newLoginId: 'new.id',
        ...meta,
      }),
    ).rejects.toMatchObject({ code: 'LOGIN_ID_SELF_EDIT_FORBIDDEN' });
  });
});

describe('LoginIdService - Client Master Admin authority', () => {
  it('CAN change a Manager Login ID inside their own tenant', async () => {
    const scenario = await buildScenario();
    const svc = new LoginIdService(scenario.repos);
    const actor = actorOf(scenario.tenantAClientAdmin, 'CLIENT_MASTER_ADMIN');
    const result = await svc.changeLoginId({
      actor,
      targetUserId: scenario.tenantAManager.id,
      newLoginId: 'a.manager.renamed',
      ...meta,
    });
    expect(result.loginId).toBe('a.manager.renamed');
    const updated = await scenario.repos.users.findById(scenario.tenantAManager.id);
    expect(updated?.loginId).toBe('a.manager.renamed');
  });

  it('CAN change a Cashier Login ID inside their own tenant', async () => {
    const scenario = await buildScenario();
    const svc = new LoginIdService(scenario.repos);
    const actor = actorOf(scenario.tenantAClientAdmin, 'CLIENT_MASTER_ADMIN');
    await expect(
      svc.changeLoginId({
        actor,
        targetUserId: scenario.tenantACashier.id,
        newLoginId: 'a.cashier.two',
        ...meta,
      }),
    ).resolves.toMatchObject({ loginId: 'a.cashier.two' });
  });

  it('CANNOT change a user in a different tenant (tenant isolation)', async () => {
    const scenario = await buildScenario();
    const svc = new LoginIdService(scenario.repos);
    const actor = actorOf(scenario.tenantAClientAdmin, 'CLIENT_MASTER_ADMIN');
    await expect(
      svc.changeLoginId({
        actor,
        targetUserId: scenario.tenantBClientAdmin.id,
        newLoginId: 'hijacked',
        ...meta,
      }),
    ).rejects.toMatchObject({ code: 'LOGIN_ID_TENANT_SCOPE' });
  });

  it('records an audit log entry and a Login ID history entry on every change', async () => {
    const scenario = await buildScenario();
    const svc = new LoginIdService(scenario.repos);
    const actor = actorOf(scenario.tenantAClientAdmin, 'CLIENT_MASTER_ADMIN');
    await svc.changeLoginId({
      actor,
      targetUserId: scenario.tenantACashier.id,
      newLoginId: 'a.cashier.audited',
      ...meta,
    });

    expect(scenario.repos.auditLogs.entries).toContainEqual(
      expect.objectContaining({
        action: 'USER_LOGIN_ID_CHANGED',
        entityId: scenario.tenantACashier.id,
      }),
    );
    expect(scenario.repos.loginIdHistory.entries).toContainEqual(
      expect.objectContaining({
        userId: scenario.tenantACashier.id,
        oldLoginId: scenario.tenantACashier.loginId,
        newLoginId: 'a.cashier.audited',
        changedById: scenario.tenantAClientAdmin.id,
      }),
    );
  });
});

describe('LoginIdService - Master Admin authority', () => {
  it('CAN (re)assign a Client Master Admin Login ID', async () => {
    const scenario = await buildScenario();
    const svc = new LoginIdService(scenario.repos);
    const actor = actorOf(scenario.masterAdmin, 'MASTER_ADMIN');
    await expect(
      svc.changeLoginId({
        actor,
        targetUserId: scenario.tenantAClientAdmin.id,
        newLoginId: 'a.admin.reassigned',
        ...meta,
      }),
    ).resolves.toMatchObject({ loginId: 'a.admin.reassigned' });
  });

  it('CANNOT change another Master Admin Login ID', async () => {
    const scenario = await buildScenario();
    const svc = new LoginIdService(scenario.repos);
    // seed a second master admin
    scenario.repos.users.seed({
      id: 'user-master-2',
      tenantId: null,
      storeId: null,
      roleId: 'role-master',
      systemRole: 'MASTER_ADMIN',
      loginId: 'master.two',
      displayName: 'Master Two',
      status: 'ACTIVE',
      passwordHash: 'irrelevant',
    });
    const actor = actorOf(scenario.masterAdmin, 'MASTER_ADMIN');
    await expect(
      svc.changeLoginId({ actor, targetUserId: 'user-master-2', newLoginId: 'x', ...meta }),
    ).rejects.toMatchObject({ code: 'LOGIN_ID_CHANGE_FORBIDDEN' });
  });
});

describe('LoginIdService - validation', () => {
  it('rejects an invalid Login ID format', async () => {
    const scenario = await buildScenario();
    const svc = new LoginIdService(scenario.repos);
    const actor = actorOf(scenario.tenantAClientAdmin, 'CLIENT_MASTER_ADMIN');
    await expect(
      svc.changeLoginId({
        actor,
        targetUserId: scenario.tenantACashier.id,
        newLoginId: 'x',
        ...meta,
      }),
    ).rejects.toMatchObject({ code: 'LOGIN_ID_INVALID' });
  });

  it('rejects a Login ID that is already taken', async () => {
    const scenario = await buildScenario();
    const svc = new LoginIdService(scenario.repos);
    const actor = actorOf(scenario.tenantAClientAdmin, 'CLIENT_MASTER_ADMIN');
    await expect(
      svc.changeLoginId({
        actor,
        targetUserId: scenario.tenantACashier.id,
        newLoginId: scenario.tenantAManager.loginId,
        ...meta,
      }),
    ).rejects.toMatchObject({ code: 'LOGIN_ID_TAKEN' });
  });
});
