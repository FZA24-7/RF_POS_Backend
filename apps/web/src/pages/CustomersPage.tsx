import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { apiRequest, ApiError } from '../api/client.js';
import type { CashMethod, CustomerListResult, CustomerWithBalance, Ledger } from '../api/types.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Input, Label } from '../components/ui/Input.js';
import { Spinner } from '../components/ui/Spinner.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { ErrorBanner } from '../components/ui/ErrorBanner.js';
import { LedgerTable } from '../components/LedgerTable.js';

const MONEY_RE = /^\d{1,14}(\.\d{1,2})?$/;
const selectClass =
  'focus-ring w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800';

const balanceText = (b: string): string =>
  b.startsWith('-') ? `${b.slice(1)} in credit` : b === '0.00' ? '0.00' : `${b} owed`;

const CustomerDetail = ({ id, onChanged }: { id: string; onChanged: () => void }) => {
  const [customer, setCustomer] = useState<CustomerWithBalance | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<CashMethod>('CASH');
  const [reference, setReference] = useState('');
  const [limit, setLimit] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, l] = await Promise.all([
        apiRequest<CustomerWithBalance>(`/customers/${id}`),
        apiRequest<Ledger>(`/customers/${id}/ledger`),
      ]);
      setCustomer(c);
      setLedger(l);
      setLimit(c.creditLimit ?? '');
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load the customer.');
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (work: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const pay = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await apiRequest(`/customers/${id}/payments`, {
        method: 'POST',
        body: { amount, method, ...(reference.trim() ? { reference: reference.trim() } : {}) },
      });
      setAmount('');
      setReference('');
    }, 'Could not record the payment.');
  };

  if (!customer || !ledger)
    return error ? <ErrorBanner message={error} /> : <Spinner label="Loading customer…" />;

  const owes = !customer.balance.startsWith('-') && customer.balance !== '0.00';
  return (
    <Card>
      <CardBody className="space-y-4">
        {error ? <ErrorBanner message={error} /> : null}
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">{customer.name}</h2>
          <p className="text-sm" data-testid="customer-balance">
            Balance: <strong>{balanceText(customer.balance)}</strong>
            <span className="ml-3 text-slate-500">
              Credit limit:{' '}
              {customer.creditLimit && customer.creditLimit !== '0.00'
                ? customer.creditLimit
                : 'none (no credit)'}
            </span>
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <form onSubmit={pay} className="space-y-2" aria-label="Record payment">
            <h3 className="text-sm font-medium">Record a payment received</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="cp-amount">Amount</Label>
                <Input
                  id="cp-amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label htmlFor="cp-method">Method</Label>
                <select
                  id="cp-method"
                  className={selectClass}
                  value={method}
                  onChange={(e) => setMethod(e.target.value as CashMethod)}
                >
                  <option value="CASH">Cash</option>
                  <option value="CARD">Card</option>
                  <option value="BANK_TRANSFER">Bank transfer</option>
                </select>
              </div>
            </div>
            <div>
              <Label htmlFor="cp-ref">Reference (optional)</Label>
              <Input
                id="cp-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={64}
              />
            </div>
            <Button
              type="submit"
              disabled={busy || !owes || !MONEY_RE.test(amount) || !/[1-9]/.test(amount)}
            >
              Record payment
            </Button>
            {!owes ? (
              <p className="text-xs text-slate-500">
                Nothing is owed, so there is nothing to pay off.
              </p>
            ) : null}
          </form>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">Credit settings</h3>
            <div>
              <Label htmlFor="cd-limit">Credit limit (empty or 0 = no credit)</Label>
              <Input
                id="cd-limit"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                inputMode="decimal"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={busy || (limit !== '' && !MONEY_RE.test(limit))}
                onClick={() =>
                  void run(
                    () =>
                      apiRequest(`/customers/${id}`, {
                        method: 'PATCH',
                        body: { creditLimit: limit === '' ? null : limit },
                      }),
                    'Could not save the credit limit.',
                  )
                }
              >
                Save limit
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      apiRequest(`/customers/${id}`, {
                        method: 'PATCH',
                        body: { isActive: !customer.isActive },
                      }),
                    'Could not update the customer.',
                  )
                }
              >
                {customer.isActive ? 'Deactivate' : 'Reactivate'}
              </Button>
            </div>
          </div>
        </div>

        <h3 className="text-sm font-medium">Ledger</h3>
        <LedgerTable ledger={ledger} />
      </CardBody>
    </Card>
  );
};

