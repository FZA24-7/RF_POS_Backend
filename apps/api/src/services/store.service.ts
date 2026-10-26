import type { Repositories } from '../domain/ports.js';
import type { StoreSummary } from '../domain/types.js';

/** Tenant-side view of a tenant's own branches (distinct from the Master Admin view in tenant-management.service.ts). */
export class StoreService {
  constructor(private readonly repos: Repositories) {}

  async list(tenantId: string): Promise<StoreSummary[]> {
    return this.repos.stores.listByTenant(tenantId);
  }
}
