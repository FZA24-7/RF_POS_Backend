/** System roles. Mirrors the Prisma `SystemRole` enum. */
export const SYSTEM_ROLES = [
  'MASTER_ADMIN',
  'CLIENT_MASTER_ADMIN',
  'MANAGER',
  'CASHIER',
  'INVENTORY_STAFF',
  'CUSTOM',
] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

/** Roles a Client Master Admin may create/manage inside their own tenant. */
export const CLIENT_STAFF_ROLES: readonly SystemRole[] = [
  'MANAGER',
  'CASHIER',
  'INVENTORY_STAFF',
  'CUSTOM',
];

export const ROLE_LABELS: Record<SystemRole, string> = {
  MASTER_ADMIN: 'Master Admin',
  CLIENT_MASTER_ADMIN: 'Client Master Admin',
  MANAGER: 'Manager',
  CASHIER: 'Cashier',
  INVENTORY_STAFF: 'Inventory Staff',
  CUSTOM: 'Custom Role',
};

export const isClientStaffRole = (role: SystemRole): boolean => CLIENT_STAFF_ROLES.includes(role);
