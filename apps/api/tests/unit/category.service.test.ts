import { describe, expect, it } from 'vitest';
import { CategoryService } from '../../src/services/category.service.js';
import { buildScenario } from '../fakes/scenario.js';

describe('CategoryService', () => {
  it('creates a category and audits it', async () => {
    const scenario = await buildScenario();
    const svc = new CategoryService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    const created = await svc.create(actor, { name: 'Footwear', description: 'Shoes and sandals' });
    expect(created.name).toBe('Footwear');
    expect(scenario.repos.auditLogs.entries).toContainEqual(
      expect.objectContaining({ action: 'CATEGORY_CREATED', entityId: created.id }),
    );
  });

  it('rejects a duplicate category name within the same tenant', async () => {
    const scenario = await buildScenario();
    const svc = new CategoryService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    await expect(svc.create(actor, { name: "Men's Wear" })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('allows the SAME category name in a DIFFERENT tenant (tenant isolation)', async () => {
    const scenario = await buildScenario();
    const svc = new CategoryService(scenario.repos);
    const actor = { id: scenario.tenantBClientAdmin.id, tenantId: scenario.tenantB.id };
    await expect(svc.create(actor, { name: "Men's Wear" })).resolves.toMatchObject({
      name: "Men's Wear",
    });
  });

  it('updates a category', async () => {
    const scenario = await buildScenario();
    const svc = new CategoryService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    const updated = await svc.update(actor, scenario.catalog.categoryId, {
      description: 'Updated description',
    });
    expect(updated.description).toBe('Updated description');
  });

  it('deactivates a category', async () => {
    const scenario = await buildScenario();
    const svc = new CategoryService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    const updated = await svc.updateStatus(actor, scenario.catalog.categoryId, 'INACTIVE');
    expect(updated.status).toBe('INACTIVE');
    expect(scenario.repos.auditLogs.entries).toContainEqual(
      expect.objectContaining({ action: 'CATEGORY_STATUS_CHANGED' }),
    );
  });

  it('a Tenant B actor cannot read a Tenant A category (tenant isolation)', async () => {
    const scenario = await buildScenario();
    const svc = new CategoryService(scenario.repos);
    await expect(
      svc.getById(scenario.catalog.categoryId, scenario.tenantB.id),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
