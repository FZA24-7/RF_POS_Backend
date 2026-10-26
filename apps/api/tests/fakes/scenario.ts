import { randomUUID } from 'node:crypto';
import { DEFAULT_ROLE_PERMISSIONS, MODULE_CATALOG } from '@mafk/shared';
import { PasswordHasher } from '../../src/security/password.js';
import { createFakeRepositories, type FakeRepositories } from './in-memory-repositories.js';

const hasher = new PasswordHasher({ memoryCostKib: 19456, timeCost: 2 }); // low cost - tests only

export interface ScenarioUser {
  id: string;
  loginId: string;
  password: string;
  tenantId: string | null;
}

export interface Scenario {
  repos: FakeRepositories;
  tenantA: { id: string; code: string; storeId: string };
  tenantB: { id: string; code: string; storeId: string };
  masterAdmin: ScenarioUser;
  tenantAClientAdmin: ScenarioUser;
  tenantAManager: ScenarioUser;
  tenantACashier: ScenarioUser;
  tenantBClientAdmin: ScenarioUser;
  catalog: {
    categoryId: string;
    subDepartmentId: string;
    otherCategoryId: string;
    otherSubDepartmentId: string;
    brandId: string;
    productId: string;
    productSku: string;
    productBarcode: string;
    tenantBCategoryId: string;
    supplierId: string;
    tenantBSupplierId: string;
  };
}

/**
 * Builds: Master Admin (platform) + two tenants, each with a Client Master
 * Admin; Tenant A additionally has a Manager and a Cashier. Mirrors the
 * hierarchy in the spec so RBAC / tenant-isolation / Login-ID tests read
 * naturally against real roles rather than ad hoc stand-ins.
 */
