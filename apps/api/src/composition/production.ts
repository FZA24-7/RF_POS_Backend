// DATABASE STATUS (Phase 4.2): the built API booted from this composition against PostgreSQL 16 and served login,
// refresh, /auth/me and logout. Only the adapters named as exercised in infra/prisma/*.ts have been run on a database.
import type { Env } from '../config/env.js';
import type { Logger } from '../logger.js';
import type { Repositories } from '../domain/ports.js';
import { buildPrismaClient } from '../infra/prisma/client.js';
import { createPrismaRepositories } from '../infra/prisma/repositories-factory.js';
import { PasswordHasher } from '../security/password.js';
import { JoseAccessTokenService } from '../security/jwt.js';
import { AuthService } from '../services/auth.service.js';
import { LoginIdService } from '../services/login-id.service.js';
import { TenantProvisioningService } from '../services/tenant-provisioning.service.js';
import { TenantManagementService } from '../services/tenant-management.service.js';
import { LicenseService } from '../services/license.service.js';
import { DashboardStatsService } from '../services/dashboard-stats.service.js';
import { CategoryService } from '../services/category.service.js';
import { SubDepartmentService } from '../services/sub-department.service.js';
import { BrandService } from '../services/brand.service.js';
import { ProductService } from '../services/product.service.js';
import { BarcodeService } from '../services/barcode.service.js';
import { ProductImportService } from '../services/product-import.service.js';
import { InventoryService } from '../services/inventory.service.js';
import { StoreService } from '../services/store.service.js';
import { CustomerService } from '../services/customer.service.js';
import { EmployeeService } from '../services/employee.service.js';
import { ExpenseService } from '../services/expense.service.js';
import { ReportService } from '../services/report.service.js';
import { SupplierService } from '../services/supplier.service.js';
import { PurchaseService } from '../services/purchase.service.js';
import { SaleService } from '../services/sale.service.js';
import { createApp } from '../http/app.js';

export const buildProductionApp = (env: Env, logger: Logger) => {
  const prisma = buildPrismaClient(env.DATABASE_URL);

  const repos: Repositories = createPrismaRepositories(prisma);

  const hasher = new PasswordHasher({
    memoryCostKib: env.ARGON2_MEMORY_KIB,
    timeCost: env.ARGON2_TIME_COST,
  });
  const accessTokens = new JoseAccessTokenService(env.JWT_SECRET, env.ACCESS_TOKEN_TTL_MINUTES);
  const authService = new AuthService(repos, hasher, accessTokens, {
    maxFailedAttempts: env.LOGIN_MAX_FAILED_ATTEMPTS,
    lockoutWindowMs: env.LOGIN_LOCKOUT_MINUTES * 60_000,
    accessTokenTtlMinutes: env.ACCESS_TOKEN_TTL_MINUTES,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
  });
  const loginIdService = new LoginIdService(repos);
  const tenantProvisioningService = new TenantProvisioningService(repos, hasher);
  const tenantManagementService = new TenantManagementService(repos, hasher);
  const licenseService = new LicenseService(repos);
  const dashboardStatsService = new DashboardStatsService(repos);
  const categoryService = new CategoryService(repos);
  const subDepartmentService = new SubDepartmentService(repos);
  const brandService = new BrandService(repos);
  const productService = new ProductService(repos);
  const barcodeService = new BarcodeService(repos);
  const productImportService = new ProductImportService(repos);
  const inventoryService = new InventoryService(repos);
  const storeService = new StoreService(repos);
  const supplierService = new SupplierService(repos);
  const purchaseService = new PurchaseService(repos);
  const saleService = new SaleService(repos);
  const customerService = new CustomerService(repos);
  const expenseService = new ExpenseService(repos);
  const employeeService = new EmployeeService(repos);
  const reportService = new ReportService(repos);

  const app = createApp({
    logger,
    clientUrl: env.CLIENT_URL,
    isProduction: env.NODE_ENV === 'production',
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    accessTokens,
    authService,
    loginIdService,
    userRepository: repos.users,
    tenantProvisioningService,
    tenantManagementService,
    licenseService,
    dashboardStatsService,
    categoryService,
    subDepartmentService,
    brandService,
    productService,
    barcodeService,
    productImportService,
    inventoryService,
    storeService,
    supplierService,
    purchaseService,
    saleService,
    customerService,
    expenseService,
    employeeService,
    reportService,
  });

  return { app, prisma };
};
