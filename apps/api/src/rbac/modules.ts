import type { ModuleKey } from '@mafk/shared';

/**
 * Server-side module gating. A tenant's License carries `enabledModules`;
 * this is the single function every future tenant-resource route (POS,
 * purchases, reports, ...) calls before doing any work, so disabling a
 * module for a tenant is enforced here, not just by hiding a nav item in the
 * UI. No route exists yet that consumes this (Phase 2 is Master-Admin-only),
 * but the enforcement point is built now so later phases plug into it
 * instead of re-deriving the rule.
 */
export const hasModuleAccess = (
  enabledModules: ReadonlySet<string> | readonly string[],
  module: ModuleKey,
): boolean => {
  const set = enabledModules instanceof Set ? enabledModules : new Set(enabledModules);
  return set.has(module);
};
