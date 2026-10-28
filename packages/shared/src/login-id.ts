import type { SystemRole } from './roles.js';
import { isClientStaffRole } from './roles.js';

/** Login IDs are stored lower-case, 3-32 chars, start alphanumeric, then [a-z0-9._-]. */
export const LOGIN_ID_REGEX = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const LOGIN_ID_LOCKED_LABEL = 'Login ID: LOCKED';

export const normalizeLoginId = (raw: string): string => raw.trim().toLowerCase();

export const isValidLoginIdFormat = (raw: string): boolean =>
  LOGIN_ID_REGEX.test(normalizeLoginId(raw));

/** Minimal shape the policy needs. Deliberately independent of Prisma. */
export interface PolicyActor {
  id: string;
  tenantId: string | null;
  systemRole: SystemRole;
}

export type LoginIdDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: 'LOGIN_ID_SELF_EDIT_FORBIDDEN' | 'LOGIN_ID_CHANGE_FORBIDDEN' | 'LOGIN_ID_TENANT_SCOPE';
      message: string;
    };

const deny = (
  code: Extract<LoginIdDecision, { allowed: false }>['code'],
  message: string,
): LoginIdDecision => ({ allowed: false, code, message });

/**
 * Single source of truth for "may `actor` change `target`'s Login ID?".
 *  - Nobody (Client Master Admin, Manager, Cashier, Inventory Staff, Custom, Master) can edit their OWN Login ID.
 *  - Master Admin can change any non-master user's Login ID (this is how a Client Master Admin's ID is assigned/corrected).
 *  - Client Master Admin can change Manager / Cashier / Inventory Staff / Custom users - inside their own tenant only.
 *  - Everyone else: denied.
 */
export const canChangeLoginId = (actor: PolicyActor, target: PolicyActor): LoginIdDecision => {
  if (actor.id === target.id) {
    return deny('LOGIN_ID_SELF_EDIT_FORBIDDEN', 'You cannot change your own Login ID.');
  }
  if (actor.systemRole === 'MASTER_ADMIN') {
    return target.systemRole === 'MASTER_ADMIN'
      ? deny('LOGIN_ID_CHANGE_FORBIDDEN', 'Master Admin Login IDs cannot be changed this way.')
      : { allowed: true };
  }
  if (actor.systemRole === 'CLIENT_MASTER_ADMIN') {
    if (actor.tenantId === null || actor.tenantId !== target.tenantId) {
      return deny('LOGIN_ID_TENANT_SCOPE', 'User not found in your tenant.');
    }
    return isClientStaffRole(target.systemRole)
      ? { allowed: true }
      : deny(
          'LOGIN_ID_CHANGE_FORBIDDEN',
          'Only Manager, Cashier, Inventory Staff and custom-role Login IDs can be changed.',
        );
  }
  return deny('LOGIN_ID_CHANGE_FORBIDDEN', 'You are not allowed to change Login IDs.');
};

/** What a UI should render next to a user's Login ID for the given viewer. */
export const getLoginIdEditState = (
  viewer: PolicyActor,
  target: PolicyActor,
): { editable: boolean; label: string | null } => {
  const decision = canChangeLoginId(viewer, target);
  if (decision.allowed) return { editable: true, label: null };
  return { editable: false, label: LOGIN_ID_LOCKED_LABEL };
};
