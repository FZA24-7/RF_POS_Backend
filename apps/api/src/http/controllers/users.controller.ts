import type { Request, Response } from 'express';
import type { ChangeLoginIdInput } from '@mafk/validation';
import { getLoginIdEditState } from '@mafk/shared';
import type { PolicyActor } from '@mafk/shared';
import type { LoginIdService } from '../../services/login-id.service.js';
import type { UserRepository } from '../../domain/ports.js';
import { DomainError } from '../../domain/types.js';

const actorFromAuth = (req: Request): PolicyActor => {
  if (!req.auth) throw new DomainError('UNAUTHENTICATED', 'Authentication required.', 401);
  return { id: req.auth.userId, tenantId: req.auth.tenantId, systemRole: req.auth.systemRole };
};

export const createUsersController = (loginIdService: LoginIdService, users: UserRepository) => ({
  async changeLoginId(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    const { newLoginId } = req.body as ChangeLoginIdInput;
    const result = await loginIdService.changeLoginId({
      actor: actorFromAuth(req),
      targetUserId: id,
      newLoginId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });
    res.status(200).json(result);
  },

  /** Tells a client UI whether to render the Login ID field editable, or "Login ID: LOCKED". */
  async loginIdEditState(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    const target = await users.findById(id);
    if (!target) throw new DomainError('NOT_FOUND', 'User not found.', 404);
    const viewer = actorFromAuth(req);
    const targetActor: PolicyActor = {
      id: target.id,
      tenantId: target.tenantId,
      systemRole: target.systemRole,
    };
    res.status(200).json(getLoginIdEditState(viewer, targetActor));
  },
});
