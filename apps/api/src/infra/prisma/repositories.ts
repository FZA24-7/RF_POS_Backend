// DATABASE STATUS (Phase 4.2): the sign-in path - users (findByLoginId/findById/touchLastLogin), roles.findById,
// sessions (create/rotate/revoke), loginAttempts (record/countRecentFailures), auditLogs.record and tenants.findById -
// was exercised by live login, refresh, /auth/me and logout against PostgreSQL 16 (sandbox). Every other method in
// this file (tenant listing/management, Login ID history, audit listing, ...) is NOT yet exercised against a database.
//
import type { Prisma, PrismaClient } from '@mafk/database';
import type {
  AuditLogRepository,
  LoginAttemptRepository,
  LoginIdHistoryRepository,
  RoleRepository,
  SessionRepository,
  TenantRepository,
  UserRepository,
} from '../../domain/ports.js';
import type {
  AuditLogEntry,
  AuthUser,
  CreateSessionInput,
  RoleSummary,
  SessionRecord,
  TenantDetail,
  TenantListFilter,
  TenantListResult,
  TenantSummary,
  UserSummary,
} from '../../domain/types.js';

const toAuthUser = (row: {
  id: string;
  tenantId: string | null;
  storeId: string | null;
  roleId: string;
  loginId: string;
  displayName: string;
  status: string;
  passwordHash: string;
  role: { systemRole: string };
}): AuthUser => ({
  id: row.id,
  tenantId: row.tenantId,
  storeId: row.storeId,
  roleId: row.roleId,
  systemRole: row.role.systemRole as AuthUser['systemRole'],
  loginId: row.loginId,
  displayName: row.displayName,
  status: row.status as AuthUser['status'],
  passwordHash: row.passwordHash,
});

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByLoginId(loginId: string): Promise<AuthUser | null> {
    const row = await this.prisma.user.findFirst({
      where: { loginId, deletedAt: null },
      include: { role: { select: { systemRole: true } } },
    });
    return row ? toAuthUser(row) : null;
  }

  async findById(id: string): Promise<AuthUser | null> {
    const row = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: { role: { select: { systemRole: true } } },
    });
    return row ? toAuthUser(row) : null;
  }

  async existsByLoginId(loginId: string): Promise<boolean> {
    const count = await this.prisma.user.count({ where: { loginId } });
    return count > 0;
  }

  async updateLoginId(userId: string, newLoginId: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { loginId: newLoginId } });
  }

  async touchLastLogin(userId: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  }

  // Phase 2 additions:
  async listByTenant(tenantId: string): Promise<UserSummary[]> {
    const rows = await this.prisma.user.findMany({
      where: { tenantId, deletedAt: null },
      include: { role: { select: { systemRole: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      loginId: r.loginId,
      displayName: r.displayName,
      email: r.email,
      systemRole: r.role.systemRole as UserSummary['systemRole'],
      status: r.status as UserSummary['status'],
      lastLoginAt: r.lastLoginAt,
      createdAt: r.createdAt,
    }));
  }

  async updateStatus(userId: string, status: 'ACTIVE' | 'DISABLED'): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { status } });
  }

  async resetPassword(userId: string, newPasswordHash: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash, passwordChangedAt: new Date() },
    });
  }

  async countAllByStatus(): Promise<{ active: number; disabled: number; total: number }> {
    const [active, disabled] = await Promise.all([
      this.prisma.user.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      this.prisma.user.count({ where: { status: 'DISABLED', deletedAt: null } }),
    ]);
    return { active, disabled, total: active + disabled };
  }
}

export class PrismaRoleRepository implements RoleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string, tenantId: string | null): Promise<RoleSummary | null> {
    const row = await this.prisma.role.findFirst({
      where: { id, tenantId },
      include: { permissions: { include: { permission: { select: { key: true } } } } },
    });
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenantId,
      systemRole: row.systemRole as RoleSummary['systemRole'],
      permissionKeys: row.permissions.map((rp) => rp.permission.key),
    };
  }
}

