import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { MODULE_CATALOG } from '@mafk/shared';
import { buildScenario } from '../fakes/scenario.js';
import { buildTestApp, loginAs, testAccessTokens } from '../fakes/build-test-app.js';

const validCreateTenantBody = () => ({
  code: 'NEWCO',
  name: 'New Co Retail',
  defaultStoreName: 'New Co Main',
  masterAdmin: {
    loginId: 'newco.admin',
    password: 'NewCoAdminPass123',
    displayName: 'New Co Admin',
  },
  license: {
    planCode: 'STANDARD',
    expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    maxUsers: 10,
    maxDevices: 5,
    maxStores: 3,
    enabledModules: [...MODULE_CATALOG],
  },
});

describe('Master Admin routes require a genuine platform actor', () => {
  it('401s every /api/master/* route without a token', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const res = await request(app).get('/api/master/stats');
    expect(res.status).toBe(401);
  });

  it('403s a Tenant A Client Master Admin trying to reach Master Admin stats (cross-boundary escalation)', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantAClientAdmin.loginId,
      scenario.tenantAClientAdmin.password,
    );
    const res = await request(app)
      .get('/api/master/stats')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(403);
  });

  it('403s a Tenant A Client Master Admin trying to list ALL tenants (would leak Tenant B data)', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantAClientAdmin.loginId,
      scenario.tenantAClientAdmin.password,
    );
    const res = await request(app)
      .get('/api/master/tenants')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(403);
  });

  it('403s a Manager and a Cashier the same way (not just the Client Master Admin)', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    for (const staff of [scenario.tenantAManager, scenario.tenantACashier]) {
      const login = await loginAs(app, staff.loginId, staff.password);
      const res = await request(app)
        .get('/api/master/tenants')
        .set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(res.status).toBe(403);
    }
  });

  it('403s a token that is well-formed but forged to claim MASTER_ADMIN with a tenantId still attached', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    // Sign a token directly (bypassing login) that inconsistently claims platform
    // role AND a tenant - simulates a bug elsewhere that produced a bad token.
    const forged = await testAccessTokens.sign({
      sub: scenario.tenantAClientAdmin.id,
      tid: scenario.tenantA.id,
      sid: 'forged-session',
      role: 'MASTER_ADMIN',
      perms: ['tenants.view', 'tenants.create', 'licenses.manage', 'users.manage', 'audit.view'],
    });
    const res = await request(app)
      .get('/api/master/tenants')
      .set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(403);
  });
});

describe('Master Admin dashboard stats', () => {
  it('returns real, non-fabricated counts derived from the seeded data', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(app, scenario.masterAdmin.loginId, scenario.masterAdmin.password);
    const res = await request(app)
      .get('/api/master/stats')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.tenants).toEqual({ total: 2, active: 2, suspended: 0, archived: 0 });
    expect(res.body.users.total).toBe(5);
  });
});

describe('POST /api/master/tenants - transactional client creation', () => {
  it('creates a tenant end-to-end and the new Client Master Admin can immediately log in', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(app, scenario.masterAdmin.loginId, scenario.masterAdmin.password);

    const createRes = await request(app)
      .post('/api/master/tenants')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send(validCreateTenantBody());
    expect(createRes.status).toBe(201);
    expect(createRes.body.tenantId).toBeTruthy();

    const newAdminLogin = await loginAs(app, 'newco.admin', 'NewCoAdminPass123');
    expect(newAdminLogin.status).toBe(200);
    expect(newAdminLogin.body.user.tenantId).toBe(createRes.body.tenantId);
  });

  it('rejects creation from a non-Master-Admin (403) even with a valid session', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(
      app,
      scenario.tenantAClientAdmin.loginId,
      scenario.tenantAClientAdmin.password,
    );
    const res = await request(app)
      .post('/api/master/tenants')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send(validCreateTenantBody());
    expect(res.status).toBe(403);
  });

  it('422s on an invalid body (e.g. missing masterAdmin)', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(app, scenario.masterAdmin.loginId, scenario.masterAdmin.password);
    const res = await request(app)
      .post('/api/master/tenants')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ code: 'X', name: 'X' });
    expect(res.status).toBe(422);
  });

  it('409s on a duplicate tenant code and leaves the tenant list unchanged', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(app, scenario.masterAdmin.loginId, scenario.masterAdmin.password);
    await request(app)
      .post('/api/master/tenants')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send(validCreateTenantBody());

    const before = await request(app)
      .get('/api/master/tenants')
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    const dupe = await request(app)
      .post('/api/master/tenants')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({
        ...validCreateTenantBody(),
        masterAdmin: {
          loginId: 'different.admin',
          password: 'DifferentPass123',
          displayName: 'Different',
        },
      });
    expect(dupe.status).toBe(409);

    const after = await request(app)
      .get('/api/master/tenants')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(after.body.total).toBe(before.body.total);
  });
});

