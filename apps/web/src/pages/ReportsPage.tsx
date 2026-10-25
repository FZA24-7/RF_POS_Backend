import { useState } from 'react';
import type { FormEvent } from 'react';
import { Download } from 'lucide-react';
import { apiDownload, apiRequest, ApiError } from '../api/client.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Input, Label } from '../components/ui/Input.js';
import { Spinner } from '../components/ui/Spinner.js';
import { ErrorBanner } from '../components/ui/ErrorBanner.js';

type Kind =
  | 'sales-summary'
  | 'daily'
  | 'hourly'
  | 'top-products'
  | 'by-cashier'
  | 'by-category'
  | 'profit-loss'
  | 'stock-valuation'
  | 'receivables'
  | 'payables';

const KINDS: { key: Kind; label: string; needsRange: boolean }[] = [
  { key: 'sales-summary', label: 'Sales summary', needsRange: true },
  { key: 'daily', label: 'Daily sales', needsRange: true },
  { key: 'hourly', label: 'Sales by hour', needsRange: true },
  { key: 'top-products', label: 'Top products', needsRange: true },
  { key: 'by-cashier', label: 'Sales by cashier', needsRange: true },
  { key: 'by-category', label: 'Sales by category', needsRange: true },
  { key: 'profit-loss', label: 'Profit & loss', needsRange: true },
  { key: 'stock-valuation', label: 'Stock valuation', needsRange: false },
  { key: 'receivables', label: 'Customer balances owed to you', needsRange: false },
  { key: 'payables', label: 'Supplier balances you owe', needsRange: false },
];

const day = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA');
const selectClass =
  'focus-ring w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800';

