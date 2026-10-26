import { describe, expect, it } from 'vitest';
import { MODULE_CATALOG } from '@mafk/shared';
import { LicenseService } from '../../src/services/license.service.js';
import { buildScenario } from '../fakes/scenario.js';

const actor = { id: 'master-1' };

describe('LicenseService', () => {
  it('lists licenses for a tenant', async () => {
    const scenario = await buildScenario();
    const svc = new LicenseService(scenario.repos);
    const list = await svc.listForTenant(scenario.tenantA.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.planCode).toBe('STANDARD');
  });

  it('creates a new license for a tenant and audits it', async () => {
    const scenario = await buildScenario();
    const svc = new LicenseService(scenario.repos);
    const created = await svc.create(actor, scenario.tenantB.id, {
      planCode: 'PREMIUM',
      expiresAt: new Date(Date.now() + 365 * 86_400_000),
      maxUsers: 50,
      maxDevices: 20,
      maxStores: 10,
      enabledModules: [...MODULE_CATALOG, 'not-a-real-module'] as unknown as string[],
    });
    expect(created.planCode).toBe('PREMIUM');
    // Unknown module keys are sanitized out, never persisted.
    expect(created.enabledModules).toEqual(MODULE_CATALOG);
    expect(scenario.repos.auditLogs.entries).toContainEqual(
      expect.objectContaining({ action: 'LICENSE_CREATED' }),
    );
  });

  it('resolves EXPIRED for a stored-ACTIVE license whose date has passed - never trusts the stale flag', async () => {
    const scenario = await buildScenario();
    scenario.repos.licenses.seed({
      id: 'license-expired',
      tenantId: scenario.tenantA.id,
      planCode: 'OLD',
      status: 'ACTIVE',
      startsAt: new Date(Date.now() - 400 * 86_400_000),
      expiresAt: new Date(Date.now() - 86_400_000),
      maxUsers: 5,
      maxDevices: 2,
      maxStores: 1,
      enabledModules: [],
      createdAt: new Date(),
    });
    const svc = new LicenseService(scenario.repos);
    const list = await svc.listForTenant(scenario.tenantA.id);
    const expired = list.find((l) => l.id === 'license-expired');
    expect(expired?.status).toBe('EXPIRED');
  });

  it('updateStatus moves a license to SUSPENDED and audits the transition', async () => {
    const scenario = await buildScenario();
    const svc = new LicenseService(scenario.repos);
    const updated = await svc.updateStatus(actor, 'license-a', 'SUSPENDED');
    expect(updated.status).toBe('SUSPENDED');
    expect(scenario.repos.auditLogs.entries).toContainEqual(
      expect.objectContaining({
        action: 'LICENSE_STATUS_CHANGED',
        metadata: { from: 'ACTIVE', to: 'SUSPENDED' },
      }),
    );
  });

  it('updateModules sanitizes unknown keys and audits the before/after sets', async () => {
    const scenario = await buildScenario();
    const svc = new LicenseService(scenario.repos);
    const updated = await svc.updateModules(actor, 'license-a', ['pos', 'reports']);
    expect(updated.enabledModules).toEqual(['pos', 'reports']);
    expect(scenario.repos.auditLogs.entries).toContainEqual(
      expect.objectContaining({ action: 'MODULES_UPDATED' }),
    );
  });

  it('throws NOT_FOUND for an unknown license id', async () => {
    const scenario = await buildScenario();
    const svc = new LicenseService(scenario.repos);
    await expect(svc.updateStatus(actor, 'nope', 'REVOKED')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
