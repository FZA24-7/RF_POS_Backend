/**
 * Transaction-integrity CONTRACT for recording purchases.
 *
 * One suite, two backends:
 *  - tests/unit/purchase-integrity.fake.test.ts  runs it against the in-memory fakes (fast; models a transaction).
 *  - tests/integration/purchase-integrity.pg.test.ts runs the SAME assertions against real PostgreSQL via the Prisma
 *    adapters. Only the PostgreSQL run is evidence that the database transaction really is all-or-nothing.
 *
 * Fault injection is done by the harness (in-memory hooks, or PostgreSQL triggers that RAISE EXCEPTION), never by
 * mocking the code under test.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreatePurchaseInput } from '@mafk/validation';
import type { Repositories } from '../../src/domain/ports.js';
import { DomainError } from '../../src/domain/types.js';
import { PurchaseService } from '../../src/services/purchase.service.js';

export interface IntegrityHarness {
  repos: Repositories;
  actor: { id: string; tenantId: string };
  ids: {
    storeId: string;
    otherStoreId: string;
    supplierId: string;
    productId: string;
    productId2: string;
    otherTenantSupplierId: string;
  };
  /** Count of supplier payment rows for the tenant. */
  countSupplierPayments(tenantId: string): Promise<number>;
  /** Each returns a function that removes the fault. */
  faults: {
    failAuditWrite(): Promise<() => Promise<void>>;
    failMovementWrite(productId: string): Promise<() => Promise<void>>;
    failPaymentWrite(): Promise<() => Promise<void>>;
  };
  close(): Promise<void>;
}

interface State {
  purchases: number;
  stock: Record<string, string>;
  movements: Record<string, number>;
  payments: number;
  purchaseAudits: number;
}

