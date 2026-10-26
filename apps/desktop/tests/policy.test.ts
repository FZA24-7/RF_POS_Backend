import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import {
  APP_ORIGIN,
  buildCsp,
  filterRequestHeaders,
  filterResponseHeaders,
  isAppUrl,
  mimeFor,
  normalizeServerUrl,
  resolveStaticFile,
  toServerUrl,
} from '../src/policy';

describe('normalizeServerUrl', () => {
  it.each([
    ['http://localhost:4000', 'http://localhost:4000'],
    ['  http://192.168.1.10:4000/  ', 'http://192.168.1.10:4000'],
    ['http://192.168.1.10:4000/api', 'http://192.168.1.10:4000'],
    ['https://pos.example.com/api/', 'https://pos.example.com'],
    ['https://pos.example.com:8443', 'https://pos.example.com:8443'],
  ])('accepts %s', (input, expected) => {
    expect(normalizeServerUrl(input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    '',
    '   ',
    'localhost:4000',
    'ftp://host/',
    'file:///C:/x',
    'javascript:alert(1)',
    'mafk-app://local',
    'http://user:pass@host:4000',
    'http://host:4000/?x=1',
    'http://host:4000/#frag',
    'http://host:4000/admin',
    'http://host:4000/api/v2',
  ])('rejects %j', (input) => {
    expect(normalizeServerUrl(input).ok).toBe(false);
  });
});

describe('navigation and proxy mapping', () => {
  it('treats only mafk-app://local as the app', () => {
    expect(isAppUrl(`${APP_ORIGIN}/`)).toBe(true);
    expect(isAppUrl(`${APP_ORIGIN}/customers?x=1`)).toBe(true);
    for (const u of [
      'https://evil.example/',
      'http://localhost:4000/',
      'mafk-app://other/',
      'file:///etc/passwd',
      'nonsense',
    ]) {
      expect(isAppUrl(u)).toBe(false);
    }
  });

  it('maps /api/ requests to the configured server and nothing else', () => {
    const s = 'http://10.0.0.5:4000';
    expect(toServerUrl(s, `${APP_ORIGIN}/api/customers?search=a%20b`)).toBe(
      `${s}/api/customers?search=a%20b`,
    );
    expect(toServerUrl(s, `${APP_ORIGIN}/api/auth/login`)).toBe(`${s}/api/auth/login`);
    expect(toServerUrl(s, `${APP_ORIGIN}/index.html`)).toBeNull();
    expect(toServerUrl(s, `${APP_ORIGIN}/apix/foo`)).toBeNull();
    expect(toServerUrl(s, `${APP_ORIGIN}/api//evil`)).toBeNull();
    expect(toServerUrl(s, 'https://evil.example/api/x')).toBeNull();
    expect(toServerUrl(s, 'garbage')).toBeNull();
  });

  it('never forwards cookies/origin from the page and never returns set-cookie to it', () => {
    const req = filterRequestHeaders([
      ['Authorization', 'Bearer t'],
      ['Content-Type', 'application/json'],
      ['Cookie', 'stolen=1'],
      ['Origin', 'mafk-app://local'],
      ['Host', 'x'],
      ['Connection', 'keep-alive'],
    ]);
    expect(req.map(([k]) => k)).toEqual(['Authorization', 'Content-Type']);
    const res = filterResponseHeaders([
      ['content-type', 'application/json'],
      ['set-cookie', 'mafk_refresh=abc; HttpOnly'],
      ['content-encoding', 'gzip'],
      ['transfer-encoding', 'chunked'],
      ['x-request-id', '1'],
    ]);
    expect(res.map(([k]) => k)).toEqual(['content-type', 'x-request-id']);
  });
});

describe('resolveStaticFile', () => {
  const root = path.resolve('/srv/web');
  it('resolves files inside the root', () => {
    expect(resolveStaticFile(root, '/assets/app.js')).toBe(path.join(root, 'assets', 'app.js'));
    expect(resolveStaticFile(root, '/')).toBe(root);
  });
  it('blocks traversal in every common spelling', () => {
    for (const p of [
      '/../secret',
      '/..%2fsecret',
      '/%2e%2e/secret',
      '/a/../../secret',
      '/..\\secret',
      '/a\\b',
      '/x%00.js',
      '/%',
    ]) {
      expect(resolveStaticFile(root, p), p).toBeNull();
    }
  });
});

describe('resolveStaticFile with Windows path rules', () => {
  const root = 'C:\\Program Files\\MAFK\\resources\\web';
  it('resolves normal files with backslash separators', () => {
    expect(resolveStaticFile(root, '/assets/app.js', path.win32)).toBe(`${root}\\assets\\app.js`);
    expect(resolveStaticFile(root, '/index.html', path.win32)).toBe(`${root}\\index.html`);
  });
  it('blocks drive letters, backslashes, UNC and traversal', () => {
    for (const p of [
      '/C:/Windows/win.ini',
      '/c:foo',
      '/D:/secret.txt',
      '/..\\..\\Windows',
      '/a\\b',
      '/../../Windows/win.ini',
      '/%2e%2e/%2e%2e/Windows',
      '/..%5c..%5cWindows',
      '/x%00.js',
    ]) {
      expect(resolveStaticFile(root, p, path.win32), p).toBeNull();
    }
  });
  it('does not treat //server/share as an escape (leading slashes are stripped)', () => {
    const r = resolveStaticFile(root, '//server/share/x.js', path.win32);
    expect(r === null || r.startsWith(`${root}\\`)).toBe(true);
  });
});

describe('policy constants', () => {
  it('CSP forbids remote scripts, frames and objects', () => {
    const csp = buildCsp();
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toContain('*');
  });
  it('knows common mime types', () => {
    expect(mimeFor('a/b/index.html')).toContain('text/html');
    expect(mimeFor('x.JS')).toContain('javascript');
    expect(mimeFor('x.unknown')).toBe('application/octet-stream');
  });
});
