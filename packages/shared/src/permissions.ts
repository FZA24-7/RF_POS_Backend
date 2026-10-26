import type { SystemRole } from './roles.js';

/** Generic CRUD-style actions. */
export const ACTIONS = ['view', 'create', 'edit', 'delete', 'export', 'print', 'approve'] as const;
export type Action = (typeof ACTIONS)[number];

/** Tenant (client) resources. */
export const TENANT_RESOURCES = [
  'dashboard',
  'pos',
  'sales',
  'sale_returns',
  'products',
  'categories',
  'sub_departments',
  'brands',
  'inventory',
  'purchases',
  'suppliers',
  'customers',
  'expenses',
  'employees',
  'barcode',
  'reports',
  'analytics',
  'audit',
  'settings',
  'users',
  'roles',
  'stores',
  'devices',
  'licenses',
] as const;

/** Platform-only resources (Master Admin). */
export const PLATFORM_RESOURCES = ['tenants', 'system'] as const;

/** Special, security-sensitive permissions (not part of the generic grid). */
export const SPECIAL_PERMISSIONS = [
  'discount.apply',
  'sale.refund',
  'sale.void',
  'stock.adjust',
  'price.change',
  'users.manage',
  'licenses.manage',
] as const;

const grid = (resources: readonly string[]): string[] =>
  resources.flatMap((r) => ACTIONS.map((a) => `${r}.${a}`));

export const PLATFORM_PERMISSION_KEYS: readonly string[] = [
  ...grid(PLATFORM_RESOURCES),
  'licenses.manage',
];

/** Every permission that exists. Seeded into the `permissions` table. */
export const PERMISSION_CATALOG: readonly string[] = Array.from(
  new Set([...grid(TENANT_RESOURCES), ...grid(PLATFORM_RESOURCES), ...SPECIAL_PERMISSIONS]),
);
export type PermissionKey = string;

export const parsePermissionKey = (key: string): { resource: string; action: string } => {
  const idx = key.indexOf('.');
  return { resource: key.slice(0, idx), action: key.slice(idx + 1) };
};

/** Permissions that may never be granted to tenant roles (platform-only). */
export const TENANT_FORBIDDEN_PERMISSIONS: ReadonlySet<string> = new Set([
  ...PLATFORM_PERMISSION_KEYS,
  ...ACTIONS.filter((a) => a !== 'view').map((a) => `licenses.${a}`),
]);

export const isGrantableToTenantRole = (key: string): boolean =>
  PERMISSION_CATALOG.includes(key) && !TENANT_FORBIDDEN_PERMISSIONS.has(key);

const only = (resources: readonly string[], actions: readonly Action[]): string[] =>
  resources.flatMap((r) => actions.map((a) => `${r}.${a}`));

const clientAdmin = PERMISSION_CATALOG.filter((k) => isGrantableToTenantRole(k));

/**
 * Default permission templates applied when a tenant is provisioned.
 * They are COPIED into each tenant's own role rows and can be changed there.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<Exclude<SystemRole, 'CUSTOM'>, readonly string[]> = {
  MASTER_ADMIN: [
    ...grid(PLATFORM_RESOURCES),
    'licenses.manage',
    'licenses.view',
    'users.view',
    'users.manage',
    'audit.view',
    'audit.export',
  ],
  CLIENT_MASTER_ADMIN: clientAdmin,
  MANAGER: [
    ...only(
      [
        'dashboard',
        'sales',
        'sale_returns',
        'products',
        'categories',
        'sub_departments',
        'brands',
        'inventory',
        'purchases',
        'suppliers',
        'customers',
        'expenses',
        'employees',
        'barcode',
        'reports',
        'analytics',
      ],
      ['view', 'create', 'edit', 'export', 'print'],
    ),
    ...only(['pos'], ['view', 'create', 'print']),
    ...only(['purchases', 'sale_returns', 'sales'], ['approve']),
    'users.view',
    'stores.view',
    'settings.view',
    'audit.view',
    'discount.apply',
    'sale.refund',
    'sale.void',
    'stock.adjust',
    'price.change',
  ],
  CASHIER: [
    'dashboard.view',
    ...only(['pos'], ['view', 'create', 'print']),
    ...only(['sales'], ['view', 'print']),
    ...only(['customers'], ['view', 'create']),
    'products.view',
    'inventory.view',
    'barcode.view',
  ],
  INVENTORY_STAFF: [
    'dashboard.view',
    ...only(
      ['products', 'categories', 'sub_departments', 'brands', 'barcode'],
      ['view', 'create', 'edit', 'export', 'print'],
    ),
    ...only(['inventory'], ['view', 'create', 'edit', 'export']),
    ...only(['purchases'], ['view', 'create', 'print']),
    'suppliers.view',
    'stock.adjust',
  ],
};

export const ROLE_DISPLAY: Record<Exclude<SystemRole, 'CUSTOM'>, { key: string; name: string }> = {
  MASTER_ADMIN: { key: 'master-admin', name: 'Master Admin' },
  CLIENT_MASTER_ADMIN: { key: 'client-master-admin', name: 'Client Master Admin' },
  MANAGER: { key: 'manager', name: 'Manager' },
  CASHIER: { key: 'cashier', name: 'Cashier' },
  INVENTORY_STAFF: { key: 'inventory-staff', name: 'Inventory Staff' },
};
