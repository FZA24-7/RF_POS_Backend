import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildScenario } from '../fakes/scenario.js';
import { buildTestApp, loginAs } from '../fakes/build-test-app.js';
import { RECEIPT_COLUMNS } from '../../src/services/receipt.js';

type S = Awaited<ReturnType<typeof buildScenario>>;
const bearer = async (
  app: ReturnType<typeof buildTestApp>,
  user: { loginId: string; password: string },
) => {
  const login = await loginAs(app, user.loginId, user.password);
  return { Authorization: `Bearer ${login.body.accessToken as string}` };
};
let n = 0;
const sale = (s: S, over: Record<string, unknown> = {}) => ({
  clientRequestId: `http-req-${++n}-${Math.random().toString(36).slice(2, 8)}`,
  storeId: s.tenantA.storeId,
  items: [{ productId: s.catalog.productId, quantity: '2' }], // 2 x 899.00
  payments: [{ method: 'CASH', amount: '2000.00' }],
  ...over,
});

describe('POS & sales routes', () => {
  it('requires authentication', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    expect((await request(app).post('/api/sales').send({})).status).toBe(401);
    expect((await request(app).get('/api/sales')).status).toBe(401);
    expect((await request(app).get('/api/pos/products?storeId=x&search=y')).status).toBe(401);
  });

  it('platform (Master Admin) tokens have no tenant context', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const master = await bearer(app, s.masterAdmin);
    expect((await request(app).get('/api/sales').set(master)).status).toBe(403);
  });

  it('Cashier can sell at the catalogue price; server computes totals, change and stock', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const cashier = await bearer(app, s.tenantACashier);
    const res = await request(app).post('/api/sales').set(cashier).send(sale(s));
    expect(res.status).toBe(201);
    expect(res.headers['idempotent-replayed']).toBe('false');
    expect(res.body).toMatchObject({
      subtotal: '1798.00',
      grandTotal: '1798.00',
      paidTotal: '2000.00',
      changeDue: '202.00',
      status: 'COMPLETED',
    });
    expect(res.body.cashierId).toBe(s.tenantACashier.id);
    const inv = await s.repos.inventory.findByStoreAndProduct(
      s.tenantA.storeId,
      s.catalog.productId,
    );
    expect(inv?.quantity).toBe('18.000');
  });

  it('a client-supplied price is ignored unless the user has price.change', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const cashier = await bearer(app, s.tenantACashier);
    const body = sale(s, {
      items: [{ productId: s.catalog.productId, quantity: '1', unitPrice: '1.00' }],
    });
    const denied = await request(app).post('/api/sales').set(cashier).send(body);
    expect(denied.status).toBe(403);
    // Sending the real price is not an override.
    const same = await request(app)
      .post('/api/sales')
      .set(cashier)
      .send(
        sale(s, {
          items: [{ productId: s.catalog.productId, quantity: '1', unitPrice: '899.00' }],
        }),
      );
    expect(same.status).toBe(201);
    const mgr = await bearer(app, s.tenantAManager);
    const ok = await request(app)
      .post('/api/sales')
      .set(mgr)
      .send(
        sale(s, {
          items: [{ productId: s.catalog.productId, quantity: '1', unitPrice: '500.00' }],
          payments: [{ method: 'CARD', amount: '500.00' }],
        }),
      );
    expect(ok.status).toBe(201);
    expect(ok.body.grandTotal).toBe('500.00');
  });

  it('discounts need discount.apply; manager discounts are computed exactly', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const cashier = await bearer(app, s.tenantACashier);
    const denied = await request(app)
      .post('/api/sales')
      .set(cashier)
      .send(sale(s, { discountPercent: '10' }));
    expect(denied.status).toBe(403);
    const mgr = await bearer(app, s.tenantAManager);
    const ok = await request(app)
      .post('/api/sales')
      .set(mgr)
      .send(sale(s, { discountPercent: '10' }));
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({
      subtotal: '1798.00',
      cartDiscountAmount: '179.80',
      grandTotal: '1618.20',
    });
  });

  it('rejects: short payment, change without cash, zero payment, CUSTOMER_CREDIT, both discount kinds, over-stock, unknown product, foreign branch', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const cashier = await bearer(app, s.tenantACashier);
    const post = (b: unknown) =>
      request(app)
        .post('/api/sales')
        .set(cashier)
        .send(b as object);
    expect(
      (await post(sale(s, { payments: [{ method: 'CASH', amount: '100' }] }))).body.error.code,
    ).toBe('PAYMENT_INSUFFICIENT');
    expect((await post(sale(s, { payments: [{ method: 'CARD', amount: '2000' }] }))).status).toBe(
      422,
    ); // change from card
    expect((await post(sale(s, { payments: [{ method: 'CASH', amount: '0' }] }))).status).toBe(422);
    expect(
      (await post(sale(s, { payments: [{ method: 'CUSTOMER_CREDIT', amount: '1798' }] }))).status,
    ).toBe(422);
    expect(
      (
        await post(
          sale(s, {
            items: [
              {
                productId: s.catalog.productId,
                quantity: '1',
                discountPercent: '5',
                discountAmount: '5',
              },
            ],
          }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await post(
          sale(s, {
            items: [{ productId: s.catalog.productId, quantity: '21' }],
            payments: [{ method: 'CASH', amount: '99999' }],
          }),
        )
      ).body.error.code,
    ).toBe('INSUFFICIENT_STOCK');
    expect((await post(sale(s, { items: [{ productId: 'nope', quantity: '1' }] }))).status).toBe(
      422,
    );
    expect((await post(sale(s, { storeId: 'store-b-main' }))).status).toBe(422);
    expect(
      (await post(sale(s, { items: [{ productId: s.catalog.productId, quantity: '0' }] }))).status,
    ).toBe(422);
    expect(
      (await post(sale(s, { items: [{ productId: s.catalog.productId, quantity: '1.0005' }] })))
        .status,
    ).toBe(422);
    expect((await post({ ...sale(s), clientRequestId: 'x' })).status).toBe(422);
    const inv = await s.repos.inventory.findByStoreAndProduct(
      s.tenantA.storeId,
      s.catalog.productId,
    );
    expect(inv?.quantity).toBe('20'); // nothing above changed stock
  });

  it('replaying the same clientRequestId returns 200 with the same sale', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const cashier = await bearer(app, s.tenantACashier);
    const b = sale(s);
    const first = await request(app).post('/api/sales').set(cashier).send(b);
    const again = await request(app).post('/api/sales').set(cashier).send(b);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body.id).toBe(first.body.id);
  });

  it('tenant isolation: tenant B cannot see tenant A sales, receipts or refund them', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const cashier = await bearer(app, s.tenantACashier);
    const created = await request(app).post('/api/sales').set(cashier).send(sale(s));
    const b = await bearer(app, s.tenantBClientAdmin);
    expect((await request(app).get(`/api/sales/${created.body.id}`).set(b)).status).toBe(404);
    expect((await request(app).get(`/api/sales/${created.body.id}/receipt`).set(b)).status).toBe(
      404,
    );
    expect(
      (await request(app).get(`/api/sales/${created.body.id}/receipt.pdf`).set(b)).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`/api/sales/${created.body.id}/returns`)
          .set(b)
          .send({
            items: [{ saleItemId: created.body.items[0].id, quantity: '1' }],
            refundMethod: 'CASH',
          })
      ).status,
    ).toBe(404);
    const list = await request(app).get('/api/sales').set(b);
    expect(list.body.total).toBe(0);
  });

  it('POS product search finds by barcode and by name, with branch stock', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const cashier = await bearer(app, s.tenantACashier);
    const byCode = await request(app)
      .get('/api/pos/products')
      .query({ storeId: s.tenantA.storeId, search: s.catalog.productBarcode })
      .set(cashier);
    expect(byCode.status).toBe(200);
    expect(byCode.body.items[0]).toMatchObject({
      id: s.catalog.productId,
      sellingPrice: '899.00',
      stock: '20',
    });
    const byName = await request(app)
      .get('/api/pos/products')
      .query({ storeId: s.tenantA.storeId, search: 'cotton' })
      .set(cashier);
    expect(byName.body.items).toHaveLength(1);
    const foreign = await request(app)
      .get('/api/pos/products')
      .query({ storeId: 'store-b-main', search: 'cotton' })
      .set(cashier);
    expect(foreign.status).toBe(422);
  });
});

