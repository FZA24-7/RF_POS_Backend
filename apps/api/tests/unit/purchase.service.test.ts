import { describe, expect, it } from 'vitest';
import { PurchaseService } from '../../src/services/purchase.service.js';
import { buildScenario } from '../fakes/scenario.js';
import type { CreatePurchaseInput } from '@mafk/validation';

const basePurchase = (
  scenario: Awaited<ReturnType<typeof buildScenario>>,
  overrides: Partial<CreatePurchaseInput> = {},
): CreatePurchaseInput => ({
  supplierId: scenario.catalog.supplierId,
  storeId: scenario.tenantA.storeId,
  invoiceNo: 'INV-1001',
  purchaseDate: new Date('2026-01-15'),
  items: [
    { productId: scenario.catalog.productId, quantity: '10', costPrice: '500', taxRate: '0' },
  ],
  ...overrides,
});

describe('PurchaseService.recordPurchase - happy path', () => {
  it('creates a purchase with correct totals, increases stock, and creates a traceable movement', async () => {
    const scenario = await buildScenario();
    const svc = new PurchaseService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };

    const before = await scenario.repos.inventory.findByStoreAndProduct(
      scenario.tenantA.storeId,
      scenario.catalog.productId,
    );
    const beforeQty = Number(before?.quantity ?? '0');

    const purchase = await svc.recordPurchase(actor, basePurchase(scenario));

    expect(purchase.subtotal).toBe('5000.00');
    expect(purchase.total).toBe('5000.00');
    expect(purchase.paymentStatus).toBe('UNPAID');
    expect(purchase.items).toHaveLength(1);
    expect(purchase.items[0]?.productName).toBe('Classic Cotton Shirt');

    const after = await scenario.repos.inventory.findByStoreAndProduct(
      scenario.tenantA.storeId,
      scenario.catalog.productId,
    );
    expect(Number(after?.quantity)).toBe(beforeQty + 10);

    const movements = await scenario.repos.inventory.listMovements(
      scenario.tenantA.id,
      scenario.catalog.productId,
      10,
    );
    expect(movements[0]).toMatchObject({ type: 'PURCHASE', quantityChange: '10' });

    expect(scenario.repos.auditLogs.entries).toContainEqual(
      expect.objectContaining({ action: 'PURCHASE_RECORDED', entityId: purchase.id }),
    );
  });

  it('supports multiple product line items', async () => {
    const scenario = await buildScenario();
    const svc = new PurchaseService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    const category = await scenario.repos.categories.create(scenario.tenantA.id, {
      name: 'Second Cat',
    });
    const subDept = await scenario.repos.subDepartments.create(scenario.tenantA.id, {
      categoryId: category.id,
      name: 'Second Sub',
    });
    const secondProduct = await scenario.repos.products.create(scenario.tenantA.id, {
      name: 'Second Product',
      sku: 'SECOND-001',
      categoryId: category.id,
      subDepartmentId: subDept.id,
      costPrice: '20',
      sellingPrice: '35',
      taxRate: '0',
      unit: 'pcs',
      minStock: '1',
    });

    const purchase = await svc.recordPurchase(
      actor,
      basePurchase(scenario, {
        items: [
          { productId: scenario.catalog.productId, quantity: '5', costPrice: '500', taxRate: '0' },
          { productId: secondProduct.id, quantity: '20', costPrice: '20', taxRate: '0' },
        ],
      }),
    );
    expect(purchase.items).toHaveLength(2);
    expect(purchase.subtotal).toBe('2900.00'); // 5*500 + 20*20
  });

  it('applies item and purchase-level discounts and tax correctly', async () => {
    const scenario = await buildScenario();
    const svc = new PurchaseService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };

    const purchase = await svc.recordPurchase(
      actor,
      basePurchase(scenario, {
        items: [
          {
            productId: scenario.catalog.productId,
            quantity: '10',
            costPrice: '100',
            discountPercent: '10',
            taxRate: '10',
          },
        ],
        discountPercent: '5',
      }),
    );
    // gross 1000, item disc 10% = 100 -> net 900, line tax 10% of 900 = 90 (line total 990, informational only).
    // Purchase-level discount 5% applies to the post-item-discount subtotal (900) = 45 -> after-discount 855.
    // Purchase total = 855 + taxTotal(90) = 945.
    expect(purchase.subtotal).toBe('1000.00');
    expect(purchase.discountAmount).toBe('45.00'); // purchase-level discount only; item discount is separate (itemDiscountTotal)
    expect(purchase.taxTotal).toBe('90.00');
    expect(purchase.total).toBe('945.00');
  });

  it('records an initial payment and sets PARTIAL status correctly', async () => {
    const scenario = await buildScenario();
    const svc = new PurchaseService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    const purchase = await svc.recordPurchase(
      actor,
      basePurchase(scenario, { initialPayment: { amount: '2000', method: 'CASH' } }),
    );
    expect(purchase.paidAmount).toBe('2000.00');
    expect(purchase.paymentStatus).toBe('PARTIAL');
  });

  it('sets PAID status when the initial payment covers the full total', async () => {
    const scenario = await buildScenario();
    const svc = new PurchaseService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    const purchase = await svc.recordPurchase(
      actor,
      basePurchase(scenario, { initialPayment: { amount: '5000', method: 'CASH' } }),
    );
    expect(purchase.paymentStatus).toBe('PAID');
  });
});

