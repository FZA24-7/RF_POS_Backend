import { describe, expect, it } from 'vitest';
import { BrandService } from '../../src/services/brand.service.js';
import { buildScenario } from '../fakes/scenario.js';

describe('BrandService', () => {
  it('full CRUD + status cycle', async () => {
    const scenario = await buildScenario();
    const svc = new BrandService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };

    const created = await svc.create(actor, { name: 'Acme Apparel' });
    expect(created.status).toBe('ACTIVE');

    const updated = await svc.update(actor, created.id, { name: 'Acme Apparel Co' });
    expect(updated.name).toBe('Acme Apparel Co');

    const deactivated = await svc.updateStatus(actor, created.id, 'INACTIVE');
    expect(deactivated.status).toBe('INACTIVE');

    const list = await svc.list(scenario.tenantA.id, {});
    expect(list.some((b) => b.id === created.id)).toBe(true);
  });

  it('rejects a duplicate brand name within the tenant', async () => {
    const scenario = await buildScenario();
    const svc = new BrandService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    await expect(svc.create(actor, { name: 'Generic Brand' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('tenant isolation on read', async () => {
    const scenario = await buildScenario();
    const svc = new BrandService(scenario.repos);
    await expect(svc.getById(scenario.catalog.brandId, scenario.tenantB.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
