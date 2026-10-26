import { normalizeLoginId, PERMISSION_CATALOG } from '@mafk/shared';
import type { Repositories } from '../domain/ports.js';
import { DomainError } from '../domain/types.js';
import type { PasswordHasher } from '../security/password.js';
import type { AccessTokenService } from '../security/jwt.js';
import { generateRefreshToken, hashRefreshToken } from '../security/refresh-token.js';

export interface AuthServiceConfig {
  maxFailedAttempts: number;
  lockoutWindowMs: number;
  accessTokenTtlMinutes: number;
  refreshTokenTtlDays: number;
}

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    tenantId: string | null;
    loginId: string;
    displayName: string;
    systemRole: string;
  };
}

const PERMISSION_KEY_SET = new Set(PERMISSION_CATALOG);

export class AuthService {
  constructor(
    private readonly repos: Repositories,
    private readonly hasher: PasswordHasher,
    private readonly accessTokens: AccessTokenService,
    private readonly config: AuthServiceConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async login(loginIdRaw: string, password: string, meta: RequestMeta): Promise<LoginResult> {
    const loginId = normalizeLoginId(loginIdRaw);
    const recentFailures = await this.repos.loginAttempts.countRecentFailures(
      loginId,
      this.now().getTime() - this.config.lockoutWindowMs,
    );
    if (recentFailures >= this.config.maxFailedAttempts) {
      await this.repos.loginAttempts.record({
        loginId,
        userId: null,
        tenantId: null,
        ...meta,
        success: false,
        failureReason: 'ACCOUNT_LOCKED',
      });
      throw new DomainError(
        'ACCOUNT_LOCKED',
        'Too many failed login attempts. Try again later.',
        423,
      );
    }

    const user = await this.repos.users.findByLoginId(loginId);
    if (!user) {
      await this.repos.loginAttempts.record({
        loginId,
        userId: null,
        tenantId: null,
        ...meta,
        success: false,
        failureReason: 'INVALID_CREDENTIALS',
      });
      throw new DomainError('INVALID_CREDENTIALS', 'Invalid Login ID or password.', 401);
    }

    if (user.status !== 'ACTIVE') {
      await this.repos.loginAttempts.record({
        loginId,
        userId: user.id,
        tenantId: user.tenantId,
        ...meta,
        success: false,
        failureReason: 'ACCOUNT_DISABLED',
      });
      throw new DomainError('ACCOUNT_DISABLED', 'This account has been disabled.', 403);
    }

    if (user.tenantId) {
      const tenant = await this.repos.tenants.findById(user.tenantId);
      if (!tenant || tenant.status !== 'ACTIVE') {
        await this.repos.loginAttempts.record({
          loginId,
          userId: user.id,
          tenantId: user.tenantId,
          ...meta,
          success: false,
          failureReason: 'TENANT_SUSPENDED',
        });
        throw new DomainError('TENANT_SUSPENDED', 'This account is currently unavailable.', 403);
      }
    }

    const passwordOk = await this.hasher.verify(user.passwordHash, password);
    if (!passwordOk) {
      await this.repos.loginAttempts.record({
        loginId,
        userId: user.id,
        tenantId: user.tenantId,
        ...meta,
        success: false,
        failureReason: 'INVALID_CREDENTIALS',
      });
      throw new DomainError('INVALID_CREDENTIALS', 'Invalid Login ID or password.', 401);
    }

    const role = await this.repos.roles.findById(user.roleId, user.tenantId);
    if (!role) {
      throw new DomainError('INTERNAL_ERROR', 'User role could not be resolved.', 500);
    }
    const permissions = role.permissionKeys.filter((p) => PERMISSION_KEY_SET.has(p));

    const { token: refreshToken, hash: refreshTokenHash } = generateRefreshToken();
    const expiresAt = new Date(this.now().getTime() + this.config.refreshTokenTtlDays * 86_400_000);
    const session = await this.repos.sessions.create({
      userId: user.id,
      tenantId: user.tenantId,
      refreshTokenHash,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
      expiresAt,
    });

    const accessToken = await this.accessTokens.sign({
      sub: user.id,
      tid: user.tenantId,
      sid: session.id,
      role: user.systemRole,
      perms: permissions,
    });

    await this.repos.users.touchLastLogin(user.id);
    await this.repos.loginAttempts.record({
      loginId,
      userId: user.id,
      tenantId: user.tenantId,
      ...meta,
      success: true,
    });
    await this.repos.auditLogs.record({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'AUTH_LOGIN',
      entity: 'User',
      entityId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        tenantId: user.tenantId,
        loginId: user.loginId,
        displayName: user.displayName,
        systemRole: user.systemRole,
      },
    };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const hash = hashRefreshToken(refreshToken);
    const session = await this.repos.sessions.findByRefreshTokenHash(hash);
    if (!session || session.revokedAt || session.expiresAt.getTime() < this.now().getTime()) {
      throw new DomainError(
        'SESSION_REVOKED',
        'Session is no longer valid. Please log in again.',
        401,
      );
    }

    const user = await this.repos.users.findById(session.userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new DomainError(
        'SESSION_REVOKED',
        'Session is no longer valid. Please log in again.',
        401,
      );
    }
    if (user.tenantId) {
      const tenant = await this.repos.tenants.findById(user.tenantId);
      if (!tenant || tenant.status !== 'ACTIVE') {
        throw new DomainError('TENANT_SUSPENDED', 'This account is currently unavailable.', 403);
      }
    }

    const role = await this.repos.roles.findById(user.roleId, user.tenantId);
    if (!role) throw new DomainError('INTERNAL_ERROR', 'User role could not be resolved.', 500);
    const permissions = role.permissionKeys.filter((p) => PERMISSION_KEY_SET.has(p));

    const { token: newRefreshToken, hash: newHash } = generateRefreshToken();
    const newExpiresAt = new Date(
      this.now().getTime() + this.config.refreshTokenTtlDays * 86_400_000,
    );
    await this.repos.sessions.rotate(session.id, newHash, newExpiresAt);

    const accessToken = await this.accessTokens.sign({
      sub: user.id,
      tid: user.tenantId,
      sid: session.id,
      role: user.systemRole,
      perms: permissions,
    });

    return { accessToken, refreshToken: newRefreshToken };
  }

  /** Profile of the already-authenticated caller (used by the web app to restore a session after a page reload). */
  async me(userId: string): Promise<LoginResult['user']> {
    const user = await this.repos.users.findById(userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new DomainError(
        'SESSION_REVOKED',
        'Session is no longer valid. Please log in again.',
        401,
      );
    }
    return {
      id: user.id,
      tenantId: user.tenantId,
      loginId: user.loginId,
      displayName: user.displayName,
      systemRole: user.systemRole,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    const hash = hashRefreshToken(refreshToken);
    const session = await this.repos.sessions.findByRefreshTokenHash(hash);
    if (session) {
      await this.repos.sessions.revoke(session.id, 'LOGOUT');
      await this.repos.auditLogs.record({
        tenantId: session.tenantId,
        userId: session.userId,
        action: 'AUTH_LOGOUT',
        entity: 'User',
        entityId: session.userId,
      });
    }
  }
}