describe('Refunds', () => {
  it('Cashier cannot refund; Manager can, stock returns, receipts reflect it', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const cashier = await bearer(app, s.tenantACashier);
    const created = await request(app).post('/api/sales').set(cashier).send(sale(s));
    const item = created.body.items[0];
    const denied = await request(app)
      .post(`/api/sales/${created.body.id}/returns`)
      .set(cashier)
      .send({ items: [{ saleItemId: item.id, quantity: '1' }], refundMethod: 'CASH' });
    expect(denied.status).toBe(403);

    const mgr = await bearer(app, s.tenantAManager);
    const ret = await request(app)
      .post(`/api/sales/${created.body.id}/returns`)
      .set(mgr)
      .send({
        items: [{ saleItemId: item.id, quantity: '1' }],
        refundMethod: 'CASH',
        reason: 'Defective',
      });
    expect(ret.status).toBe(201);
    expect(ret.body).toMatchObject({
      refundTotal: '899.00',
      refundMethod: 'CASH',
      reason: 'Defective',
    });
    const after = await request(app).get(`/api/sales/${created.body.id}`).set(mgr);
    expect(after.body.status).toBe('PARTIALLY_REFUNDED');
    expect(
      (await s.repos.inventory.findByStoreAndProduct(s.tenantA.storeId, s.catalog.productId))
        ?.quantity,
    ).toBe('19.000');

    const slip = await request(app)
      .get(`/api/sale-returns/${ret.body.id}/receipt`)
      .query({ format: '58mm' })
      .set(mgr);
    expect(slip.status).toBe(200);
    expect(slip.body.receipt).toMatchObject({
      kind: 'REFUND',
      number: ret.body.returnNo,
      relatedNumber: created.body.invoiceNo,
    });
    expect(slip.body.text).toContain('REFUND SLIP');
    const sr = await request(app).get(`/api/sales/${created.body.id}/receipt`).set(mgr);
    expect(sr.body.receipt.payments.map((p: { label: string }) => p.label)).toContain(
      'Refunded so far',
    );
  });

  it('rejects over-returns, CUSTOMER_CREDIT refunds, duplicate lines and empty returns', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const mgr = await bearer(app, s.tenantAManager);
    const created = await request(app).post('/api/sales').set(mgr).send(sale(s));
    const item = created.body.items[0];
    const post = (b: unknown) =>
      request(app)
        .post(`/api/sales/${created.body.id}/returns`)
        .set(mgr)
        .send(b as object);
    expect(
      (await post({ items: [{ saleItemId: item.id, quantity: '3' }], refundMethod: 'CASH' }))
        .status,
    ).toBe(409);
    expect(
      (
        await post({
          items: [{ saleItemId: item.id, quantity: '1' }],
          refundMethod: 'CUSTOMER_CREDIT',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await post({
          items: [
            { saleItemId: item.id, quantity: '1' },
            { saleItemId: item.id, quantity: '1' },
          ],
          refundMethod: 'CASH',
        })
      ).status,
    ).toBe(422);
    expect((await post({ items: [], refundMethod: 'CASH' })).status).toBe(422);
  });
});

