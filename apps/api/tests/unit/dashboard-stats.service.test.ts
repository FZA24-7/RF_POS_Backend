import { describe, expect, it } from 'vitest';
import { DashboardStatsService } from '../../src/services/dashboard-stats.service.js';
import { buildScenario } from '../fakes/scenario.js';

describe('DashboardStatsService.getStats', () => {
  it('counts exactly the seeded tenants, licenses and users - no fabricated numbers', async () => {
    const scenario = await buildScenario();
    const svc = new DashboardStatsService(scenario.repos);

    const stats = await svc.getStats();

    // Scenario seeds exactly 2 tenants, both ACTIVE, each with one ACTIVE license,
    // and 5 users total (1 master + 2 tenant-A staff/admin + 1 more + 1 tenant-B admin).
    expect(stats.tenants).toEqual({ total: 2, active: 2, suspended: 0, archived: 0 });
    expect(stats.licenses.total).toBe(2);
    expect(stats.licenses.active).toBe(2);
    expect(stats.licenses.expired).toBe(0);
    expect(stats.users.total).toBe(5);
    expect(stats.users.active).toBe(5);
    expect(stats.users.disabled).toBe(0);
    expect(stats.databaseReachable).toBe(true);
  });

  it('reflects a suspended tenant and a disabled user in the counts', async () => {
    const scenario = await buildScenario();
    await scenario.repos.tenants.updateStatus(scenario.tenantB.id, 'SUSPENDED');
    await scenario.repos.users.updateStatus(scenario.tenantACashier.id, 'DISABLED');

    const svc = new DashboardStatsService(scenario.repos);
    const stats = await svc.getStats();

    expect(stats.tenants).toEqual({ total: 2, active: 1, suspended: 1, archived: 0 });
    expect(stats.users.disabled).toBe(1);
    expect(stats.users.active).toBe(4);
  });

  it('classifies an expired license correctly, even if its stored flag still says ACTIVE', async () => {
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
    const svc = new DashboardStatsService(scenario.repos);
    const stats = await svc.getStats();
    expect(stats.licenses.total).toBe(3);
    expect(stats.licenses.expired).toBe(1);
    expect(stats.licenses.active).toBe(2);
  });

  it('flags a license expiring within the window as expiringSoon (without double counting it as active-only noise)', async () => {
    const scenario = await buildScenario();
    scenario.repos.licenses.seed({
      id: 'license-soon',
      tenantId: scenario.tenantA.id,
      planCode: 'SOON',
      status: 'ACTIVE',
      startsAt: new Date(),
      expiresAt: new Date(Date.now() + 3 * 86_400_000),
      maxUsers: 5,
      maxDevices: 2,
      maxStores: 1,
      enabledModules: [],
      createdAt: new Date(),
    });
    const svc = new DashboardStatsService(scenario.repos);
    const stats = await svc.getStats();
    expect(stats.licenses.expiringSoon).toBe(1);
    expect(stats.licenses.active).toBe(3); // still counted as active
  });

  it('surfaces databaseReachable = false when the health check fails', async () => {
    const scenario = await buildScenario();
    scenario.repos.systemHealth.reachable = false;
    const svc = new DashboardStatsService(scenario.repos);
    const stats = await svc.getStats();
    expect(stats.databaseReachable).toBe(false);
  });
});
