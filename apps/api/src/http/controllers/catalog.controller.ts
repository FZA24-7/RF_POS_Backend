import type { Request, Response } from 'express';
import type {
  CreateBrandInput,
  CreateCategoryInput,
  CreateProductInput,
  CreateSubDepartmentInput,
  ListQuery,
  ProductListQuery,
  SubDepartmentListQuery,
  UpdateBrandInput,
  UpdateCategoryInput,
  UpdateProductInput,
  UpdateStatusInput,
  UpdateSubDepartmentInput,
} from '@mafk/validation';
import type { CategoryService } from '../../services/category.service.js';
import type { SubDepartmentService } from '../../services/sub-department.service.js';
import type { BrandService } from '../../services/brand.service.js';
import type { ProductService } from '../../services/product.service.js';
import type { BarcodeService } from '../../services/barcode.service.js';
import type { ProductImportService } from '../../services/product-import.service.js';
import { DomainError } from '../../domain/types.js';
import type { Actor } from '../../services/category.service.js';

const actorFrom = (req: Request): Actor => {
  if (!req.auth?.tenantId)
    throw new DomainError('TENANT_REQUIRED', 'This action requires a tenant context.', 403);
  return { id: req.auth.userId, tenantId: req.auth.tenantId };
};

export const createCatalogController = (deps: {
  categories: CategoryService;
  subDepartments: SubDepartmentService;
  brands: BrandService;
  products: ProductService;
  barcodes: BarcodeService;
  productImport: ProductImportService;
}) => ({
  // Categories
  async listCategories(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as ListQuery;
    res.status(200).json(await deps.categories.list(actorFrom(req).tenantId, query));
  },
  async getCategory(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    res.status(200).json(await deps.categories.getById(id, actorFrom(req).tenantId));
  },
  async createCategory(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateCategoryInput;
    res.status(201).json(await deps.categories.create(actorFrom(req), input));
  },
  async updateCategory(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    res
      .status(200)
      .json(await deps.categories.update(actorFrom(req), id, req.body as UpdateCategoryInput));
  },
  async updateCategoryStatus(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    const { status } = req.body as UpdateStatusInput;
    res.status(200).json(await deps.categories.updateStatus(actorFrom(req), id, status));
  },

  // Sub-Departments
  async listSubDepartments(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as SubDepartmentListQuery;
    res.status(200).json(await deps.subDepartments.list(actorFrom(req).tenantId, query));
  },
  async getSubDepartment(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    res.status(200).json(await deps.subDepartments.getById(id, actorFrom(req).tenantId));
  },
  async createSubDepartment(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateSubDepartmentInput;
    res.status(201).json(await deps.subDepartments.create(actorFrom(req), input));
  },
  async updateSubDepartment(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    res
      .status(200)
      .json(
        await deps.subDepartments.update(actorFrom(req), id, req.body as UpdateSubDepartmentInput),
      );
  },
  async updateSubDepartmentStatus(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    const { status } = req.body as UpdateStatusInput;
    res.status(200).json(await deps.subDepartments.updateStatus(actorFrom(req), id, status));
  },

  // Brands
  async listBrands(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as ListQuery;
    res.status(200).json(await deps.brands.list(actorFrom(req).tenantId, query));
  },
  async getBrand(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    res.status(200).json(await deps.brands.getById(id, actorFrom(req).tenantId));
  },
  async createBrand(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateBrandInput;
    res.status(201).json(await deps.brands.create(actorFrom(req), input));
  },
  async updateBrand(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    res
      .status(200)
      .json(await deps.brands.update(actorFrom(req), id, req.body as UpdateBrandInput));
  },
  async updateBrandStatus(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    const { status } = req.body as UpdateStatusInput;
    res.status(200).json(await deps.brands.updateStatus(actorFrom(req), id, status));
  },

  // Products
  async listProducts(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as ProductListQuery;
    res.status(200).json(await deps.products.list(actorFrom(req).tenantId, query));
  },
  async getProduct(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    res.status(200).json(await deps.products.getById(id, actorFrom(req).tenantId));
  },
  async createProduct(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateProductInput;
    res.status(201).json(await deps.products.create(actorFrom(req), input));
  },
  async updateProduct(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    res
      .status(200)
      .json(await deps.products.update(actorFrom(req), id, req.body as UpdateProductInput));
  },
  async updateProductStatus(req: Request, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    const { status } = req.body as UpdateStatusInput;
    res.status(200).json(await deps.products.updateStatus(actorFrom(req), id, status));
  },

  // Barcode lookup
  async lookupBarcode(req: Request, res: Response): Promise<void> {
    const { code } = req.params as { code: string };
    res.status(200).json(await deps.barcodes.lookup(actorFrom(req).tenantId, code));
  },

  // Import / export
  async importProducts(req: Request, res: Response): Promise<void> {
    const { csv } = req.body as { csv: string };
    res.status(200).json(await deps.productImport.importCsv(actorFrom(req), csv));
  },
  async exportProducts(req: Request, res: Response): Promise<void> {
    const csv = await deps.productImport.exportCsv(actorFrom(req).tenantId);
    res
      .status(200)
      .setHeader('Content-Type', 'text/csv')
      .setHeader('Content-Disposition', 'attachment; filename="products.csv"')
      .send(csv);
  },
});
