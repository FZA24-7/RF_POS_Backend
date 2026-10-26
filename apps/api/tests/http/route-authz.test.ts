import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildScenario } from '../fakes/scenario.js';
import { buildTestApp, loginAs } from '../fakes/build-test-app.js';

// Final security review (Phase 7): every route that is registered must refuse anonymous callers, and the platform
// (/api/master) routes must refuse tenant users. The routes are ENUMERATED from the live Express app, so a route added
// later without authentication fails this test instead of slipping through.

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
}
type RouterLike = { router?: { stack: Layer[] }; _router?: { stack: Layer[] } };

const enumerateRoutes = (app: Express): { method: string; path: string }[] => {
  const root = (app as unknown as RouterLike).router ?? (app as unknown as RouterLike)._router;
  const out: { method: string; path: string }[] = [];
  const walk = (stack: Layer[]) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const [m, on] of Object.entries(layer.route.methods)) {
          if (on) out.push({ method: m.toUpperCase(), path: `/api${layer.route.path}` });
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk(root?.stack ?? []);
  return out;
};

// Deliberately public: liveness probes and the endpoints that establish or end a session.
const PUBLIC = new Set([
  'GET /api/health',
  'GET /api/health/ready',
  'POST /api/auth/login',
  'POST /api/auth/refresh',
  'POST /api/auth/logout',
]);

const concrete = (p: string): string => p.replace(/:[A-Za-z]+/g, 'x');

describe('route authorization sweep', () => {
  it('enumerates the real route table (guards against enumerating nothing)', async () => {
    const app = buildTestApp(await buildScenario());
    expect(enumerateRoutes(app).length).toBeGreaterThan(90);
  });

  it('rejects every non-public route without a token (401)', async () => {
    const app = buildTestApp(await buildScenario());
    const routes = enumerateRoutes(app).filter((r) => !PUBLIC.has(`${r.method} ${r.path}`));
    const bad: string[] = [];
    for (const r of routes) {
      const res = await request(app)[r.method.toLowerCase() as 'get'](concrete(r.path)).send({});
      if (res.status !== 401) bad.push(`${r.method} ${r.path} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  });

  it('refuses a garbage bearer token on every non-public route (401)', async () => {
    const app = buildTestApp(await buildScenario());
    const routes = enumerateRoutes(app).filter((r) => !PUBLIC.has(`${r.method} ${r.path}`));
    const bad: string[] = [];
    for (const r of routes) {
      const call = request(app)[r.method.toLowerCase() as 'get'](concrete(r.path));
      const res = await call.set('Authorization', 'Bearer not.a.token').send({});
      if (res.status !== 401) bad.push(`${r.method} ${r.path} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  });

  it('keeps tenant users out of every platform (/api/master) route (403)', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const login = await loginAs(app, s.tenantAClientAdmin.loginId, s.tenantAClientAdmin.password);
    const auth = { Authorization: `Bearer ${login.body.accessToken as string}` };
    const master = enumerateRoutes(app).filter((r) => r.path.startsWith('/api/master'));
    expect(master.length).toBeGreaterThan(5);
    const bad: string[] = [];
    for (const r of master) {
      const call = request(app)[r.method.toLowerCase() as 'get'](concrete(r.path));
      const res = await call.set(auth).send({});
      if (res.status !== 403) bad.push(`${r.method} ${r.path} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  });
});
