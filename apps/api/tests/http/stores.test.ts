import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildScenario } from '../fakes/scenario.js';
import { buildTestApp, loginAs } from '../fakes/build-test-app.js';

describe('GET /api/stores', () => {
  it("returns only the caller's own tenant stores", async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantAClientAdmin.loginId,
      scenario.tenantAClientAdmin.password,
    );
    const res = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(scenario.tenantA.storeId);
  });

  it('401s without a token', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const res = await request(app).get('/api/stores');
    expect(res.status).toBe(401);
  });
});
