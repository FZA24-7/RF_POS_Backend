/**
 * Transaction-integrity CONTRACT for POS sales and refunds. Same shape as the purchase contract:
 * one suite, run against the in-memory fakes (tests/unit/sale-integrity.fake.test.ts) and against real PostgreSQL
 * (tests/integration/sale-integrity.pg.test.ts). Only the PostgreSQL run is evidence of real transactional behaviour.
 *
 * Fixture assumptions (the harness must provide them):
 *   product 1: selling price 100.00, tax 0       product 2: selling price 40.00, tax 10%
 *   branch `storeId` and a second branch `otherStoreId` with a different code, both in the actor's tenant.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreateSaleInput } from '@mafk/validation';
import type { Repositories } from '../../src/domain/ports.js';
import { DomainError } from '../../src/domain/types.js';
import { SaleService, type SaleActor } from '../../src/services/sale.service.js';

export interface SaleHarness {
  repos: Repositories;
  actor: SaleActor;
  otherTenantActor: SaleActor;
  ids: { storeId: string; otherStoreId: string; productId: string; productId2: string };
  faults: {
    failAuditWrite(): Promise<() => Promise<void>>;
    failMovementWrite(productId: string): Promise<() => Promise<void>>;
  };
  close(): Promise<void>;
}

const rejects = async (p: Promise<unknown>): Promise<DomainError> => {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    return err as DomainError;
  }
  throw new Error('expected the promise to reject');
};

export function describeSaleIntegrityContract(
  backendName: string,
  createHarness: () => Promise<SaleHarness>,
): void {
  describe(`sale & refund transaction integrity [${backendName}]`, () => {
    let h: SaleHarness;
    let svc: SaleService;
    let counter = 0;

    beforeEach(async () => {
      h = await createHarness();
      svc = new SaleService(h.repos);
      counter = 0;
      // Opening stock: product 1 = 10, product 2 = 5 (in the main branch).
      for (const [productId, qty] of [
        [h.ids.productId, '10'],
        [h.ids.productId2, '5'],
      ] as const) {
        await h.repos.inventory.applyMovement({
          tenantId: h.actor.tenantId,
          storeId: h.ids.storeId,
          productId,
          type: 'OPENING',
          quantityChange: qty,
          createdById: h.actor.id,
        });
      }
    });
    afterAll(async () => {
      await h?.close();
    });

    const key = (): string =>
      `req-${Date.now()}-${++counter}-${Math.random().toString(36).slice(2, 8)}`;
    const body = (over: Partial<CreateSaleInput> = {}): CreateSaleInput => ({
      clientRequestId: key(),
      storeId: h.ids.storeId,
      items: [
        { productId: h.ids.productId, quantity: '2' },
        { productId: h.ids.productId2, quantity: '3' },
      ],
      payments: [{ method: 'CASH', amount: '340.00' }],
      ...over,
    });

    const stock = async (productId: string, storeId = h.ids.storeId): Promise<string> =>
      (await h.repos.inventory.findByStoreAndProduct(storeId, productId))?.quantity ?? '0';
    const state = async () => {
      const t = h.actor.tenantId;
      const audits = await h.repos.auditLogs.listByTenant(t, 1000);
      return {
        sales: (await h.repos.sales.list(t, { page: 1, pageSize: 100 })).total,
        stock1: await stock(h.ids.productId),
        stock2: await stock(h.ids.productId2),
        movements1: (await h.repos.inventory.listMovements(t, h.ids.productId, 1000)).length,
        movements2: (await h.repos.inventory.listMovements(t, h.ids.productId2, 1000)).length,
        saleAudits: audits.filter((a) => a.action.startsWith('SALE_')).length,
      };
    };
    const num = (s: string): number => Number.parseFloat(s);

    it('records a sale: exact totals, change, payments, stock down, SALE movements, one audit', async () => {
      const { sale, replayed } = await svc.createSale(h.actor, body());
      expect(replayed).toBe(false);
      expect(sale.status).toBe('COMPLETED');
      expect(sale.subtotal).toBe('320.00');
      expect(sale.taxTotal).toBe('12.00');
      expect(sale.grandTotal).toBe('332.00');
      expect(sale.paidTotal).toBe('340.00');
      expect(sale.changeDue).toBe('8.00');
      expect(sale.items).toHaveLength(2);
      expect(sale.payments).toEqual([
        expect.objectContaining({ method: 'CASH', amount: '340.00' }),
      ]);
      expect(sale.invoiceNo).toMatch(/^INV-.+-000001$/);
      expect(num(await stock(h.ids.productId))).toBe(8);
      expect(num(await stock(h.ids.productId2))).toBe(2);
      const moves = await h.repos.inventory.listMovements(h.actor.tenantId, h.ids.productId, 10);
      expect(moves[0]).toMatchObject({ type: 'SALE' });
      expect(num(moves[0]!.quantityChange)).toBe(-2);
      const audits = (await h.repos.auditLogs.listByTenant(h.actor.tenantId, 100)).filter(
        (a) => a.action === 'SALE_RECORDED',
      );
      expect(audits).toHaveLength(1);
      // The stored sale reads back identically.
      expect(await h.repos.sales.findById(sale.id, h.actor.tenantId)).toEqual(sale);
    });

    it('insufficient stock on the 2nd line writes NOTHING (no sale, no stock change, no movement, no audit)', async () => {
      const before = await state();
      const err = await rejects(
        svc.createSale(
          h.actor,
          body({
            items: [
              { productId: h.ids.productId, quantity: '2' },
              { productId: h.ids.productId2, quantity: '6' },
            ],
            payments: [{ method: 'CASH', amount: '1000' }],
          }),
        ),
      );
      expect(err.code).toBe('INSUFFICIENT_STOCK');
      expect(err.httpStatus).toBe(409);
      expect(await state()).toEqual(before);
    });

    it('an audit-write failure rolls the whole sale back', async () => {
      const before = await state();
      const undo = await h.faults.failAuditWrite();
      try {
        await expect(svc.createSale(h.actor, body())).rejects.toBeTruthy();
      } finally {
        await undo();
      }
      expect(await state()).toEqual(before);
    });

    it('a stock-movement failure on the 2nd product rolls back the 1st product too', async () => {
      const before = await state();
      const undo = await h.faults.failMovementWrite(h.ids.productId2);
      try {
        await expect(svc.createSale(h.actor, body())).rejects.toBeTruthy();
      } finally {
        await undo();
      }
      expect(await state()).toEqual(before);
    });

    it('is idempotent: the same clientRequestId returns the same sale and writes once', async () => {
      const b = body();
      const first = await svc.createSale(h.actor, b);
      const second = await svc.createSale(h.actor, b);
      expect(second.replayed).toBe(true);
      expect(second.sale.id).toBe(first.sale.id);
      const s = await state();
      expect(s.sales).toBe(1);
      expect(num(s.stock1)).toBe(8);
      expect(s.saleAudits).toBe(1);
    });

    it('concurrent double-submit of one clientRequestId creates exactly one sale', async () => {
      const b = body();
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => svc.createSale(h.actor, b)),
      );
      const ok = results.filter(
        (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof svc.createSale>>> =>
          r.status === 'fulfilled',
      );
      expect(ok.length).toBe(5);
      expect(new Set(ok.map((r) => r.value.sale.id)).size).toBe(1);
      expect(ok.filter((r) => !r.value.replayed)).toHaveLength(1);
      const s = await state();
      expect(s.sales).toBe(1);
      expect(num(s.stock1)).toBe(8);
    });

    it('concurrent sales never oversell: 5 x qty 3 against 10 in stock -> exactly 3 succeed, stock ends at 1', async () => {
      const attempts = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          svc.createSale(
            h.actor,
            body({
              items: [{ productId: h.ids.productId, quantity: '3' }],
              payments: [{ method: 'CASH', amount: '300' }],
            }),
          ),
        ),
      );
      const ok = attempts.filter((a) => a.status === 'fulfilled');
      const failed = attempts.filter((a) => a.status === 'rejected');
      expect(ok).toHaveLength(3);
      for (const f of failed)
        expect(((f as PromiseRejectedResult).reason as DomainError).code).toBe(
          'INSUFFICIENT_STOCK',
        );
      expect(num(await stock(h.ids.productId))).toBe(1);
      const nos = ok.map(
        (a) =>
          (a as PromiseFulfilledResult<Awaited<ReturnType<typeof svc.createSale>>>).value.sale
            .invoiceNo,
      );
      expect(new Set(nos).size).toBe(3);
      expect((await state()).sales).toBe(3);
    });

    it('invoice numbers run per branch, are unique within the tenant, and sell from that branch only', async () => {
      const a1 = await svc.createSale(h.actor, body());
      const a2 = await svc.createSale(
        h.actor,
        body({
          items: [{ productId: h.ids.productId, quantity: '1' }],
          payments: [{ method: 'CASH', amount: '100' }],
        }),
      );
      await h.repos.inventory.applyMovement({
        tenantId: h.actor.tenantId,
        storeId: h.ids.otherStoreId,
        productId: h.ids.productId,
        type: 'OPENING',
        quantityChange: '4',
        createdById: h.actor.id,
      });
      const b1 = await svc.createSale(
        h.actor,
        body({
          storeId: h.ids.otherStoreId,
          items: [{ productId: h.ids.productId, quantity: '1' }],
          payments: [{ method: 'CASH', amount: '100' }],
        }),
      );
      expect(a1.sale.invoiceNo.endsWith('000001')).toBe(true);
      expect(a2.sale.invoiceNo.endsWith('000002')).toBe(true);
      expect(b1.sale.invoiceNo.endsWith('000001')).toBe(true);
      expect(new Set([a1.sale.invoiceNo, a2.sale.invoiceNo, b1.sale.invoiceNo]).size).toBe(3);
      expect(num(await stock(h.ids.productId, h.ids.otherStoreId))).toBe(3);
      // Selling something the second branch has none of fails, even though the main branch has plenty.
      const err = await rejects(
        svc.createSale(
          h.actor,
          body({
            storeId: h.ids.otherStoreId,
            items: [{ productId: h.ids.productId2, quantity: '1' }],
            payments: [{ method: 'CASH', amount: '100' }],
          }),
        ),
      );
      expect(err.code).toBe('INSUFFICIENT_STOCK');
    });

    describe('refunds', () => {
      const sellThree = async () =>
        (
          await svc.createSale(
            h.actor,
            body({
              items: [{ productId: h.ids.productId2, quantity: '3' }],
              payments: [{ method: 'CASH', amount: '200' }],
            }),
          )
        ).sale;
      // product 2: 3 x 40.00 = 120.00 + 10% tax = 132.00

      it('partial then final refund: restocks, statuses, and refunds sum exactly to the line total', async () => {
        const sale = await sellThree();
        expect(sale.grandTotal).toBe('132.00');
        expect(num(await stock(h.ids.productId2))).toBe(2);
        const item = sale.items[0]!;

        const r1 = await svc.refund(h.actor, sale.id, {
          items: [{ saleItemId: item.id, quantity: '1' }],
          refundMethod: 'CASH',
          reason: 'Wrong size',
        });
        expect(r1.refundTotal).toBe('44.00');
        expect(r1.returnNo).toMatch(/^RET-.+-000001$/);
        expect((await svc.getById(sale.id, h.actor.tenantId)).status).toBe('PARTIALLY_REFUNDED');
        expect(num(await stock(h.ids.productId2))).toBe(3);

        const r2 = await svc.refund(h.actor, sale.id, {
          items: [{ saleItemId: item.id, quantity: '2' }],
          refundMethod: 'CARD',
        });
        expect(r2.refundTotal).toBe('88.00');
        const after = await svc.getById(sale.id, h.actor.tenantId);
        expect(after.status).toBe('REFUNDED');
        expect(after.items[0]!.returnedQuantity).toBe('3.000');
        expect(after.returns).toHaveLength(2);
        expect(num(await stock(h.ids.productId2))).toBe(5);

        const e = await rejects(
          svc.refund(h.actor, sale.id, {
            items: [{ saleItemId: item.id, quantity: '1' }],
            refundMethod: 'CASH',
          }),
        );
        expect(e.code).toBe('RETURN_NOT_ALLOWED');
      });

      it('cannot return more than was sold, or an item from another sale', async () => {
        const sale = await sellThree();
        const other = (
          await svc.createSale(
            h.actor,
            body({
              items: [{ productId: h.ids.productId, quantity: '1' }],
              payments: [{ method: 'CASH', amount: '100' }],
            }),
          )
        ).sale;
        const over = await rejects(
          svc.refund(h.actor, sale.id, {
            items: [{ saleItemId: sale.items[0]!.id, quantity: '4' }],
            refundMethod: 'CASH',
          }),
        );
        expect(over.code).toBe('RETURN_NOT_ALLOWED');
        const foreign = await rejects(
          svc.refund(h.actor, sale.id, {
            items: [{ saleItemId: other.items[0]!.id, quantity: '1' }],
            refundMethod: 'CASH',
          }),
        );
        expect(foreign.httpStatus).toBe(422);
        expect(num(await stock(h.ids.productId2))).toBe(2);
      });

      it('concurrent refunds cannot over-return: two x qty 2 of a 3-unit line -> exactly one succeeds', async () => {
        const sale = await sellThree();
        const item = sale.items[0]!;
        const results = await Promise.allSettled([
          svc.refund(h.actor, sale.id, {
            items: [{ saleItemId: item.id, quantity: '2' }],
            refundMethod: 'CASH',
          }),
          svc.refund(h.actor, sale.id, {
            items: [{ saleItemId: item.id, quantity: '2' }],
            refundMethod: 'CASH',
          }),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const after = await svc.getById(sale.id, h.actor.tenantId);
        expect(after.items[0]!.returnedQuantity).toBe('2.000');
        expect(after.returns).toHaveLength(1);
        expect(num(await stock(h.ids.productId2))).toBe(4);
      });

      it('an audit failure during a refund rolls it back completely', async () => {
        const sale = await sellThree();
        const undo = await h.faults.failAuditWrite();
        try {
          await expect(
            svc.refund(h.actor, sale.id, {
              items: [{ saleItemId: sale.items[0]!.id, quantity: '1' }],
              refundMethod: 'CASH',
            }),
          ).rejects.toBeTruthy();
        } finally {
          await undo();
        }
        const after = await svc.getById(sale.id, h.actor.tenantId);
        expect(after.status).toBe('COMPLETED');
        expect(after.items[0]!.returnedQuantity).toBe('0.000');
        expect(after.returns).toHaveLength(0);
        expect(num(await stock(h.ids.productId2))).toBe(2);
      });

      it('tenant isolation: another tenant cannot read or refund the sale', async () => {
        const sale = await sellThree();
        expect(await h.repos.sales.findById(sale.id, h.otherTenantActor.tenantId)).toBeNull();
        const e = await rejects(
          svc.refund(h.otherTenantActor, sale.id, {
            items: [{ saleItemId: sale.items[0]!.id, quantity: '1' }],
            refundMethod: 'CASH',
          }),
        );
        expect(e.httpStatus).toBe(404);
        expect((await svc.getById(sale.id, h.actor.tenantId)).status).toBe('COMPLETED');
      });
    });
  });
}
