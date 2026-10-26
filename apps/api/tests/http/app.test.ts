import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildScenario } from '../fakes/scenario.js';
import { buildTestApp, loginAs } from '../fakes/build-test-app.js';

describe('GET /api/health', () => {
  it('returns 200 with no authentication required', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('POST /api/auth/login', () => {
  it('returns 200 + access token + refresh cookie on valid credentials', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const res = await loginAs(
      app,
      scenario.tenantACashier.loginId,
      scenario.tenantACashier.password,
    );
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.headers['set-cookie']?.[0]).toMatch(/mafk_refresh_token=/);
  });

  it('returns 401 on invalid credentials', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const res = await loginAs(app, scenario.tenantACashier.loginId, 'wrong-password');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 422 on malformed input (missing password)', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const res = await request(app).post('/api/auth/login').send({ loginId: 'someone' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('PATCH /api/users/:id/login-id - authentication & authorization', () => {
  it('returns 401 without a bearer token', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const res = await request(app)
      .patch(`/api/users/${scenario.tenantACashier.id}/login-id`)
      .send({ newLoginId: 'a.cashier.new' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when the caller lacks users.manage (Cashier cannot change Login IDs)', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantACashier.loginId,
      scenario.tenantACashier.password,
    );
    const res = await request(app)
      .patch(`/api/users/${scenario.tenantAManager.id}/login-id`)
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ newLoginId: 'a.manager.new' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('returns 403 when a Client Master Admin tries to edit their OWN Login ID', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantAClientAdmin.loginId,
      scenario.tenantAClientAdmin.password,
    );
    const res = await request(app)
      .patch(`/api/users/${scenario.tenantAClientAdmin.id}/login-id`)
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ newLoginId: 'a.admin.new' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('LOGIN_ID_SELF_EDIT_FORBIDDEN');
  });

  it('allows a Client Master Admin to change their Manager Login ID (200)', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantAClientAdmin.loginId,
      scenario.tenantAClientAdmin.password,
    );
    const res = await request(app)
      .patch(`/api/users/${scenario.tenantAManager.id}/login-id`)
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ newLoginId: 'a.manager.newid' });
    expect(res.status).toBe(200);
    expect(res.body.loginId).toBe('a.manager.newid');
  });

  it('blocks cross-tenant Login ID edits end-to-end (tenant isolation over HTTP)', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantAClientAdmin.loginId,
      scenario.tenantAClientAdmin.password,
    );
    const res = await request(app)
      .patch(`/api/users/${scenario.tenantBClientAdmin.id}/login-id`)
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ newLoginId: 'hijack.attempt' });
    // The Tenant A admin DOES hold `users.manage` (it's their own tenant's grant), so
    // the request passes the permission-gate middleware - it is the SERVICE layer's
    // tenant-scope check (LoginIdService -> canChangeLoginId) that rejects it. This is
    // exactly the "enforced server-side, not just hidden in the UI" requirement.
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('LOGIN_ID_TENANT_SCOPE');
  });
});

describe('GET /api/users/:id/login-id/edit-state', () => {
  it("shows LOCKED for the viewer's own account", async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantAClientAdmin.loginId,
      scenario.tenantAClientAdmin.password,
    );
    const res = await request(app)
      .get(`/api/users/${scenario.tenantAClientAdmin.id}/login-id/edit-state`)
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ editable: false, label: 'Login ID: LOCKED' });
  });

  it('shows editable=true for a Manager viewed by their Client Master Admin', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantAClientAdmin.loginId,
      scenario.tenantAClientAdmin.password,
    );
    const res = await request(app)
      .get(`/api/users/${scenario.tenantAManager.id}/login-id/edit-state`)
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ editable: true, label: null });
  });
});

describe('Refresh + logout over HTTP', () => {
  it('rotates the session cookie on /api/auth/refresh and invalidates it on /api/auth/logout', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantACashier.loginId,
      scenario.tenantACashier.password,
    );
    const cookie = login.headers['set-cookie'][0];

    const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toBeTruthy();
    const newCookie = refreshed.headers['set-cookie'][0];

    const loggedOut = await request(app).post('/api/auth/logout').set('Cookie', newCookie);
    expect(loggedOut.status).toBe(204);

    const afterLogout = await request(app).post('/api/auth/refresh').set('Cookie', newCookie);
    expect(afterLogout.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 without a bearer token', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns the caller profile (and no password hash) for a valid token', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantACashier.loginId,
      scenario.tenantACashier.password,
    );
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: scenario.tenantACashier.id,
      loginId: scenario.tenantACashier.loginId,
      tenantId: scenario.tenantA.id,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/i);
  });

  it('returns 401 for a disabled user even with a still-valid token', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantACashier.loginId,
      scenario.tenantACashier.password,
    );
    const stored = scenario.repos.users.users.get(scenario.tenantACashier.id);
    if (stored) stored.status = 'DISABLED';
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(401);
  });
});
