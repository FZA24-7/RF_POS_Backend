import { describe, expect, it } from 'vitest';
import { ProductService } from '../../src/services/product.service.js';
import { buildScenario } from '../fakes/scenario.js';
import type { CreateProductInput } from '@mafk/validation';

const baseInput = (
  scenario: Awaited<ReturnType<typeof buildScenario>>,
  overrides: Partial<CreateProductInput> = {},
): CreateProductInput => ({
  name: 'Denim Jeans',
  sku: 'JEANS-001',
  categoryId: scenario.catalog.categoryId,
  subDepartmentId: scenario.catalog.subDepartmentId,
  brandId: scenario.catalog.brandId,
  costPrice: '1200',
  sellingPrice: '1999',
  taxRate: '0',
  unit: 'pcs',
  minStock: '3',
  ...overrides,
});

describe('ProductService.create', () => {
  it('creates a product with a valid category/sub-department pair', async () => {
    const scenario = await buildScenario();
    const svc = new ProductService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    const created = await svc.create(actor, baseInput(scenario));
    expect(created.sku).toBe('JEANS-001');
    expect(scenario.repos.auditLogs.entries).toContainEqual(
      expect.objectContaining({ action: 'PRODUCT_CREATED' }),
    );
  });

  it('rejects a Sub-Department that does not belong to the selected Category', async () => {
    const scenario = await buildScenario();
    const svc = new ProductService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    await expect(
      svc.create(
        actor,
        baseInput(scenario, { subDepartmentId: scenario.catalog.otherSubDepartmentId }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects an unknown Category', async () => {
    const scenario = await buildScenario();
    const svc = new ProductService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    await expect(
      svc.create(actor, baseInput(scenario, { categoryId: 'nope' })),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects a duplicate SKU within the tenant', async () => {
    const scenario = await buildScenario();
    const svc = new ProductService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    await expect(
      svc.create(actor, baseInput(scenario, { sku: scenario.catalog.productSku })),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('allows the SAME SKU in a DIFFERENT tenant (tenant isolation)', async () => {
    const scenario = await buildScenario();
    const svc = new ProductService(scenario.repos);
    const actorB = { id: scenario.tenantBClientAdmin.id, tenantId: scenario.tenantB.id };
    // Tenant B has none of Tenant A's category/sub-department, so it must create its own first.
    const category = await scenario.repos.categories.create(scenario.tenantB.id, {
      name: 'Apparel',
    });
    const subDept = await scenario.repos.subDepartments.create(scenario.tenantB.id, {
      categoryId: category.id,
      name: 'Jeans',
    });
    await expect(
      svc.create(actorB, {
        name: 'Denim Jeans (Tenant B)',
        sku: scenario.catalog.productSku,
        categoryId: category.id,
        subDepartmentId: subDept.id,
        costPrice: '1000',
        sellingPrice: '1500',
        taxRate: '0',
        unit: 'pcs',
        minStock: '1',
      }),
    ).resolves.toMatchObject({ sku: scenario.catalog.productSku });
  });

  it('rejects a duplicate barcode within the tenant', async () => {
    const scenario = await buildScenario();
    const svc = new ProductService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    await expect(
      svc.create(
        actor,
        baseInput(scenario, { sku: 'JEANS-002', barcodes: [scenario.catalog.productBarcode] }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects a negative selling price', async () => {
    const scenario = await buildScenario();
    const svc = new ProductService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    await expect(
      svc.create(actor, baseInput(scenario, { sellingPrice: '-5' })),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects maxStock lower than minStock', async () => {
    const scenario = await buildScenario();
    const svc = new ProductService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    await expect(
      svc.create(actor, baseInput(scenario, { minStock: '50', maxStock: '10' })),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('ProductService.update', () => {
  it('re-validates the category/sub-department relationship on update', async () => {
    const scenario = await buildScenario();
    const svc = new ProductService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    await expect(
      svc.update(actor, scenario.catalog.productId, {
        subDepartmentId: scenario.catalog.otherSubDepartmentId,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('allows switching to a consistent category + sub-department pair together', async () => {
    const scenario = await buildScenario();
    const svc = new ProductService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    const updated = await svc.update(actor, scenario.catalog.productId, {
      categoryId: scenario.catalog.otherCategoryId,
      subDepartmentId: scenario.catalog.otherSubDepartmentId,
    });
    expect(updated.categoryId).toBe(scenario.catalog.otherCategoryId);
    expect(updated.subDepartmentId).toBe(scenario.catalog.otherSubDepartmentId);
  });
});

describe('ProductService tenant isolation', () => {
  it('Tenant B cannot read Tenant A product', async () => {
    const scenario = await buildScenario();
    const svc = new ProductService(scenario.repos);
    await expect(
      svc.getById(scenario.catalog.productId, scenario.tenantB.id),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
