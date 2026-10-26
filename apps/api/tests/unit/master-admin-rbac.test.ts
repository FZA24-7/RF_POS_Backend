import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { requirePlatformActor } from '../../src/http/middleware/require-platform-actor.js';
import { hasModuleAccess } from '../../src/rbac/modules.js';

const mockRes = () => {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
};

describe('requirePlatformActor', () => {
  it('401s with no auth context at all', () => {
    const req = {} as Request;
    const res = mockRes();
    const next = vi.fn();
    requirePlatformActor(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('403s a tenant-scoped token even if it somehow carries a platform permission key (defence in depth)', () => {
    const req = {
      auth: {
        userId: 'u1',
        tenantId: 'tenant-a', // NOT null - this is the key thing being defended against
        storeId: null,
        systemRole: 'CLIENT_MASTER_ADMIN',
        permissions: new Set(['tenants.view']), // hypothetically mis-granted
        sessionId: 's1',
      },
    } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();
    requirePlatformActor(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('403s a token claiming MASTER_ADMIN role but still carrying a tenantId (inconsistent token)', () => {
    const req = {
      auth: {
        userId: 'u1',
        tenantId: 'tenant-a',
        storeId: null,
        systemRole: 'MASTER_ADMIN',
        permissions: new Set(['tenants.view']),
        sessionId: 's1',
      },
    } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();
    requirePlatformActor(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('passes a genuine platform actor (MASTER_ADMIN, tenantId null)', () => {
    const req = {
      auth: {
        userId: 'u1',
        tenantId: null,
        storeId: null,
        systemRole: 'MASTER_ADMIN',
        permissions: new Set(['tenants.view']),
        sessionId: 's1',
      },
    } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();
    requirePlatformActor(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('hasModuleAccess', () => {
  it('true when the module is in the enabled set', () => {
    expect(hasModuleAccess(['pos', 'reports'], 'pos')).toBe(true);
  });
  it('false when it is not', () => {
    expect(hasModuleAccess(['reports'], 'pos')).toBe(false);
  });
  it('works with a Set as well as an array', () => {
    expect(hasModuleAccess(new Set(['inventory']), 'inventory')).toBe(true);
  });
});
