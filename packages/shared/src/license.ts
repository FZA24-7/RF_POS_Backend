export const LICENSE_STATUSES = ['ACTIVE', 'EXPIRED', 'SUSPENDED', 'REVOKED'] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export interface LicenseFacts {
  /** The status as stored in the database (an operator's explicit action: suspend/revoke/reactivate). */
  storedStatus: LicenseStatus;
  expiresAt: Date;
}

/**
 * Resolves the EFFECTIVE license status. A license an operator marked ACTIVE
 * is still not usable once `expiresAt` has passed - "expired" always wins
 * over a stale ACTIVE flag, so status is represented consistently everywhere
 * (dashboard stats, tenant detail, any future login-time check) rather than
 * trusting whichever value happens to be sitting in the column.
 *
 * SUSPENDED and REVOKED are explicit operator actions and always take
 * precedence, even over a not-yet-expired date.
 */
export const resolveLicenseStatus = (
  license: LicenseFacts,
  now: Date = new Date(),
): LicenseStatus => {
  if (license.storedStatus === 'SUSPENDED' || license.storedStatus === 'REVOKED') {
    return license.storedStatus;
  }
  if (license.expiresAt.getTime() <= now.getTime()) {
    return 'EXPIRED';
  }
  return 'ACTIVE';
};

export const isLicenseUsable = (license: LicenseFacts, now: Date = new Date()): boolean =>
  resolveLicenseStatus(license, now) === 'ACTIVE';

/** Convenience for dashboards: is this license within `withinDays` of expiring (and not already expired)? */
export const isLicenseExpiringSoon = (
  license: LicenseFacts,
  withinDays: number,
  now: Date = new Date(),
): boolean => {
  const status = resolveLicenseStatus(license, now);
  if (status !== 'ACTIVE') return false;
  const msRemaining = license.expiresAt.getTime() - now.getTime();
  return msRemaining <= withinDays * 86_400_000;
};
