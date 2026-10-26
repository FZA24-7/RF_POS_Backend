// Runs the shared Phase 6 contract against the in-memory fakes (a MODEL of transactions - fast feedback only).
// The PostgreSQL run in tests/integration is the real evidence.
import { randomUUID } from 'node:crypto';
import { describePhase6Contract } from '../contract/phase6.contract.js';
import { buildScenario } from '../fakes/scenario.js';

const FULL = new Set([
  'pos.create',
  'discount.apply',
  'price.change',
  'sale.refund',
  'customers.edit',
  'employees.edit',
  'reports.view',
  'reports.export',
]);

describePhase6Contract('in-memory fakes', async () => {
  const s = await buildScenario();
  const { repos } = s;
  const category = await repos.categories.create(s.tenantA.id, { name: 'Cat' });
  const sub = await repos.subDepartments.create(s.tenantA.id, {
    categoryId: category.id,
    name: 'Sub',
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
  const p1 = await mk('P1', '100.00', '0');
  const p2 = await mk('P2', '40.00', '10');
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
    limitedActor: {
      id: s.tenantAManager.id,
      tenantId: s.tenantA.id,
      permissions: new Set(['pos.create', 'customers.view', 'customers.create']),
    },
    otherTenantActor: { id: s.tenantBClientAdmin.id, tenantId: s.tenantB.id, permissions: FULL },
    ids: {
      storeId: s.tenantA.storeId,
      otherStoreId: 'store-a-branch2',
      productId: p1.id,
      productId2: p2.id,
    },
    timeZone: 'Asia/Karachi',
    faults: {
      failAuditWrite: async () => {
        repos.auditLogs.failWith = new Error('injected: audit insert failed');
        return async () => {
          repos.auditLogs.failWith = null;
        };
      },
    },
    setSoldAt: async (saleId, at) => {
      const sale = repos.sales.sales.get(saleId);
      if (sale) sale.soldAt = at;
    },
    newUserId: async () => {
      const base = repos.users.users.get(s.tenantAManager.id)!;
      const id = randomUUID();
      repos.users.users.set(id, { ...base, id, loginId: `emp.${id.slice(0, 8)}` });
      return id;
    },
    close: async () => undefined,
  };
});
