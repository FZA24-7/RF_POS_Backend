import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../src/http/app.js';
import { AuthService } from '../../src/services/auth.service.js';
import { LoginIdService } from '../../src/services/login-id.service.js';
import { TenantProvisioningService } from '../../src/services/tenant-provisioning.service.js';
import { TenantManagementService } from '../../src/services/tenant-management.service.js';
import { LicenseService } from '../../src/services/license.service.js';
import { DashboardStatsService } from '../../src/services/dashboard-stats.service.js';
import { CategoryService } from '../../src/services/category.service.js';
import { SubDepartmentService } from '../../src/services/sub-department.service.js';
import { BrandService } from '../../src/services/brand.service.js';
import { ProductService } from '../../src/services/product.service.js';
import { BarcodeService } from '../../src/services/barcode.service.js';
import { ProductImportService } from '../../src/services/product-import.service.js';
import { InventoryService } from '../../src/services/inventory.service.js';
import { StoreService } from '../../src/services/store.service.js';
import { CustomerService } from '../../src/services/customer.service.js';
import { EmployeeService } from '../../src/services/employee.service.js';
import { ExpenseService } from '../../src/services/expense.service.js';
import { ReportService } from '../../src/services/report.service.js';
import { SupplierService } from '../../src/services/supplier.service.js';
import { PurchaseService } from '../../src/services/purchase.service.js';
import { SaleService } from '../../src/services/sale.service.js';
import { PasswordHasher } from '../../src/security/password.js';
import { JoseAccessTokenService } from '../../src/security/jwt.js';
import { createLogger } from '../../src/logger.js';
import type { Scenario } from './scenario.js';

export const testHasher = new PasswordHasher({ memoryCostKib: 19456, timeCost: 2 });
export const testAccessTokens = new JoseAccessTokenService(
  'test-secret-at-least-32-characters-long',
  15,
);
const logger = createLogger({ NODE_ENV: 'test' });

/**
 * Wires every real service against the scenario's in-memory repositories and
 * returns a fully working Express app - the exact same `createApp` factory
 * production uses, just with the Prisma adapters swapped for fakes (see
 * `docs/ARCHITECTURE.md` "Ports and adapters").
 */
export const buildTestApp = (scenario: Scenario): Express => {
  const authService = new AuthService(scenario.repos, testHasher, testAccessTokens, {
    maxFailedAttempts: 5,
    lockoutWindowMs: 15 * 60_000,
    accessTokenTtlMinutes: 15,
    refreshTokenTtlDays: 14,
  });
  const loginIdService = new LoginIdService(scenario.repos);
  const tenantProvisioningService = new TenantProvisioningService(scenario.repos, testHasher);
  const tenantManagementService = new TenantManagementService(scenario.repos, testHasher);
  const licenseService = new LicenseService(scenario.repos);
  const dashboardStatsService = new DashboardStatsService(scenario.repos);
  const categoryService = new CategoryService(scenario.repos);
  const subDepartmentService = new SubDepartmentService(scenario.repos);
  const brandService = new BrandService(scenario.repos);
  const productService = new ProductService(scenario.repos);
  const barcodeService = new BarcodeService(scenario.repos);
  const productImportService = new ProductImportService(scenario.repos);
  const inventoryService = new InventoryService(scenario.repos);
  const storeService = new StoreService(scenario.repos);
  const supplierService = new SupplierService(scenario.repos);
  const purchaseService = new PurchaseService(scenario.repos);
  const saleService = new SaleService(scenario.repos);
  const customerService = new CustomerService(scenario.repos);
  const expenseService = new ExpenseService(scenario.repos);
  const employeeService = new EmployeeService(scenario.repos);
  const reportService = new ReportService(scenario.repos);

  return createApp({
    logger,
    clientUrl: 'http://localhost:5173',
    isProduction: false,
    refreshTokenTtlDays: 14,
    accessTokens: testAccessTokens,
    authService,
    loginIdService,
    userRepository: scenario.repos.users,
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
};

export const loginAs = async (app: Express, loginId: string, password: string) =>
  request(app).post('/api/auth/login').send({ loginId, password });
