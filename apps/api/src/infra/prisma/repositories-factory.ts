// Single place that wires every port to its Prisma adapter, so production and the real-PostgreSQL integration
// tests build the repositories identically.
import type { PrismaClient } from '@mafk/database';
import type { Repositories } from '../../domain/ports.js';
import {
  PrismaAuditLogRepository,
  PrismaLoginAttemptRepository,
  PrismaLoginIdHistoryRepository,
  PrismaRoleRepository,
  PrismaSessionRepository,
  PrismaTenantRepository,
  PrismaUserRepository,
} from './repositories.js';
import {
  PrismaLicenseRepository,
  PrismaStoreRepository,
  PrismaSystemHealthRepository,
  PrismaTenantProvisioningRepository,
} from './master-admin-repositories.js';
import {
  PrismaBarcodeRepository,
  PrismaBrandRepository,
  PrismaCategoryRepository,
  PrismaInventoryRepository,
  PrismaProductRepository,
  PrismaSubDepartmentRepository,
} from './catalog-repositories.js';
import { PrismaCustomerRepository } from './customer-repositories.js';
import {
  PrismaEmployeeRepository,
  PrismaExpenseRepository,
} from './expense-employee-repositories.js';
import { PrismaReportRepository } from './report-repositories.js';
import { PrismaSaleRepository } from './sale-repositories.js';
import { PrismaPurchaseRepository, PrismaSupplierRepository } from './purchase-repositories.js';

export const createPrismaRepositories = (prisma: PrismaClient): Repositories => ({
  users: new PrismaUserRepository(prisma),
  roles: new PrismaRoleRepository(prisma),
  tenants: new PrismaTenantRepository(prisma),
  sessions: new PrismaSessionRepository(prisma),
  loginAttempts: new PrismaLoginAttemptRepository(prisma),
  auditLogs: new PrismaAuditLogRepository(prisma),
  loginIdHistory: new PrismaLoginIdHistoryRepository(prisma),
  tenantProvisioning: new PrismaTenantProvisioningRepository(prisma),
  stores: new PrismaStoreRepository(prisma),
  licenses: new PrismaLicenseRepository(prisma),
  systemHealth: new PrismaSystemHealthRepository(prisma),
  categories: new PrismaCategoryRepository(prisma),
  subDepartments: new PrismaSubDepartmentRepository(prisma),
  brands: new PrismaBrandRepository(prisma),
  products: new PrismaProductRepository(prisma),
  barcodes: new PrismaBarcodeRepository(prisma),
  inventory: new PrismaInventoryRepository(prisma),
  suppliers: new PrismaSupplierRepository(prisma),
  purchases: new PrismaPurchaseRepository(prisma),
  sales: new PrismaSaleRepository(prisma),
  customers: new PrismaCustomerRepository(prisma),
  expenses: new PrismaExpenseRepository(prisma),
  employees: new PrismaEmployeeRepository(prisma),
  reports: new PrismaReportRepository(prisma),
});
