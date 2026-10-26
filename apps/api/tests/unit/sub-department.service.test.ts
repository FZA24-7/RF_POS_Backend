import { describe, expect, it } from 'vitest';
import { SubDepartmentService } from '../../src/services/sub-department.service.js';
import { buildScenario } from '../fakes/scenario.js';

describe('SubDepartmentService', () => {
  it('creates a sub-department under a real category', async () => {
    const scenario = await buildScenario();
    const svc = new SubDepartmentService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    const created = await svc.create(actor, {
      categoryId: scenario.catalog.categoryId,
      name: 'Trousers',
    });
    expect(created.categoryId).toBe(scenario.catalog.categoryId);
    expect(scenario.repos.auditLogs.entries).toContainEqual(
      expect.objectContaining({ action: 'SUB_DEPARTMENT_CREATED' }),
    );
  });

  it('rejects creation under a non-existent category', async () => {
    const scenario = await buildScenario();
    const svc = new SubDepartmentService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    await expect(
      svc.create(actor, { categoryId: 'does-not-exist', name: 'Trousers' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects creation under a category belonging to a DIFFERENT tenant', async () => {
    const scenario = await buildScenario();
    const svc = new SubDepartmentService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    await expect(
      svc.create(actor, { categoryId: scenario.catalog.tenantBCategoryId, name: 'Trousers' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects a duplicate name within the SAME category', async () => {
    const scenario = await buildScenario();
    const svc = new SubDepartmentService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    await expect(
      svc.create(actor, { categoryId: scenario.catalog.categoryId, name: 'Shirts' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('allows the SAME name in a DIFFERENT category', async () => {
    const scenario = await buildScenario();
    const svc = new SubDepartmentService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    await expect(
      svc.create(actor, { categoryId: scenario.catalog.otherCategoryId, name: 'Shirts' }),
    ).resolves.toMatchObject({ name: 'Shirts' });
  });

  it('deactivates a sub-department', async () => {
    const scenario = await buildScenario();
    const svc = new SubDepartmentService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    const updated = await svc.updateStatus(actor, scenario.catalog.subDepartmentId, 'INACTIVE');
    expect(updated.status).toBe('INACTIVE');
  });

  it('tenant isolation on read', async () => {
    const scenario = await buildScenario();
    const svc = new SubDepartmentService(scenario.repos);
    await expect(
      svc.getById(scenario.catalog.subDepartmentId, scenario.tenantB.id),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
