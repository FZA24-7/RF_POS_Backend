import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildScenario } from '../fakes/scenario.js';
import { buildTestApp, loginAs } from '../fakes/build-test-app.js';

const bearer = async (
  app: ReturnType<typeof buildTestApp>,
  user: { loginId: string; password: string },
) => {
  const login = await loginAs(app, user.loginId, user.password);
  return { Authorization: `Bearer ${login.body.accessToken as string}` };
};

const purchaseBody = (
  s: Awaited<ReturnType<typeof buildScenario>>,
  over: Record<string, unknown> = {},
) => ({
  supplierId: s.catalog.supplierId,
  storeId: s.tenantA.storeId,
  invoiceNo: 'SUP-INV-1001',
  purchaseDate: '2026-10-01',
  items: [
    {
      productId: s.catalog.productId,
      quantity: '10',
      costPrice: '100',
      taxRate: '10',
      discountPercent: '5',
    },
  ],
  ...over,
});

describe('Suppliers routes', () => {
  it('requires authentication', async () => {
    const s = await buildScenario();
    expect((await request(buildTestApp(s)).get('/api/suppliers')).status).toBe(401);
  });

  it('Manager can create and list; Cashier cannot create', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const mgr = await bearer(app, s.tenantAManager);
    const created = await request(app)
      .post('/api/suppliers')
      .set(mgr)
      .send({ name: 'Fresh Supplier' });
    expect(created.status).toBe(201);
    const list = await request(app).get('/api/suppliers').set(mgr);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain('Fresh Supplier');
    const dup = await request(app).post('/api/suppliers').set(mgr).send({ name: 'Fresh Supplier' });
    expect(dup.status).toBe(409);

    const cashier = await bearer(app, s.tenantACashier);
    const denied = await request(app)
      .post('/api/suppliers')
      .set(cashier)
      .send({ name: 'Nope Supplier' });
    expect(denied.status).toBe(403);
  });

  it("Tenant B cannot see Tenant A's suppliers", async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const b = await bearer(app, s.tenantBClientAdmin);
    const list = await request(app).get('/api/suppliers').set(b);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain('Textile Wholesalers');
  });
});

