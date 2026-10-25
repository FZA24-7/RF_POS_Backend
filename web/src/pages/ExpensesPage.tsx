import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { apiRequest, ApiError } from '../api/client.js';
import type { CashMethod, ExpenseListResult, StoreSummary } from '../api/types.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Input, Label } from '../components/ui/Input.js';
import { Spinner } from '../components/ui/Spinner.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { ErrorBanner } from '../components/ui/ErrorBanner.js';

const MONEY_RE = /^\d{1,14}(\.\d{1,2})?$/;
const today = (): string => new Date().toLocaleDateString('en-CA');
const selectClass =
  'focus-ring w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800';

export const ExpensesPage = () => {
  const [stores, setStores] = useState<StoreSummary[]>([]);
  const [result, setResult] = useState<ExpenseListResult | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    storeId: '',
    category: '',
    amount: '',
    expenseDate: today(),
    method: 'CASH' as CashMethod,
    description: '',
  });

  const load = useCallback(async (f: string, t: string, c: string) => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ pageSize: '100' });
      if (f) q.set('from', f);
      if (t) q.set('to', t);
      if (c.trim()) q.set('category', c.trim());
      setResult(await apiRequest<ExpenseListResult>(`/expenses?${q.toString()}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load expenses.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('', '', '');
    void (async () => {
      try {
        const s = await apiRequest<StoreSummary[]>('/stores');
        setStores(s);
        setForm((prev) => ({ ...prev, storeId: prev.storeId || s[0]?.id || '' }));
      } catch {
        setStores([]);
      }
    })();
  }, [load]);

  const valid =
    form.storeId !== '' &&
    form.category.trim().length >= 2 &&
    MONEY_RE.test(form.amount) &&
    /[1-9]/.test(form.amount) &&
    /^\d{4}-\d{2}-\d{2}$/.test(form.expenseDate);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest('/expenses', {
        method: 'POST',
        body: {
          storeId: form.storeId,
          category: form.category.trim(),
          amount: form.amount,
          expenseDate: form.expenseDate,
          method: form.method,
          ...(form.description.trim() ? { description: form.description.trim() } : {}),
        },
      });
      setForm({ ...form, category: '', amount: '', description: '' });
      setShowForm(false);
      await load(from, to, category);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record the expense.');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this expense? This cannot be undone.')) return;
    setError(null);
    try {
      await apiRequest(`/expenses/${id}`, { method: 'DELETE' });
      await load(from, to, category);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete the expense.');
    }
  };

  const storeName = (id: string): string => stores.find((s) => s.id === id)?.name ?? '—';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Expenses</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          <Plus size={16} /> New Expense
        </Button>
      </div>
      {error ? <ErrorBanner message={error} /> : null}

      {showForm ? (
        <Card>
          <CardBody>
            <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="e-store">Branch</Label>
                  <select
                    id="e-store"
                    className={selectClass}
                    value={form.storeId}
                    onChange={(e) => setForm({ ...form, storeId: e.target.value })}
                  >
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="e-cat">Expense category</Label>
                  <Input
                    id="e-cat"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    placeholder="Rent, Electricity, Salaries…"
                  />
                </div>
                <div>
                  <Label htmlFor="e-amount">Amount</Label>
                  <Input
                    id="e-amount"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <Label htmlFor="e-date">Date</Label>
                  <Input
                    id="e-date"
                    type="date"
                    value={form.expenseDate}
                    onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="e-method">Paid by</Label>
                  <select
                    id="e-method"
                    className={selectClass}
                    value={form.method}
                    onChange={(e) => setForm({ ...form, method: e.target.value as CashMethod })}
                  >
                    <option value="CASH">Cash</option>
                    <option value="CARD">Card</option>
                    <option value="BANK_TRANSFER">Bank transfer</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="e-desc">Note (optional)</Label>
                  <Input
                    id="e-desc"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    maxLength={300}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting || !valid}>
                  {submitting ? 'Saving…' : 'Save expense'}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="f-from">From</Label>
              <Input
                id="f-from"
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  void load(e.target.value, to, category);
                }}
              />
            </div>
            <div>
              <Label htmlFor="f-to">To</Label>
              <Input
                id="f-to"
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  void load(from, e.target.value, category);
                }}
              />
            </div>
            <div>
              <Label htmlFor="f-cat">Filter by category</Label>
              <Input
                id="f-cat"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  void load(from, to, e.target.value);
                }}
              />
            </div>
            {result ? (
              <p className="ml-auto text-sm" data-testid="expense-total">
                {result.total} expense{result.total === 1 ? '' : 's'} · Total{' '}
                <strong>{result.totalAmount}</strong>
              </p>
            ) : null}
          </div>
          {loading ? (
            <Spinner label="Loading expenses…" />
          ) : !result || result.items.length === 0 ? (
            <EmptyState
              title="No expenses"
              description="Record rent, utilities, salaries and other running costs."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Category</th>
                    <th className="py-2 pr-4">Branch</th>
                    <th className="py-2 pr-4">Paid by</th>
                    <th className="py-2 pr-4 text-right">Amount</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((x) => (
                    <tr key={x.id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-2.5 pr-4">{x.expenseDay}</td>
                      <td className="py-2.5 pr-4">
                        {x.category}
                        {x.description ? (
                          <span className="block text-xs text-slate-500">{x.description}</span>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-4">{storeName(x.storeId)}</td>
                      <td className="py-2.5 pr-4">{x.method.replace('_', ' ').toLowerCase()}</td>
                      <td className="py-2.5 pr-4 text-right">{x.amount}</td>
                      <td className="py-2.5 text-right">
                        <Button
                          variant="ghost"
                          aria-label={`Delete ${x.category} expense`}
                          onClick={() => void remove(x.id)}
                        >
                          <Trash2 size={16} />
                        </Button>
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
