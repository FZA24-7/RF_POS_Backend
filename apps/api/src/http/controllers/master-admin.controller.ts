import type { Request, Response } from 'express';
import type {
  CreateClientAdminInput,
  CreateLicenseInput,
  CreateTenantInput,
  ResetPasswordInput,
  TenantListQuery,
  UpdateLicenseInput,
  UpdateLicenseStatusInput,
  UpdateModulesInput,
  UpdateTenantInput,
  UpdateTenantStatusInput,
  UpdateUserStatusInput,
} from '@mafk/validation';
import type { TenantProvisioningService } from '../../services/tenant-provisioning.service.js';
import type { TenantManagementService } from '../../services/tenant-management.service.js';
import type { LicenseService } from '../../services/license.service.js';
import type { DashboardStatsService } from '../../services/dashboard-stats.service.js';
import { DomainError } from '../../domain/types.js';

const actorFrom = (req: Request): { id: string; tenantId: string | null } => {
  if (!req.auth) throw new DomainError('UNAUTHENTICATED', 'Authentication required.', 401);
  return { id: req.auth.userId, tenantId: req.auth.tenantId };
};

export const createMasterAdminController = (deps: {
  provisioning: TenantProvisioningService;
  tenants: TenantManagementService;
  licenses: LicenseService;
  stats: DashboardStatsService;
}) => ({
  async getStats(_req: Request, res: Response): Promise<void> {
    res.status(200).json(await deps.stats.getStats());
  },

  async listTenants(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as TenantListQuery;
    res.status(200).json(await deps.tenants.list(query));
  },

  async createTenant(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateTenantInput;
    const result = await deps.provisioning.createTenant(actorFrom(req), input);
    res.status(201).json(result);
  },

  async getTenant(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    res.status(200).json(await deps.tenants.getDetail(id));
  },

  async updateTenant(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    const patch = req.body as UpdateTenantInput;
    res.status(200).json(await deps.tenants.update(actorFrom(req), id, patch));
  },

  async updateTenantStatus(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    const { status, reason } = req.body as UpdateTenantStatusInput;
    res.status(200).json(await deps.tenants.updateStatus(actorFrom(req), id, status, reason));
  },

  async listTenantStores(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    res.status(200).json(await deps.tenants.listStores(id));
  },

  async listTenantUsers(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    res.status(200).json(await deps.tenants.listUsers(id));
  },

  async listTenantAuditLogs(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    res.status(200).json(await deps.tenants.listAuditLogs(id));
  },

  async createClientAdmin(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    const input = req.body as CreateClientAdminInput;
    const created = await deps.tenants.createClientAdmin(actorFrom(req), id, input);
    res.status(201).json(created);
  },

  async listTenantLicenses(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    res.status(200).json(await deps.licenses.listForTenant(id));
  },

  async createLicense(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    const input = req.body as CreateLicenseInput;
    const created = await deps.licenses.create(actorFrom(req), id, input);
    res.status(201).json(created);
  },

  async listAllLicenses(_req: Request, res: Response): Promise<void> {
    res.status(200).json(await deps.licenses.listAll());
  },

  async updateLicense(req: Request, res: Response): Promise<void> {
    const { licenseId } = req.params as { licenseId: string };
    const patch = req.body as UpdateLicenseInput;
    res.status(200).json(await deps.licenses.update(actorFrom(req), licenseId, patch));
  },

  async updateLicenseStatus(req: Request, res: Response): Promise<void> {
    const { licenseId } = req.params as { licenseId: string };
    const { status } = req.body as UpdateLicenseStatusInput;
    res.status(200).json(await deps.licenses.updateStatus(actorFrom(req), licenseId, status));
  },

  async updateLicenseModules(req: Request, res: Response): Promise<void> {
    const { licenseId } = req.params as { licenseId: string };
    const { enabledModules } = req.body as UpdateModulesInput;
    res
      .status(200)
      .json(await deps.licenses.updateModules(actorFrom(req), licenseId, enabledModules));
  },

  async setUserStatus(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    const { status, reason } = req.body as UpdateUserStatusInput;
    await deps.tenants.setUserStatus(actorFrom(req), id, status, reason);
    res.status(204).send();
  },

  async resetPassword(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    const { newPassword } = req.body as ResetPasswordInput;
    await deps.tenants.resetPassword(actorFrom(req), id, newPassword);
    res.status(204).send();
  },
});
