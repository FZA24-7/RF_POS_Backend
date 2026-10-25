import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Upload, Download } from 'lucide-react';
import { apiRequest, ApiError } from '../api/client.js';
import type {
  BrandSummary,
  CategorySummary,
  ProductListResult,
  SubDepartmentSummary,
} from '../api/types.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Button } from '../components/ui/Button.js';
import { Input } from '../components/ui/Input.js';
import { ProductForm } from '../components/ProductForm.js';
import { Spinner } from '../components/ui/Spinner.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { ErrorBanner } from '../components/ui/ErrorBanner.js';

export const ProductsPage = () => {
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [subDepartments, setSubDepartments] = useState<SubDepartmentSummary[]>([]);
  const [brands, setBrands] = useState<BrandSummary[]>([]);
  const [products, setProducts] = useState<ProductListResult | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [importResult, setImportResult] = useState<{
    totalRows: number;
    successCount: number;
    failedCount: number;
    rowErrors: { row: number; errors: string[] }[];
  } | null>(null);

  const load = useCallback(async (searchTerm: string) => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      if (searchTerm) query.set('search', searchTerm);
      const [cats, subs, brandList, productList] = await Promise.all([
        apiRequest<CategorySummary[]>('/catalog/categories'),
        apiRequest<SubDepartmentSummary[]>('/catalog/sub-departments'),
        apiRequest<BrandSummary[]>('/catalog/brands'),
        apiRequest<ProductListResult>(`/catalog/products?${query.toString()}`),
      ]);
      setCategories(cats);
      setSubDepartments(subs);
      setBrands(brandList);
      setProducts(productList);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load products.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Runs once on mount. `search` changes are handled explicitly by the search
  // input's onChange calling `load(value)` directly, not by re-running this
  // effect - `load` itself is stable (useCallback with no deps).
  useEffect(() => {
    void load(search);
    // intentionally run only once on mount - see comment above
  }, [load]);

  const onImportFile = async (file: File) => {
    const text = await file.text();
    setError(null);
    try {
      const result = await apiRequest<typeof importResult>('/catalog/products/import', {
        method: 'POST',
        body: { csv: text },
      });
      setImportResult(result);
      await load(search);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Products</h1>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              (window.location.href =
                (import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api') +
                '/catalog/products/export')
            }
          >
            <Download size={16} /> Export CSV
          </Button>
          <label className="focus-ring inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700">
            <Upload size={16} /> Import CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onImportFile(file);
                e.target.value = '';
              }}
            />
          </label>
          <Button onClick={() => setShowForm((v) => !v)} disabled={categories.length === 0}>
            <Plus size={16} /> New Product
          </Button>
        </div>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      {importResult ? (
        <Card>
          <CardBody>
            <p className="text-sm font-medium">
              Import complete: {importResult.successCount}/{importResult.totalRows} rows imported,{' '}
              {importResult.failedCount} failed.
            </p>
            {importResult.rowErrors.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs text-red-700 dark:text-red-400">
                {importResult.rowErrors.map((re) => (
                  <li key={re.row}>
                    Row {re.row}: {re.errors.join('; ')}
                  </li>
                ))}
              </ul>
            ) : null}
            <Button variant="ghost" className="mt-2" onClick={() => setImportResult(null)}>
              Dismiss
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {showForm ? (
        <Card>
          <CardBody>
            <ProductForm
              categories={categories}
              subDepartments={subDepartments}
              brands={brands}
              onCancel={() => setShowForm(false)}
              onCreated={() => {
                setShowForm(false);
                void load(search);
              }}
            />
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardBody className="space-y-4">
          <div className="relative max-w-sm">
            <Search
              className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400"
              size={16}
            />
            <Input
              placeholder="Search by name or SKU…"
              className="pl-8"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                void load(e.target.value);
              }}
            />
          </div>

          {loading ? (
            <Spinner label="Loading products…" />
          ) : !products || products.items.length === 0 ? (
            <EmptyState
              title="No products yet"
              description="Create your first product to get started."
            />
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">SKU</th>
                  <th className="py-2 pr-4">Selling Price</th>
                  <th className="py-2 pr-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {products.items.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2.5 pr-4 font-medium">{p.name}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs">{p.sku}</td>
                    <td className="py-2.5 pr-4">{p.sellingPrice}</td>
                    <td className="py-2.5 pr-4">
                      <Badge tone={p.status === 'ACTIVE' ? 'green' : 'slate'}>{p.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
};