describe('Purchases routes', () => {
  it('requires authentication', async () => {
    const s = await buildScenario();
    expect((await request(buildTestApp(s)).get('/api/purchases')).status).toBe(401);
  });

  it('Cashier is forbidden from creating purchases', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const res = await request(app)
      .post('/api/purchases')
      .set(await bearer(app, s.tenantACashier))
      .send(purchaseBody(s));
    expect(res.status).toBe(403);
  });

  it('records a purchase with exact totals, increments stock, and writes a PURCHASE movement', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const mgr = await bearer(app, s.tenantAManager);

    const before = await request(app)
      .get(`/api/inventory/${s.catalog.productId}/movements`)
      .set(mgr);
    const res = await request(app).post('/api/purchases').set(mgr).send(purchaseBody(s));
    expect(res.status).toBe(201);
    // gross 1000.00, 5% line discount 50.00, net 950.00, 10% tax 95.00, total 1045.00
    expect(res.body.subtotal).toBe('1000.00');
    expect(res.body.taxTotal).toBe('95.00');
    expect(res.body.total).toBe('1045.00');
    expect(res.body.paymentStatus).toBe('UNPAID');
    expect(res.body.paidAmount).toBe('0.00');

    const after = await request(app)
      .get(`/api/inventory/${s.catalog.productId}/movements`)
      .set(mgr);
    expect(after.body.length).toBe(before.body.length + 1);
    const purchaseMovements = (
      after.body as Array<{ type: string; quantityChange: string }>
    ).filter((m) => m.type === 'PURCHASE');
    expect(purchaseMovements).toHaveLength(1);
    expect(purchaseMovements[0]?.quantityChange).toBe('10');
  });

  it('a duplicate submission is rejected with 409 and does not double-count stock', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const mgr = await bearer(app, s.tenantAManager);
    expect((await request(app).post('/api/purchases').set(mgr).send(purchaseBody(s))).status).toBe(
      201,
    );
    const again = await request(app).post('/api/purchases').set(mgr).send(purchaseBody(s));
    expect(again.status).toBe(409);
    const moves = await request(app)
      .get(`/api/inventory/${s.catalog.productId}/movements`)
      .set(mgr);
    expect(
      (moves.body as Array<{ type: string }>).filter((m) => m.type === 'PURCHASE'),
    ).toHaveLength(1);
  });

  it('rejects both percent and fixed discount on a line (no double-discounting)', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const res = await request(app)
      .post('/api/purchases')
      .set(await bearer(app, s.tenantAManager))
      .send(
        purchaseBody(s, {
          items: [
            {
              productId: s.catalog.productId,
              quantity: '1',
              costPrice: '10',
              discountPercent: '5',
              discountAmount: '1',
            },
          ],
        }),
      );
    expect(res.status).toBe(422);
  });

  it("rejects another tenant's supplier and product, and a foreign branch", async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const mgr = await bearer(app, s.tenantAManager);
    const badSupplier = await request(app)
      .post('/api/purchases')
      .set(mgr)
      .send(purchaseBody(s, { supplierId: s.catalog.tenantBSupplierId }));
    expect(badSupplier.status).toBe(422);
    const badBranch = await request(app)
      .post('/api/purchases')
      .set(mgr)
      .send(purchaseBody(s, { storeId: s.tenantB.storeId }));
    expect(badBranch.status).toBe(422);
    const badProduct = await request(app)
      .post('/api/purchases')
      .set(mgr)
      .send(
        purchaseBody(s, {
          items: [{ productId: 'does-not-exist', quantity: '1', costPrice: '1' }],
        }),
      );
    expect(badProduct.status).toBe(422);
  });

  it('Tenant B cannot view, invoice, export or pay Tenant A purchase (IDOR)', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const created = await request(app)
      .post('/api/purchases')
      .set(await bearer(app, s.tenantAManager))
      .send(purchaseBody(s));
    const id = created.body.id as string;
    const b = await bearer(app, s.tenantBClientAdmin);
    expect((await request(app).get(`/api/purchases/${id}`).set(b)).status).toBe(404);
    expect((await request(app).get(`/api/purchases/${id}/invoice`).set(b)).status).toBe(404);
    expect((await request(app).get(`/api/purchases/${id}/invoice.pdf`).set(b)).status).toBe(404);
    expect(
      (
        await request(app)
          .post(`/api/purchases/${id}/payments`)
          .set(b)
          .send({ amount: '1', method: 'CASH' })
      ).status,
    ).toBe(404);
  });

  it('payments move status UNPAID → PARTIAL → PAID and cannot exceed the balance', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const mgr = await bearer(app, s.tenantAManager);
    const created = await request(app).post('/api/purchases').set(mgr).send(purchaseBody(s));
    const id = created.body.id as string;

    const partial = await request(app)
      .post(`/api/purchases/${id}/payments`)
      .set(mgr)
      .send({ amount: '45', method: 'CASH' });
    expect(partial.status).toBe(200);
    expect(partial.body.paymentStatus).toBe('PARTIAL');
    expect(partial.body.paidAmount).toBe('45.00');

    const over = await request(app)
      .post(`/api/purchases/${id}/payments`)
      .set(mgr)
      .send({ amount: '1000.01', method: 'CASH' });
    expect(over.status).toBe(409);

    const rest = await request(app)
      .post(`/api/purchases/${id}/payments`)
      .set(mgr)
      .send({ amount: '1000', method: 'BANK_TRANSFER' });
    expect(rest.status).toBe(200);
    expect(rest.body.paymentStatus).toBe('PAID');

    const inv = await request(app).get(`/api/purchases/${id}/invoice`).set(mgr);
    expect(inv.body.amountPaid).toBe('1045.00');
    expect(inv.body.outstanding).toBe('0.00');
  });

  it('initial payment is recorded and normalised to 2dp', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const mgr = await bearer(app, s.tenantAManager);
    const res = await request(app)
      .post('/api/purchases')
      .set(mgr)
      .send(purchaseBody(s, { initialPayment: { amount: '500', method: 'CASH' } }));
    expect(res.status).toBe(201);
    expect(res.body.paidAmount).toBe('500.00');
    expect(res.body.paymentStatus).toBe('PARTIAL');
  });

  it('create-product-inside-purchase: a product made via the catalog API is immediately purchasable', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const mgr = await bearer(app, s.tenantAManager);
    const product = await request(app)
      .post('/api/catalog/products')
      .set(mgr)
      .send({
        name: 'Brand New Item',
        sku: 'NEW-001',
        categoryId: s.catalog.categoryId,
        subDepartmentId: s.catalog.subDepartmentId,
        supplierId: s.catalog.supplierId,
        costPrice: '20',
        sellingPrice: '30',
        barcodes: ['9990001112223'],
      });
    expect(product.status).toBe(201);
    const res = await request(app)
      .post('/api/purchases')
      .set(mgr)
      .send(
        purchaseBody(s, {
          items: [{ productId: product.body.id, quantity: '4', costPrice: '20' }],
        }),
      );
    expect(res.status).toBe(201);
    expect(res.body.total).toBe('80.00');
    const inv = await request(app).get(`/api/purchases/${res.body.id}/invoice`).set(mgr);
    expect(inv.body.purchase.items[0].sku).toBe('NEW-001');
    expect(inv.body.purchase.items[0].barcodes).toContain('9990001112223');
  });

  it('invoice reflects the saved purchase and the PDF is a real PDF; reprint creates nothing new', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const mgr = await bearer(app, s.tenantAManager);
    const created = await request(app).post('/api/purchases').set(mgr).send(purchaseBody(s));
    const id = created.body.id as string;

    const inv = await request(app).get(`/api/purchases/${id}/invoice`).set(mgr);
    expect(inv.status).toBe(200);
    expect(inv.body.purchase.id).toBe(id);
    expect(inv.body.purchase.total).toBe(created.body.total);
    expect(inv.body.supplier.name).toBe('Textile Wholesalers Ltd');
    expect(inv.body.branch.id).toBe(s.tenantA.storeId);
    expect(inv.body.createdBy.id).toBe(s.tenantAManager.id);
    expect(inv.body.business.name).toBeTruthy();
    expect(inv.body.outstanding).toBe('1045.00');

    const pdf = await request(app)
      .get(`/api/purchases/${id}/invoice.pdf`)
      .set(mgr)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    const list = await request(app).get('/api/purchases').set(mgr);
    expect(list.body.total).toBe(1);
    const moves = await request(app)
      .get(`/api/inventory/${s.catalog.productId}/movements`)
      .set(mgr);
    expect(
      (moves.body as Array<{ type: string }>).filter((m) => m.type === 'PURCHASE'),
    ).toHaveLength(1);
  });

  it('Cashier has no purchases permission at all (cannot view the invoice)', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const created = await request(app)
      .post('/api/purchases')
      .set(await bearer(app, s.tenantAManager))
      .send(purchaseBody(s));
    const cashier = await bearer(app, s.tenantACashier);
    const res = await request(app).get(`/api/purchases/${created.body.id}/invoice`).set(cashier);
    expect(res.status).toBe(403);
  });
});
