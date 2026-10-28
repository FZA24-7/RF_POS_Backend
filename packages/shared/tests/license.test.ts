import { describe, expect, it } from 'vitest';
import { isLicenseExpiringSoon, isLicenseUsable, resolveLicenseStatus } from '../src/license.js';

const day = 86_400_000;
const now = new Date('2026-01-01T00:00:00Z');

describe('resolveLicenseStatus', () => {
  it('is ACTIVE when stored ACTIVE and not yet expired', () => {
    expect(
      resolveLicenseStatus(
        { storedStatus: 'ACTIVE', expiresAt: new Date(now.getTime() + day) },
        now,
      ),
    ).toBe('ACTIVE');
  });

  it('is EXPIRED when stored ACTIVE but the expiry date has passed (stale flag never wins)', () => {
    expect(
      resolveLicenseStatus(
        { storedStatus: 'ACTIVE', expiresAt: new Date(now.getTime() - day) },
        now,
      ),
    ).toBe('EXPIRED');
  });

  it('treats the exact expiry instant as already expired', () => {
    expect(resolveLicenseStatus({ storedStatus: 'ACTIVE', expiresAt: now }, now)).toBe('EXPIRED');
  });

  it('SUSPENDED always wins, even if not yet expired', () => {
    expect(
      resolveLicenseStatus(
        { storedStatus: 'SUSPENDED', expiresAt: new Date(now.getTime() + day) },
        now,
      ),
    ).toBe('SUSPENDED');
  });

  it('REVOKED always wins', () => {
    expect(
      resolveLicenseStatus(
        { storedStatus: 'REVOKED', expiresAt: new Date(now.getTime() + day) },
        now,
      ),
    ).toBe('REVOKED');
  });
});

describe('isLicenseUsable', () => {
  it('true only for effectively-ACTIVE', () => {
    expect(
      isLicenseUsable({ storedStatus: 'ACTIVE', expiresAt: new Date(now.getTime() + day) }, now),
    ).toBe(true);
    expect(
      isLicenseUsable({ storedStatus: 'ACTIVE', expiresAt: new Date(now.getTime() - day) }, now),
    ).toBe(false);
  });
});

describe('isLicenseExpiringSoon', () => {
  it('true when active and within the window', () => {
    expect(
      isLicenseExpiringSoon(
        { storedStatus: 'ACTIVE', expiresAt: new Date(now.getTime() + 3 * day) },
        7,
        now,
      ),
    ).toBe(true);
  });
  it('false when active but outside the window', () => {
    expect(
      isLicenseExpiringSoon(
        { storedStatus: 'ACTIVE', expiresAt: new Date(now.getTime() + 30 * day) },
        7,
        now,
      ),
    ).toBe(false);
  });
  it('false when already expired (that is a different bucket, not "expiring soon")', () => {
    expect(
      isLicenseExpiringSoon(
        { storedStatus: 'ACTIVE', expiresAt: new Date(now.getTime() - day) },
        7,
        now,
      ),
    ).toBe(false);
  });
});