export class PrismaTenantRepository implements TenantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<TenantSummary | null> {
    const row = await this.prisma.tenant.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      status: row.status as TenantSummary['status'],
    };
  }

  // Phase 2 additions:
  private toDetail(row: {
    id: string;
    code: string;
    name: string;
    status: string;
    legalName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    address: string | null;
    logoUrl?: string | null;
    timezone?: string;
    currency?: string;
    createdAt: Date;
  }): TenantDetail {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      status: row.status as TenantSummary['status'],
      timezone: row.timezone,
      currency: row.currency,
      legalName: row.legalName,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
      address: row.address,
      logoUrl: row.logoUrl ?? null,
      createdAt: row.createdAt,
    };
  }

  async findDetailById(id: string): Promise<TenantDetail | null> {
    const row = await this.prisma.tenant.findUnique({ where: { id } });
    return row ? this.toDetail(row) : null;
  }

  async existsByCode(code: string): Promise<boolean> {
    const count = await this.prisma.tenant.count({ where: { code } });
    return count > 0;
  }

  async list(filter: TenantListFilter): Promise<TenantListResult> {
    const where = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.search
        ? {
            OR: [
              { name: { contains: filter.search, mode: 'insensitive' as const } },
              { code: { contains: filter.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      this.prisma.tenant.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toDetail(r)),
      total,
      page: filter.page,
      pageSize: filter.pageSize,
    };
  }

  async listAll(): Promise<TenantDetail[]> {
    const rows = await this.prisma.tenant.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((r) => this.toDetail(r));
  }

  async update(
    id: string,
    patch: Partial<
      Pick<TenantDetail, 'name' | 'legalName' | 'contactEmail' | 'contactPhone' | 'address'>
    >,
  ): Promise<void> {
    await this.prisma.tenant.update({ where: { id }, data: patch });
  }

  async updateStatus(id: string, status: TenantSummary['status']): Promise<void> {
    await this.prisma.tenant.update({ where: { id }, data: { status } });
  }
}

export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateSessionInput): Promise<SessionRecord> {
    const row = await this.prisma.session.create({
      data: {
        userId: input.userId,
        tenantId: input.tenantId,
        deviceId: input.deviceId ?? null,
        refreshTokenHash: input.refreshTokenHash,
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
        expiresAt: input.expiresAt,
      },
    });
    return {
      id: row.id,
      userId: row.userId,
      tenantId: row.tenantId,
      refreshTokenHash: row.refreshTokenHash,
      previousRefreshTokenHash: row.previousRefreshTokenHash,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
    };
  }

  async findByRefreshTokenHash(hash: string): Promise<SessionRecord | null> {
    const row = await this.prisma.session.findUnique({ where: { refreshTokenHash: hash } });
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      tenantId: row.tenantId,
      refreshTokenHash: row.refreshTokenHash,
      previousRefreshTokenHash: row.previousRefreshTokenHash,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
    };
  }

  async rotate(sessionId: string, newHash: string, expiresAt: Date): Promise<void> {
    const current = await this.prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        previousRefreshTokenHash: current.refreshTokenHash,
        refreshTokenHash: newHash,
        expiresAt,
        lastUsedAt: new Date(),
      },
    });
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }
}

export class PrismaLoginAttemptRepository implements LoginAttemptRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(input: {
    loginId: string;
    userId: string | null;
    tenantId: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    success: boolean;
    failureReason?: string;
  }): Promise<void> {
    await this.prisma.loginAttempt.create({
      data: {
        loginId: input.loginId,
        userId: input.userId,
        tenantId: input.tenantId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        success: input.success,
        failureReason: input.failureReason ?? null,
      },
    });
  }

  async countRecentFailures(loginId: string, sinceMs: number): Promise<number> {
    return this.prisma.loginAttempt.count({
      where: { loginId, success: false, createdAt: { gte: new Date(sinceMs) } },
    });
  }
}

export class PrismaAuditLogRepository implements AuditLogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(input: {
    tenantId: string | null;
    userId: string | null;
    action: string;
    entity: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
    ipAddress?: string | null;
    userAgent?: string | null;
    requestId?: string | null;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        requestId: input.requestId ?? null,
      },
    });
  }

  // Phase 2 addition:
  async listByTenant(tenantId: string, limit: number): Promise<AuditLogEntry[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      userId: r.userId,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      metadata: (r.metadata as Record<string, unknown> | null) ?? null,
      createdAt: r.createdAt,
    }));
  }
}

export class PrismaLoginIdHistoryRepository implements LoginIdHistoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(entry: {
    tenantId: string | null;
    userId: string;
    oldLoginId: string;
    newLoginId: string;
    changedById: string;
    reason?: string;
  }): Promise<void> {
    await this.prisma.loginIdHistory.create({
      data: {
        tenantId: entry.tenantId,
        userId: entry.userId,
        oldLoginId: entry.oldLoginId,
        newLoginId: entry.newLoginId,
        changedById: entry.changedById,
        reason: entry.reason ?? null,
      },
    });
  }
}