export const buildScenario = async (): Promise<Scenario> => {
  const repos = createFakeRepositories();

  const roleFor = (
    key: string,
    tenantId: string | null,
    systemRole: keyof typeof DEFAULT_ROLE_PERMISSIONS,
  ) =>
    repos.roles.seed({
      id: `role-${key}`,
      tenantId,
      systemRole,
      permissionKeys: DEFAULT_ROLE_PERMISSIONS[systemRole],
    });

  const masterRole = roleFor('master', null, 'MASTER_ADMIN');

  const tenantA = repos.tenants.seed({
    id: 'tenant-a',
    code: 'TEN-A',
    name: 'Tenant A Store',
    status: 'ACTIVE',
  });
  const tenantB = repos.tenants.seed({
    id: 'tenant-b',
    code: 'TEN-B',
    name: 'Tenant B Store',
    status: 'ACTIVE',
  });

  const tenantAAdminRole = roleFor('a-admin', tenantA.id, 'CLIENT_MASTER_ADMIN');
  const tenantAManagerRole = roleFor('a-manager', tenantA.id, 'MANAGER');
  const tenantACashierRole = roleFor('a-cashier', tenantA.id, 'CASHIER');
  const tenantBAdminRole = roleFor('b-admin', tenantB.id, 'CLIENT_MASTER_ADMIN');

  const makeUser = async (opts: {
    id: string;
    loginId: string;
    password: string;
    tenantId: string | null;
    roleId: string;
  }): Promise<ScenarioUser> => {
    const passwordHash = await hasher.hash(opts.password);
    repos.users.seed({
      id: opts.id,
      tenantId: opts.tenantId,
      storeId: null,
      roleId: opts.roleId,
      systemRole:
        opts.roleId === masterRole.id
          ? 'MASTER_ADMIN'
          : opts.roleId === tenantAAdminRole.id || opts.roleId === tenantBAdminRole.id
            ? 'CLIENT_MASTER_ADMIN'
            : opts.roleId === tenantAManagerRole.id
              ? 'MANAGER'
              : 'CASHIER',
      loginId: opts.loginId,
      displayName: opts.loginId,
      status: 'ACTIVE',
      passwordHash,
    });
    return { id: opts.id, loginId: opts.loginId, password: opts.password, tenantId: opts.tenantId };
  };

  const masterAdmin = await makeUser({
    id: 'user-master',
    loginId: 'master.admin',
    password: 'MasterPass123',
    tenantId: null,
    roleId: masterRole.id,
  });
  const tenantAClientAdmin = await makeUser({
    id: 'user-a-admin',
    loginId: 'a.admin',
    password: 'TenantAPass123',
    tenantId: tenantA.id,
    roleId: tenantAAdminRole.id,
  });
  const tenantAManager = await makeUser({
    id: 'user-a-manager',
    loginId: 'a.manager',
    password: 'ManagerPass123',
    tenantId: tenantA.id,
    roleId: tenantAManagerRole.id,
  });
  const tenantACashier = await makeUser({
    id: 'user-a-cashier',
    loginId: 'a.cashier',
    password: 'CashierPass123',
    tenantId: tenantA.id,
    roleId: tenantACashierRole.id,
  });
  const tenantBClientAdmin = await makeUser({
    id: 'user-b-admin',
    loginId: 'b.admin',
    password: 'TenantBPass123',
    tenantId: tenantB.id,
    roleId: tenantBAdminRole.id,
  });

  // Phase 2: give each tenant a default Store and an active License, so
  // dashboard-stats / license / tenant-detail tests have real data to read.
  repos.stores.seed({
    id: 'store-a-main',
    tenantId: tenantA.id,
    code: 'MAIN',
    name: 'Tenant A Main Branch',
    isDefault: true,
    isActive: true,
  });
  repos.stores.seed({
    id: 'store-b-main',
    tenantId: tenantB.id,
    code: 'MAIN',
    name: 'Tenant B Main Branch',
    isDefault: true,
    isActive: true,
  });

  const inThirtyDays = new Date(Date.now() + 30 * 86_400_000);
  repos.licenses.seed({
    id: 'license-a',
    tenantId: tenantA.id,
    planCode: 'STANDARD',
    status: 'ACTIVE',
    startsAt: new Date(),
    expiresAt: inThirtyDays,
    maxUsers: 10,
    maxDevices: 5,
    maxStores: 3,
    enabledModules: [...MODULE_CATALOG],
    createdAt: new Date(),
  });
  repos.licenses.seed({
    id: 'license-b',
    tenantId: tenantB.id,
    planCode: 'STANDARD',
    status: 'ACTIVE',
    startsAt: new Date(),
    expiresAt: inThirtyDays,
    maxUsers: 10,
    maxDevices: 5,
    maxStores: 3,
    enabledModules: [...MODULE_CATALOG],
    createdAt: new Date(),
  });

  // Phase 3: a small, real catalog for Tenant A (plus one Tenant B category,
  // for tenant-isolation tests), and one product with opening stock.
  const now = new Date();
  const category = repos.categories.seed({
    id: 'category-a-menswear',
    tenantId: tenantA.id,
    name: "Men's Wear",
    description: null,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  });
  const otherCategory = repos.categories.seed({
    id: 'category-a-grocery',
    tenantId: tenantA.id,
    name: 'Grocery',
    description: null,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  });
  const subDepartment = repos.subDepartments.seed({
    id: 'subdept-a-shirts',
    tenantId: tenantA.id,
    categoryId: category.id,
    name: 'Shirts',
    description: null,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  });
  const otherSubDepartment = repos.subDepartments.seed({
    id: 'subdept-a-snacks',
    tenantId: tenantA.id,
    categoryId: otherCategory.id,
    name: 'Snacks',
    description: null,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  });
  const brand = repos.brands.seed({
    id: 'brand-a-generic',
    tenantId: tenantA.id,
    name: 'Generic Brand',
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  });
  const tenantBCategory = repos.categories.seed({
    id: 'category-b-electronics',
    tenantId: tenantB.id,
    name: 'Electronics',
    description: null,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  });

  const productSku = 'SHIRT-001';
  const productBarcode = '8901234567890';
  const product = repos.products.seed({
    id: 'product-a-shirt',
    tenantId: tenantA.id,
    name: 'Classic Cotton Shirt',
    sku: productSku,
    categoryId: category.id,
    subDepartmentId: subDepartment.id,
    brandId: brand.id,
    supplierId: null,
    costPrice: '500.00',
    sellingPrice: '899.00',
    wholesalePrice: '750.00',
    taxRate: '0',
    unit: 'pcs',
    minStock: '5',
    maxStock: '200',
    imageUrl: null,
    description: null,
    status: 'ACTIVE',
    barcodes: [productBarcode],
    createdAt: now,
    updatedAt: now,
  });

  repos.inventory.seed({
    id: 'inventory-a-shirt',
    tenantId: tenantA.id,
    storeId: 'store-a-main',
    productId: product.id,
    quantity: '20',
    updatedAt: now,
  });

  // Phase 4: a supplier per tenant, for purchase tests.
  const supplier = repos.suppliers.seed({
    id: 'supplier-a-textiles',
    tenantId: tenantA.id,
    name: 'Textile Wholesalers Ltd',
    phone: '+92-300-1234567',
    email: 'sales@textilewholesalers.example',
    address: null,
    openingBalance: '0.00',
    isActive: true,
    createdAt: now,
  });
  const tenantBSupplier = repos.suppliers.seed({
    id: 'supplier-b-electronics',
    tenantId: tenantB.id,
    name: 'Electronics Direct',
    phone: null,
    email: null,
    address: null,
    openingBalance: '0.00',
    isActive: true,
    createdAt: now,
  });

  return {
    repos,
    tenantA: { id: tenantA.id, code: tenantA.code, storeId: 'store-a-main' },
    tenantB: { id: tenantB.id, code: tenantB.code, storeId: 'store-b-main' },
    masterAdmin,
    tenantAClientAdmin,
    tenantAManager,
    tenantACashier,
    tenantBClientAdmin,
    catalog: {
      categoryId: category.id,
      subDepartmentId: subDepartment.id,
      otherCategoryId: otherCategory.id,
      otherSubDepartmentId: otherSubDepartment.id,
      brandId: brand.id,
      productId: product.id,
      productSku,
      productBarcode,
      tenantBCategoryId: tenantBCategory.id,
      supplierId: supplier.id,
      tenantBSupplierId: tenantBSupplier.id,
    },
  };
};

export const newId = (): string => randomUUID();
