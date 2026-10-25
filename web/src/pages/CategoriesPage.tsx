import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { apiRequest, ApiError } from '../api/client.js';
import type { CategorySummary } from '../api/types.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Button } from '../components/ui/Button.js';
import { Input, Label } from '../components/ui/Input.js';
import { Spinner } from '../components/ui/Spinner.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { ErrorBanner } from '../components/ui/ErrorBanner.js';

export const CategoriesPage = () => {
  const [categories, setCategories] = useState<CategorySummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCategories(await apiRequest<CategorySummary[]>('/catalog/categories'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load categories.');
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
      await apiRequest('/catalog/categories', {
        method: 'POST',
        body: { name, description: description || undefined },
      });
      setName('');
      setDescription('');
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create category.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = async (category: CategorySummary) => {
    try {
      await apiRequest(`/catalog/categories/${category.id}/status`, {
        method: 'PATCH',
        body: { status: category.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update status.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Categories</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          <Plus size={16} /> New Category
        </Button>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      {showForm ? (
        <Card>
          <CardBody>
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <div>
                <Label htmlFor="cat-name">Name</Label>
                <Input
                  id="cat-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="cat-desc">Description</Label>
                <Input
                  id="cat-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Creating…' : 'Create'}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardBody>
          {loading ? (
            <Spinner label="Loading categories…" />
          ) : !categories || categories.length === 0 ? (
            <EmptyState
              title="No categories yet"
              description="Create your first category to get started."
            />
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Description</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4" />
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2.5 pr-4 font-medium">{c.name}</td>
                    <td className="py-2.5 pr-4 text-slate-500 dark:text-slate-400">
                      {c.description ?? '—'}
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge tone={c.status === 'ACTIVE' ? 'green' : 'slate'}>{c.status}</Badge>
                    </td>
                    <td className="py-2.5 pr-4 text-right">
                      <Button variant="ghost" onClick={() => void toggleStatus(c)}>
                        {c.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
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
