import { normalizeLoginId } from '@mafk/shared';
import type { CreateTenantInput } from '@mafk/validation';
import type { Repositories } from '../domain/ports.js';
import {
  DomainError,
  ProvisioningConflictError,
  type ProvisionTenantResult,
} from '../domain/types.js';
import type { PasswordHasher } from '../security/password.js';

export interface ProvisionActor {
  id: string;
}

/**
 * Master Admin "Create Client" flow. Delegates the actual multi-table write
 * to `repos.tenantProvisioning.provision`, which both implementations
 * (Prisma `$transaction`, in-memory fake) guarantee is all-or-nothing - see
 * the port's doc comment in `domain/ports.ts`. This service's job is:
 * validate input, hash the password (a security concern, not a persistence
 * one - it does NOT belong inside the repository), and record the audit
 * entry only after the transaction has genuinely committed.
 */
export class TenantProvisioningService {
  constructor(
    private readonly repos: Repositories,
    private readonly hasher: PasswordHasher,
  ) {}

  async createTenant(
    actor: ProvisionActor,
    input: CreateTenantInput,
  ): Promise<ProvisionTenantResult> {
    const code = input.code.trim().toUpperCase();
    const loginId = normalizeLoginId(input.masterAdmin.loginId);

    if (await this.repos.tenants.existsByCode(code)) {
      throw new DomainError('CONFLICT', `Tenant code "${code}" is already in use.`, 409);
    }
    if (await this.repos.users.existsByLoginId(loginId)) {
      throw new DomainError('LOGIN_ID_TAKEN', `Login ID "${loginId}" is already in use.`, 409);
    }

    const passwordHash = await this.hasher.hash(input.masterAdmin.password);

    let result: ProvisionTenantResult;
    try {
      result = await this.repos.tenantProvisioning.provision({
        code,
        name: input.name,
        legalName: input.legalName,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        address: input.address,
        currency: input.currency,
        timezone: input.timezone,
        defaultStoreName: input.defaultStoreName,
        masterAdmin: {
          loginId,
          passwordHash,
          displayName: input.masterAdmin.displayName,
          email: input.masterAdmin.email,
        },
        license: {
          planCode: input.license.planCode,
          expiresAt: input.license.expiresAt,
          maxUsers: input.license.maxUsers,
          maxDevices: input.license.maxDevices,
          maxStores: input.license.maxStores,
          enabledModules: input.license.enabledModules,
        },
      });
    } catch (err) {
      // A conflict detected DURING the atomic operation (e.g. a race with
      // another request) - nothing was left half-created; surface it as the
      // same client-facing conflict error as the pre-checks above.
      if (err instanceof ProvisioningConflictError) {
        throw new DomainError(
          err.field === 'code' ? 'CONFLICT' : 'LOGIN_ID_TAKEN',
          err.message,
          409,
        );
      }
      throw err;
    }

    await this.repos.auditLogs.record({
      tenantId: result.tenantId,
      userId: actor.id,
      action: 'TENANT_CREATED',
      entity: 'Tenant',
      entityId: result.tenantId,
      metadata: { code, name: input.name, clientAdminLoginId: loginId },
    });

    return result;
  }
}