describe('Tenant detail / users / audit / status endpoints', () => {
  it('returns tenant detail, stores, users and audit logs for a real tenant', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(app, scenario.masterAdmin.loginId, scenario.masterAdmin.password);
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };

    const detail = await request(app).get(`/api/master/tenants/${scenario.tenantA.id}`).set(auth);
    expect(detail.status).toBe(200);
    expect(detail.body.code).toBe('TEN-A');

    const users = await request(app)
      .get(`/api/master/tenants/${scenario.tenantA.id}/users`)
      .set(auth);
    expect(users.status).toBe(200);
    expect(users.body.map((u: { loginId: string }) => u.loginId)).toEqual(
      expect.arrayContaining(['a.admin', 'a.manager', 'a.cashier']),
    );
    // Must NOT include Tenant B's users.
    expect(users.body.map((u: { loginId: string }) => u.loginId)).not.toContain('b.admin');
  });

  it('activating/deactivating a tenant is reflected immediately and audited', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(app, scenario.masterAdmin.loginId, scenario.masterAdmin.password);
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };

    const res = await request(app)
      .patch(`/api/master/tenants/${scenario.tenantB.id}/status`)
      .set(auth)
      .send({ status: 'SUSPENDED', reason: 'trial ended' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUSPENDED');

    const auditRes = await request(app)
      .get(`/api/master/tenants/${scenario.tenantB.id}/audit-logs`)
      .set(auth);
    expect(auditRes.body).toContainEqual(
      expect.objectContaining({ action: 'TENANT_STATUS_CHANGED' }),
    );

    // A suspended tenant's Client Master Admin can no longer log in.
    const blockedLogin = await loginAs(
      app,
      scenario.tenantBClientAdmin.loginId,
      scenario.tenantBClientAdmin.password,
    );
    expect(blockedLogin.status).toBe(403);
    expect(blockedLogin.body.error.code).toBe('TENANT_SUSPENDED');
  });
});

describe('License management endpoints', () => {
  it('creates, updates status, and updates modules on a license', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(app, scenario.masterAdmin.loginId, scenario.masterAdmin.password);
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };

    const created = await request(app)
      .post(`/api/master/tenants/${scenario.tenantA.id}/licenses`)
      .set(auth)
      .send({
        planCode: 'PREMIUM',
        expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
        maxUsers: 100,
        maxDevices: 50,
        maxStores: 20,
        enabledModules: ['pos', 'reports'],
      });
    expect(created.status).toBe(201);
    const licenseId = created.body.id;

    const statusRes = await request(app)
      .patch(`/api/master/licenses/${licenseId}/status`)
      .set(auth)
      .send({ status: 'SUSPENDED' });
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe('SUSPENDED');

    const modulesRes = await request(app)
      .patch(`/api/master/licenses/${licenseId}/modules`)
      .set(auth)
      .send({ enabledModules: ['pos'] });
    expect(modulesRes.status).toBe(200);
    expect(modulesRes.body.enabledModules).toEqual(['pos']);
  });
});

describe('Master Admin user management', () => {
  it('creates an additional Client Master Admin for a tenant', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const login = await loginAs(app, scenario.masterAdmin.loginId, scenario.masterAdmin.password);
    const res = await request(app)
      .post(`/api/master/tenants/${scenario.tenantA.id}/client-admins`)
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ loginId: 'a.admin2', password: 'SecondAdminPass123', displayName: 'Second Admin' });
    expect(res.status).toBe(201);
    expect(res.body.systemRole).toBe('CLIENT_MASTER_ADMIN');
  });

  it('disables a user and their session dies', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const masterLogin = await loginAs(
      app,
      scenario.masterAdmin.loginId,
      scenario.masterAdmin.password,
    );
    const cashierLogin = await loginAs(
      app,
      scenario.tenantACashier.loginId,
      scenario.tenantACashier.password,
    );
    expect(cashierLogin.status).toBe(200);

    const disableRes = await request(app)
      .patch(`/api/master/users/${scenario.tenantACashier.id}/status`)
      .set('Authorization', `Bearer ${masterLogin.body.accessToken}`)
      .send({ status: 'DISABLED', reason: 'offboarded' });
    expect(disableRes.status).toBe(204);

    const nextLoginAttempt = await loginAs(
      app,
      scenario.tenantACashier.loginId,
      scenario.tenantACashier.password,
    );
    expect(nextLoginAttempt.status).toBe(403);
    expect(nextLoginAttempt.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('resets a user password through the secure admin flow', async () => {
    const scenario = await buildScenario();
    const app = buildTestApp(scenario);
    const masterLogin = await loginAs(
      app,
      scenario.masterAdmin.loginId,
      scenario.masterAdmin.password,
    );

    const resetRes = await request(app)
      .post(`/api/master/users/${scenario.tenantAManager.id}/reset-password`)
      .set('Authorization', `Bearer ${masterLogin.body.accessToken}`)
      .send({ newPassword: 'BrandNewManagerPass123' });
    expect(resetRes.status).toBe(204);

    const oldPasswordLogin = await loginAs(
      app,
      scenario.tenantAManager.loginId,
      scenario.tenantAManager.password,
    );
    expect(oldPasswordLogin.status).toBe(401);

    const newPasswordLogin = await loginAs(
      app,
      scenario.tenantAManager.loginId,
      'BrandNewManagerPass123',
    );
    expect(newPasswordLogin.status).toBe(200);
  });
});
