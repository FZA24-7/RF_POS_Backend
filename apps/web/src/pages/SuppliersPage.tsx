import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { apiRequest, ApiError } from '../api/client.js';
import type { Ledger, SupplierSummary } from '../api/types.js';
import { LedgerTable } from '../components/LedgerTable.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Input, Label } from '../components/ui/Input.js';
import { Spinner } from '../components/ui/Spinner.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { ErrorBanner } from '../components/ui/ErrorBanner.js';

export const SuppliersPage = () => {
  const [suppliers, setSuppliers] = useState<SupplierSummary[] | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [ledger, setLedger] = useState<{ name: string; data: Ledger } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (term: string) => {
    setLoading(true);
    setError(null);
    try {
      const q = term ? `?search=${encodeURIComponent(term)}` : '';
      setSuppliers(await apiRequest<SupplierSummary[]>(`/suppliers${q}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load suppliers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  const openLedger = async (s: SupplierSummary) => {
    setError(null);
    try {
      setLedger({ name: s.name, data: await apiRequest<Ledger>(`/suppliers/${s.id}/ledger`) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load the ledger.');
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest('/suppliers', {
        method: 'POST',
        body: {
          name,
          phone: phone || undefined,
          email: email || undefined,
          address: address || undefined,
          openingBalance: openingBalance || undefined,
        },
      });
      setName('');
      setPhone('');
      setEmail('');
      setAddress('');
      setOpeningBalance('');
      setShowForm(false);
      await load(search);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create supplier.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Suppliers</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          <Plus size={16} /> New Supplier
        </Button>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {showForm ? (
        <Card>
          <CardBody>
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="s-name">Name</Label>
                  <Input
                    id="s-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="s-phone">Phone</Label>
                  <Input id="s-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="s-email">Email</Label>
                  <Input
                    id="s-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="s-address">Address</Label>
                  <Input
                    id="s-address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="s-opening">Opening balance we owe (optional)</Label>
                  <Input
                    id="s-opening"
                    value={openingBalance}
                    onChange={(e) => setOpeningBalance(e.target.value)}
                    inputMode="decimal"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    submitting ||
                    name.trim().length < 2 ||
                    (openingBalance !== '' && !/^\d{1,14}(\.\d{1,2})?$/.test(openingBalance))
                  }
                >
                  {submitting ? 'Creating…' : 'Create supplier'}
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
            placeholder="Search suppliers…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              void load(e.target.value);
            }}
          />
          {loading ? (
            <Spinner label="Loading suppliers…" />
          ) : !suppliers || suppliers.length === 0 ? (
            <EmptyState
              title="No suppliers yet"
              description="Add a supplier to start recording purchases."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Phone</th>
                    <th className="py-2 pr-4">Email</th>
                    <th className="py-2 pr-4">Address</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => (
                    <tr key={s.id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-2.5 pr-4 font-medium">{s.name}</td>
                      <td className="py-2.5 pr-4">{s.phone ?? '—'}</td>
                      <td className="py-2.5 pr-4">{s.email ?? '—'}</td>
                      <td className="py-2.5 pr-4">{s.address ?? '—'}</td>
                      <td className="py-2.5 text-right">
                        <Button variant="ghost" onClick={() => void openLedger(s)}>
                          Ledger
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
      {ledger ? (
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-base font-semibold">Ledger: {ledger.name}</h2>
              <p className="text-sm" data-testid="supplier-balance">
                We owe: <strong>{ledger.data.balance}</strong>
              </p>
            </div>
            <LedgerTable ledger={ledger.data} />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
};
