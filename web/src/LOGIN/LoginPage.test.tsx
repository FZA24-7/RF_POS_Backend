import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from '../state/auth.js';
import { setAccessToken } from '../api/client.js';
import { LoginPage } from './LoginPage.js';
import { describeLoginError } from './loginErrors.js';
import { validateLoginForm } from './loginValidation.js';
import { ApiError } from '../api/client.js';

/**
 * Behaviour tests for the sign-in screen. `fetch` is replaced by a tiny router returning well-formed API payloads,
 * so these verify the FRONTEND (validation, messages, restore, double-submit); the server's own login rules
 * (lockout, disabled accounts, tenant suspension) are covered by the API tests.
 */

const USER = {
  id: 'u1',
  tenantId: 't1',
  loginId: 'a.cashier',
  displayName: 'Ayesha Cashier',
  systemRole: 'CASHIER',
};

const json = (status: number, body: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

interface Routes {
  refresh?: () => Response;
  me?: () => Response;
  login?: (body: { loginId: string; password: string }) => Response | Promise<Response>;
}

const installFetch = (routes: Routes) => {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method: init?.method ?? 'GET', body });
      if (url.endsWith('/auth/refresh')) return (routes.refresh ?? (() => json(401, {})))();
      if (url.endsWith('/auth/me')) return (routes.me ?? (() => json(401, {})))();
      if (url.endsWith('/auth/login')) {
        if (!routes.login) throw new Error('unexpected login call');
        return routes.login(body);
      }
      throw new Error(`unexpected request ${url}`);
    }),
  );
  return calls;
};

const App = () => {
  const { status, user } = useAuth();
  if (status === 'restoring') return <p>restoring</p>;
  if (status === 'authenticated') return <p>Signed in as {user?.displayName}</p>;
  return <LoginPage />;
};

const renderApp = () =>
  render(
    <AuthProvider>
      <App />
    </AuthProvider>,
  );

const fill = async (loginId: string, password: string) => {
  const user = userEvent.setup();
  if (loginId) await user.type(screen.getByLabelText('Login ID'), loginId);
  if (password) await user.type(screen.getByLabelText('Password'), password);
  return user;
};

beforeEach(() => setAccessToken(null));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe('LOGIN page - rendering and session restore', () => {
  it('shows the sign-in form when there is no session', async () => {
    installFetch({});
    renderApp();
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByLabelText('Login ID')).toBeTruthy();
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('password');
  });

  it('restores an existing session after a reload without showing the form', async () => {
    const calls = installFetch({
      refresh: () => json(200, { accessToken: 'tok' }),
      me: () => json(200, { user: USER }),
    });
    renderApp();
    expect(await screen.findByText('Signed in as Ayesha Cashier')).toBeTruthy();
    expect(screen.queryByLabelText('Login ID')).toBeNull();
    expect(calls.some((c) => c.url.endsWith('/auth/login'))).toBe(false);
  });

  it('falls back to the form when the session cannot be restored', async () => {
    installFetch({ refresh: () => json(200, { accessToken: 'tok' }), me: () => json(401, {}) });
    renderApp();
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('toggles password visibility', async () => {
    installFetch({});
    renderApp();
    await screen.findByLabelText('Password');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('password');
  });
});

describe('LOGIN page - validation (no request is sent)', () => {
  it('requires a Login ID and a password', async () => {
    const calls = installFetch({});
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your Login ID.')).toBeTruthy();
    await fill('a.cashier', '');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your password.')).toBeTruthy();
    expect(calls.some((c) => c.url.endsWith('/auth/login'))).toBe(false);
  });

  it('rejects a malformed Login ID before calling the server', async () => {
    const calls = installFetch({});
    renderApp();
    await screen.findByLabelText('Login ID');
    const user = await fill('bad id!', 'Secret123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText(/Login IDs are 3–32 characters/)).toBeTruthy();
    expect(calls.some((c) => c.url.endsWith('/auth/login'))).toBe(false);
  });
});

describe('LOGIN page - signing in', () => {
  it('sends the trimmed Login ID and password, then shows the signed-in app', async () => {
    const calls = installFetch({
      login: () => json(200, { accessToken: 'tok', user: USER }),
    });
    renderApp();
    await screen.findByLabelText('Login ID');
    const user = await fill('  a.cashier  ', 'Secret123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Signed in as Ayesha Cashier')).toBeTruthy();
    const login = calls.find((c) => c.url.endsWith('/auth/login'));
    expect(login?.method).toBe('POST');
    expect(login?.body).toEqual({ loginId: 'a.cashier', password: 'Secret123' });
  });

  it('shows the server reason, clears the rejected password and refocuses it', async () => {
    installFetch({
      login: () =>
        json(401, {
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid Login ID or password.' },
        }),
    });
    renderApp();
    await screen.findByLabelText('Login ID');
    const user = await fill('a.cashier', 'WrongPass1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Invalid Login ID or password\./,
    );
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(screen.getByLabelText('Password'));
    expect((screen.getByLabelText('Login ID') as HTMLInputElement).value).toBe('a.cashier');
  });

  it('explains a locked account and an unreachable server differently', async () => {
    installFetch({
      login: () => json(423, { error: { code: 'ACCOUNT_LOCKED', message: 'locked' } }),
    });
    renderApp();
    await screen.findByLabelText('Login ID');
    const user = await fill('a.cashier', 'Secret123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Too many failed attempts/);

    cleanup();
    vi.unstubAllGlobals();
    installFetch({
      login: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    renderApp();
    await screen.findByLabelText('Login ID');
    const user2 = await fill('a.cashier', 'Secret123');
    await user2.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Cannot reach the server/);
  });

  it('sends only one request when the form is submitted twice quickly', async () => {
    let release: (r: Response) => void = () => undefined;
    const calls = installFetch({
      login: () => new Promise<Response>((resolve) => (release = resolve)),
    });
    renderApp();
    await screen.findByLabelText('Login ID');
    const user = await fill('a.cashier', 'Secret123');
    const button = screen.getByRole('button', { name: 'Sign in' });
    await user.click(button);
    await user.type(screen.getByLabelText('Login ID'), '{Enter}'); // disabled while in flight -> ignored
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Signing in…' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    release(json(200, { accessToken: 'tok', user: USER }));
    expect(await screen.findByText('Signed in as Ayesha Cashier')).toBeTruthy();
    expect(calls.filter((c) => c.url.endsWith('/auth/login'))).toHaveLength(1);
  });
});

describe('LOGIN helpers', () => {
  it('validateLoginForm accepts a valid pair', () => {
    expect(validateLoginForm('owner.admin', 'x')).toEqual({});
  });
  it('describeLoginError never reveals whether the Login ID exists', () => {
    expect(describeLoginError(new ApiError(401, 'INVALID_CREDENTIALS', 'whatever'))).toBe(
      'Invalid Login ID or password.',
    );
    expect(describeLoginError(new ApiError(500, 'INTERNAL_ERROR', 'stack trace here'))).not.toMatch(
      /stack trace/,
    );
  });
  it('describeLoginError explains an unreachable server (desktop shell answers 502 SERVER_UNREACHABLE)', () => {
    expect(describeLoginError(new ApiError(502, 'SERVER_UNREACHABLE', 'any wording'))).toBe(
      'Cannot reach the server. Check your connection and try again.',
    );
  });
});
