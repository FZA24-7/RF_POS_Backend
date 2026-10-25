import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, Receipt, Search } from 'lucide-react';
import { apiRequest, ApiError } from '../api/client.js';
import type {
  ReceiptFormat,
  SaleDetail,
  SaleListResult,
  SaleReturnDetail,
  SaleStatus,
  TenderMethod,
} from '../api/types.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Button } from '../components/ui/Button.js';
import { Input, Label } from '../components/ui/Input.js';
import { Spinner } from '../components/ui/Spinner.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { ErrorBanner } from '../components/ui/ErrorBanner.js';
import { ReceiptModal } from '../components/ReceiptModal.js';

const tone = (s: SaleStatus): 'green' | 'amber' | 'red' | 'slate' =>
  s === 'COMPLETED'
    ? 'green'
    : s === 'PARTIALLY_REFUNDED'
      ? 'amber'
      : s === 'REFUNDED'
        ? 'red'
        : 'slate';

const QTY_RE = /^\d{1,11}(\.\d{1,3})?$/;
const selectClass =
  'focus-ring rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

type Receipt = { basePath: string; number: string; format?: ReceiptFormat };

export const SalesPage = () => {
  const [openId, setOpenId] = useState<string | null>(null);
  return openId ? (
    <SaleDetailView saleId={openId} onBack={() => setOpenId(null)} />
  ) : (
    <SaleList onOpen={setOpenId} />
  );
};

