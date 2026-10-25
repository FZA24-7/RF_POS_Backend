import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { apiRequest, ApiError } from '../api/client.js';
import type { CategorySummary, SubDepartmentSummary } from '../api/types.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Button } from '../components/ui/Button.js';
import { Input, Label } from '../components/ui/Input.js';
import { Spinner } from '../components/ui/Spinner.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { ErrorBanner } from '../components/ui/ErrorBanner.js';

export const SubDepartmentsPage = () => {
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [subDepartments, setSubDepartments] = useState<SubDepartmentSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cats, subs] = await Promise.all([
        apiRequest<CategorySummary[]>('/catalog/categories'),
        apiRequest<SubDepartmentSummary[]>('/catalog/sub-departments'),
      ]);
      setCategories(cats);
      setSubDepartments(subs);
      setCategoryId((current) => current || cats[0]?.id || '');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load sub-departments.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? '—';

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest('/catalog/sub-departments', { method: 'POST', body: { categoryId, name } });
      setName('');
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create sub-department.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Sub-Departments</h1>
        <Button onClick={() => setShowForm((v) => !v)} disabled={categories.length === 0}>
          <Plus size={16} /> New Sub-Department
        </Button>
      </div>

      {error ? <ErrorBanner message={error} /> : null}
      {!loading && categories.length === 0 ? (
        <EmptyState
          title="Create a Category first"
          description="A Sub-Department must belong to a Category."
        />
      ) : null}

      {showForm ? (
        <Card>
          <CardBody>
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <div>
                <Label htmlFor="subdept-category">Category</Label>
                <select
                  id="subdept-category"
                  className="focus-ring w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
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
                <Label htmlFor="subdept-name">Name</Label>
                <Input
                  id="subdept-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
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
            <Spinner label="Loading sub-departments…" />
          ) : !subDepartments || subDepartments.length === 0 ? (
            <EmptyState title="No sub-departments yet" />
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Category</th>
                  <th className="py-2 pr-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {subDepartments.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2.5 pr-4 font-medium">{s.name}</td>
                    <td className="py-2.5 pr-4 text-slate-500 dark:text-slate-400">
                      {categoryName(s.categoryId)}
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge tone={s.status === 'ACTIVE' ? 'green' : 'slate'}>{s.status}</Badge>
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