describe('Receipts', () => {
  const setup = async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const cashier = await bearer(app, s.tenantACashier);
    const created = await request(app)
      .post('/api/sales')
      .set(cashier)
      .send(sale(s, { customerName: 'Ayesha Khan' }));
    return { s, app, cashier, id: created.body.id as string, no: created.body.invoiceNo as string };
  };

  it('58mm and 80mm text receipts are fixed width and carry the saved figures', async () => {
    const { app, cashier, id, no } = await setup();
    for (const format of ['58mm', '80mm'] as const) {
      const res = await request(app).get(`/api/sales/${id}/receipt`).query({ format }).set(cashier);
      expect(res.status).toBe(200);
      const width = RECEIPT_COLUMNS[format];
      const lines = (res.body.text as string).trimEnd().split('\n');
      expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(width);
      expect(res.body.text).toContain(no);
      expect(res.body.text).toContain('1798.00');
      expect(res.body.text).toContain('2000.00');
      expect(res.body.text).toContain('202.00');
      expect(res.body.text).toContain('Ayesha Khan');
    }
  });

  it('a4 returns the structured receipt with no thermal text; default format is 80mm; bad format is 422', async () => {
    const { app, cashier, id } = await setup();
    const a4 = await request(app)
      .get(`/api/sales/${id}/receipt`)
      .query({ format: 'a4' })
      .set(cashier);
    expect(a4.body.text).toBeNull();
    expect(a4.body.receipt.lines[0]).toMatchObject({
      quantity: '2.000',
      unitPrice: '899.00',
      lineTotal: '1798.00',
    });
    expect((await request(app).get(`/api/sales/${id}/receipt`).set(cashier)).body.format).toBe(
      '80mm',
    );
    expect(
      (await request(app).get(`/api/sales/${id}/receipt`).query({ format: '100mm' }).set(cashier))
        .status,
    ).toBe(422);
  });

  it('PDFs are real, sized per format (58mm, 80mm, A4), single page, and the print is audited', async () => {
    const { s, app, cashier, id } = await setup();
    const widths: Record<string, number> = { '58mm': 164.4, '80mm': 226.8, a4: 595.28 };
    for (const format of ['58mm', '80mm', 'a4']) {
      const res = await request(app)
        .get(`/api/sales/${id}/receipt.pdf`)
        .query({ format })
        .set(cashier)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      const pdf = res.body as Buffer;
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      const text = pdf.toString('latin1');
      const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text);
      expect(Number(box?.[1])).toBeCloseTo(widths[format]!, 1);
      expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBe(1);
    }
    expect(s.repos.auditLogs.entries.filter((e) => e.action === 'RECEIPT_PRINTED')).toHaveLength(3);
  });
});
