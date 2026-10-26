import { useState } from 'react';
import type { FormEvent } from 'react';
import { ScanLine } from 'lucide-react';
import { apiRequest, ApiError } from '../api/client.js';
import type { ProductSummary } from '../api/types.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Input, Label } from '../components/ui/Input.js';
import { Button } from '../components/ui/Button.js';
import { ErrorBanner } from '../components/ui/ErrorBanner.js';
import { EmptyState } from '../components/ui/EmptyState.js';

/**
 * Works identically whether the code arrives from a USB keyboard-emulation
 * scanner (which just "types" into this field and sends Enter) or manual
 * entry - there is no scanner SDK or device object anywhere in this page.
 */
export const BarcodeLookupPage = () => {
  const [code, setCode] = useState('');
  const [product, setProduct] = useState<ProductSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const lookup = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setError(null);
    setSearched(true);
    try {
      setProduct(
        await apiRequest<ProductSummary>(`/catalog/barcode/${encodeURIComponent(code.trim())}`),
      );
    } catch (err) {
      setProduct(null);
      setError(err instanceof ApiError ? err.message : 'Lookup failed.');
    } finally {
      setCode('');
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Barcode Lookup</h1>
      <Card>
        <CardBody>
          <form onSubmit={lookup} className="flex items-end gap-3" noValidate>
            <div className="flex-1">
              <Label htmlFor="barcode-input">Scan or type a barcode</Label>
              <Input
                id="barcode-input"
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. 8901234567890"
              />
            </div>
            <Button type="submit">
              <ScanLine size={16} /> Look up
            </Button>
          </form>
        </CardBody>
      </Card>

      {error ? <ErrorBanner message={error} /> : null}

      {product ? (
        <Card>
          <CardBody className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">{product.name}</h2>
              <Badge tone={product.status === 'ACTIVE' ? 'green' : 'slate'}>{product.status}</Badge>
            </div>
            <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
              SKU: {product.sku}
            </p>
            <p className="text-sm">
              Selling price: <span className="font-medium">{product.sellingPrice}</span>
            </p>
          </CardBody>
        </Card>
      ) : searched && !error ? (
        <EmptyState title="No product found for that barcode" />
      ) : null}
    </div>
  );
};
