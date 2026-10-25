#!/usr/bin/env node
// Static security checks that must keep holding (Phase 7 final review). Dependency-free; complements scan:secrets.
// It does NOT replace review, `pnpm audit`, or the runtime tests (tests/http/route-authz.test.ts, desktop E2E).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'generated',
  'release',
  'out',
]);
const rel = (p) => relative(ROOT, p).split(sep).join('/');

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};
const read = (p) => readFileSync(p, 'utf8');
const failures = [];
const fail = (msg) => failures.push(msg);

// ── 1. Electron hardening: required settings present, dangerous settings absent ─────────────────────────────────────
const mainFile = join(ROOT, 'apps/desktop/src/main.ts');
if (existsSync(mainFile)) {
  const main = read(mainFile);
  for (const required of [
    'contextIsolation: true',
    'sandbox: true',
    'nodeIntegration: false',
    'webSecurity: true',
    'will-attach-webview',
    'will-navigate',
    'setWindowOpenHandler',
    'setPermissionRequestHandler',
    'requestSingleInstanceLock',
  ]) {
    if (!main.includes(required)) fail(`apps/desktop/src/main.ts is missing "${required}"`);
  }
  for (const forbidden of [
    /nodeIntegration:\s*true/,
    /contextIsolation:\s*false/,
    /sandbox:\s*false/,
    /webSecurity:\s*false/,
    /allowRunningInsecureContent/,
    /enableRemoteModule/,
    /webviewTag:\s*true/,
    /nodeIntegrationInSubFrames:\s*true/,
    /ignore-certificate-errors/,
    /certificate-error/,
    /openExternal\((?![^)]*url)/,
  ]) {
    if (forbidden.test(main))
      fail(`apps/desktop/src/main.ts contains a forbidden setting: ${forbidden}`);
  }
  if (!/https:\\\/\\\//.test(main) && !main.includes('https://'))
    fail('main.ts must only open https:// links externally');
}
for (const f of existsSync(join(ROOT, 'apps/desktop/src'))
  ? walk(join(ROOT, 'apps/desktop/src'))
  : []) {
  const src = read(f);
  if (/\bnodeIntegration\b[^\n]*true/.test(src)) fail(`${rel(f)}: nodeIntegration enabled`);
}

// ── 2. Risky code patterns in shipped source (tests excluded) ───────────────────────────────────────────────────────
const SHIPPED = [
  'apps/api/src',
  'apps/web/src',
  'apps/desktop/src',
  'packages/shared/src',
  'packages/validation/src',
  'packages/database/src',
]
  .map((d) => join(ROOT, d))
  .filter(existsSync)
  .flatMap((d) => walk(d))
  .filter((f) => /\.(ts|tsx|js|mjs)$/.test(f) && !/\.test\.|\/tests\//.test(rel(f)));

const RULES = [
  { re: /dangerouslySetInnerHTML/, why: 'raw HTML injection' },
  { re: /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML/, why: 'raw HTML injection' },
  { re: /\beval\s*\(/, why: 'eval' },
  { re: /new\s+Function\s*\(/, why: 'dynamic code' },
  { re: /document\.write\s*\(/, why: 'document.write' },
  {
    re: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/,
    why: 'TLS verification disabled',
  },
  { re: /Math\.random\s*\(/, why: 'Math.random is not a secure random source' },
  {
    re: /(localStorage|sessionStorage)\.setItem\([^)]*(token|password|secret|jwt)/i,
    why: 'secret in browser storage',
  },
  { re: /console\.(log|info|debug)\([^)]*(password|secret|token)/i, why: 'secret in a log line' },
];
for (const f of SHIPPED) {
  const lines = read(f).split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    for (const r of RULES) if (r.re.test(line)) fail(`${rel(f)}:${i + 1} ${r.why}`);
  });
}
// child_process has no business in the API, web or desktop sources.
for (const f of SHIPPED.filter((p) => /apps\/(api|web|desktop)\//.test(rel(p)))) {
  if (
    /from\s+['"](node:)?child_process['"]|require\(['"](node:)?child_process['"]\)/.test(read(f))
  ) {
    fail(`${rel(f)} imports child_process`);
  }
}

// ── 3. API baseline ─────────────────────────────────────────────────────────────────────────────────────────────────
const appTs = join(ROOT, 'apps/api/src/http/app.ts');
if (existsSync(appTs)) {
  const a = read(appTs);
  if (!a.includes('helmet(')) fail('apps/api/src/http/app.ts: helmet() is not applied');
  if (/origin:\s*['"]\*['"]/.test(a) || /origin:\s*true/.test(a))
    fail('apps/api CORS must list explicit origins');
  if (!/limit:\s*['"]\d+(kb|mb)['"]/.test(a)) fail('apps/api JSON body size limit is not set');
}
const envTs = join(ROOT, 'apps/api/src/config/env.ts');
if (existsSync(envTs) && !read(envTs).includes('dev-only-local-secret')) {
  fail('apps/api/src/config/env.ts no longer refuses the dev-only JWT secret in production');
}
const authCtl = join(ROOT, 'apps/api/src/http/controllers/auth.controller.ts');
if (existsSync(authCtl)) {
  const c = read(authCtl);
  if (!/httpOnly:\s*true/.test(c)) fail('refresh cookie must be httpOnly');
  if (!/secure:\s*config\.isProduction/.test(c))
    fail('refresh cookie must be Secure in production');
}

// ── 4. Supply chain: which packages may run install scripts ─────────────────────────────────────────────────────────
const ws = read(join(ROOT, 'pnpm-workspace.yaml'));
const EXPECTED_SCRIPTS = new Set([
  'argon2',
  'esbuild',
  'prisma',
  '@prisma/engines',
  '@prisma/client',
  'electron',
]);
const listStart = ws.indexOf('onlyBuiltDependencies:');
if (listStart >= 0) {
  const block = ws.slice(listStart).split(/\n\S/)[0];
  for (const m of block.matchAll(/^\s+-\s+'?([^'\n]+?)'?\s*$/gm)) {
    if (!EXPECTED_SCRIPTS.has(m[1]))
      fail(`pnpm-workspace.yaml allows install scripts for unexpected package "${m[1]}"`);
  }
}
for (const f of ['.npmrc']) {
  if (
    existsSync(join(ROOT, f)) &&
    /ignore-scripts\s*=\s*false|strict-ssl\s*=\s*false|PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING/.test(
      read(join(ROOT, f)),
    )
  ) {
    fail(`${f} weakens supply-chain protections`);
  }
}
for (const f of walk(ROOT).filter(
  (p) => /(package\.json|\.mjs|\.ya?ml|\.md)$/.test(p) && !/security-scan\.mjs$/.test(p),
)) {
  const t = read(f);
  // Mentioning the variable in documentation to FORBID it is fine; setting it is not.
  if (
    /(^|\s)(set\s+|export\s+)?PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING\s*=\s*(1|true)/m.test(t) &&
    !/not|never|do not|don't/i.test(t)
  ) {
    fail(`${rel(f)} sets PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING`);
  }
}

if (failures.length > 0) {
  console.error('Security scan FAILED:');
  for (const f of failures) console.error(' - ' + f);
  process.exit(1);
}
console.log(
  `Security scan PASSED - ${SHIPPED.length} shipped source files checked (Electron flags, code patterns, API baseline, install-script allow-list).`,
);