export function describePurchaseIntegrityContract(
  backendName: string,
  createHarness: () => Promise<IntegrityHarness>,
): void {
  describe(`purchase transaction integrity [${backendName}]`, () => {
    let h: IntegrityHarness;
    let svc: PurchaseService;
    let invoiceCounter = 0;

    beforeEach(async () => {
      h = await createHarness();
      svc = new PurchaseService(h.repos);
      invoiceCounter = 0;
    });
    afterAll(async () => {
      await h?.close();
    });

    const nextInvoice = (): string => `INV-${++invoiceCounter}`;
    const body = (overrides: Partial<CreatePurchaseInput> = {}): CreatePurchaseInput => ({
      supplierId: h.ids.supplierId,
      storeId: h.ids.storeId,
      invoiceNo: nextInvoice(),
      purchaseDate: new Date('2026-01-15'),
      items: [
        { productId: h.ids.productId, quantity: '10', costPrice: '500', taxRate: '0' },
        { productId: h.ids.productId2, quantity: '4', costPrice: '25', taxRate: '0' },
      ],
      ...overrides,
    });

    const readState = async (): Promise<State> => {
      const t = h.actor.tenantId;
      const list = await h.repos.purchases.list(t, { page: 1, pageSize: 100 });
      const stock: Record<string, string> = {};
      const movements: Record<string, number> = {};
      for (const productId of [h.ids.productId, h.ids.productId2]) {
        const inv = await h.repos.inventory.findByStoreAndProduct(h.ids.storeId, productId);
        stock[productId] = inv?.quantity ?? '0';
        movements[productId] = (await h.repos.inventory.listMovements(t, productId, 1000)).length;
      }
      const audits = await h.repos.auditLogs.listByTenant(t, 1000);
      return {
        purchases: list.total,
        stock,
        movements,
        payments: await h.countSupplierPayments(t),
        purchaseAudits: audits.filter((a) => a.action.startsWith('PURCHASE_')).length,
      };
    };

    it('success: writes purchase, stock, PURCHASE movements, supplier payment and audit together', async () => {
      const before = await readState();
      const purchase = await svc.recordPurchase(
        h.actor,
        body({ initialPayment: { amount: '1000', method: 'CASH' } }),
      );
      const after = await readState();

      expect(after.purchases).toBe(before.purchases + 1);
      expect(Number(after.stock[h.ids.productId])).toBe(Number(before.stock[h.ids.productId]) + 10);
      expect(Number(after.stock[h.ids.productId2])).toBe(
        Number(before.stock[h.ids.productId2]) + 4,
      );
      expect(after.payments).toBe(before.payments + 1);
      expect(after.purchaseAudits).toBe(before.purchaseAudits + 1);
      expect(purchase.total).toBe('5100.00');
      expect(purchase.paidAmount).toBe('1000.00');
      expect(purchase.paymentStatus).toBe('PARTIAL');

      const movements = await h.repos.inventory.listMovements(h.actor.tenantId, h.ids.productId, 5);
      expect(movements[0]).toMatchObject({ type: 'PURCHASE', quantityChange: '10' });

      const audits = await h.repos.auditLogs.listByTenant(h.actor.tenantId, 50);
      expect(audits).toContainEqual(
        expect.objectContaining({
          action: 'PURCHASE_RECORDED',
          entity: 'Purchase',
          entityId: purchase.id,
        }),
      );
    });

    it('audit failure rolls back the purchase, stock, movements and initial payment', async () => {
      const before = await readState();
      const remove = await h.faults.failAuditWrite();
      try {
        await expect(
          svc.recordPurchase(h.actor, body({ initialPayment: { amount: '1000', method: 'CASH' } })),
        ).rejects.toThrow();
      } finally {
        await remove();
      }
      expect(await readState()).toEqual(before);
    });

    it('inventory movement failure on the 2nd line rolls back every write (incl. line 1 stock)', async () => {
      const before = await readState();
      const remove = await h.faults.failMovementWrite(h.ids.productId2);
      try {
        await expect(
          svc.recordPurchase(h.actor, body({ initialPayment: { amount: '1000', method: 'CASH' } })),
        ).rejects.toThrow();
      } finally {
        await remove();
      }
      expect(await readState()).toEqual(before);
    });

    it('supplier payment failure rolls back the purchase, stock and audit', async () => {
      const before = await readState();
      const remove = await h.faults.failPaymentWrite();
      try {
        await expect(
          svc.recordPurchase(h.actor, body({ initialPayment: { amount: '1000', method: 'CASH' } })),
        ).rejects.toThrow();
      } finally {
        await remove();
      }
      expect(await readState()).toEqual(before);
    });

    it('a failed submission can be retried and then succeeds exactly once', async () => {
      const input = body();
      const remove = await h.faults.failAuditWrite();
      await expect(svc.recordPurchase(h.actor, input)).rejects.toThrow();
      await remove();
      const before = await readState();
      await svc.recordPurchase(h.actor, input);
      const after = await readState();
      expect(after.purchases).toBe(before.purchases + 1);
      expect(Number(after.stock[h.ids.productId])).toBe(Number(before.stock[h.ids.productId]) + 10);
    });

    it('duplicate sequential submission is rejected and does not increase stock twice', async () => {
      const input = body();
      await svc.recordPurchase(h.actor, input);
      const afterFirst = await readState();
      await expect(svc.recordPurchase(h.actor, input)).rejects.toMatchObject({ httpStatus: 409 });
      expect(await readState()).toEqual(afterFirst);
    });

    it('duplicate CONCURRENT submissions: exactly one wins, stock rises once', async () => {
      const before = await readState();
      const input = body();
      const results = await Promise.allSettled([
        svc.recordPurchase(h.actor, input),
        svc.recordPurchase(h.actor, input),
        svc.recordPurchase(h.actor, input),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of results) {
        if (r.status === 'rejected') {
          expect(r.reason).toBeInstanceOf(DomainError);
          expect((r.reason as DomainError).httpStatus).toBe(409);
        }
      }
      const after = await readState();
      expect(after.purchases).toBe(before.purchases + 1);
      expect(Number(after.stock[h.ids.productId])).toBe(Number(before.stock[h.ids.productId]) + 10);
      expect(after.movements[h.ids.productId]).toBe(before.movements[h.ids.productId]! + 1);
      expect(after.purchaseAudits).toBe(before.purchaseAudits + 1);
    });

    it('recordPayment: audit failure rolls back the paid amount and the payment row', async () => {
      const purchase = await svc.recordPurchase(h.actor, body());
      const before = await readState();
      const remove = await h.faults.failAuditWrite();
      try {
        await expect(
          svc.recordPayment(h.actor, purchase.id, { amount: '100', method: 'CASH' }),
        ).rejects.toThrow();
      } finally {
        await remove();
      }
      expect(await readState()).toEqual(before);
      const reread = await h.repos.purchases.findById(purchase.id, h.actor.tenantId);
      expect(reread?.paidAmount).toBe('0.00');
      expect(reread?.paymentStatus).toBe('UNPAID');
    });

    it('concurrent payments cannot overpay the balance', async () => {
      const purchase = await svc.recordPurchase(h.actor, body());
      const results = await Promise.allSettled([
        svc.recordPayment(h.actor, purchase.id, { amount: '3000', method: 'CASH' }),
        svc.recordPayment(h.actor, purchase.id, { amount: '3000', method: 'CASH' }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const reread = await h.repos.purchases.findById(purchase.id, h.actor.tenantId);
      expect(reread?.paidAmount).toBe('3000.00');
      expect(await h.countSupplierPayments(h.actor.tenantId)).toBe(1);
    });

    it("rejects another tenant's supplier without writing anything", async () => {
      const before = await readState();
      await expect(
        svc.recordPurchase(h.actor, body({ supplierId: h.ids.otherTenantSupplierId })),
      ).rejects.toBeInstanceOf(DomainError);
      expect(await readState()).toEqual(before);
    });
  });
}
