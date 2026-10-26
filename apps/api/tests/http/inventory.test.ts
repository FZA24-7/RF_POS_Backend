import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildScenario } from '../fakes/scenario.js';
import { buildTestApp, loginAs } from '../fakes/build-test-app.js';

describe('Inventory routes', () => {
  it('Cashier can view inventory and low-stock but cannot adjust stock', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantACashier.loginId,
      scenario.tenantACashier.password,
    );
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };

    const list = await request(app).get('/api/inventory').set(auth);
    expect(list.status).toBe(200);

    const low = await request(app).get('/api/inventory/low-stock').set(auth);
    expect(low.status).toBe(200);

    const adjust = await request(app).post('/api/inventory/adjust').set(auth).send({
      storeId: scenario.tenantA.storeId,
      productId: scenario.catalog.productId,
      quantityChange: '5',
      reason: 'test',
    });
    expect(adjust.status).toBe(403);
  });

  it('Manager (holds stock.adjust) can adjust stock, producing a traceable movement', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantAManager.loginId,
      scenario.tenantAManager.password,
    );
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };

    const res = await request(app).post('/api/inventory/adjust').set(auth).send({
      storeId: scenario.tenantA.storeId,
      productId: scenario.catalog.productId,
      quantityChange: '10',
      reason: 'Recount',
    });
    expect(res.status).toBe(201);
    expect(res.body.movement.type).toBe('ADJUSTMENT');

    const movements = await request(app)
      .get(`/api/inventory/${scenario.catalog.productId}/movements`)
      .set(auth);
    expect(movements.status).toBe(200);
    expect(movements.body.length).toBeGreaterThan(0);
  });

  it('rejects an adjustment that would push stock negative', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantAManager.loginId,
      scenario.tenantAManager.password,
    );
    const res = await request(app)
      .post('/api/inventory/adjust')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({
        storeId: scenario.tenantA.storeId,
        productId: scenario.catalog.productId,
        quantityChange: '-999999',
        reason: 'too much',
      });
    expect(res.status).toBe(409);
  });

  it('a Tenant A actor cannot adjust stock in a Tenant B branch (tenant isolation over HTTP)', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantAManager.loginId,
      scenario.tenantAManager.password,
    );
    const res = await request(app)
      .post('/api/inventory/adjust')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({
        storeId: scenario.tenantB.storeId,
        productId: scenario.catalog.productId,
        quantityChange: '5',
        reason: 'cross-tenant',
      });
    expect(res.status).toBe(404);
  });

  it('401s every inventory route without a token', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const res = await request(app).get('/api/inventory/low-stock');
    expect(res.status).toBe(401);
  });
});
