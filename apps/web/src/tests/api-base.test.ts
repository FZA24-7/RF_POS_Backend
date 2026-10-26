import { afterEach, describe, expect, it, vi } from 'vitest';

// The API base is decided when the client module is first loaded, so each case imports a fresh copy.
const load = async () => {
  vi.resetModules();
  return import('../api/client.js');
};

afterEach(() => {
  delete (window as { mafkDesktop?: unknown }).mafkDesktop;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const fetchSpy = () => {
  const spy = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
};

describe('API base', () => {
  it('in a normal browser uses the configured default API address', async () => {
    const spy = fetchSpy();
    const { apiRequest } = await load();
    await apiRequest('/customers');
    expect(String(spy.mock.calls[0]?.[0])).toBe('http://localhost:4000/api/customers');
  });

  it('inside the desktop shell uses the same-origin /api base', async () => {
    (window as { mafkDesktop?: unknown }).mafkDesktop = { isDesktop: true, apiBase: '/api' };
    const spy = fetchSpy();
    const { apiRequest } = await load();
    await apiRequest('/customers');
    expect(String(spy.mock.calls[0]?.[0])).toBe('/api/customers');
  });
});
