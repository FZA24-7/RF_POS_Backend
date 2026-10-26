import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { apiRequest, ApiError } from '../api/client.js';
import type {
  BrandSummary,
  CategorySummary,
  ProductSummary,
  SubDepartmentSummary,
  SupplierSummary,
} from '../api/types.js';
import { Button } from './ui/Button.js';
import { Input, Label } from './ui/Input.js';
import { ErrorBanner } from './ui/ErrorBanner.js';

const selectClass =
  'focus-ring w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

export interface ProductFormProps {
  categories: CategorySummary[];
  subDepartments: SubDepartmentSummary[];
  brands: BrandSummary[];
  suppliers?: SupplierSummary[];
  /** Pre-selects the supplier (e.g. the supplier chosen on the purchase being entered). */
  defaultSupplierId?: string;
  submitLabel?: string;
  onCreated: (product: ProductSummary) => void;
  onCancel: () => void;
}

/**
 * The one Product create form, used both on the Products page and inline from
 * the Purchase screen. It only collects input and calls the real
 * `POST /catalog/products` endpoint - every business rule (SKU/barcode
 * uniqueness, Category->Sub-Department consistency, price validity) is
 * enforced by the server's ProductService, so nothing is duplicated here.
 * Server errors are shown in-place and the entered values are kept.
 */
export const ProductForm = ({
  categories,
  subDepartments,
  brands,
  suppliers = [],
  defaultSupplierId = '',
  submitLabel = 'Create product',
  onCreated,
  onCancel,
}: ProductFormProps) => {
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [subDepartmentId, setSubDepartmentId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [supplierId, setSupplierId] = useState(defaultSupplierId);
  const [costPrice, setCostPrice] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [wholesalePrice, setWholesalePrice] = useState('');
  const [taxRate, setTaxRate] = useState('0');
  const [unit, setUnit] = useState('pcs');
  const [minStock, setMinStock] = useState('0');
  const [maxStock, setMaxStock] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = useMemo(
    () => subDepartments.filter((s) => s.categoryId === categoryId),
    [subDepartments, categoryId],
  );
  // Category -> Sub-Department: clear an incompatible selection. The backend
  // independently re-validates the pairing.
  useEffect(() => {
    if (subDepartmentId && !available.some((s) => s.id === subDepartmentId)) setSubDepartmentId('');
  }, [available, subDepartmentId]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation(); // never bubble into an enclosing (purchase) form
    setSubmitting(true);
    setError(null);
    try {
      const created = await apiRequest<ProductSummary>('/catalog/products', {
        method: 'POST',
        body: {
          name,
          sku,
          categoryId,
          subDepartmentId,
          brandId: brandId || undefined,
          supplierId: supplierId || undefined,
          costPrice,
          sellingPrice,
          wholesalePrice: wholesalePrice || undefined,
          taxRate,
          unit,
          minStock,
          maxStock: maxStock || undefined,
          description: description || undefined,
          barcodes: barcode ? [barcode] : undefined,
        },
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create product.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <ErrorBanner message={error} /> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="pf-name">Product name</Label>
          <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="pf-sku">SKU</Label>
          <Input id="pf-sku" value={sku} onChange={(e) => setSku(e.target.value)} required />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="pf-category">Category</Label>
          <select
            id="pf-category"
            className={selectClass}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            required
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="pf-subdept">Sub-Department</Label>
          <select
            id="pf-subdept"
            className={selectClass}
            value={subDepartmentId}
            onChange={(e) => setSubDepartmentId(e.target.value)}
            required
          >
            <option value="" disabled>
              {available.length === 0 ? 'No sub-departments in this category' : 'Select…'}
            </option>
            {available.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="pf-brand">Brand</Label>
          <select
            id="pf-brand"
            className={selectClass}
            value={brandId}
            onChange={(e) => setBrandId(e.target.value)}
          >
            <option value="">None</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {suppliers.length > 0 ? (
        <div>
          <Label htmlFor="pf-supplier">Supplier</Label>
          <select
            id="pf-supplier"
            className={selectClass}
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">None</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <Label htmlFor="pf-cost">Cost price</Label>
          <Input
            id="pf-cost"
            inputMode="decimal"
            value={costPrice}
            onChange={(e) => setCostPrice(e.target.value)}
            placeholder="0.00"
            required
          />
        </div>
        <div>
          <Label htmlFor="pf-sell">Selling price</Label>
          <Input
            id="pf-sell"
            inputMode="decimal"
            value={sellingPrice}
            onChange={(e) => setSellingPrice(e.target.value)}
            placeholder="0.00"
            required
          />
        </div>
        <div>
          <Label htmlFor="pf-wholesale">Wholesale price</Label>
          <Input
            id="pf-wholesale"
            inputMode="decimal"
            value={wholesalePrice}
            onChange={(e) => setWholesalePrice(e.target.value)}
            placeholder="optional"
          />
        </div>
        <div>
          <Label htmlFor="pf-tax">Tax %</Label>
          <Input
            id="pf-tax"
            inputMode="decimal"
            value={taxRate}
            onChange={(e) => setTaxRate(e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label htmlFor="pf-unit">Unit</Label>
          <Input id="pf-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="pf-min">Min stock</Label>
          <Input
            id="pf-min"
            inputMode="decimal"
            value={minStock}
            onChange={(e) => setMinStock(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="pf-max">Max stock</Label>
          <Input
            id="pf-max"
            inputMode="decimal"
            value={maxStock}
            onChange={(e) => setMaxStock(e.target.value)}
            placeholder="optional"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="pf-barcode">Barcode (optional)</Label>
          <Input id="pf-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="pf-desc">Description (optional)</Label>
          <Input
            id="pf-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting || !subDepartmentId}>
          {submitting ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
};
