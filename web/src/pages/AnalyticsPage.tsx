import { useCallback, useEffect, useState } from 'react';
import { apiRequest, ApiError } from '../api/client.js';
import type { AnalyticsOverview } from '../api/types.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { Input, Label } from '../components/ui/Input.js';
import { Spinner } from '../components/ui/Spinner.js';
import { ErrorBanner } from '../components/ui/ErrorBanner.js';

const day = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA');

/** Bars are drawn from the numbers only for their LENGTH; every figure shown is the server's exact string. */
const Bars = ({
  items,
  label,
}: {
  items: { key: string; label: string; value: string }[];
  label: string;
}) => {
  const max = Math.max(0, ...items.map((i) => Number.parseFloat(i.value)));
  return (
    <ul className="space-y-1.5" aria-label={label}>
      {items.map((i) => (
        <li key={i.key} className="grid grid-cols-[5.5rem_1fr_6rem] items-center gap-2 text-xs">
          <span className="text-slate-500">{i.label}</span>
          <span className="h-3 rounded bg-slate-100 dark:bg-slate-800">
            <span
              className="block h-3 rounded bg-brand-600"
              style={{
                width: `${max > 0 ? Math.max(2, (Number.parseFloat(i.value) / max) * 100) : 0}%`,
              }}
            />
          </span>
          <span className="text-right font-medium">{i.value}</span>
        </li>
      ))}
    </ul>
  );
};

const Tile = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <Card>
    <CardBody>
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </CardBody>
  </Card>
);

export const AnalyticsPage = () => {
  const [from, setFrom] = useState(day(-29));
  const [to, setTo] = useState(day(0));
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (f: string, t: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(t) || f > t) return;
    setLoading(true);
    setError(null);
    try {
      setData(await apiRequest<AnalyticsOverview>(`/analytics/overview?from=${f}&to=${t}&limit=8`));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : 'Could not load analytics.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load(from, to);
  }, [load, from, to]);

  const change = data?.netSalesChangePercent ?? null;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Analytics</h1>
        <div className="flex gap-3">
          <div>
            <Label htmlFor="a-from">From</Label>
            <Input id="a-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="a-to">To</Label>
            <Input id="a-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <Spinner label="Loading analytics…" /> : null}
      {data && !loading ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              label="Net sales"
              value={data.summary.netSales}
              hint={
                change === null
                  ? `No sales in the previous period (${data.previous.from} to ${data.previous.to})`
                  : `${change.startsWith('-') ? '' : '+'}${change}% vs previous period (${data.previous.summary.netSales})`
              }
            />
            <Tile
              label="Sales"
              value={String(data.summary.saleCount)}
              hint={`Previous: ${data.previous.summary.saleCount}`}
            />
            <Tile label="Average sale" value={data.summary.averageSale} />
            <Tile
              label="Refunds"
              value={data.summary.refunds}
              hint={`${data.summary.refundCount} refund(s)`}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardBody className="space-y-3">
                <h2 className="text-sm font-semibold">Sales by day</h2>
                {data.daily.length === 0 ? (
                  <p className="text-sm text-slate-500">No sales in this period.</p>
                ) : (
                  <Bars
                    label="Sales by day"
                    items={data.daily.map((d) => ({
                      key: d.date,
                      label: d.date.slice(5),
                      value: d.netSales,
                    }))}
                  />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardBody className="space-y-3">
                <h2 className="text-sm font-semibold">Busiest hours</h2>
                {data.hourly.length === 0 ? (
                  <p className="text-sm text-slate-500">No sales in this period.</p>
                ) : (
                  <Bars
                    label="Sales by hour"
                    items={data.hourly.map((h) => ({
                      key: String(h.hour),
                      label: `${String(h.hour).padStart(2, '0')}:00`,
                      value: h.netSales,
                    }))}
                  />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardBody className="space-y-3">
                <h2 className="text-sm font-semibold">Best sellers</h2>
                {data.topProducts.length === 0 ? (
                  <p className="text-sm text-slate-500">No sales in this period.</p>
                ) : (
                  <Bars
                    label="Best sellers"
                    items={data.topProducts.map((p) => ({
                      key: p.productId,
                      label: p.productName.slice(0, 12),
                      value: p.revenue,
                    }))}
                  />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardBody className="space-y-3">
                <h2 className="text-sm font-semibold">Categories</h2>
                {data.byCategory.length === 0 ? (
                  <p className="text-sm text-slate-500">No sales in this period.</p>
                ) : (
                  <Bars
                    label="Categories"
                    items={data.byCategory.map((c) => ({
                      key: c.categoryId,
                      label: c.categoryName.slice(0, 12),
                      value: c.revenue,
                    }))}
                  />
                )}
              </CardBody>
            </Card>
          </div>
          <p className="text-xs text-slate-500">
            Days are calendar days in {data.meta.timeZone}; amounts in {data.meta.currency}.
          </p>
        </>
      ) : null}
    </div>
  );
};
