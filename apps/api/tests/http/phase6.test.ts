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
const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const range = `from=${ymd(new Date(Date.now() - 2 * 86_400_000))}&to=${ymd(new Date(Date.now() + 86_400_000))}`;

describe('Phase 6 routes: authentication and permissions', () => {
  it('every Phase 6 endpoint requires authentication, and platform tokens have no tenant', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    for (const path of [
      '/customers',
      '/expenses',
      '/employees',
      `/reports/sales-summary?${range}`,
      `/analytics/overview?${range}`,
      '/suppliers/x/ledger',
    ]) {
      expect((await request(app).get(`/api${path}`)).status, path).toBe(401);
    }
    const master = await bearer(app, s.masterAdmin);
    expect((await request(app).get('/api/customers').set(master)).status).toBe(403);
    expect((await request(app).get(`/api/reports/sales-summary?${range}`).set(master)).status).toBe(
      403,
    );
  });

  it('a Cashier may view and create customers but not edit them, take payments, or see expenses/employees/reports', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const cashier = await bearer(app, s.tenantACashier);
    expect((await request(app).get('/api/customers').set(cashier)).status).toBe(200);
    const created = await request(app)
      .post('/api/customers')
      .set(cashier)
      .send({ name: 'Walk In' });
    expect(created.status).toBe(201);
    // cannot grant credit
    expect(
      (
        await request(app)
          .post('/api/customers')
          .set(cashier)
          .send({ name: 'Credit Seeker', creditLimit: '500' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .patch(`/api/customers/${created.body.id}`)
          .set(cashier)
          .send({ creditLimit: '500' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/customers/${created.body.id}/payments`)
          .set(cashier)
          .send({ amount: '1', method: 'CASH' })
      ).status,
    ).toBe(403);
    expect((await request(app).get('/api/expenses').set(cashier)).status).toBe(403);
    expect((await request(app).get('/api/employees').set(cashier)).status).toBe(403);
    expect(
      (await request(app).get(`/api/reports/sales-summary?${range}`).set(cashier)).status,
    ).toBe(403);
    expect((await request(app).get(`/api/analytics/overview?${range}`).set(cashier)).status).toBe(
      403,
    );
  });

  it('validates input with 422 (bad dates, over-long ranges, malformed money)', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const admin = await bearer(app, s.tenantAClientAdmin);
    expect(
      (
        await request(app)
          .get('/api/reports/sales-summary?from=2026-03-02&to=2026-03-01')
          .set(admin)
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .get('/api/reports/sales-summary?from=2024-01-01&to=2026-01-01')
          .set(admin)
      ).status,
    ).toBe(422);
    expect(
      (await request(app).get('/api/reports/sales-summary?from=yesterday&to=today').set(admin))
        .status,
    ).toBe(422);
    // Regression (browser-E2E probe): a date with the right shape that does not exist must not roll over silently.
    for (const bad of ['2026-02-30', '2026-13-01', '2026-04-31', '2025-02-29']) {
      expect(
        (await request(app).get(`/api/reports/sales-summary?from=${bad}&to=2026-12-01`).set(admin))
          .status,
        bad,
      ).toBe(422);
    }
    expect(
      (
        await request(app)
          .get('/api/reports/sales-summary?from=2028-02-29&to=2028-03-01')
          .set(admin)
      ).status,
    ).toBe(200); // a real leap day is accepted
    expect(
      (
        await request(app).post('/api/expenses').set(admin).send({
          storeId: s.tenantA.storeId,
          category: 'Rent',
          amount: '10.00',
          expenseDate: '2026-02-30',
          method: 'CASH',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app).post('/api/expenses').set(admin).send({
          storeId: s.tenantA.storeId,
          category: 'Rent',
          amount: '1e3',
          expenseDate: '2026-03-01',
          method: 'CASH',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .post('/api/customers')
          .set(admin)
          .send({ name: 'X', openingBalance: '-5' })
      ).status,
    ).toBe(422);
  });
});

describe('Phase 6 routes: end-to-end flows', () => {
  it('customer credit sale, ledger, payment and receivables report', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const admin = await bearer(app, s.tenantAClientAdmin);
    const cashier = await bearer(app, s.tenantACashier);
    const customer = (
      await request(app).post('/api/customers').set(admin).send({
        name: 'Hassan Traders',
        phone: '0300-5551212',
        creditLimit: '5000',
        openingBalance: '100',
      })
    ).body;
    expect(customer).toMatchObject({ balance: '100.00', creditLimit: '5000.00' });

    const sale = await request(app)
      .post('/api/sales')
      .set(cashier)
      .send({
        clientRequestId: `p6-${Math.random().toString(36).slice(2)}`,
        storeId: s.tenantA.storeId,
        customerId: customer.id,
        items: [{ productId: s.catalog.productId, quantity: '2' }], // 2 x 899.00
        payments: [
          { method: 'CASH', amount: '500.00' },
          { method: 'CUSTOMER_CREDIT', amount: '1298.00' },
        ],
      });
    expect(sale.status).toBe(201);
    expect(sale.body).toMatchObject({
      customerName: 'Hassan Traders',
      paidTotal: '1798.00',
      changeDue: '0.00',
    });

    // over the limit -> 409 with a clear code
    const tooMuch = await request(app)
      .post('/api/sales')
      .set(cashier)
      .send({
        clientRequestId: `p6-${Math.random().toString(36).slice(2)}`,
        storeId: s.tenantA.storeId,
        customerId: customer.id,
        items: [{ productId: s.catalog.productId, quantity: '5' }],
        payments: [{ method: 'CUSTOMER_CREDIT', amount: '4495.00' }],
      });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.code).toBe('CREDIT_LIMIT_EXCEEDED');

    const ledger = await request(app).get(`/api/customers/${customer.id}/ledger`).set(admin);
    expect(ledger.status).toBe(200);
    expect(ledger.body.balance).toBe('1398.00');
    expect(ledger.body.entries.map((e: { type: string }) => e.type)).toEqual([
      'OPENING',
      'CREDIT_SALE',
    ]);

    const pay = await request(app)
      .post(`/api/customers/${customer.id}/payments`)
      .set(admin)
      .send({ amount: '398.00', method: 'BANK_TRANSFER', reference: 'TT-1' });
    expect(pay.status).toBe(201);
    expect(pay.body.balance).toBe('1000.00');
    const over = await request(app)
      .post(`/api/customers/${customer.id}/payments`)
      .set(admin)
      .send({ amount: '1000.01', method: 'CASH' });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('PAYMENT_EXCEEDS_BALANCE');

    const recv = await request(app).get('/api/reports/receivables').set(admin);
    expect(recv.body.total).toBe('1000.00');
    const csv = await request(app).get('/api/reports/receivables?format=csv').set(admin);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('Hassan Traders');

    // another tenant cannot touch it
    const other = await bearer(app, s.tenantBClientAdmin);
    expect((await request(app).get(`/api/customers/${customer.id}`).set(other)).status).toBe(404);
    expect((await request(app).get(`/api/customers/${customer.id}/ledger`).set(other)).status).toBe(
      404,
    );
    expect(
      (
        await request(app)
          .post(`/api/customers/${customer.id}/payments`)
          .set(other)
          .send({ amount: '1', method: 'CASH' })
      ).status,
    ).toBe(404);
  });

  it('expenses CRUD with permissions; employee private fields are hidden without employees.edit', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const admin = await bearer(app, s.tenantAClientAdmin);
    const manager = await bearer(app, s.tenantAManager);
    const exp = await request(app).post('/api/expenses').set(admin).send({
      storeId: s.tenantA.storeId,
      category: 'Electricity',
      amount: '1250.50',
      expenseDate: '2026-03-01',
      method: 'BANK_TRANSFER',
    });
    expect(exp.status).toBe(201);
    expect(exp.body.expenseDay).toBe('2026-03-01');
    const list = await request(app).get('/api/expenses?from=2026-03-01&to=2026-03-01').set(admin);
    expect(list.body).toMatchObject({ total: 1, totalAmount: '1250.50' });
    expect(
      (await request(app).patch(`/api/expenses/${exp.body.id}`).set(admin).send({ amount: '1300' }))
        .body.amount,
    ).toBe('1300.00');
    expect((await request(app).delete(`/api/expenses/${exp.body.id}`).set(admin)).status).toBe(204);
    expect((await request(app).get(`/api/expenses/${exp.body.id}`).set(admin)).status).toBe(404);

    const emp = await request(app)
      .post('/api/employees')
      .set(admin)
      .send({ fullName: 'Sana Malik', salary: '60000', nationalId: '42101-1111111-1' });
    expect(emp.status).toBe(201);
    expect(emp.body.salary).toBe('60000.00');
    // The Manager template has employees.edit, so private fields are visible; hiding without it is covered by the contract suite.
    const seen = await request(app).get(`/api/employees/${emp.body.id}`).set(manager);
    expect(seen.status).toBe(200);
    expect(seen.body.salary).toBe('60000.00');
    // The Manager template has no expenses.delete.
    const mine = await request(app).post('/api/expenses').set(manager).send({
      storeId: s.tenantA.storeId,
      category: 'Tea',
      amount: '10',
      expenseDate: '2026-03-02',
      method: 'CASH',
    });
    expect(mine.status).toBe(201);
    expect((await request(app).delete(`/api/expenses/${mine.body.id}`).set(manager)).status).toBe(
      403,
    );
  });

  it('reports: JSON and CSV need the right permission; analytics overview responds', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const admin = await bearer(app, s.tenantAClientAdmin);
    const res = await request(app).get(`/api/reports/sales-summary?${range}`).set(admin);
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ timeZone: 'Asia/Karachi', currency: 'PKR' });
    expect(res.body.data).toHaveProperty('netSales');
    for (const r of [
      'daily',
      'hourly',
      'top-products',
      'by-cashier',
      'by-category',
      'profit-loss',
    ]) {
      expect((await request(app).get(`/api/reports/${r}?${range}`).set(admin)).status, r).toBe(200);
    }
    expect((await request(app).get('/api/reports/stock-valuation').set(admin)).status).toBe(200);
    expect((await request(app).get('/api/reports/payables').set(admin)).status).toBe(200);
    const csv = await request(app).get(`/api/reports/sales-summary?${range}&format=csv`).set(admin);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-disposition']).toMatch(/attachment; filename="sales-summary_/);
    const an = await request(app).get(`/api/analytics/overview?${range}`).set(admin);
    expect(an.status).toBe(200);
    expect(an.body).toHaveProperty('previous');
  });

  it('supplier ledger endpoint is tenant-scoped', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const admin = await bearer(app, s.tenantAClientAdmin);
    const other = await bearer(app, s.tenantBClientAdmin);
    const ok = await request(app).get('/api/suppliers/supplier-a-textiles/ledger').set(admin);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ openingBalance: '0.00', balance: '0.00' });
    expect(
      (await request(app).get('/api/suppliers/supplier-a-textiles/ledger').set(other)).status,
    ).toBe(404);
  });
});
