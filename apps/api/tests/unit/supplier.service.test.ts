import { describe, expect, it } from 'vitest';
import { SupplierService } from '../../src/services/supplier.service.js';
import { buildScenario } from '../fakes/scenario.js';

describe('SupplierService', () => {
  it('creates a supplier and audits it', async () => {
    const scenario = await buildScenario();
    const svc = new SupplierService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    const created = await svc.create(actor, { name: 'New Supplier Co' });
    expect(created.name).toBe('New Supplier Co');
    expect(scenario.repos.auditLogs.entries).toContainEqual(
      expect.objectContaining({ action: 'SUPPLIER_CREATED', entityId: created.id }),
    );
  });

  it('rejects a duplicate supplier name within the tenant', async () => {
    const scenario = await buildScenario();
    const svc = new SupplierService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    await expect(svc.create(actor, { name: 'Textile Wholesalers Ltd' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('tenant isolation on read', async () => {
    const scenario = await buildScenario();
    const svc = new SupplierService(scenario.repos);
    await expect(
      svc.getById(scenario.catalog.supplierId, scenario.tenantB.id),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('list is tenant-scoped', async () => {
    const scenario = await buildScenario();
    const svc = new SupplierService(scenario.repos);
    const listA = await svc.list(scenario.tenantA.id, {});
    expect(listA.map((s) => s.id)).toContain(scenario.catalog.supplierId);
    expect(listA.map((s) => s.id)).not.toContain(scenario.catalog.tenantBSupplierId);
  });
});
