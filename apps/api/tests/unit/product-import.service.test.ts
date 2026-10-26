import { describe, expect, it } from 'vitest';
import { ProductImportService } from '../../src/services/product-import.service.js';
import { buildScenario } from '../fakes/scenario.js';

const header = 'name,sku,categoryId,subDepartmentId,costPrice,sellingPrice';

describe('ProductImportService.importCsv', () => {
  it('imports every valid row and reports zero failures', async () => {
    const scenario = await buildScenario();
    const svc = new ProductImportService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    const csv = [
      header,
      `Import Shirt 1,IMP-001,${scenario.catalog.categoryId},${scenario.catalog.subDepartmentId},100,200`,
      `Import Shirt 2,IMP-002,${scenario.catalog.categoryId},${scenario.catalog.subDepartmentId},110,220`,
    ].join('\n');

    const result = await svc.importCsv(actor, csv);
    expect(result.totalRows).toBe(2);
    expect(result.successCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(result.rowErrors).toEqual([]);
    expect(result.createdProductIds).toHaveLength(2);
  });

  it('rejects a row with an invalid category WITHOUT blocking the other valid rows', async () => {
    const scenario = await buildScenario();
    const svc = new ProductImportService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    const csv = [
      header,
      `Good Row,IMP-010,${scenario.catalog.categoryId},${scenario.catalog.subDepartmentId},100,200`,
      `Bad Row,IMP-011,does-not-exist,${scenario.catalog.subDepartmentId},100,200`,
    ].join('\n');

    const result = await svc.importCsv(actor, csv);
    expect(result.totalRows).toBe(2);
    expect(result.successCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.rowErrors).toHaveLength(1);
    expect(result.rowErrors[0]?.row).toBe(3); // header is row 1, this is the 2nd data row
  });

  it('reports duplicate SKU within the file as a per-row failure', async () => {
    const scenario = await buildScenario();
    const svc = new ProductImportService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    const csv = [
      header,
      // Duplicates the already-seeded product's SKU.
      `Duplicate SKU,${scenario.catalog.productSku},${scenario.catalog.categoryId},${scenario.catalog.subDepartmentId},100,200`,
    ].join('\n');

    const result = await svc.importCsv(actor, csv);
    expect(result.successCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(result.rowErrors[0]?.errors[0]).toMatch(/already in use/i);
  });

  it('reports duplicate barcode as a per-row failure', async () => {
    const scenario = await buildScenario();
    const svc = new ProductImportService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    const csvWithBarcode = [
      'name,sku,categoryId,subDepartmentId,costPrice,sellingPrice,barcode',
      `Dup Barcode,IMP-020,${scenario.catalog.categoryId},${scenario.catalog.subDepartmentId},100,200,${scenario.catalog.productBarcode}`,
    ].join('\n');

    const result = await svc.importCsv(actor, csvWithBarcode);
    expect(result.successCount).toBe(0);
    expect(result.failedCount).toBe(1);
  });

  it('rejects a row with invalid pricing (e.g. negative selling price) via schema validation', async () => {
    const scenario = await buildScenario();
    const svc = new ProductImportService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    const csv = [
      header,
      `Bad Price,IMP-030,${scenario.catalog.categoryId},${scenario.catalog.subDepartmentId},100,-5`,
    ].join('\n');

    const result = await svc.importCsv(actor, csv);
    expect(result.failedCount).toBe(1);
    expect(result.rowErrors[0]?.errors.join(' ')).toMatch(/sellingPrice/);
  });

  it('throws before importing anything if a required column is entirely missing', async () => {
    const scenario = await buildScenario();
    const svc = new ProductImportService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    await expect(svc.importCsv(actor, 'name,sku\nX,Y')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('never imports into the wrong tenant', async () => {
    const scenario = await buildScenario();
    const svc = new ProductImportService(scenario.repos);
    const actorB = { id: scenario.tenantBClientAdmin.id, tenantId: scenario.tenantB.id };
    const category = await scenario.repos.categories.create(scenario.tenantB.id, { name: 'B Cat' });
    const subDept = await scenario.repos.subDepartments.create(scenario.tenantB.id, {
      categoryId: category.id,
      name: 'B Sub',
    });
    const csv = [header, `B Product,B-SKU-1,${category.id},${subDept.id},50,90`].join('\n');

    const result = await svc.importCsv(actorB, csv);
    expect(result.successCount).toBe(1);
    const created = await scenario.repos.products.findBySku(scenario.tenantB.id, 'B-SKU-1');
    expect(created?.tenantId).toBe(scenario.tenantB.id);
    // Must not be visible under Tenant A.
    expect(await scenario.repos.products.findBySku(scenario.tenantA.id, 'B-SKU-1')).toBeNull();
  });
});

describe('ProductImportService.exportCsv', () => {
  it("exports only the requesting tenant's products", async () => {
    const scenario = await buildScenario();
    const svc = new ProductImportService(scenario.repos);
    const csv = await svc.exportCsv(scenario.tenantA.id);
    expect(csv).toContain(scenario.catalog.productSku);

    const csvB = await svc.exportCsv(scenario.tenantB.id);
    expect(csvB).not.toContain(scenario.catalog.productSku);
  });
});
