import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { apiRequest, ApiError } from '../api/client.js';
import type { StockLevel } from '../api/types.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Button } from '../components/ui/Button.js';
import { Input, Label } from '../components/ui/Input.js';
import { Spinner } from '../components/ui/Spinner.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { ErrorBanner } from '../components/ui/ErrorBanner.js';

const statusTone = (status: StockLevel['stockStatus']) =>
  status === 'NORMAL' ? 'green' : status === 'LOW_STOCK' ? 'amber' : 'red';

export const InventoryPage = ({ storeId }: { storeId: string }) => {
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);
  const [items, setItems] = useState<StockLevel[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<StockLevel | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (showLowStockOnly) {
        const lowStock = await apiRequest<StockLevel[]>(`/inventory/low-stock?storeId=${storeId}`);
        setItems(lowStock);
      } else {
        const result = await apiRequest<{ items: StockLevel[] }>(
          `/inventory?storeId=${storeId}&pageSize=100`,
        );
        setItems(result.items);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load inventory.');
    } finally {
      setLoading(false);
    }
  }, [storeId, showLowStockOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitAdjustment = async (e: FormEvent) => {
    e.preventDefault();
    if (!adjustTarget) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest('/inventory/adjust', {
        method: 'POST',
        body: {
          storeId,
          productId: adjustTarget.productId,
          quantityChange: adjustAmount,
          reason: adjustReason,
        },
      });
      setAdjustTarget(null);
      setAdjustAmount('');
      setAdjustReason('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to adjust stock.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Inventory</h1>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={showLowStockOnly}
            onChange={(e) => setShowLowStockOnly(e.target.checked)}
            className="rounded border-slate-300"
          />
          Low-stock &amp; out-of-stock only
        </label>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      {adjustTarget ? (
        <Card>
          <CardBody>
            <h2 className="mb-3 text-sm font-semibold">Adjust stock: {adjustTarget.productName}</h2>
            <form onSubmit={submitAdjustment} className="grid grid-cols-3 gap-4" noValidate>
              <div>
                <Label htmlFor="adj-qty">Quantity change (+/-)</Label>
                <Input
                  id="adj-qty"
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                  placeholder="-5 or 10"
                  required
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="adj-reason">Reason</Label>
                <Input
                  id="adj-reason"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  required
                />
              </div>
              <div className="col-span-3 flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setAdjustTarget(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Saving…' : 'Save adjustment'}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardBody>
          {loading ? (
            <Spinner label="Loading stock levels…" />
          ) : !items || items.length === 0 ? (
            <EmptyState
              title={showLowStockOnly ? 'Nothing is low or out of stock' : 'No stock records yet'}
              description={
                showLowStockOnly ? 'Every product is above its minimum stock level.' : undefined
              }
            />
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="py-2 pr-4">Product</th>
                  <th className="py-2 pr-4">SKU</th>
                  <th className="py-2 pr-4">Quantity</th>
                  <th className="py-2 pr-4">Min</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2.5 pr-4 font-medium">{item.productName}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs">{item.sku}</td>
                    <td className="py-2.5 pr-4">{item.quantity}</td>
                    <td className="py-2.5 pr-4 text-slate-500 dark:text-slate-400">
                      {item.minStock}
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge tone={statusTone(item.stockStatus)}>
                        {item.stockStatus.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-4 text-right">
                      <Button variant="ghost" onClick={() => setAdjustTarget(item)}>
                        Adjust
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
