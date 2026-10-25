import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { apiRequest, ApiError } from '../api/client.js';
import type { EmployeeListResult, EmployeeView } from '../api/types.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Input, Label } from '../components/ui/Input.js';
import { Spinner } from '../components/ui/Spinner.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { ErrorBanner } from '../components/ui/ErrorBanner.js';

const MONEY_RE = /^\d{1,14}(\.\d{1,2})?$/;
const STATUS_LABEL: Record<EmployeeView['status'], string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  TERMINATED: 'Left',
};

export const EmployeesPage = () => {
  const [result, setResult] = useState<EmployeeListResult | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    designation: '',
    nationalId: '',
    hireDate: '',
    salary: '',
  });

  const load = useCallback(async (term: string) => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ pageSize: '100' });
      if (term) q.set('search', term);
      setResult(await apiRequest<EmployeeListResult>(`/employees?${q.toString()}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load employees.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load('');
  }, [load]);

  const valid =
    form.fullName.trim().length >= 2 && (form.salary === '' || MONEY_RE.test(form.salary));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, string> = { fullName: form.fullName.trim() };
      for (const k of ['phone', 'designation', 'nationalId', 'hireDate', 'salary'] as const) {
        if (form[k].trim()) body[k] = form[k].trim();
      }
      await apiRequest('/employees', { method: 'POST', body });
      setForm({
        fullName: '',
        phone: '',
        designation: '',
        nationalId: '',
        hireDate: '',
        salary: '',
      });
      setShowForm(false);
      await load(search);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add the employee.');
    } finally {
      setSubmitting(false);
    }
  };

  const setStatus = async (id: string, status: EmployeeView['status']) => {
    setError(null);
    try {
      await apiRequest(`/employees/${id}`, { method: 'PATCH', body: { status } });
      await load(search);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update the employee.');
    }
  };

  const showPrivate = result?.items.some((x) => x.salary !== null) ?? false;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Employees</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          <Plus size={16} /> New Employee
        </Button>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {showForm ? (
        <Card>
          <CardBody>
            <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="m-name">Full name</Label>
                  <Input
                    id="m-name"
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="m-phone">Phone</Label>
                  <Input
                    id="m-phone"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="m-role">Designation</Label>
                  <Input
                    id="m-role"
                    value={form.designation}
                    onChange={(e) => setForm({ ...form, designation: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="m-nid">National ID</Label>
                  <Input
                    id="m-nid"
                    value={form.nationalId}
                    onChange={(e) => setForm({ ...form, nationalId: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="m-hire">Hire date</Label>
                  <Input
                    id="m-hire"
                    type="date"
                    value={form.hireDate}
                    onChange={(e) => setForm({ ...form, hireDate: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="m-salary">Monthly salary</Label>
                  <Input
                    id="m-salary"
                    value={form.salary}
                    onChange={(e) => setForm({ ...form, salary: e.target.value })}
                    inputMode="decimal"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting || !valid}>
                  {submitting ? 'Saving…' : 'Add employee'}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardBody className="space-y-4">
          <Input
            className="max-w-sm"
            placeholder="Search employees…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              void load(e.target.value);
            }}
          />
          {loading ? (
            <Spinner label="Loading employees…" />
          ) : !result || result.items.length === 0 ? (
            <EmptyState
              title="No employees"
              description="Add the people who work in your business."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Designation</th>
                    <th className="py-2 pr-4">Phone</th>
                    <th className="py-2 pr-4">Hired</th>
                    {showPrivate ? <th className="py-2 pr-4 text-right">Salary</th> : null}
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((x) => (
                    <tr key={x.id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-2.5 pr-4 font-medium">{x.fullName}</td>
                      <td className="py-2.5 pr-4">{x.designation ?? '—'}</td>
                      <td className="py-2.5 pr-4">{x.phone ?? '—'}</td>
                      <td className="py-2.5 pr-4">{x.hireDate ?? '—'}</td>
                      {showPrivate ? (
                        <td className="py-2.5 pr-4 text-right">{x.salary ?? '—'}</td>
                      ) : null}
                      <td className="py-2.5">
                        <select
                          aria-label={`Status of ${x.fullName}`}
                          className="focus-ring rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
                          value={x.status}
                          onChange={(e) =>
                            void setStatus(x.id, e.target.value as EmployeeView['status'])
                          }
                        >
                          {(Object.keys(STATUS_LABEL) as EmployeeView['status'][]).map((st) => (
                            <option key={st} value={st}>
                              {STATUS_LABEL[st]}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
};
