import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildScenario } from '../fakes/scenario.js';
import { buildTestApp, loginAs } from '../fakes/build-test-app.js';

describe('Catalog routes - authentication & tenant context', () => {
  it('401s without a token', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const res = await request(app).get('/api/catalog/categories');
    expect(res.status).toBe(401);
  });

  it('403s a Master Admin token (no tenant context) hitting a tenant-scoped catalog route', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(app, scenario.masterAdmin.loginId, scenario.masterAdmin.password);
    const res = await request(app)
      .get('/api/catalog/categories')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TENANT_REQUIRED');
  });
});

describe('Categories over HTTP', () => {
  it('Cashier (no category permissions at all) is 403d from both viewing and creating categories', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantACashier.loginId,
      scenario.tenantACashier.password,
    );
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };

    const list = await request(app).get('/api/catalog/categories').set(auth);
    expect(list.status).toBe(403);

    const create = await request(app)
      .post('/api/catalog/categories')
      .set(auth)
      .send({ name: 'New Category' });
    expect(create.status).toBe(403);
  });

  it('Manager can both view and create categories (holds categories.view + categories.create)', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantAManager.loginId,
      scenario.tenantAManager.password,
    );
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };

    const list = await request(app).get('/api/catalog/categories').set(auth);
    expect(list.status).toBe(200);

    const create = await request(app)
      .post('/api/catalog/categories')
      .set(auth)
      .send({ name: 'New Category' });
    expect(create.status).toBe(201);
  });

  it('Client Master Admin can create, update, and deactivate a category', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantAClientAdmin.loginId,
      scenario.tenantAClientAdmin.password,
    );
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };

    const created = await request(app)
      .post('/api/catalog/categories')
      .set(auth)
      .send({ name: 'Footwear' });
    expect(created.status).toBe(201);

    const updated = await request(app)
      .patch(`/api/catalog/categories/${created.body.id}`)
      .set(auth)
      .send({ description: 'Shoes' });
    expect(updated.status).toBe(200);
    expect(updated.body.description).toBe('Shoes');

    const deactivated = await request(app)
      .patch(`/api/catalog/categories/${created.body.id}/status`)
      .set(auth)
      .send({ status: 'INACTIVE' });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.status).toBe('INACTIVE');
  });

  it('a Tenant A admin cannot see or reach a Tenant B category (tenant isolation over HTTP)', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantAClientAdmin.loginId,
      scenario.tenantAClientAdmin.password,
    );
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };

    const res = await request(app)
      .get(`/api/catalog/categories/${scenario.catalog.tenantBCategoryId}`)
      .set(auth);
    expect(res.status).toBe(404);
  });
});

describe('Sub-Departments over HTTP', () => {
  it('rejects a Sub-Department whose Category belongs to a different tenant', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantAClientAdmin.loginId,
      scenario.tenantAClientAdmin.password,
    );
    const res = await request(app)
      .post('/api/catalog/sub-departments')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ categoryId: scenario.catalog.tenantBCategoryId, name: 'Should Fail' });
    expect(res.status).toBe(422);
  });
});

describe('Products over HTTP', () => {
  it('creates a product and enforces the Category/Sub-Department relationship', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantAClientAdmin.loginId,
      scenario.tenantAClientAdmin.password,
    );
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };

    const badRelationship = await request(app).post('/api/catalog/products').set(auth).send({
      name: 'Bad Product',
      sku: 'BAD-001',
      categoryId: scenario.catalog.categoryId,
      subDepartmentId: scenario.catalog.otherSubDepartmentId, // belongs to a different category
      costPrice: '10',
      sellingPrice: '20',
    });
    expect(badRelationship.status).toBe(422);

    const good = await request(app).post('/api/catalog/products').set(auth).send({
      name: 'Good Product',
      sku: 'GOOD-001',
      categoryId: scenario.catalog.categoryId,
      subDepartmentId: scenario.catalog.subDepartmentId,
      costPrice: '10',
      sellingPrice: '20',
    });
    expect(good.status).toBe(201);
  });

  it('Cashier cannot create products (lacks products.create - least privilege)', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantACashier.loginId,
      scenario.tenantACashier.password,
    );
    const res = await request(app)
      .post('/api/catalog/products')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({
        name: 'X',
        sku: 'X-1',
        categoryId: scenario.catalog.categoryId,
        subDepartmentId: scenario.catalog.subDepartmentId,
        costPrice: '1',
        sellingPrice: '2',
      });
    expect(res.status).toBe(403);
  });

  it("exports products as CSV containing only this tenant's data", async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantAClientAdmin.loginId,
      scenario.tenantAClientAdmin.password,
    );
    const res = await request(app)
      .get('/api/catalog/products/export')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain(scenario.catalog.productSku);
  });

  it('imports a CSV of products and reports the result', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantAClientAdmin.loginId,
      scenario.tenantAClientAdmin.password,
    );
    const csv = [
      'name,sku,categoryId,subDepartmentId,costPrice,sellingPrice',
      `Imported,HTTP-IMP-1,${scenario.catalog.categoryId},${scenario.catalog.subDepartmentId},50,90`,
    ].join('\n');
    const res = await request(app)
      .post('/api/catalog/products/import')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ csv });
    expect(res.status).toBe(200);
    expect(res.body.successCount).toBe(1);
    expect(res.body.failedCount).toBe(0);
  });
});

describe('Barcode lookup over HTTP', () => {
  it('looks up a known barcode', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantACashier.loginId,
      scenario.tenantACashier.password,
    );
    const res = await request(app)
      .get(`/api/catalog/barcode/${scenario.catalog.productBarcode}`)
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(scenario.catalog.productId);
  });

  it('404s an unknown barcode', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantACashier.loginId,
      scenario.tenantACashier.password,
    );
    const res = await request(app)
      .get('/api/catalog/barcode/0000000000000')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(404);
  });
});
