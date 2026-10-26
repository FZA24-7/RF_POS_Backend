import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLE_PERMISSIONS,
  isGrantableToTenantRole,
  PERMISSION_CATALOG,
  TENANT_FORBIDDEN_PERMISSIONS,
} from '../src/permissions.js';

describe('PERMISSION_CATALOG', () => {
  it('has no duplicate keys', () => {
    expect(new Set(PERMISSION_CATALOG).size).toBe(PERMISSION_CATALOG.length);
  });

  it('includes the special, security-sensitive permissions from the spec', () => {
    for (const key of [
      'discount.apply',
      'sale.refund',
      'sale.void',
      'stock.adjust',
      'price.change',
      'users.manage',
      'licenses.manage',
    ]) {
      expect(PERMISSION_CATALOG).toContain(key);
    }
  });
});

describe('tenant role permission isolation from platform permissions', () => {
  it('never allows a tenant role to be granted a platform-only permission', () => {
    for (const key of DEFAULT_ROLE_PERMISSIONS.CLIENT_MASTER_ADMIN) {
      expect(TENANT_FORBIDDEN_PERMISSIONS.has(key)).toBe(false);
    }
  });

  it('rejects platform resources as grantable to tenant roles', () => {
    expect(isGrantableToTenantRole('tenants.view')).toBe(false);
    expect(isGrantableToTenantRole('system.edit')).toBe(false);
  });

  it('allows ordinary tenant resources', () => {
    expect(isGrantableToTenantRole('pos.create')).toBe(true);
    expect(isGrantableToTenantRole('products.view')).toBe(true);
  });
});

describe('DEFAULT_ROLE_PERMISSIONS - least privilege shape', () => {
  it('Cashier cannot manage users or products', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.CASHIER).not.toContain('users.manage');
    expect(DEFAULT_ROLE_PERMISSIONS.CASHIER).not.toContain('products.create');
  });

  it('Cashier can operate the POS and view sales', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.CASHIER).toContain('pos.create');
    expect(DEFAULT_ROLE_PERMISSIONS.CASHIER).toContain('sales.view');
  });

  it('Manager has refund and void authority; Cashier does not', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.MANAGER).toContain('sale.refund');
    expect(DEFAULT_ROLE_PERMISSIONS.MANAGER).toContain('sale.void');
    expect(DEFAULT_ROLE_PERMISSIONS.CASHIER).not.toContain('sale.refund');
    expect(DEFAULT_ROLE_PERMISSIONS.CASHIER).not.toContain('sale.void');
  });

  it('Inventory Staff can adjust stock but not run the POS', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.INVENTORY_STAFF).toContain('stock.adjust');
    expect(DEFAULT_ROLE_PERMISSIONS.INVENTORY_STAFF).not.toContain('pos.create');
  });

  it('Master Admin has license management; Client Master Admin does not', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.MASTER_ADMIN).toContain('licenses.manage');
    expect(DEFAULT_ROLE_PERMISSIONS.CLIENT_MASTER_ADMIN).not.toContain('licenses.manage');
  });
});
