// End-to-end test of the Electron desktop shell: the real Electron app -> built web UI (mafk-app://local) -> proxied to
// the real API -> real PostgreSQL. No mocks. Run with `pnpm run e2e:desktop` (see docs/E2E.md and docs/DESKTOP.md).
// Needs the web app and the desktop shell built (`pnpm --filter @mafk/web run build`, `pnpm --filter @mafk/desktop run build`).
// On a headless Linux machine run it under a virtual display: `xvfb-run -a pnpm run e2e:desktop`.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';

const originOf = (u) => {
  const x = new URL(u);
  return `${x.protocol}//${x.host}`;
};
const need = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set (see docs/E2E.md).`);
  return v;
};
const API = (process.env.E2E_API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');
const SERVER = API.replace(/\/api$/, '');
const MASTER_LOGIN = need('E2E_MASTER_LOGIN_ID');
const MASTER_PASSWORD = need('E2E_MASTER_PASSWORD');

const run = randomBytes(3).toString('hex');
const adminLogin = `dsk.${run}`;
const adminPassword = `Pw-${randomBytes(9).toString('hex')}-Aa1`;

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name} ${detail}`);
    console.log(`  FAIL ${name} ${detail}`);
  }
};
const eq = (name, actual, expected) =>
  check(
    name,
    actual === expected,
    `(expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
  );

const call = async (method, path, token, body) => {
  const r = await fetch(API + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => {
    throw new Error(`Cannot reach the API at ${API}. Start it first (see docs/E2E.md).`);
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
};

// ---- Arrange: a throwaway tenant admin through the real API ---------------------------------------------------------
const { MODULE_CATALOG } = await import('../packages/shared/dist/index.js');
const master = await call('POST', '/auth/login', null, {
  loginId: MASTER_LOGIN,
  password: MASTER_PASSWORD,
});
await call('POST', '/master/tenants', master.accessToken, {
  code: `DSK${run.toUpperCase()}`,
  name: `Desktop Retail ${run}`,
  defaultStoreName: 'Main Branch',
  masterAdmin: { loginId: adminLogin, password: adminPassword, displayName: 'Desktop Admin' },
  license: {
    planCode: 'STANDARD',
    expiresAt: new Date(Date.now() + 365 * 864e5).toISOString(),
    maxUsers: 10,
    maxDevices: 5,
    maxStores: 3,
    enabledModules: [...MODULE_CATALOG],
  },
});

// ---- Launch the real Electron app ----------------------------------------------------------------------------------
const repoRoot = resolve(import.meta.dirname, '..');
const desktopDir = join(repoRoot, 'apps', 'desktop');
const electronPath =
  process.env.E2E_ELECTRON ?? createRequire(join(desktopDir, 'package.json'))('electron');
const userData = mkdtempSync(join(tmpdir(), 'mafk-desktop-e2e-'));
// Pre-configure the server address exactly as the settings window would have saved it.
writeFileSync(join(userData, 'config.json'), JSON.stringify({ serverUrl: SERVER }));
const app = await electron.launch({
  executablePath: electronPath,
  args: [
    // A packaged build (E2E_ELECTRON pointing at the installed .exe / unpacked app) starts without a script argument.
    ...(process.env.E2E_PACKAGED === '1' ? [] : [join(desktopDir, 'dist', 'main.js')]),
    `--user-data-dir=${userData}`,
    ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []),
  ],
  env: { ...process.env, NODE_ENV: 'test' },
});

try {
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  console.log('Shell and isolation');
  await page.getByLabel('Login ID', { exact: true }).waitFor({ timeout: 30_000 });
  eq('UI is served from the private app scheme', originOf(page.url()), 'mafk-app://local');
  const iso = await page.evaluate(() => ({
    bridge: window.mafkDesktop?.isDesktop,
    apiBase: window.mafkDesktop?.apiBase,
    hasRequire: typeof require,
    hasProcess: typeof process,
    keys: Object.keys(window.mafkDesktop ?? {}).sort(),
  }));
  eq('desktop bridge present', iso.bridge, true);
  eq('API base is same-origin /api', iso.apiBase, '/api');
  eq('page has no require()', iso.hasRequire, 'undefined');
  eq('page has no process', iso.hasProcess, 'undefined');
  eq(
    'bridge exposes only the fixed API',
    iso.keys.join(','),
    'apiBase,closeSettings,getInfo,isDesktop,openSettings,setServer',
  );

  const headers = await page.evaluate(async () => {
    const r = await fetch('/index.html');
    return {
      csp: r.headers.get('content-security-policy'),
      nosniff: r.headers.get('x-content-type-options'),
    };
  });
  check('CSP header is served', Boolean(headers.csp?.includes("script-src 'self'")));
  eq('nosniff header is served', headers.nosniff, 'nosniff');
  const traversal = await page.evaluate(async () => {
    const out = [];
    for (const p of [
      '/..%2f..%2fpackage.json',
      '/%2e%2e/%2e%2e/etc/passwd',
      '/..%5c..%5cpackage.json',
    ]) {
      const r = await fetch(p);
      const body = await r.text();
      out.push({ p, leaked: /"workspaces"|root:x:0/.test(body) });
    }
    out.push({ p: '/__desktop/main.js', status: (await fetch('/__desktop/main.js')).status });
    return out;
  });
  check(
    'path traversal never returns files outside the web root',
    traversal.slice(0, 3).every((t) => !t.leaked),
    JSON.stringify(traversal),
  );
  eq('only the settings page is served under /__desktop/', traversal[3].status, 404);
  const spa = await page.evaluate(async () => (await fetch('/customers')).status);
  eq('unknown app route falls back to the single-page app', spa, 200);
  const missingAsset = await page.evaluate(
    async () => (await fetch('/assets/does-not-exist.js')).status,
  );
  eq('missing asset is 404, not index.html', missingAsset, 404);

  console.log('Hardening');
  const opened = await page.evaluate(() => window.open('https://example.com/', '_blank') === null);
  const windowsAfterOpen = app.windows().length;
  check(
    'window.open is denied',
    opened && windowsAfterOpen === 1,
    `(windows: ${windowsAfterOpen})`,
  );
  const geo = await page.evaluate(
    () =>
      new Promise((resolveGeo) => {
        navigator.geolocation.getCurrentPosition(
          () => resolveGeo('granted'),
          (e) => resolveGeo(`denied:${e.code}`),
          { timeout: 4000 },
        );
      }),
  );
  check('permission requests (location) are denied', String(geo).startsWith('denied'), String(geo));
  const notAllowed = await page.evaluate(() =>
    window.mafkDesktop.setServer('http://evil.example:4000', true),
  );
  check(
    'the main app page cannot change the server address',
    notAllowed.ok === false && notAllowed.error === 'Not allowed.',
  );

  console.log('Sign in through the proxy');
  await page.getByLabel('Login ID', { exact: true }).fill(adminLogin);
  await page.getByLabel('Password', { exact: true }).fill(adminPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Customers', exact: true }).waitFor();
  check('signed in; the Phase 6 navigation is visible', true);

  console.log('A Phase 6 screen inside the desktop app');
  await page.getByRole('button', { name: 'Customers', exact: true }).click();
  await page.getByRole('button', { name: /New Customer/ }).click();
  await page.getByLabel('Name', { exact: true }).fill(`Zainab ${run}`);
  await page.getByLabel(/Opening balance owed/).fill('75');
  await page.getByLabel(/Credit limit \(optional\)/).fill('300');
  await page.getByRole('button', { name: 'Create customer' }).click();
  await page.getByTestId('customer-balance').waitFor();
  check(
    'customer created through the desktop proxy (75.00 owed)',
    (await page.getByTestId('customer-balance').innerText()).includes('75.00 owed'),
  );

  console.log('Session survives a reload (refresh cookie works through the proxy)');
  await page.reload();
  await page.getByRole('button', { name: 'Customers', exact: true }).waitFor({ timeout: 20_000 });
  check('still signed in after reload', true);

  console.log('Server settings window');
  await page.evaluate(() => void window.mafkDesktop.openSettings());
  const deadline = Date.now() + 15_000;
  let settings;
  while (!settings && Date.now() < deadline) {
    settings = app.windows().find((w) => w.url().endsWith('/__desktop/settings.html'));
    if (!settings) await new Promise((r) => setTimeout(r, 200));
  }
  check('settings window opened', Boolean(settings));
  await settings.getByLabel('Server address').waitFor();
  eq(
    'settings show the current server',
    await settings.getByLabel('Server address').inputValue(),
    SERVER,
  );
  await settings.getByLabel('Server address').fill('ftp://nope');
  await settings.getByRole('button', { name: 'Test and save' }).click();
  await settings.getByText(/http:\/\/ or https:\/\//).waitFor();
  check('a non-http address is refused with a clear message', true);
  await settings.getByLabel('Server address').fill('http://127.0.0.1:9');
  await settings.getByRole('button', { name: 'Test and save' }).click();
  await settings.getByText(/Cannot reach this address/).waitFor();
  check(
    'an unreachable address is reported and nothing is saved yet',
    await settings.getByRole('button', { name: 'Save anyway' }).isVisible(),
  );
  await settings.getByRole('button', { name: 'Save anyway' }).click();
  await settings.waitForEvent('close', { timeout: 15_000 }).catch(() => undefined);

  console.log('Unreachable server is explained, then recovery');
  await page.waitForLoadState('load');
  await page.getByLabel('Login ID', { exact: true }).waitFor({ timeout: 20_000 });
  check('changing the server signs the old session out', true);
  await page.getByLabel('Login ID', { exact: true }).fill(adminLogin);
  await page.getByLabel('Password', { exact: true }).fill(adminPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText(/Cannot reach the server/).waitFor({ timeout: 20_000 });
  check('a dead server gives a readable error, not a blank screen', true);

  await page.evaluate(() => void window.mafkDesktop.openSettings());
  let settings2;
  const d2 = Date.now() + 15_000;
  while (!settings2 && Date.now() < d2) {
    settings2 = app.windows().find((w) => w.url().endsWith('/__desktop/settings.html'));
    if (!settings2) await new Promise((r) => setTimeout(r, 200));
  }
  await settings2.getByLabel('Server address').fill(`${SERVER}/api/`);
  await settings2.getByRole('button', { name: 'Test and save' }).click();
  await settings2.waitForEvent('close', { timeout: 20_000 }).catch(() => undefined);
  await page.getByLabel('Login ID', { exact: true }).waitFor({ timeout: 20_000 });
  await page.getByLabel('Login ID', { exact: true }).fill(adminLogin);
  await page.getByLabel('Password', { exact: true }).fill(adminPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Customers', exact: true }).waitFor({ timeout: 20_000 });
  check('after restoring the address, sign-in works again', true);

  console.log('Sign out');
  await page
    .getByRole('button', { name: /sign out|log out/i })
    .first()
    .click();
  await page.getByLabel('Login ID', { exact: true }).waitFor({ timeout: 20_000 });
  check('signed out back to the login page', true);

  // Last on purpose: a deliberately cancelled navigation leaves Playwright waiting for a navigation that never commits.
  await page.evaluate(() => {
    window.location.href = 'https://example.com/';
  });
  await page.waitForTimeout(800);
  eq('navigation to an outside site is blocked', originOf(page.url()), 'mafk-app://local');
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  failures.push(`aborted: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
  console.log('ABORTED', err instanceof Error ? err.message : err);
  if (process.env.E2E_SCREENSHOT_DIR) {
    const w = app.windows()[0];
    if (w)
      await w
        .screenshot({ path: join(process.env.E2E_SCREENSHOT_DIR, 'desktop-failure.png') })
        .catch(() => undefined);
  }
} finally {
  await app.close().catch(() => undefined);
  rmSync(userData, { recursive: true, force: true });
}

console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
