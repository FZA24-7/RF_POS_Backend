// Pure security/configuration rules for the desktop shell. No Electron imports, so every rule here is unit-tested
// (tests/policy.test.ts). main.ts only wires these rules into Electron.
import * as path from 'node:path';

export const APP_SCHEME = 'mafk-app';
export const APP_ORIGIN = `${APP_SCHEME}://local`;
export const API_PATH_PREFIX = '/api/';
export const DEFAULT_SERVER_URL = 'http://localhost:4000';

export type ServerUrlResult = { ok: true; value: string } | { ok: false; error: string };

/**
 * Validates the address of the API server typed by the user. Accepts `http://host:port` or `https://host`
 * (an optional trailing `/api` or `/` is tolerated) and returns the bare origin. Rejects anything else:
 * other schemes, embedded credentials, query strings, fragments and extra paths.
 */
export const normalizeServerUrl = (input: string): ServerUrlResult => {
  const raw = input.trim();
  if (raw.length === 0) return { ok: false, error: 'Enter the server address.' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'This is not a valid address. Example: http://192.168.1.10:4000' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Only http:// or https:// addresses are allowed.' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, error: 'Do not put a user name or password in the address.' };
  }
  if (url.search !== '' || url.hash !== '') {
    return { ok: false, error: 'The address must not contain a query string or fragment.' };
  }
  const p = url.pathname.replace(/\/+$/, '');
  if (p !== '' && p !== '/api') {
    return {
      ok: false,
      error:
        'Enter only the server address, without a path (for example http://192.168.1.10:4000).',
    };
  }
  return { ok: true, value: url.origin };
};

/** True only for pages of this app itself. Every other navigation is blocked. */
export const isAppUrl = (url: string): boolean => {
  try {
    const u = new URL(url);
    return u.protocol === `${APP_SCHEME}:` && u.host === 'local';
  } catch {
    return false;
  }
};

/** Maps an app request `mafk-app://local/api/...` onto the configured server. Returns null for non-API paths. */
export const toServerUrl = (serverOrigin: string, requestUrl: string): string | null => {
  let u: URL;
  try {
    u = new URL(requestUrl);
  } catch {
    return null;
  }
  if (!isAppUrl(requestUrl)) return null;
  if (!u.pathname.startsWith(API_PATH_PREFIX)) return null;
  if (u.pathname.includes('..') || u.pathname.includes('//')) return null;
  return `${serverOrigin}${u.pathname}${u.search}`;
};

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

/** Request headers forwarded to the server. `origin`/`referer`/`cookie` are dropped: the shell supplies its own. */
export const filterRequestHeaders = (headers: Iterable<[string, string]>): [string, string][] => {
  const out: [string, string][] = [];
  for (const [k, v] of headers) {
    const key = k.toLowerCase();
    if (HOP_BY_HOP.has(key) || key === 'origin' || key === 'referer' || key === 'cookie') continue;
    out.push([k, v]);
  }
  return out;
};

/** Response headers handed back to the page. `set-cookie` never reaches the page (the shell's cookie jar keeps it). */
export const filterResponseHeaders = (headers: Iterable<[string, string]>): [string, string][] => {
  const out: [string, string][] = [];
  for (const [k, v] of headers) {
    const key = k.toLowerCase();
    if (HOP_BY_HOP.has(key) || key === 'set-cookie' || key === 'content-encoding') continue;
    out.push([k, v]);
  }
  return out;
};

/**
 * Resolves a request path to a file inside `root`, or null when it would escape it. `root` must be absolute.
 * Works with both `/` and `\` separators so it behaves the same on Windows.
 */
export const resolveStaticFile = (
  root: string,
  urlPath: string,
  pathApi: Pick<typeof path, 'resolve' | 'sep'> = path,
): string | null => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const relative = decoded.replace(/^\/+/, '');
  // A drive letter or device path ("C:/Windows/win.ini", "C:foo") would make resolve() ignore the root on Windows.
  if (/^[a-zA-Z]:/.test(relative)) return null;
  const resolved = pathApi.resolve(root, relative);
  const rootWithSep = root.endsWith(pathApi.sep) ? root : root + pathApi.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) return null;
  return resolved;
};

/** Content-Security-Policy for pages served by the shell. No remote scripts, frames or objects. */
export const buildCsp = (): string =>
  [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};
export const mimeFor = (file: string): string =>
  MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
