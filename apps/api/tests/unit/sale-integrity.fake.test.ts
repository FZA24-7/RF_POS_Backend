// Runs the shared sale/refund integrity contract against the in-memory fakes (a MODEL of transactions - fast
// feedback only). The PostgreSQL run in tests/integration is the real evidence.
import { describeSaleIntegrityContract } from '../contract/sale-integrity.contract.js';
import { buildScenario } from '../fakes/scenario.js';

const FULL = new Set(['pos.create', 'discount.apply', 'price.change', 'sale.refund']);

describeSaleIntegrityContract('in-memory fakes', async () => {
  const s = await buildScenario();
  const { repos } = s;
  const category = await repos.categories.create(s.tenantA.id, { name: 'Sale Cat' });
  const sub = await repos.subDepartments.create(s.tenantA.id, {
    categoryId: category.id,
    name: 'Sale Sub',
  });
  const mk = (sku: string, selling: string, tax: string) =>
    repos.products.create(s.tenantA.id, {
      name: sku,
      sku,
      categoryId: category.id,
      subDepartmentId: sub.id,
      costPrice: '10',
      sellingPrice: selling,
      taxRate: tax,
      unit: 'pcs',
      minStock: '0',
    });
  const p1 = await mk('SALE-P1', '100.00', '0');
  const p2 = await mk('SALE-P2', '40.00', '10');
  repos.stores.seed({
    id: 'store-a-branch2',
    tenantId: s.tenantA.id,
    code: 'BR2',
    name: 'Branch 2',
    isDefault: false,
    isActive: true,
  });
  return {
    repos,
    actor: { id: s.tenantAManager.id, tenantId: s.tenantA.id, permissions: FULL },
    otherTenantActor: { id: s.tenantBClientAdmin.id, tenantId: s.tenantB.id, permissions: FULL },
    ids: {
      storeId: s.tenantA.storeId,
      otherStoreId: 'store-a-branch2',
      productId: p1.id,
      productId2: p2.id,
    },
    faults: {
      failAuditWrite: async () => {
        repos.auditLogs.failWith = new Error('injected: audit insert failed');
        return async () => {
          repos.auditLogs.failWith = null;
        };
      },
      failMovementWrite: async (productId) => {
        repos.inventory.onApplyMovement = (input) => {
          if (input.productId === productId && input.type !== 'OPENING')
            throw new Error('injected: movement insert failed');
        };
        return async () => {
          repos.inventory.onApplyMovement = null;
        };
      },
    },
    close: async () => undefined,
  };
});
