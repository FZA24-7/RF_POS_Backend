/**
 * REAL PostgreSQL integration test for Phase 6 (customer credit, ledgers, expenses, employees, reports).
 *
 * Runs the same contract as the in-memory run, but through the Prisma adapters against an isolated PostgreSQL
 * database. Faults are injected with PostgreSQL triggers that RAISE EXCEPTION, so what is rolled back is a real
 * database transaction - nothing is mocked.
 *
 * Requires: TEST_DATABASE_URL pointing at an ISOLATED, already-migrated database whose name contains "test"
 * (see docs/TESTING.md). Without it, the suite is skipped and reported as skipped - never as passed.
 *
 * STATUS: see docs/TESTING.md for the result of the last real-PostgreSQL run of this file.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@mafk/database';
import { describe, it } from 'vitest';
import { describePhase6Contract, type Phase6Harness } from '../contract/phase6.contract.js';

// Local dev defaults come from the repo-root .env.example (no .env needed); real environment variables win.
// Wrapped because the helper lives in the built @mafk/database package: if it is not built yet, just skip.
try {
  const { loadExampleEnv } = await import('@mafk/database/load-example-env');
  loadExampleEnv();
} catch {
  /* not built yet - TEST_DATABASE_URL stays unset and the suite reports "skipped" */
}

const url = process.env.TEST_DATABASE_URL;

function assertIsolatedTestDatabase(databaseUrl: string): void {
  const dbName = new URL(databaseUrl).pathname.replace(/^\//, '');
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Refusing to run: TEST_DATABASE_URL database "${dbName}" does not contain "test". ` +
        'These tests create and fault-inject data; point them at an isolated test database.',
    );
  }
}

if (!url) {
  describe('phase 6 customers, expenses, employees, reports [real PostgreSQL]', () => {
    it.skip('SKIPPED: TEST_DATABASE_URL is not set (NOT VERIFIED)', () => undefined);
  });
} else {
  assertIsolatedTestDatabase(url);
  // Dynamic imports: the generated Prisma client only exists after `prisma generate`; when TEST_DATABASE_URL is
  // unset this file must still load and report "skipped".
  const { createPrismaClient } = await import('@mafk/database');
  const { createPrismaRepositories } =
    await import('../../src/infra/prisma/repositories-factory.js');
  let prisma: PrismaClient | null = null;
  const client = (): PrismaClient => (prisma ??= createPrismaClient({ databaseUrl: url }));

  const installFault = async (
    p: PrismaClient,
    table: string,
    tenantId: string,
    extraCondition: string,
    message: string,
  ): Promise<() => Promise<void>> => {
    const name = `mafk_fault_${randomUUID().replace(/-/g, '')}`;
    await p.$executeRawUnsafe(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '${message}'; END $$`,
    );
    await p.$executeRawUnsafe(
      `CREATE TRIGGER ${name} BEFORE INSERT ON ${table} FOR EACH ROW WHEN (NEW."tenantId" = '${tenantId}' ${extraCondition}) EXECUTE FUNCTION ${name}()`,
    );
    return async () => {
      await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON ${table}`);
      await p.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
    };
  };

  const createHarness = async (): Promise<Phase6Harness> => {
    const p = client();
    const run = randomUUID().slice(0, 8);
    const tenantA = await p.tenant.create({ data: { code: `TA${run}`, name: `Tenant A ${run}` } });
    const tenantB = await p.tenant.create({ data: { code: `TB${run}`, name: `Tenant B ${run}` } });
    const store = await p.store.create({
      data: { tenantId: tenantA.id, code: 'MAIN', name: 'Main', isDefault: true },
    });
    const otherStore = await p.store.create({
      data: { tenantId: tenantA.id, code: 'BR2', name: 'Branch 2' },
    });
    const category = await p.category.create({ data: { tenantId: tenantA.id, name: 'Cat' } });
    const sub = await p.subDepartment.create({
      data: { tenantId: tenantA.id, categoryId: category.id, name: 'Sub' },
    });
    const mkProduct = (name: string, selling: string, tax: string) =>
      p.product.create({
        data: {
          tenantId: tenantA.id,
          name,
          sku: `${name}-${run}`,
          categoryId: category.id,
          subDepartmentId: sub.id,
          costPrice: '10',
          sellingPrice: selling,
          taxRate: tax,
        },
      });
    const product1 = await mkProduct('P1', '100', '0');
    const product2 = await mkProduct('P2', '40', '10');
    const role = await p.role.create({
      data: { tenantId: tenantA.id, key: `r-${run}`, name: 'Staff', systemRole: 'CUSTOM' },
    });
    const full = new Set([
      'pos.create',
      'discount.apply',
      'price.change',
      'sale.refund',
      'customers.edit',
      'employees.edit',
      'reports.view',
      'reports.export',
    ]);

    return {
      repos: createPrismaRepositories(p),
      actor: { id: `actor-${run}`, tenantId: tenantA.id, permissions: full },
      limitedActor: {
        id: `cashier-${run}`,
        tenantId: tenantA.id,
        permissions: new Set(['pos.create', 'customers.view', 'customers.create']),
      },
      otherTenantActor: { id: `actor-b-${run}`, tenantId: tenantB.id, permissions: full },
      ids: {
        storeId: store.id,
        otherStoreId: otherStore.id,
        productId: product1.id,
        productId2: product2.id,
      },
      timeZone: 'Asia/Karachi',
      faults: {
        failAuditWrite: (prefix) =>
          installFault(
            p,
            'audit_logs',
            tenantA.id,
            `AND NEW.action LIKE '${prefix.replace(/_/g, '\\_')}%'`,
            'injected: audit insert failed',
          ),
      },
      setSoldAt: async (saleId, at) => {
        await p.sale.update({ where: { id: saleId }, data: { soldAt: at } });
      },
      newUserId: async () => {
        const id = randomUUID().slice(0, 8);
        const u = await p.user.create({
          data: {
            tenantId: tenantA.id,
            roleId: role.id,
            loginId: `emp.${id}.${run}`,
            displayName: `Emp ${id}`,
            passwordHash: 'not-a-real-hash',
          },
        });
        return u.id;
      },
      close: async () => {
        await prisma?.$disconnect();
        prisma = null;
      },
    };
  };

  describePhase6Contract('real PostgreSQL', createHarness);
}
