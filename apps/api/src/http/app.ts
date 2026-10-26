import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from '../logger.js';
import { pinoHttp } from './pino-http-compat.js';
import type { AccessTokenService } from '../security/jwt.js';
import type { AuthService } from '../services/auth.service.js';
import type { LoginIdService } from '../services/login-id.service.js';
import type { TenantProvisioningService } from '../services/tenant-provisioning.service.js';
import type { TenantManagementService } from '../services/tenant-management.service.js';
import type { LicenseService } from '../services/license.service.js';
import type { DashboardStatsService } from '../services/dashboard-stats.service.js';
import type { CategoryService } from '../services/category.service.js';
import type { SubDepartmentService } from '../services/sub-department.service.js';
import type { BrandService } from '../services/brand.service.js';
import type { ProductService } from '../services/product.service.js';
import type { BarcodeService } from '../services/barcode.service.js';
import type { ProductImportService } from '../services/product-import.service.js';
import type { InventoryService } from '../services/inventory.service.js';
import type { StoreService } from '../services/store.service.js';
import type { SupplierService } from '../services/supplier.service.js';
import type { PurchaseService } from '../services/purchase.service.js';
import type { SaleService } from '../services/sale.service.js';
import type { CustomerService } from '../services/customer.service.js';
import type { ExpenseService } from '../services/expense.service.js';
import type { EmployeeService } from '../services/employee.service.js';
import type { ReportService } from '../services/report.service.js';
import {
  createCustomerController,
  createEmployeeController,
  createExpenseController,
  createReportController,
} from './controllers/business.controller.js';
import { businessRoutes } from './routes/business.routes.js';
import type { UserRepository } from '../domain/ports.js';
import { createAuthController } from './controllers/auth.controller.js';
import { createUsersController } from './controllers/users.controller.js';
import { createMasterAdminController } from './controllers/master-admin.controller.js';
import { createCatalogController } from './controllers/catalog.controller.js';
import { createInventoryController } from './controllers/inventory.controller.js';
import { createStoreController } from './controllers/store.controller.js';
import { createSupplierController } from './controllers/supplier.controller.js';
import { createPurchaseController } from './controllers/purchase.controller.js';
import { createSaleController } from './controllers/sale.controller.js';
import { saleRoutes } from './routes/sale.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { usersRoutes } from './routes/users.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { masterAdminRoutes } from './routes/master-admin.routes.js';
import { catalogRoutes } from './routes/catalog.routes.js';
import { inventoryRoutes } from './routes/inventory.routes.js';
import { storeRoutes } from './routes/store.routes.js';
import { supplierRoutes } from './routes/supplier.routes.js';
import { purchaseRoutes } from './routes/purchase.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requestId } from './middleware/request-id.js';

export interface AppDependencies {
  logger: Logger;
  clientUrl: string;
  isProduction: boolean;
  refreshTokenTtlDays: number;
  accessTokens: AccessTokenService;
  authService: AuthService;
  loginIdService: LoginIdService;
  userRepository: UserRepository;
  // Phase 2:
  tenantProvisioningService: TenantProvisioningService;
  tenantManagementService: TenantManagementService;
  licenseService: LicenseService;
  dashboardStatsService: DashboardStatsService;
  // Phase 3:
  categoryService: CategoryService;
  subDepartmentService: SubDepartmentService;
  brandService: BrandService;
  productService: ProductService;
  barcodeService: BarcodeService;
  productImportService: ProductImportService;
  inventoryService: InventoryService;
  storeService: StoreService;
  supplierService: SupplierService;
  purchaseService: PurchaseService;
  // Phase 5:
  saleService: SaleService;
  customerService: CustomerService;
  expenseService: ExpenseService;
  employeeService: EmployeeService;
  reportService: ReportService;
}

export const createApp = (deps: AppDependencies): Express => {
  const app = express();

  app.disable('x-powered-by');
  app.use(requestId);
  app.use(helmet());
  app.use(
    cors({
      origin: deps.clientUrl.split(',').map((s) => s.trim()),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(
    pinoHttp({
      logger: deps.logger,
      genReqId: (req) => (req as unknown as { requestId: string }).requestId,
    }),
  );

  const authController = createAuthController(deps.authService, {
    isProduction: deps.isProduction,
    refreshTokenTtlDays: deps.refreshTokenTtlDays,
  });
  const usersController = createUsersController(deps.loginIdService, deps.userRepository);
  const masterAdminController = createMasterAdminController({
    provisioning: deps.tenantProvisioningService,
    tenants: deps.tenantManagementService,
    licenses: deps.licenseService,
    stats: deps.dashboardStatsService,
  });
  const catalogController = createCatalogController({
    categories: deps.categoryService,
    subDepartments: deps.subDepartmentService,
    brands: deps.brandService,
    products: deps.productService,
    barcodes: deps.barcodeService,
    productImport: deps.productImportService,
  });
  const inventoryController = createInventoryController(deps.inventoryService);
  const storeController = createStoreController(deps.storeService);
  const supplierController = createSupplierController(deps.supplierService);
  const purchaseController = createPurchaseController(deps.purchaseService);
  const saleController = createSaleController(deps.saleService);

  app.use('/api', healthRoutes());
  app.use('/api', authRoutes(authController, deps.accessTokens));
  app.use('/api', usersRoutes(usersController, deps.accessTokens));
  app.use('/api', masterAdminRoutes(masterAdminController, deps.accessTokens));
  app.use('/api', catalogRoutes(catalogController, deps.accessTokens));
  app.use('/api', inventoryRoutes(inventoryController, deps.accessTokens));
  app.use('/api', storeRoutes(storeController, deps.accessTokens));
  app.use('/api', supplierRoutes(supplierController, deps.accessTokens));
  app.use('/api', purchaseRoutes(purchaseController, deps.accessTokens));
  app.use('/api', saleRoutes(saleController, deps.accessTokens));
  app.use(
    '/api',
    businessRoutes(
      {
        customers: createCustomerController(deps.customerService),
        expenses: createExpenseController(deps.expenseService),
        employees: createEmployeeController(deps.employeeService),
        reports: createReportController(deps.reportService),
      },
      deps.accessTokens,
    ),
  );

  app.use(notFoundHandler);
  app.use(errorHandler(deps.logger));

  return app;
};