describe('PurchaseService.recordPurchase - validation & relationships', () => {
  it('rejects an unknown supplier', async () => {
    const scenario = await buildScenario();
    const svc = new PurchaseService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    await expect(
      svc.recordPurchase(actor, basePurchase(scenario, { supplierId: 'nope' })),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects a supplier belonging to a different tenant', async () => {
    const scenario = await buildScenario();
    const svc = new PurchaseService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    await expect(
      svc.recordPurchase(
        actor,
        basePurchase(scenario, { supplierId: scenario.catalog.tenantBSupplierId }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects an unknown branch', async () => {
    const scenario = await buildScenario();
    const svc = new PurchaseService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    await expect(
      svc.recordPurchase(actor, basePurchase(scenario, { storeId: 'nope' })),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects a branch belonging to a different tenant', async () => {
    const scenario = await buildScenario();
    const svc = new PurchaseService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    await expect(
      svc.recordPurchase(actor, basePurchase(scenario, { storeId: scenario.tenantB.storeId })),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects an unknown product in a line item', async () => {
    const scenario = await buildScenario();
    const svc = new PurchaseService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    await expect(
      svc.recordPurchase(
        actor,
        basePurchase(scenario, { items: [{ productId: 'nope', quantity: '1', costPrice: '10' }] }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects a zero quantity', async () => {
    const scenario = await buildScenario();
    const svc = new PurchaseService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    await expect(
      svc.recordPurchase(
        actor,
        basePurchase(scenario, {
          items: [{ productId: scenario.catalog.productId, quantity: '0', costPrice: '10' }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects an initial payment exceeding the total', async () => {
    const scenario = await buildScenario();
    const svc = new PurchaseService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    await expect(
      svc.recordPurchase(
        actor,
        basePurchase(scenario, { initialPayment: { amount: '999999', method: 'CASH' } }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('PurchaseService.recordPurchase - duplicate submission / idempotency', () => {
  it('rejects a second purchase with the same supplier + invoice number', async () => {
    const scenario = await buildScenario();
    const svc = new PurchaseService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    await svc.recordPurchase(actor, basePurchase(scenario));
    await expect(svc.recordPurchase(actor, basePurchase(scenario))).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('a duplicate submission does NOT double-count stock', async () => {
    const scenario = await buildScenario();
    const svc = new PurchaseService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    const before = await scenario.repos.inventory.findByStoreAndProduct(
      scenario.tenantA.storeId,
      scenario.catalog.productId,
    );
    await svc.recordPurchase(actor, basePurchase(scenario));
    await expect(svc.recordPurchase(actor, basePurchase(scenario))).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const after = await scenario.repos.inventory.findByStoreAndProduct(
      scenario.tenantA.storeId,
      scenario.catalog.productId,
    );
    // Only ONE purchase's worth of stock (+10) was applied, not two (+20).
    expect(Number(after?.quantity)).toBe(Number(before?.quantity) + 10);
  });

  it('the SAME invoice number is allowed for a DIFFERENT supplier', async () => {
    const scenario = await buildScenario();
    const svc = new PurchaseService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    const otherSupplier = await scenario.repos.suppliers.create(scenario.tenantA.id, {
      name: 'Another Supplier',
    });
    await svc.recordPurchase(actor, basePurchase(scenario));
    await expect(
      svc.recordPurchase(actor, basePurchase(scenario, { supplierId: otherSupplier.id })),
    ).resolves.toMatchObject({ invoiceNo: 'INV-1001' });
  });
});

describe('PurchaseService.recordPurchase - transaction rollback', () => {
  it('rolls back everything when one line item in a multi-item purchase is invalid - no partial purchase, no partial stock change', async () => {
    const scenario = await buildScenario();
    const svc = new PurchaseService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };

    const beforeInventorySize = scenario.repos.inventory.inventories.size;
    const beforePurchaseCount = scenario.repos.purchases.purchases.size;
    const beforeQty = await scenario.repos.inventory.findByStoreAndProduct(
      scenario.tenantA.storeId,
      scenario.catalog.productId,
    );

    await expect(
      svc.recordPurchase(
        actor,
        basePurchase(scenario, {
          items: [
            { productId: scenario.catalog.productId, quantity: '10', costPrice: '500' },
            { productId: 'does-not-exist', quantity: '5', costPrice: '20' },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(scenario.repos.purchases.purchases.size).toBe(beforePurchaseCount);
    expect(scenario.repos.inventory.inventories.size).toBe(beforeInventorySize);
    const afterQty = await scenario.repos.inventory.findByStoreAndProduct(
      scenario.tenantA.storeId,
      scenario.catalog.productId,
    );
    expect(afterQty?.quantity).toBe(beforeQty?.quantity);
  });
});

describe('PurchaseService.recordPayment', () => {
  it('records a payment and transitions UNPAID -> PARTIAL -> PAID', async () => {
    const scenario = await buildScenario();
    const svc = new PurchaseService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    const purchase = await svc.recordPurchase(actor, basePurchase(scenario));
    expect(purchase.paymentStatus).toBe('UNPAID');

    const partial = await svc.recordPayment(actor, purchase.id, { amount: '2000', method: 'CASH' });
    expect(partial.paymentStatus).toBe('PARTIAL');
    expect(partial.paidAmount).toBe('2000.00');

    const paid = await svc.recordPayment(actor, purchase.id, {
      amount: '3000',
      method: 'BANK_TRANSFER',
    });
    expect(paid.paymentStatus).toBe('PAID');
    expect(paid.paidAmount).toBe('5000.00');

    expect(scenario.repos.auditLogs.entries).toContainEqual(
      expect.objectContaining({ action: 'PURCHASE_PAYMENT_RECORDED' }),
    );
  });

  it('rejects a payment that would exceed the outstanding balance', async () => {
    const scenario = await buildScenario();
    const svc = new PurchaseService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    const purchase = await svc.recordPurchase(actor, basePurchase(scenario));
    await expect(
      svc.recordPayment(actor, purchase.id, { amount: '999999', method: 'CASH' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});

describe('PurchaseService tenant isolation', () => {
  it('Tenant B cannot read a Tenant A purchase', async () => {
    const scenario = await buildScenario();
    const svc = new PurchaseService(scenario.repos);
    const actor = { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id };
    const purchase = await svc.recordPurchase(actor, basePurchase(scenario));
    await expect(svc.getById(purchase.id, scenario.tenantB.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