export const CustomersPage = () => {
  const [result, setResult] = useState<CustomerListResult | null>(null);
  const [search, setSearch] = useState('');
  const [owingOnly, setOwingOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', openingBalance: '', creditLimit: '' });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (term: string, owing: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ pageSize: '100' });
      if (term) q.set('search', term);
      if (owing) q.set('withBalanceOnly', 'true');
      setResult(await apiRequest<CustomerListResult>(`/customers?${q.toString()}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load customers.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load('', false);
  }, [load]);

  const formValid =
    form.name.trim().length >= 2 &&
    (form.openingBalance === '' || MONEY_RE.test(form.openingBalance)) &&
    (form.creditLimit === '' || MONEY_RE.test(form.creditLimit));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const created = await apiRequest<CustomerWithBalance>('/customers', {
        method: 'POST',
        body: {
          name: form.name.trim(),
          ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
          ...(form.openingBalance ? { openingBalance: form.openingBalance } : {}),
          ...(form.creditLimit ? { creditLimit: form.creditLimit } : {}),
        },
      });
      setForm({ name: '', phone: '', openingBalance: '', creditLimit: '' });
      setShowForm(false);
      setSelected(created.id);
      await load(search, owingOnly);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create the customer.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Customers</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          <Plus size={16} /> New Customer
        </Button>
      </div>
      {error ? <ErrorBanner message={error} /> : null}

      {showForm ? (
        <Card>
          <CardBody>
            <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="c-name">Name</Label>
                  <Input
                    id="c-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="c-phone">Phone</Label>
                  <Input
                    id="c-phone"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="c-open">Opening balance owed (optional)</Label>
                  <Input
                    id="c-open"
                    value={form.openingBalance}
                    onChange={(e) => setForm({ ...form, openingBalance: e.target.value })}
                    inputMode="decimal"
                  />
                </div>
                <div>
                  <Label htmlFor="c-limit">Credit limit (optional)</Label>
                  <Input
                    id="c-limit"
                    value={form.creditLimit}
                    onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
                    inputMode="decimal"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Setting a credit limit or opening balance needs the “edit customers” permission.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting || !formValid}>
                  {submitting ? 'Creating…' : 'Create customer'}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <Input
              className="max-w-sm"
              placeholder="Search by name or phone…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                void load(e.target.value, owingOnly);
              }}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={owingOnly}
                onChange={(e) => {
                  setOwingOnly(e.target.checked);
                  void load(search, e.target.checked);
                }}
              />
              With a balance only
            </label>
          </div>
          {loading ? (
            <Spinner label="Loading customers…" />
          ) : !result || result.items.length === 0 ? (
            <EmptyState
              title="No customers"
              description="Add a customer to sell on account or keep a ledger."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Phone</th>
                    <th className="py-2 pr-4 text-right">Balance</th>
                    <th className="py-2 pr-4 text-right">Credit limit</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((c) => (
                    <tr
                      key={c.id}
                      className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 ${selected === c.id ? 'bg-slate-50 dark:bg-slate-800' : ''}`}
                      onClick={() => setSelected(c.id)}
                    >
                      <td className="py-2.5 pr-4 font-medium">
                        <button
                          type="button"
                          className="text-left underline-offset-2 hover:underline"
                          onClick={() => setSelected(c.id)}
                        >
                          {c.name}
                        </button>
                      </td>
                      <td className="py-2.5 pr-4">{c.phone ?? '—'}</td>
                      <td className="py-2.5 pr-4 text-right">{c.balance}</td>
                      <td className="py-2.5 pr-4 text-right">{c.creditLimit ?? '—'}</td>
                      <td className="py-2.5">{c.isActive ? 'Active' : 'Inactive'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {selected ? (
        <CustomerDetail
          key={selected}
          id={selected}
          onChanged={() => void load(search, owingOnly)}
        />
      ) : null}
    </div>
  );
};
