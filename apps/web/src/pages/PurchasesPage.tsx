import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, FileText, Plus, Search } from 'lucide-react';
import { isNonNegativeDecimalString } from '@mafk/shared';
import { apiRequest, ApiError } from '../api/client.js';
import type {
  PaymentMethod,
  PurchaseDetail,
  PurchaseListResult,
  PurchasePaymentStatus,
  SupplierSummary,
} from '../api/types.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Button } from '../components/ui/Button.js';
import { Input, Label } from '../components/ui/Input.js';
import { Spinner } from '../components/ui/Spinner.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { ErrorBanner } from '../components/ui/ErrorBanner.js';
import { PurchaseForm } from '../components/PurchaseForm.js';
import { PurchaseInvoiceDocument } from '../components/PurchaseInvoiceDocument.js';
import {
  InvoiceActions,
  PurchaseInvoiceModal,
  usePurchaseInvoice,
} from '../components/PurchaseInvoiceModal.js';

const selectClass =
  'focus-ring rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

const statusTone = (s: PurchasePaymentStatus): 'green' | 'amber' | 'red' =>
  s === 'PAID' ? 'green' : s === 'PARTIAL' ? 'amber' : 'red';

type Mode = { name: 'list' } | { name: 'new' } | { name: 'detail'; purchaseId: string };

export const PurchasesPage = () => {
  const [mode, setMode] = useState<Mode>({ name: 'list' });
  // The invoice that auto-opens after "Record Purchase", or on the list's Invoice action.
  const [invoiceFor, setInvoiceFor] = useState<string | null>(null);

  return (
    <>
      {mode.name === 'list' ? (
        <PurchaseList
          onNew={() => setMode({ name: 'new' })}
          onOpen={(id) => setMode({ name: 'detail', purchaseId: id })}
          onInvoice={(id) => setInvoiceFor(id)}
        />
      ) : null}
      {mode.name === 'new' ? (
        <PurchaseForm
          onCancel={() => setMode({ name: 'list' })}
          onRecorded={(purchase: PurchaseDetail) => {
            // Saved + committed on the server: leave the form and open the invoice automatically.
            setMode({ name: 'list' });
            setInvoiceFor(purchase.id);
          }}
        />
      ) : null}
      {mode.name === 'detail' ? (
        <PurchaseDetailView purchaseId={mode.purchaseId} onBack={() => setMode({ name: 'list' })} />
      ) : null}
      {invoiceFor ? (
        <PurchaseInvoiceModal
          purchaseId={invoiceFor}
          onClose={() => setInvoiceFor(null)}
          onViewPurchase={() => {
            setMode({ name: 'detail', purchaseId: invoiceFor });
            setInvoiceFor(null);
          }}
        />
      ) : null}
    </>
  );
};

