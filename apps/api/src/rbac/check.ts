/**
 * Pure permission-checking logic. Deliberately has zero dependency on Express,
 * Prisma, or any I/O so it can be unit tested in isolation and reused by both
 * the HTTP middleware and any future channel (Electron IPC, background jobs).
 */
export const hasPermission = (granted: ReadonlySet<string>, required: string): boolean =>
  granted.has(required);

export const hasAnyPermission = (
  granted: ReadonlySet<string>,
  required: readonly string[],
): boolean => required.some((p) => granted.has(p));

export const hasAllPermissions = (
  granted: ReadonlySet<string>,
  required: readonly string[],
): boolean => required.every((p) => granted.has(p));
