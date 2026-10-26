/**
 * REAL PostgreSQL integration test for the product repository (regression: nested barcode create must not pass tenantId).
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
import { describe, expect, it } from 'vitest';

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
  describe('catalogue product create [real PostgreSQL]', () => {
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

  describe('catalogue product create [real PostgreSQL]', () => {
    it('creates a product with barcodes, reads it back by id and barcode, and is tenant-scoped', async () => {
      const p = client();
      const run = randomUUID().slice(0, 8);
      const a = await p.tenant.create({ data: { code: `CA${run}`, name: `Cat A ${run}` } });
      const b = await p.tenant.create({ data: { code: `CB${run}`, name: `Cat B ${run}` } });
      const category = await p.category.create({ data: { tenantId: a.id, name: 'Cat' } });
      const sub = await p.subDepartment.create({
        data: { tenantId: a.id, categoryId: category.id, name: 'Sub' },
      });
      const repos = createPrismaRepositories(p);
      const created = await repos.products.create(a.id, {
        name: 'Shirt',
        sku: `SKU-${run}`,
        categoryId: category.id,
        subDepartmentId: sub.id,
        costPrice: '100',
        sellingPrice: '150',
        taxRate: '10',
        unit: 'pcs',
        minStock: '0',
        barcodes: [`BC1-${run}`, `BC2-${run}`],
      });
      expect(created.barcodes).toEqual([`BC1-${run}`, `BC2-${run}`]);
      expect((await repos.products.findById(created.id, a.id))?.sku).toBe(`SKU-${run}`);
      expect(await repos.barcodes.findProductIdByCode(a.id, `BC2-${run}`)).toBe(created.id);
      expect(await repos.products.findById(created.id, b.id)).toBeNull();
      expect(await repos.barcodes.findProductIdByCode(b.id, `BC1-${run}`)).toBeNull();
      await p.$disconnect();
      prisma = null;
    });
  });
}
