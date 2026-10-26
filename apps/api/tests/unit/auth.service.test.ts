import { describe, expect, it } from 'vitest';
import { AuthService } from '../../src/services/auth.service.js';
import { PasswordHasher } from '../../src/security/password.js';
import { JoseAccessTokenService } from '../../src/security/jwt.js';
import { buildScenario } from '../fakes/scenario.js';

const hasher = new PasswordHasher({ memoryCostKib: 19456, timeCost: 2 });
const accessTokens = new JoseAccessTokenService('test-secret-at-least-32-characters-long', 15);
const meta = { ipAddress: '127.0.0.1', userAgent: 'vitest' };

const buildAuth = async (
  config?: Partial<{ maxFailedAttempts: number; lockoutWindowMs: number }>,
) => {
  const scenario = await buildScenario();
  const authService = new AuthService(scenario.repos, hasher, accessTokens, {
    maxFailedAttempts: config?.maxFailedAttempts ?? 5,
    lockoutWindowMs: config?.lockoutWindowMs ?? 15 * 60_000,
    accessTokenTtlMinutes: 15,
    refreshTokenTtlDays: 14,
  });
  return { scenario, authService };
};

describe('AuthService.login', () => {
  it('succeeds with correct credentials and returns an access + refresh token', async () => {
    const { scenario, authService } = await buildAuth();
    const result = await authService.login(
      scenario.tenantAClientAdmin.loginId,
      scenario.tenantAClientAdmin.password,
      meta,
    );
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.tenantId).toBe(scenario.tenantA.id);

    const claims = await accessTokens.verify(result.accessToken);
    expect(claims.sub).toBe(scenario.tenantAClientAdmin.id);
    expect(claims.tid).toBe(scenario.tenantA.id);
    expect(claims.role).toBe('CLIENT_MASTER_ADMIN');
  });

  it('rejects an unknown Login ID without revealing whether the account exists', async () => {
    const { authService } = await buildAuth();
    await expect(authService.login('nobody.here', 'whatever123', meta)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('rejects a wrong password', async () => {
    const { scenario, authService } = await buildAuth();
    await expect(
      authService.login(scenario.tenantAClientAdmin.loginId, 'totally-wrong-password', meta),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('locks the account after the configured number of failed attempts', async () => {
    const { scenario, authService } = await buildAuth({ maxFailedAttempts: 3 });
    for (let i = 0; i < 3; i += 1) {
      await expect(
        authService.login(scenario.tenantAClientAdmin.loginId, 'wrong-password', meta),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    }
    // 4th attempt - even with the CORRECT password - is locked out.
    await expect(
      authService.login(
        scenario.tenantAClientAdmin.loginId,
        scenario.tenantAClientAdmin.password,
        meta,
      ),
    ).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
  });

  it('rejects login for a suspended tenant', async () => {
    const { scenario, authService } = await buildAuth();
    scenario.repos.tenants.seed({
      id: scenario.tenantA.id,
      code: scenario.tenantA.code,
      name: 'x',
      status: 'SUSPENDED',
    });
    await expect(
      authService.login(
        scenario.tenantAClientAdmin.loginId,
        scenario.tenantAClientAdmin.password,
        meta,
      ),
    ).rejects.toMatchObject({ code: 'TENANT_SUSPENDED' });
  });

  it('rejects login for a disabled user', async () => {
    const { scenario, authService } = await buildAuth();
    const u = scenario.repos.users.users.get(scenario.tenantACashier.id)!;
    scenario.repos.users.users.set(u.id, { ...u, status: 'DISABLED' });
    await expect(
      authService.login(scenario.tenantACashier.loginId, scenario.tenantACashier.password, meta),
    ).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' });
  });

  it('records both failed and successful login attempts for audit/lockout purposes', async () => {
    const { scenario, authService } = await buildAuth();
    await expect(
      authService.login(scenario.tenantACashier.loginId, 'nope', meta),
    ).rejects.toBeTruthy();
    await authService.login(
      scenario.tenantACashier.loginId,
      scenario.tenantACashier.password,
      meta,
    );
    const attempts = scenario.repos.loginAttempts.attempts.filter(
      (a) => a.loginId === scenario.tenantACashier.loginId,
    );
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.success).toBe(false);
    expect(attempts[1]?.success).toBe(true);
  });
});

describe('AuthService.refresh / logout', () => {
  it('rotates the refresh token and issues a fresh access token', async () => {
    const { scenario, authService } = await buildAuth();
    const login = await authService.login(
      scenario.tenantAManager.loginId,
      scenario.tenantAManager.password,
      meta,
    );
    const refreshed = await authService.refresh(login.refreshToken);
    expect(refreshed.accessToken).toBeTruthy();
    expect(refreshed.refreshToken).not.toBe(login.refreshToken);

    // the OLD refresh token must no longer work
    await expect(authService.refresh(login.refreshToken)).rejects.toMatchObject({
      code: 'SESSION_REVOKED',
    });
    // the NEW one must work
    await expect(authService.refresh(refreshed.refreshToken)).resolves.toBeTruthy();
  });

  it('revokes the session on logout so the refresh token can no longer be used', async () => {
    const { scenario, authService } = await buildAuth();
    const login = await authService.login(
      scenario.tenantACashier.loginId,
      scenario.tenantACashier.password,
      meta,
    );
    await authService.logout(login.refreshToken);
    await expect(authService.refresh(login.refreshToken)).rejects.toMatchObject({
      code: 'SESSION_REVOKED',
    });
  });
});
