import { describe, expect, it } from 'vitest';
import {
  canChangeLoginId,
  getLoginIdEditState,
  isValidLoginIdFormat,
  normalizeLoginId,
} from '../src/login-id.js';
import type { PolicyActor } from '../src/login-id.js';

const master: PolicyActor = { id: 'm1', tenantId: null, systemRole: 'MASTER_ADMIN' };
const clientAdminA: PolicyActor = {
  id: 'ca1',
  tenantId: 'tenant-a',
  systemRole: 'CLIENT_MASTER_ADMIN',
};
const clientAdminB: PolicyActor = {
  id: 'ca2',
  tenantId: 'tenant-b',
  systemRole: 'CLIENT_MASTER_ADMIN',
};
const managerA: PolicyActor = { id: 'mg1', tenantId: 'tenant-a', systemRole: 'MANAGER' };
const cashierA: PolicyActor = { id: 'cs1', tenantId: 'tenant-a', systemRole: 'CASHIER' };
const inventoryA: PolicyActor = { id: 'iv1', tenantId: 'tenant-a', systemRole: 'INVENTORY_STAFF' };
const managerB: PolicyActor = { id: 'mg2', tenantId: 'tenant-b', systemRole: 'MANAGER' };

describe('normalizeLoginId / isValidLoginIdFormat', () => {
  it('lower-cases and trims', () => {
    expect(normalizeLoginId('  John.Doe  ')).toBe('john.doe');
  });
  it('accepts a well-formed id', () => {
    expect(isValidLoginIdFormat('john.doe-01')).toBe(true);
  });
  it.each(['ab', 'a'.repeat(33), '-startsWithDash', 'has space', 'has$symbol'])(
    'rejects malformed id: %s',
    (bad) => {
      expect(isValidLoginIdFormat(bad)).toBe(false);
    },
  );
});

describe('canChangeLoginId - nobody may edit their own', () => {
  it.each([
    ['Client Master Admin', clientAdminA],
    ['Manager', managerA],
    ['Cashier', cashierA],
    ['Inventory Staff', inventoryA],
    ['Master Admin', master],
  ])('%s cannot edit their own Login ID', (_label, actor) => {
    const decision = canChangeLoginId(actor, actor);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('LOGIN_ID_SELF_EDIT_FORBIDDEN');
  });
});

describe('canChangeLoginId - Client Master Admin authority', () => {
  it('can change Manager / Cashier / Inventory Staff in their own tenant', () => {
    expect(canChangeLoginId(clientAdminA, managerA).allowed).toBe(true);
    expect(canChangeLoginId(clientAdminA, cashierA).allowed).toBe(true);
    expect(canChangeLoginId(clientAdminA, inventoryA).allowed).toBe(true);
  });

  it('cannot change a user in a different tenant', () => {
    const decision = canChangeLoginId(clientAdminA, managerB);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('LOGIN_ID_TENANT_SCOPE');
  });

  it('cannot change another Client Master Admin, even in the same tenant', () => {
    const otherAdminSameTenant: PolicyActor = {
      id: 'ca3',
      tenantId: 'tenant-a',
      systemRole: 'CLIENT_MASTER_ADMIN',
    };
    const decision = canChangeLoginId(clientAdminA, otherAdminSameTenant);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('LOGIN_ID_CHANGE_FORBIDDEN');
  });

  it('Tenant B admin cannot reach into Tenant A', () => {
    expect(canChangeLoginId(clientAdminB, managerA).allowed).toBe(false);
  });
});

describe('canChangeLoginId - Master Admin authority', () => {
  it('can (re)assign any non-Master Login ID', () => {
    expect(canChangeLoginId(master, clientAdminA).allowed).toBe(true);
    expect(canChangeLoginId(master, managerA).allowed).toBe(true);
  });
  it('cannot change another Master Admin', () => {
    const otherMaster: PolicyActor = { id: 'm2', tenantId: null, systemRole: 'MASTER_ADMIN' };
    const decision = canChangeLoginId(master, otherMaster);
    expect(decision.allowed).toBe(false);
  });
});

describe('canChangeLoginId - everyone else is denied', () => {
  it('Manager cannot change a Cashier Login ID (no such authority in the spec)', () => {
    expect(canChangeLoginId(managerA, cashierA).allowed).toBe(false);
  });
  it('Cashier cannot change anyone', () => {
    expect(canChangeLoginId(cashierA, inventoryA).allowed).toBe(false);
  });
});

describe('getLoginIdEditState', () => {
  it('returns the LOCKED label for a non-editable target', () => {
    expect(getLoginIdEditState(clientAdminA, clientAdminA)).toEqual({
      editable: false,
      label: 'Login ID: LOCKED',
    });
  });
  it('returns editable with no label when allowed', () => {
    expect(getLoginIdEditState(clientAdminA, managerA)).toEqual({ editable: true, label: null });
  });
});