const PurchaseList = ({
  onNew,
  onOpen,
  onInvoice,
}: {
  onNew: () => void;
  onOpen: (id: string) => void;
  onInvoice: (id: string) => void;
}) => {
  const [result, setResult] = useState<PurchaseListResult | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierSummary[]>([]);
  const [search, setSearch] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [status, setStatus] = useState<'' | PurchasePaymentStatus>('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (search.trim()) q.set('search', search.trim());
      if (supplierId) q.set('supplierId', supplierId);
      if (status) q.set('paymentStatus', status);
      setResult(await apiRequest<PurchaseListResult>(`/purchases?${q.toString()}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load purchases.');
    } finally {
      setLoading(false);
    }
  }, [page, search, supplierId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        setSuppliers(await apiRequest<SupplierSummary[]>('/suppliers'));
      } catch {
        setSuppliers([]);
      }
    })();
  }, []);

  const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? '—';
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Purchases</h1>
        <Button onClick={onNew}>
          <Plus size={16} /> New Purchase
        </Button>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400"
                size={16}
              />
              <Input
                className="w-64 pl-8"
                placeholder="Search purchase / invoice no…"
                value={search}
                onChange={(e) => {
                  setPage(1);
                  setSearch(e.target.value);
                }}
              />
            </div>
            <select
              aria-label="Filter by supplier"
              className={selectClass}
              value={supplierId}
              onChange={(e) => {
                setPage(1);
                setSupplierId(e.target.value);
              }}
            >
              <option value="">All suppliers</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by payment status"
              className={selectClass}
              value={status}
              onChange={(e) => {
                setPage(1);
                setStatus(e.target.value as '' | PurchasePaymentStatus);
              }}
            >
              <option value="">Any payment status</option>
              <option value="UNPAID">Unpaid</option>
              <option value="PARTIAL">Partially paid</option>
              <option value="PAID">Paid</option>
            </select>
          </div>

          {loading ? (
            <Spinner label="Loading purchases…" />
          ) : !result || result.items.length === 0 ? (
            <EmptyState
              title="No purchases found"
              description="Record your first purchase to see it here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <th className="py-2 pr-4">Purchase no.</th>
                    <th className="py-2 pr-4">Supplier invoice</th>
                    <th className="py-2 pr-4">Supplier</th>
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4 text-right">Total</th>
                    <th className="py-2 pr-4 text-right">Paid</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-2.5 pr-4 font-mono text-xs">{p.purchaseNo}</td>
                      <td className="py-2.5 pr-4">{p.invoiceNo}</td>
                      <td className="py-2.5 pr-4">{supplierName(p.supplierId)}</td>
                      <td className="py-2.5 pr-4">{p.purchaseDate.slice(0, 10)}</td>
                      <td className="py-2.5 pr-4 text-right">{p.total}</td>
                      <td className="py-2.5 pr-4 text-right">{p.paidAmount}</td>
                      <td className="py-2.5 pr-4">
                        <Badge tone={statusTone(p.paymentStatus)}>{p.paymentStatus}</Badge>
                      </td>
                      <td className="flex gap-1 py-2">
                        <Button variant="ghost" onClick={() => onOpen(p.id)}>
                          View
                        </Button>
                        <Button variant="ghost" onClick={() => onInvoice(p.id)}>
                          <FileText size={14} /> Invoice
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result && result.total > result.pageSize ? (
            <div className="flex items-center justify-end gap-2 text-sm">
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span>
                Page {page} of {totalPages}
              </span>
              <Button
                variant="secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
};

const PurchaseDetailView = ({ purchaseId, onBack }: { purchaseId: string; onBack: () => void }) => {
  const { invoice, loading, error, reload } = usePurchaseInvoice(purchaseId);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [payOk, setPayOk] = useState<string | null>(null);

  const onPay = async (e: FormEvent) => {
    e.preventDefault();
    setPaying(true);
    setPayError(null);
    setPayOk(null);
    try {
      await apiRequest(`/purchases/${purchaseId}/payments`, {
        method: 'POST',
        body: { amount: amount.trim(), method },
      });
      setAmount('');
      setPayOk('Payment recorded.');
      await reload();
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : 'Failed to record the payment.');
    } finally {
      setPaying(false);
    }
  };

  const payValid = isNonNegativeDecimalString(amount.trim() || 'x', 2) && amount.trim() !== '0';

  return (
    <div className="space-y-4">
      <Button variant="ghost" className="no-print" onClick={onBack}>
        <ArrowLeft size={16} /> Back to purchases
      </Button>
      {loading && !invoice ? <Spinner label="Loading purchase…" /> : null}
      {error ? <ErrorBanner message={error} /> : null}
      {invoice ? (
        <>
          <PurchaseInvoiceDocument invoice={invoice} />
          <InvoiceActions
            purchaseId={purchaseId}
            purchaseNo={invoice.purchase.purchaseNo}
            reprint={async () => (await reload()) !== null}
          />
          {invoice.purchase.paymentStatus !== 'PAID' ? (
            <Card className="no-print">
              <CardBody>
                <form onSubmit={onPay} className="flex flex-wrap items-end gap-3" noValidate>
                  <div>
                    <Label htmlFor="pay-amount">
                      Record payment (outstanding {invoice.outstanding})
                    </Label>
                    <Input
                      id="pay-amount"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <Label htmlFor="pay-method">Method</Label>
                    <select
                      id="pay-method"
                      className={selectClass}
                      value={method}
                      onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                    >
                      <option value="CASH">Cash</option>
                      <option value="CARD">Card</option>
                      <option value="BANK_TRANSFER">Bank transfer</option>
                    </select>
                  </div>
                  <Button type="submit" disabled={paying || !payValid}>
                    {paying ? 'Saving…' : 'Record payment'}
                  </Button>
                </form>
                {payError ? (
                  <div className="mt-3">
                    <ErrorBanner message={payError} />
                  </div>
                ) : null}
                {payOk ? (
                  <p className="mt-3 text-sm text-green-700 dark:text-green-400">{payOk}</p>
                ) : null}
              </CardBody>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
};
