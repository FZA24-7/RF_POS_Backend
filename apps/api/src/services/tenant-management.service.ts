import { normalizeLoginId } from '@mafk/shared';
import type { CreateClientAdminInput, TenantListQuery, UpdateTenantInput } from '@mafk/validation';
import type { Repositories } from '../domain/ports.js';
import {
  DomainError,
  type AuditLogEntry,
  type StoreSummary,
  type TenantDetail,
  type TenantListResult,
  type UserSummary,
} from '../domain/types.js';
import type { PasswordHasher } from '../security/password.js';

export interface Actor {
  id: string;
  tenantId: string | null;
}

export class TenantManagementService {
  constructor(
    private readonly repos: Repositories,
    private readonly hasher: PasswordHasher,
  ) {}

  async list(query: TenantListQuery): Promise<TenantListResult> {
    return this.repos.tenants.list({
      search: query.search,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  private async requireTenant(tenantId: string): Promise<TenantDetail> {
    const tenant = await this.repos.tenants.findDetailById(tenantId);
    if (!tenant) throw new DomainError('NOT_FOUND', 'Tenant not found.', 404);
    return tenant;
  }

  async getDetail(tenantId: string): Promise<TenantDetail> {
    return this.requireTenant(tenantId);
  }

  async listStores(tenantId: string): Promise<StoreSummary[]> {
    await this.requireTenant(tenantId);
    return this.repos.stores.listByTenant(tenantId);
  }

  async listUsers(tenantId: string): Promise<UserSummary[]> {
    await this.requireTenant(tenantId);
    return this.repos.users.listByTenant(tenantId);
  }

  async listAuditLogs(tenantId: string, limit = 100): Promise<AuditLogEntry[]> {
    await this.requireTenant(tenantId);
    return this.repos.auditLogs.listByTenant(tenantId, limit);
  }

  async update(actor: Actor, tenantId: string, patch: UpdateTenantInput): Promise<TenantDetail> {
    await this.requireTenant(tenantId);
    await this.repos.tenants.update(tenantId, patch);
    await this.repos.auditLogs.record({
      tenantId,
      userId: actor.id,
      action: 'TENANT_UPDATED',
      entity: 'Tenant',
      entityId: tenantId,
      metadata: { patch },
    });
    return this.requireTenant(tenantId);
  }

  async updateStatus(
    actor: Actor,
    tenantId: string,
    status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED',
    reason?: string,
  ): Promise<TenantDetail> {
    const before = await this.requireTenant(tenantId);
    await this.repos.tenants.updateStatus(tenantId, status);
    if (status !== 'ACTIVE') {
      // Suspending/archiving a tenant also kills every live session for its users,
      // so access is revoked immediately rather than waiting for tokens to expire.
      const users = await this.repos.users.listByTenant(tenantId);
      for (const u of users) {
        await this.repos.sessions.revokeAllForUser(u.id, `TENANT_${status}`);
      }
    }
    await this.repos.auditLogs.record({
      tenantId,
      userId: actor.id,
      action: 'TENANT_STATUS_CHANGED',
      entity: 'Tenant',
      entityId: tenantId,
      metadata: { from: before.status, to: status, reason },
    });
    return this.requireTenant(tenantId);
  }

  /** Master Admin creating an ADDITIONAL Client Master Admin for an existing tenant. */
  async createClientAdmin(
    actor: Actor,
    tenantId: string,
    input: CreateClientAdminInput,
  ): Promise<UserSummary> {
    await this.requireTenant(tenantId);
    const loginId = normalizeLoginId(input.loginId);
    if (await this.repos.users.existsByLoginId(loginId)) {
      throw new DomainError('LOGIN_ID_TAKEN', 'This Login ID is already in use.', 409);
    }
    const passwordHash = await this.hasher.hash(input.password);
    const created = await this.repos.tenantProvisioning.addClientAdmin(tenantId, {
      loginId,
      passwordHash,
      displayName: input.displayName,
      email: input.email,
    });
    await this.repos.auditLogs.record({
      tenantId,
      userId: actor.id,
      action: 'CLIENT_ADMIN_CREATED',
      entity: 'User',
      entityId: created.id,
      metadata: { loginId },
    });
    const summary = (await this.repos.users.listByTenant(tenantId)).find(
      (u) => u.id === created.id,
    );
    if (!summary)
      throw new DomainError('INTERNAL_ERROR', 'User created but could not be re-read.', 500);
    return summary;
  }

  async setUserStatus(
    actor: Actor,
    targetUserId: string,
    status: 'ACTIVE' | 'DISABLED',
    reason?: string,
  ): Promise<void> {
    const target = await this.repos.users.findById(targetUserId);
    if (!target) throw new DomainError('NOT_FOUND', 'User not found.', 404);
    await this.repos.users.updateStatus(targetUserId, status);
    if (status === 'DISABLED') {
      await this.repos.sessions.revokeAllForUser(targetUserId, 'ACCOUNT_DISABLED');
    }
    await this.repos.auditLogs.record({
      tenantId: target.tenantId,
      userId: actor.id,
      action: 'USER_STATUS_CHANGED',
      entity: 'User',
      entityId: targetUserId,
      metadata: { to: status, reason },
    });
  }

  /**
   * Secure admin-driven password reset: Master Admin sets a new password
   * meeting the same policy as everywhere else. Every existing session for
   * the target is revoked immediately so the reset takes effect right away.
   * A forced "must change password on next login" flag is deferred to a
   * later phase's first-login UX.
   */
  async resetPassword(actor: Actor, targetUserId: string, newPassword: string): Promise<void> {
    const target = await this.repos.users.findById(targetUserId);
    if (!target) throw new DomainError('NOT_FOUND', 'User not found.', 404);
    if (target.id === actor.id) {
      throw new DomainError(
        'FORBIDDEN',
        'Use the account settings flow to change your own password.',
        403,
      );
    }
    const passwordHash = await this.hasher.hash(newPassword);
    await this.repos.users.resetPassword(targetUserId, passwordHash);
    await this.repos.sessions.revokeAllForUser(targetUserId, 'PASSWORD_RESET');
    await this.repos.auditLogs.record({
      tenantId: target.tenantId,
      userId: actor.id,
      action: 'USER_PASSWORD_RESET',
      entity: 'User',
      entityId: targetUserId,
    });
  }
}