type Cell = string | number | null;
interface Table {
  head: string[];
  rows: Cell[][];
  right?: number[];
  foot?: Cell[];
}
interface Shown {
  title: string;
  note?: string;
  table: Table;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the report payloads are validated by the server; this maps them to rows */
const toTable = (kind: Kind, body: any): Shown => {
  switch (kind) {
    case 'sales-summary': {
      const s = body.data;
      return {
        title: 'Sales summary',
        table: {
          head: ['Metric', 'Value'],
          right: [1],
          rows: [
            ['Sales', s.saleCount],
            ['Gross sales', s.grossSales],
            ['Item discounts', s.itemDiscounts],
            ['Cart discounts', s.cartDiscounts],
            ['Tax', s.tax],
            ['Net sales', s.netSales],
            ['Refunds (' + s.refundCount + ')', s.refunds],
            ['Net after refunds', s.netAfterRefunds],
            ['Average sale', s.averageSale],
            ...s.paymentsByMethod.map((p: any) => [
              'Received - ' + String(p.method).replace('_', ' ').toLowerCase(),
              p.amount,
            ]),
            ...s.refundsByMethod.map((p: any) => [
              'Refunded - ' + String(p.method).replace('_', ' ').toLowerCase(),
              p.amount,
            ]),
          ],
        },
        note: 'Cash received is shown after giving change. "On account" is the part of sales put on a customer\'s credit.',
      };
    }
    case 'daily':
      return {
        title: 'Daily sales',
        table: {
          head: ['Date', 'Sales', 'Net sales'],
          right: [1, 2],
          rows: body.data.map((d: any) => [d.date, d.saleCount, d.netSales]),
        },
      };
    case 'hourly':
      return {
        title: 'Sales by hour',
        table: {
          head: ['Hour', 'Sales', 'Net sales'],
          right: [1, 2],
          rows: body.data.map((d: any) => [
            `${String(d.hour).padStart(2, '0')}:00`,
            d.saleCount,
            d.netSales,
          ]),
        },
      };
    case 'top-products':
      return {
        title: 'Top products',
        table: {
          head: ['Product', 'SKU', 'Qty sold', 'Qty returned', 'Revenue'],
          right: [2, 3, 4],
          rows: body.data.map((d: any) => [
            d.productName,
            d.sku,
            d.quantitySold,
            d.quantityReturned,
            d.revenue,
          ]),
        },
      };
    case 'by-cashier':
      return {
        title: 'Sales by cashier',
        table: {
          head: ['Cashier', 'Sales', 'Net sales'],
          right: [1, 2],
          rows: body.data.map((d: any) => [d.cashierName ?? d.cashierId, d.saleCount, d.netSales]),
        },
      };
    case 'by-category':
      return {
        title: 'Sales by category',
        table: {
          head: ['Category', 'Qty sold', 'Revenue'],
          right: [1, 2],
          rows: body.data.map((d: any) => [d.categoryName, d.quantitySold, d.revenue]),
        },
      };
    case 'profit-loss': {
      const p = body.data;
      return {
        title: 'Profit & loss',
        note: 'Revenue excludes tax and the share of refunded items. Cost of goods uses the cost recorded when each item was sold.',
        table: {
          head: ['Line', 'Amount'],
          right: [1],
          rows: [
            ['Revenue', p.revenue],
            ['Cost of goods', p.costOfGoods],
            ['Gross profit', p.grossProfit],
            ...p.expensesByCategory.map((e: any) => ['Expense - ' + e.category, e.amount]),
            ['Total expenses', p.expenses],
            ['Net profit', p.netProfit],
          ],
        },
      };
    }
    case 'stock-valuation':
      return {
        title: 'Stock valuation',
        table: {
          head: [
            'Product',
            'SKU',
            'Qty',
            'Cost price',
            'Selling price',
            'Cost value',
            'Retail value',
          ],
          right: [2, 3, 4, 5, 6],
          rows: body.data.rows.map((r: any) => [
            r.productName,
            r.sku,
            r.quantity,
            r.costPrice,
            r.sellingPrice,
            r.costValue,
            r.retailValue,
          ]),
          foot: ['Total', '', '', '', '', body.data.totalCostValue, body.data.totalRetailValue],
        },
      };
    case 'receivables':
    case 'payables':
      return {
        title: kind === 'receivables' ? 'Customers who owe you' : 'Suppliers you owe',
        table: {
          head: [kind === 'receivables' ? 'Customer' : 'Supplier', 'Phone', 'Balance'],
          right: [2],
          rows: body.rows.map((r: any) => [r.name, r.phone, r.balance]),
          foot: ['Total', '', body.total],
        },
      };
  }
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export const ReportsPage = () => {
  const [kind, setKind] = useState<Kind>('sales-summary');
  const [from, setFrom] = useState(day(-29));
  const [to, setTo] = useState(day(0));
  const [shown, setShown] = useState<Shown | null>(null);
  const [meta, setMeta] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const def = KINDS.find((k) => k.key === kind)!;
  const path = (): string => `/reports/${kind}${def.needsRange ? `?from=${from}&to=${to}` : ''}`;
  const rangeOk =
    !def.needsRange ||
    (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to);

  const run = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const body = await apiRequest<{ meta?: { timeZone: string; currency: string } }>(path());
      setShown(toTable(kind, body));
      setMeta(
        body.meta
          ? `Days are calendar days in ${body.meta.timeZone}; amounts in ${body.meta.currency}.`
          : null,
      );
    } catch (err) {
      setShown(null);
      setError(err instanceof ApiError ? err.message : 'Could not run the report.');
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = async () => {
    setError(null);
    try {
      await apiDownload(`${path()}${path().includes('?') ? '&' : '?'}format=csv`, `${kind}.csv`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not export the report.');
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Reports</h1>
      {error ? <ErrorBanner message={error} /> : null}
      <Card>
        <CardBody>
          <form onSubmit={(e) => void run(e)} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem]">
              <Label htmlFor="r-kind">Report</Label>
              <select
                id="r-kind"
                className={selectClass}
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as Kind);
                  setShown(null);
                }}
              >
                {KINDS.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
            {def.needsRange ? (
              <>
                <div>
                  <Label htmlFor="r-from">From</Label>
                  <Input
                    id="r-from"
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="r-to">To</Label>
                  <Input id="r-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
              </>
            ) : null}
            <Button type="submit" disabled={loading || !rangeOk}>
              Run report
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!shown || loading}
              onClick={() => void exportCsv()}
            >
              <Download size={16} /> Export CSV
            </Button>
          </form>
          {def.needsRange && !rangeOk ? (
            <p className="mt-2 text-sm text-red-600">
              Choose a valid range (From must not be after To; at most 366 days).
            </p>
          ) : null}
        </CardBody>
      </Card>

      {loading ? <Spinner label="Running report…" /> : null}
      {shown ? (
        <Card>
          <CardBody className="space-y-3">
            <h2 className="text-base font-semibold">{shown.title}</h2>
            {meta ? <p className="text-xs text-slate-500">{meta}</p> : null}
            {shown.note ? <p className="text-xs text-slate-500">{shown.note}</p> : null}
            {shown.table.rows.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing to show for this selection.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm" aria-label={shown.title}>
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      {shown.table.head.map((h, i) => (
                        <th
                          key={h}
                          className={`py-2 pr-4 ${shown.table.right?.includes(i) ? 'text-right' : ''}`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.table.rows.map((r, ri) => (
                      <tr key={ri} className="border-b border-slate-100 dark:border-slate-800">
                        {r.map((c, ci) => (
                          <td
                            key={ci}
                            className={`py-2 pr-4 ${shown.table.right?.includes(ci) ? 'text-right' : ''}`}
                          >
                            {c ?? '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {shown.table.foot ? (
                      <tr className="font-semibold">
                        {shown.table.foot.map((c, ci) => (
                          <td
                            key={ci}
                            className={`py-2 pr-4 ${shown.table.right?.includes(ci) ? 'text-right' : ''}`}
                          >
                            {c}
                          </td>
                        ))}
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
};
