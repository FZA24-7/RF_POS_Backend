import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { apiRequest, ApiError } from '../api/client.js';
import type { BrandSummary } from '../api/types.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Button } from '../components/ui/Button.js';
import { Input, Label } from '../components/ui/Input.js';
import { Spinner } from '../components/ui/Spinner.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { ErrorBanner } from '../components/ui/ErrorBanner.js';

export const BrandsPage = () => {
  const [brands, setBrands] = useState<BrandSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBrands(await apiRequest<BrandSummary[]>('/catalog/brands'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load brands.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest('/catalog/brands', { method: 'POST', body: { name } });
      setName('');
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create brand.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = async (brand: BrandSummary) => {
    try {
      await apiRequest(`/catalog/brands/${brand.id}/status`, {
        method: 'PATCH',
        body: { status: brand.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update status.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Brands</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          <Plus size={16} /> New Brand
        </Button>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      {showForm ? (
        <Card>
          <CardBody>
            <form onSubmit={onSubmit} className="flex items-end gap-3" noValidate>
              <div className="flex-1">
                <Label htmlFor="brand-name">Name</Label>
                <Input
                  id="brand-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creating…' : 'Create'}
              </Button>
            </form>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardBody>
          {loading ? (
            <Spinner label="Loading brands…" />
          ) : !brands || brands.length === 0 ? (
            <EmptyState title="No brands yet" />
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4" />
                </tr>
              </thead>
              <tbody>
                {brands.map((b) => (
                  <tr key={b.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2.5 pr-4 font-medium">{b.name}</td>
                    <td className="py-2.5 pr-4">
                      <Badge tone={b.status === 'ACTIVE' ? 'green' : 'slate'}>{b.status}</Badge>
                    </td>
                    <td className="py-2.5 pr-4 text-right">
                      <Button variant="ghost" onClick={() => void toggleStatus(b)}>
                        {b.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                      </Button>
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
