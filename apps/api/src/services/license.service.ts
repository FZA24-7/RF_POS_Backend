import { resolveLicenseStatus, sanitizeModuleKeys } from '@mafk/shared';
import type { CreateLicenseInput, UpdateLicenseInput } from '@mafk/validation';
import type { Repositories } from '../domain/ports.js';
import { DomainError, type LicenseSummary } from '../domain/types.js';

export interface Actor {
  id: string;
}

const withResolvedStatus = (license: LicenseSummary, now: Date): LicenseSummary => ({
  ...license,
  status: resolveLicenseStatus({ storedStatus: license.status, expiresAt: license.expiresAt }, now),
});

/**
 * Every read path re-resolves the effective status via the shared, pure
 * `resolveLicenseStatus` function rather than trusting the stored column, so
 * "EXPIRED" is never something the frontend has to compute itself, and a
 * stale ACTIVE flag can never leak out of this service.
 */
export class LicenseService {
  constructor(
    private readonly repos: Repositories,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listAll(): Promise<LicenseSummary[]> {
    const all = await this.repos.licenses.listAll();
    const now = this.now();
    return all.map((l) => withResolvedStatus(l, now));
  }

  async listForTenant(tenantId: string): Promise<LicenseSummary[]> {
    const all = await this.repos.licenses.listByTenant(tenantId);
    const now = this.now();
    return all.map((l) => withResolvedStatus(l, now));
  }

  async create(actor: Actor, tenantId: string, input: CreateLicenseInput): Promise<LicenseSummary> {
    const created = await this.repos.licenses.create(tenantId, {
      planCode: input.planCode,
      expiresAt: input.expiresAt,
      maxUsers: input.maxUsers,
      maxDevices: input.maxDevices,
      maxStores: input.maxStores,
      enabledModules: sanitizeModuleKeys(input.enabledModules),
    });
    await this.repos.auditLogs.record({
      tenantId,
      userId: actor.id,
      action: 'LICENSE_CREATED',
      entity: 'License',
      entityId: created.id,
      metadata: { planCode: input.planCode, expiresAt: input.expiresAt.toISOString() },
    });
    return withResolvedStatus(created, this.now());
  }

  private async requireLicense(id: string): Promise<LicenseSummary> {
    const license = await this.repos.licenses.findById(id);
    if (!license) throw new DomainError('NOT_FOUND', 'License not found.', 404);
    return license;
  }

  async update(actor: Actor, id: string, patch: UpdateLicenseInput): Promise<LicenseSummary> {
    const before = await this.requireLicense(id);
    await this.repos.licenses.update(id, patch);
    await this.repos.auditLogs.record({
      tenantId: before.tenantId,
      userId: actor.id,
      action: 'LICENSE_UPDATED',
      entity: 'License',
      entityId: id,
      metadata: { patch: { ...patch, expiresAt: patch.expiresAt?.toISOString() } },
    });
    return withResolvedStatus(await this.requireLicense(id), this.now());
  }

  async updateStatus(
    actor: Actor,
    id: string,
    status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED',
  ): Promise<LicenseSummary> {
    const before = await this.requireLicense(id);
    await this.repos.licenses.updateStatus(id, status);
    await this.repos.auditLogs.record({
      tenantId: before.tenantId,
      userId: actor.id,
      action: 'LICENSE_STATUS_CHANGED',
      entity: 'License',
      entityId: id,
      metadata: { from: before.status, to: status },
    });
    return withResolvedStatus(await this.requireLicense(id), this.now());
  }

  /** Module Management: enable/disable which tenant modules this license grants. */
  async updateModules(
    actor: Actor,
    id: string,
    enabledModules: readonly string[],
  ): Promise<LicenseSummary> {
    const before = await this.requireLicense(id);
    const sanitized = sanitizeModuleKeys(enabledModules);
    await this.repos.licenses.updateModules(id, sanitized);
    await this.repos.auditLogs.record({
      tenantId: before.tenantId,
      userId: actor.id,
      action: 'MODULES_UPDATED',
      entity: 'License',
      entityId: id,
      metadata: { from: before.enabledModules, to: sanitized },
    });
    return withResolvedStatus(await this.requireLicense(id), this.now());
  }
}
