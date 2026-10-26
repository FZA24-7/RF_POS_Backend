import { canChangeLoginId, isValidLoginIdFormat, normalizeLoginId } from '@mafk/shared';
import type { PolicyActor } from '@mafk/shared';
import type { Repositories } from '../domain/ports.js';
import { DomainError } from '../domain/types.js';

export interface ChangeLoginIdRequest {
  actor: PolicyActor;
  targetUserId: string;
  newLoginId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Enforces, end to end, the rule set from the product spec:
 *  - nobody may change their own Login ID (Client Master Admin, Manager, Cashier, Inventory Staff)
 *  - a Client Master Admin may change Manager / Cashier / Inventory Staff / Custom users in their own tenant
 *  - Master Admin may (re)assign any non-Master Login ID
 *  - every change is validated for format + uniqueness and produces an audit record
 *  - history is kept so past transactions remain linked to the correct identity (via immutable User.id)
 */
export class LoginIdService {
  constructor(private readonly repos: Repositories) {}

  async changeLoginId(req: ChangeLoginIdRequest): Promise<{ loginId: string }> {
    const target = await this.repos.users.findById(req.targetUserId);
    if (!target) {
      throw new DomainError('NOT_FOUND', 'User not found.', 404);
    }

    const targetActor: PolicyActor = {
      id: target.id,
      tenantId: target.tenantId,
      systemRole: target.systemRole,
    };

    const decision = canChangeLoginId(req.actor, targetActor);
    if (!decision.allowed) {
      throw new DomainError(decision.code, decision.message, 403);
    }

    if (!isValidLoginIdFormat(req.newLoginId)) {
      throw new DomainError(
        'LOGIN_ID_INVALID',
        'Login ID must be 3-32 characters: letters, numbers, dot, dash or underscore, starting alphanumeric.',
        422,
      );
    }
    const newLoginId = normalizeLoginId(req.newLoginId);

    if (newLoginId === target.loginId) {
      throw new DomainError('CONFLICT', 'New Login ID is the same as the current one.', 409);
    }

    const taken = await this.repos.users.existsByLoginId(newLoginId);
    if (taken) {
      throw new DomainError('LOGIN_ID_TAKEN', 'This Login ID is already in use.', 409);
    }

    const oldLoginId = target.loginId;
    await this.repos.users.updateLoginId(target.id, newLoginId);
    await this.repos.loginIdHistory.record({
      tenantId: target.tenantId,
      userId: target.id,
      oldLoginId,
      newLoginId,
      changedById: req.actor.id,
    });
    await this.repos.auditLogs.record({
      tenantId: target.tenantId,
      userId: req.actor.id,
      action: 'USER_LOGIN_ID_CHANGED',
      entity: 'User',
      entityId: target.id,
      metadata: { oldLoginId, newLoginId },
      ipAddress: req.ipAddress,
      userAgent: req.userAgent,
    });

    return { loginId: newLoginId };
  }
}
