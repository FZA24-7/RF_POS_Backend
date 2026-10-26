import { Router } from 'express';
import {
  barcodeCodeParamSchema,
  createBrandSchema,
  createCategorySchema,
  createProductSchema,
  createSubDepartmentSchema,
  idParamSchema,
  listQuerySchema,
  productListQuerySchema,
  subDepartmentListQuerySchema,
  updateBrandSchema,
  updateCategorySchema,
  updateProductSchema,
  updateStatusSchema,
  updateSubDepartmentSchema,
} from '@mafk/validation';
import { z } from 'zod';
import type { AccessTokenService } from '../../security/jwt.js';
import type { createCatalogController } from '../controllers/catalog.controller.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requirePermission, requireTenant } from '../middleware/require-permission.js';

type CatalogController = ReturnType<typeof createCatalogController>;

const importCsvSchema = z.object({ csv: z.string().min(1) });

export const catalogRoutes = (
  controller: CatalogController,
  accessTokens: AccessTokenService,
): Router => {
  const router = Router();
  // Scoped to '/catalog' - see master-admin.routes.ts's comment for why an
  // unscoped `router.use()` here would be a real bug (it would run for every
  // request reaching this router, since all routers share the '/api' mount
  // prefix, not just requests actually destined for a '/catalog/*' route).
  router.use('/catalog', requireAuth(accessTokens), requireTenant);

  // Categories
  router.get(
    '/catalog/categories',
    requirePermission('categories.view'),
    validate(listQuerySchema, 'query'),
    controller.listCategories,
  );
  router.post(
    '/catalog/categories',
    requirePermission('categories.create'),
    validate(createCategorySchema),
    controller.createCategory,
  );
  router.get(
    '/catalog/categories/:id',
    requirePermission('categories.view'),
    validate(idParamSchema, 'params'),
    controller.getCategory,
  );
  router.patch(
    '/catalog/categories/:id',
    requirePermission('categories.edit'),
    validate(idParamSchema, 'params'),
    validate(updateCategorySchema),
    controller.updateCategory,
  );
  router.patch(
    '/catalog/categories/:id/status',
    requirePermission('categories.edit'),
    validate(idParamSchema, 'params'),
    validate(updateStatusSchema),
    controller.updateCategoryStatus,
  );

  // Sub-Departments
  router.get(
    '/catalog/sub-departments',
    requirePermission('sub_departments.view'),
    validate(subDepartmentListQuerySchema, 'query'),
    controller.listSubDepartments,
  );
  router.post(
    '/catalog/sub-departments',
    requirePermission('sub_departments.create'),
    validate(createSubDepartmentSchema),
    controller.createSubDepartment,
  );
  router.get(
    '/catalog/sub-departments/:id',
    requirePermission('sub_departments.view'),
    validate(idParamSchema, 'params'),
    controller.getSubDepartment,
  );
  router.patch(
    '/catalog/sub-departments/:id',
    requirePermission('sub_departments.edit'),
    validate(idParamSchema, 'params'),
    validate(updateSubDepartmentSchema),
    controller.updateSubDepartment,
  );
  router.patch(
    '/catalog/sub-departments/:id/status',
    requirePermission('sub_departments.edit'),
    validate(idParamSchema, 'params'),
    validate(updateStatusSchema),
    controller.updateSubDepartmentStatus,
  );

  // Brands
  router.get(
    '/catalog/brands',
    requirePermission('brands.view'),
    validate(listQuerySchema, 'query'),
    controller.listBrands,
  );
  router.post(
    '/catalog/brands',
    requirePermission('brands.create'),
    validate(createBrandSchema),
    controller.createBrand,
  );
  router.get(
    '/catalog/brands/:id',
    requirePermission('brands.view'),
    validate(idParamSchema, 'params'),
    controller.getBrand,
  );
  router.patch(
    '/catalog/brands/:id',
    requirePermission('brands.edit'),
    validate(idParamSchema, 'params'),
    validate(updateBrandSchema),
    controller.updateBrand,
  );
  router.patch(
    '/catalog/brands/:id/status',
    requirePermission('brands.edit'),
    validate(idParamSchema, 'params'),
    validate(updateStatusSchema),
    controller.updateBrandStatus,
  );

  // Products
  router.get(
    '/catalog/products',
    requirePermission('products.view'),
    validate(productListQuerySchema, 'query'),
    controller.listProducts,
  );
  router.post(
    '/catalog/products',
    requirePermission('products.create'),
    validate(createProductSchema),
    controller.createProduct,
  );
  router.get(
    '/catalog/products/export',
    requirePermission('products.export'),
    controller.exportProducts,
  );
  router.post(
    '/catalog/products/import',
    requirePermission('products.create'),
    validate(importCsvSchema),
    controller.importProducts,
  );
  router.get(
    '/catalog/products/:id',
    requirePermission('products.view'),
    validate(idParamSchema, 'params'),
    controller.getProduct,
  );
  router.patch(
    '/catalog/products/:id',
    requirePermission('products.edit'),
    validate(idParamSchema, 'params'),
    validate(updateProductSchema),
    controller.updateProduct,
  );
  router.patch(
    '/catalog/products/:id/status',
    requirePermission('products.edit'),
    validate(idParamSchema, 'params'),
    validate(updateStatusSchema),
    controller.updateProductStatus,
  );

  // Barcode lookup
  router.get(
    '/catalog/barcode/:code',
    requirePermission('barcode.view'),
    validate(barcodeCodeParamSchema, 'params'),
    controller.lookupBarcode,
  );

  return router;
};
