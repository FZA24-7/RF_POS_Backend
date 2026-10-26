// Runs the shared integrity contract against the in-memory fakes. This models transaction semantics for fast
// feedback; it is NOT evidence of PostgreSQL behaviour (see tests/integration for that).
import { describePurchaseIntegrityContract } from '../contract/purchase-integrity.contract.js';
import { buildScenario } from '../fakes/scenario.js';

describePurchaseIntegrityContract('in-memory fakes', async () => {
  const scenario = await buildScenario();
  const { repos } = scenario;
  const category = await repos.categories.create(scenario.tenantA.id, { name: 'Contract Cat' });
  const sub = await repos.subDepartments.create(scenario.tenantA.id, {
    categoryId: category.id,
    name: 'Contract Sub',
  });
  const product2 = await repos.products.create(scenario.tenantA.id, {
    name: 'Second Product',
    sku: 'CONTRACT-002',
    categoryId: category.id,
    subDepartmentId: sub.id,
    costPrice: '25',
    sellingPrice: '40',
    taxRate: '0',
    unit: 'pcs',
    minStock: '1',
  });
  return {
    repos,
    actor: { id: scenario.tenantAClientAdmin.id, tenantId: scenario.tenantA.id },
    ids: {
      storeId: scenario.tenantA.storeId,
      otherStoreId: scenario.tenantA.storeId,
      supplierId: scenario.catalog.supplierId,
      productId: scenario.catalog.productId,
      productId2: product2.id,
      otherTenantSupplierId: scenario.catalog.tenantBSupplierId,
    },
    countSupplierPayments: async (tenantId) =>
      repos.purchases.supplierPayments.filter((p) => p.tenantId === tenantId).length,
    faults: {
      failAuditWrite: async () => {
        repos.auditLogs.failWith = new Error('injected: audit insert failed');
        return async () => {
          repos.auditLogs.failWith = null;
        };
      },
      failMovementWrite: async (productId) => {
        repos.inventory.onApplyMovement = (input) => {
          if (input.productId === productId) throw new Error('injected: movement insert failed');
        };
        return async () => {
          repos.inventory.onApplyMovement = null;
        };
      },
      failPaymentWrite: async () => {
        repos.purchases.onPaymentWrite = () => {
          throw new Error('injected: supplier payment insert failed');
        };
        return async () => {
          repos.purchases.onPaymentWrite = null;
        };
      },
    },
    close: async () => undefined,
  };
});