const SaleList = ({ onOpen }: { onOpen: (id: string) => void }) => {
  const [search, setSearch] = useState('');
  const [data, setData] = useState<SaleListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (q: string) => {
    setError(null);
    try {
      setData(
        await apiRequest<SaleListResult>(
          `/sales?pageSize=50${q ? `&search=${encodeURIComponent(q)}` : ''}`,
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load sales.');
    }
  }, []);
  useEffect(() => {
    void load('');
  }, [load]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void load(search.trim());
  };
  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="flex gap-2" role="search">
        <div className="flex-1">
          <Label htmlFor="sale-search">Search by invoice number or customer</Label>
          <Input id="sale-search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button type="submit" className="self-end">
          <Search size={16} /> Search
        </Button>
      </form>
      {error ? <ErrorBanner message={error} /> : null}
      {!data && !error ? <Spinner label="Loading sales…" /> : null}
      {data && data.items.length === 0 ? <EmptyState title="No sales found" /> : null}
      {data && data.items.length > 0 ? (
        <Card>
          <CardBody>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1">Invoice</th>
                  <th className="py-1">Date</th>
                  <th className="py-1">Customer</th>
                  <th className="py-1">Status</th>
                  <th className="py-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((s) => (
                  <tr key={s.id} className="border-t border-slate-200 dark:border-slate-800">
                    <td className="py-2">
                      <button className="text-brand-600 underline" onClick={() => onOpen(s.id)}>
                        {s.invoiceNo}
                      </button>
                    </td>
                    <td className="py-2">{s.soldAt.slice(0, 16).replace('T', ' ')}</td>
                    <td className="py-2">{s.customerName ?? '—'}</td>
                    <td className="py-2">
                      <Badge tone={tone(s.status)}>{s.status.replace('_', ' ')}</Badge>
                    </td>
                    <td className="py-2 text-right">{s.grandTotal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
};

const SaleDetailView = ({ saleId, onBack }: { saleId: string; onBack: () => void }) => {
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [method, setMethod] = useState<TenderMethod>('CASH');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSale(await apiRequest<SaleDetail>(`/sales/${saleId}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load the sale.');
    }
  }, [saleId]);
  useEffect(() => {
    void load();
  }, [load]);

  const refund = async () => {
    if (!sale || busy) return;
    const items = Object.entries(qty)
      .filter(([, q]) => q !== '' && /[1-9]/.test(q))
      .map(([saleItemId, quantity]) => ({ saleItemId, quantity }));
    if (items.length === 0) return setError('Enter a quantity to return for at least one item.');
    if (items.some((i) => !QTY_RE.test(i.quantity)))
      return setError('Quantities must be positive numbers with at most 3 decimals.');
    setBusy(true);
    setError(null);
    try {
      const ret = await apiRequest<SaleReturnDetail>(`/sales/${sale.id}/returns`, {
        method: 'POST',
        body: { items, refundMethod: method, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      });
      setQty({});
      setReason('');
      await load();
      setReceipt({ basePath: `/sale-returns/${ret.id}`, number: ret.returnNo });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Refund failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!sale) return error ? <ErrorBanner message={error} /> : <Spinner label="Loading sale…" />;
  const refundable = sale.status === 'COMPLETED' || sale.status === 'PARTIALLY_REFUNDED';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={16} /> Back
        </Button>
        <h2 className="text-lg font-semibold">{sale.invoiceNo}</h2>
        <Badge tone={tone(sale.status)}>{sale.status.replace('_', ' ')}</Badge>
        <Button
          variant="secondary"
          className="ml-auto"
          onClick={() => setReceipt({ basePath: `/sales/${sale.id}`, number: sale.invoiceNo })}
        >
          <Receipt size={16} /> Receipt
        </Button>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      <Card>
        <CardBody>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1">Item</th>
                <th className="py-1 text-right">Sold</th>
                <th className="py-1 text-right">Returned</th>
                <th className="py-1 text-right">Total</th>
                {refundable ? <th className="py-1 text-right">Return qty</th> : null}
              </tr>
            </thead>
            <tbody>
              {sale.items.map((i) => (
                <tr key={i.id} className="border-t border-slate-200 dark:border-slate-800">
                  <td className="py-2">
                    {i.productName} <span className="text-slate-500">{i.sku}</span>
                  </td>
                  <td className="py-2 text-right">{i.quantity}</td>
                  <td className="py-2 text-right">{i.returnedQuantity}</td>
                  <td className="py-2 text-right">{i.lineTotal}</td>
                  {refundable ? (
                    <td className="py-2 text-right">
                      <Input
                        aria-label={`Return quantity ${i.productName}`}
                        className="ml-auto w-24"
                        value={qty[i.id] ?? ''}
                        onChange={(e) => setQty((p) => ({ ...p, [i.id]: e.target.value }))}
                        inputMode="decimal"
                        placeholder="0"
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex justify-end text-base font-bold">Total {sale.grandTotal}</div>
        </CardBody>
      </Card>

      {refundable ? (
        <Card>
          <CardBody className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="refund-method">Refund method</Label>
              <select
                id="refund-method"
                className={selectClass}
                value={method}
                onChange={(e) => setMethod(e.target.value as TenderMethod)}
              >
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="CUSTOMER_CREDIT">Customer account (credit)</option>
              </select>
            </div>
            <div className="min-w-[14rem] flex-1">
              <Label htmlFor="refund-reason">Reason (optional)</Label>
              <Input
                id="refund-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={300}
              />
            </div>
            <Button variant="danger" disabled={busy} onClick={() => void refund()}>
              {busy ? 'Refunding…' : 'Process refund'}
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {sale.returns.length > 0 ? (
        <Card>
          <CardBody>
            <h3 className="mb-2 text-sm font-semibold">Refunds</h3>
            <ul className="space-y-1 text-sm">
              {sale.returns.map((r) => (
                <li key={r.id} className="flex items-center justify-between">
                  <span>
                    {r.returnNo} · {r.refundMethod.replace('_', ' ')} · {r.refundTotal}
                    {r.reason ? ` · ${r.reason}` : ''}
                  </span>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setReceipt({ basePath: `/sale-returns/${r.id}`, number: r.returnNo })
                    }
                  >
                    Slip
                  </Button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {receipt ? (
        <ReceiptModal
          basePath={receipt.basePath}
          number={receipt.number}
          initialFormat={receipt.format}
          onClose={() => setReceipt(null)}
        />
      ) : null}
    </div>
  );
};
