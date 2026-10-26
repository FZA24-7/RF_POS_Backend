/**
 * The set of tenant-facing modules that a License can enable/disable.
 * This is the single source of truth - both the Master Admin module-management
 * UI and the backend `requireModule` enforcement (apps/api/src/rbac/modules.ts)
 * read from this list, so a module can never be "hidden in the UI" without
 * also being blocked server-side.
 */
export const MODULE_CATALOG = [
  'pos',
  'sales',
  'inventory',
  'purchases',
  'customers',
  'suppliers',
  'expenses',
  'employees',
  'reports',
  'analytics',
] as const;

export type ModuleKey = (typeof MODULE_CATALOG)[number];

export const isValidModuleKey = (key: string): key is ModuleKey =>
  (MODULE_CATALOG as readonly string[]).includes(key);

/** Every new tenant starts with the full module set enabled; Master Admin can later restrict it. */
export const DEFAULT_ENABLED_MODULES: readonly ModuleKey[] = [...MODULE_CATALOG];

export const sanitizeModuleKeys = (keys: readonly string[]): ModuleKey[] =>
  Array.from(new Set(keys.filter(isValidModuleKey)));
