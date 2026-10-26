import { describe, expect, it } from 'vitest';
import { InventoryService } from '../../src/services/inventory.service.js';
import { buildScenario } from '../fakes/scenario.js';

describe('InventoryService.setOpeningStock', () => {
  it('creates an OPENING movement and sets the quantity', async () => {
    const scenario = await buildScenario();
    const svc = new InventoryService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };

    // Use a brand-new product/store combination (distinct from the pre-seeded one).
    const category = await scenario.repos.categories.create(scenario.tenantA.id, {
      name: 'New Category',
    });
    const subDept = await scenario.repos.subDepartments.create(scenario.tenantA.id, {
      categoryId: category.id,
      name: 'New Sub',
    });
    const product = await scenario.repos.products.create(scenario.tenantA.id, {
      name: 'New Product',
      sku: 'NEW-001',
      categoryId: category.id,
      subDepartmentId: subDept.id,
      costPrice: '10',
      sellingPrice: '20',
      taxRate: '0',
      unit: 'pcs',
      minStock: '2',
    });

    const result = await svc.setOpeningStock(actor, {
      storeId: scenario.tenantA.storeId,
      productId: product.id,
      quantity: '50',
    });
    expect(result.inventory.quantity).toBe('50.000');
    expect(result.movement.type).toBe('OPENING');

    const movements = await svc.listMovements(scenario.tenantA.id, product.id);
    expect(movements).toHaveLength(1);
    expect(scenario.repos.auditLogs.entries).toContainEqual(
      expect.objectContaining({ action: 'INVENTORY_OPENING_STOCK_SET' }),
    );
  });
});

describe('InventoryService.adjustStock', () => {
  it('increases stock and records a traceable ADJUSTMENT movement', async () => {
    const scenario = await buildScenario();
    const svc = new InventoryService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };

    const before = await scenario.repos.inventory.findByStoreAndProduct(
      scenario.tenantA.storeId,
      scenario.catalog.productId,
    );
    const result = await svc.adjustStock(actor, {
      storeId: scenario.tenantA.storeId,
      productId: scenario.catalog.productId,
      quantityChange: '5',
      reason: 'Stock count correction',
    });
    expect(result.inventory.quantity).toBe((Number(before!.quantity) + 5).toFixed(3));
    expect(result.movement.type).toBe('ADJUSTMENT');
    expect(scenario.repos.auditLogs.entries).toContainEqual(
      expect.objectContaining({ action: 'INVENTORY_ADJUSTED' }),
    );
  });

  it('decreases stock correctly', async () => {
    const scenario = await buildScenario();
    const svc = new InventoryService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    const result = await svc.adjustStock(actor, {
      storeId: scenario.tenantA.storeId,
      productId: scenario.catalog.productId,
      quantityChange: '-5',
      reason: 'Damaged goods',
    });
    expect(result.inventory.quantity).toBe('15.000');
  });

  it('prevents stock from going negative (insufficient stock)', async () => {
    const scenario = await buildScenario();
    const svc = new InventoryService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    // Seeded quantity is 20 - try to remove 1000.
    await expect(
      svc.adjustStock(actor, {
        storeId: scenario.tenantA.storeId,
        productId: scenario.catalog.productId,
        quantityChange: '-1000',
        reason: 'Too much',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects adjustment for a product belonging to a different tenant', async () => {
    const scenario = await buildScenario();
    const svc = new InventoryService(scenario.repos);
    const actorB = { id: scenario.tenantBClientAdmin.id, tenantId: scenario.tenantB.id };
    await expect(
      svc.adjustStock(actorB, {
        storeId: scenario.tenantB.storeId,
        productId: scenario.catalog.productId, // Tenant A's product
        quantityChange: '5',
        reason: 'Cross-tenant attempt',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects adjustment for a branch belonging to a different tenant', async () => {
    const scenario = await buildScenario();
    const svc = new InventoryService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    await expect(
      svc.adjustStock(actor, {
        storeId: scenario.tenantB.storeId, // Tenant B's branch
        productId: scenario.catalog.productId,
        quantityChange: '5',
        reason: 'Cross-tenant attempt',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('InventoryService low-stock / out-of-stock detection', () => {
  it('classifies NORMAL, LOW_STOCK and OUT_OF_STOCK correctly from real data', async () => {
    const scenario = await buildScenario();
    const svc = new InventoryService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };

    // Seeded product has minStock=5, quantity=20 -> NORMAL, should not appear in low-stock list.
    let lowStock = await svc.listLowStock(scenario.tenantA.id);
    expect(lowStock.find((s) => s.productId === scenario.catalog.productId)).toBeUndefined();

    // Reduce to exactly minStock -> LOW_STOCK.
    await svc.adjustStock(actor, {
      storeId: scenario.tenantA.storeId,
      productId: scenario.catalog.productId,
      quantityChange: '-15',
      reason: 'Reduce to threshold',
    });
    lowStock = await svc.listLowStock(scenario.tenantA.id);
    const entry = lowStock.find((s) => s.productId === scenario.catalog.productId);
    expect(entry?.stockStatus).toBe('LOW_STOCK');

    // Reduce to zero -> OUT_OF_STOCK.
    await svc.adjustStock(actor, {
      storeId: scenario.tenantA.storeId,
      productId: scenario.catalog.productId,
      quantityChange: '-5',
      reason: 'Sell out',
    });
    lowStock = await svc.listLowStock(scenario.tenantA.id);
    const outEntry = lowStock.find((s) => s.productId === scenario.catalog.productId);
    expect(outEntry?.stockStatus).toBe('OUT_OF_STOCK');
  });

  it('does not fabricate counts - an empty store has an empty low-stock list', async () => {
    const scenario = await buildScenario();
    const svc = new InventoryService(scenario.repos);
    const lowStock = await svc.listLowStock(scenario.tenantB.id);
    expect(lowStock).toEqual([]);
  });
});
