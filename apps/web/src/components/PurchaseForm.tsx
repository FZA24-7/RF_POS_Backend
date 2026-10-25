import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Search, Trash2 } from 'lucide-react';
import {
  computeLine,
  computeTotals,
  isNonNegativeDecimalString,
  PurchaseMathError,
  type LineComputed,
} from '@mafk/shared';
import { apiRequest, ApiError } from '../api/client.js';
import type {
  BrandSummary,
  CategorySummary,
  PaymentMethod,
  ProductListResult,
  ProductSummary,
  PurchaseDetail,
  StoreSummary,
  SubDepartmentSummary,
  SupplierSummary,
} from '../api/types.js';
import { Card, CardBody } from './ui/Card.js';
import { Button } from './ui/Button.js';
import { Input, Label } from './ui/Input.js';
import { Spinner } from './ui/Spinner.js';
import { ErrorBanner } from './ui/ErrorBanner.js';
import { ProductForm } from './ProductForm.js';

const selectClass =
  'focus-ring w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

type DiscountMode = 'percent' | 'amount';

interface Line {
  key: number;
  product: ProductSummary;
  quantity: string;
  costPrice: string;
  discountMode: DiscountMode;
  discountValue: string;
  taxRate: string;
}

const todayIso = (): string => {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

const blankToZero = (v: string): string => (v.trim() === '' ? '0' : v.trim());

const discountFields = (mode: DiscountMode, value: string) => {
  const v = blankToZero(value);
  return mode === 'percent' ? { discountPercent: v } : { discountAmount: v };
};

/**
 * The Record Purchase screen. Everything the user types lives in this
 * component's state, and the inline "Create New Product" dialog is rendered
 * as an overlay INSIDE this component, so opening, saving or cancelling it
 * never unmounts the form or clears suppliers, header fields or line items.
 *
 * The totals shown are a live PREVIEW computed with the same `@mafk/shared`
 * decimal math the server uses (no floating point). The server recomputes and
 * stores the authoritative values; the invoice shows what was saved.
 */
export const PurchaseForm = ({
  onRecorded,
  onCancel,
}: {
  onRecorded: (purchase: PurchaseDetail) => void;
  onCancel: () => void;
}) => {
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [refError, setRefError] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierSummary[]>([]);
  const [stores, setStores] = useState<StoreSummary[]>([]);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [subDepartments, setSubDepartments] = useState<SubDepartmentSummary[]>([]);
  const [brands, setBrands] = useState<BrandSummary[]>([]);

  const [supplierId, setSupplierId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(todayIso());
  const [lines, setLines] = useState<Line[]>([]);
  const [discMode, setDiscMode] = useState<DiscountMode>('percent');
  const [discValue, setDiscValue] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('CASH');

  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<ProductSummary[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef(1);
  const searchSeq = useRef(0);

  useEffect(() => {
    void (async () => {
      try {
        const [sup, st, cats, subs, br] = await Promise.all([
          apiRequest<SupplierSummary[]>('/suppliers'),
          apiRequest<StoreSummary[]>('/stores'),
          apiRequest<CategorySummary[]>('/catalog/categories'),
          apiRequest<SubDepartmentSummary[]>('/catalog/sub-departments'),
          apiRequest<BrandSummary[]>('/catalog/brands'),
        ]);
        setSuppliers(sup);
        setStores(st);
        setCategories(cats);
        setSubDepartments(subs);
        setBrands(br);
        setStoreId((cur) => cur || st.find((s) => s.isDefault)?.id || st[0]?.id || '');
      } catch (err) {
        setRefError(err instanceof ApiError ? err.message : 'Failed to load purchase form data.');
      } finally {
        setLoadingRefs(false);
      }
    })();
  }, []);

  // Debounced product search (name / SKU).
  useEffect(() => {
    const term = searchTerm.trim();
    if (term.length < 1) {
      setResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const r = await apiRequest<ProductListResult>(
            `/catalog/products?search=${encodeURIComponent(term)}&status=ACTIVE&pageSize=8`,
          );
          if (seq === searchSeq.current) setResults(r.items);
        } catch {
          if (seq === searchSeq.current) setResults([]);
        }
      })();
    }, 200);
    return () => window.clearTimeout(t);
  }, [searchTerm]);

  const addProduct = useCallback((product: ProductSummary) => {
    setLines((cur) => {
      const existing = cur.find((l) => l.product.id === product.id);
      if (existing) return cur; // already on the purchase - edit its quantity instead
      return [
        ...cur,
        {
          key: keyRef.current++,
          product,
          quantity: '1',
          costPrice: product.costPrice,
          discountMode: 'percent',
          discountValue: '',
          taxRate: product.taxRate,
        },
      ];
    });
    setSearchTerm('');
    setResults([]);
  }, []);

  const onSearchKey = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = searchTerm.trim();
    if (!code) return;
    try {
      // USB scanners type the code then Enter: resolve it as a barcode first.
      addProduct(await apiRequest<ProductSummary>(`/catalog/barcode/${encodeURIComponent(code)}`));
      return;
    } catch {
      // not a barcode (or no barcode permission) - fall back to the first search hit
    }
    if (results[0]) addProduct(results[0]);
  };

  const updateLine = (key: number, patch: Partial<Line>) =>
    setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // ───── live preview (shared decimal math, no floats) ─────
  const preview = useMemo(() => {
    const computed: Array<{ line: LineComputed | null; problem: string | null }> = lines.map(
      (l) => {
        if (
          !isNonNegativeDecimalString(blankToZero(l.quantity), 3) ||
          blankToZero(l.quantity) === '0'
        ) {
          return { line: null, problem: 'Quantity must be a number greater than zero.' };
        }
        if (!isNonNegativeDecimalString(blankToZero(l.costPrice), 4)) {
          return { line: null, problem: 'Cost price must be a valid non-negative number.' };
        }
        if (!isNonNegativeDecimalString(blankToZero(l.discountValue), 4)) {
          return { line: null, problem: 'Discount must be a valid non-negative number.' };
        }
        if (!isNonNegativeDecimalString(blankToZero(l.taxRate), 4)) {
          return { line: null, problem: 'Tax must be a valid non-negative number.' };
        }
        try {
          return {
            line: computeLine({
              quantity: blankToZero(l.quantity),
              costPrice: blankToZero(l.costPrice),
              taxRate: blankToZero(l.taxRate),
              ...discountFields(l.discountMode, l.discountValue),
            }),
            problem: null,
          };
        } catch (err) {
          return {
            line: null,
            problem: err instanceof PurchaseMathError ? err.message : 'Invalid line.',
          };
        }
      },
    );

    let totals: ReturnType<typeof computeTotals> | null = null;
    let totalsProblem: string | null = null;
    if (computed.length > 0 && computed.every((c) => c.line)) {
      if (!isNonNegativeDecimalString(blankToZero(discValue), 4)) {
        totalsProblem = 'Purchase discount must be a valid non-negative number.';
      } else {
        try {
          totals = computeTotals(
            computed.map((c) => c.line as LineComputed),
            discountFields(discMode, discValue),
          );
        } catch (err) {
          totalsProblem = err instanceof PurchaseMathError ? err.message : 'Invalid totals.';
        }
      }
    }
    return { computed, totals, totalsProblem };
  }, [lines, discMode, discValue]);

  const payValid =
    payAmount.trim() === '' ||
    (isNonNegativeDecimalString(payAmount.trim(), 2) && payAmount.trim() !== '0');

  const canSubmit =
    !!supplierId &&
    !!storeId &&
    invoiceNo.trim().length > 0 &&
    lines.length > 0 &&
    !!preview.totals &&
    payValid &&
    !submitting;

  const record = async () => {
    setSubmitting(true);
    setError(null);
    setConfirming(false);
    try {
      const body = {
        supplierId,
        storeId,
        invoiceNo: invoiceNo.trim(),
        purchaseDate,
        items: lines.map((l) => ({
          productId: l.product.id,
          quantity: blankToZero(l.quantity),
          costPrice: blankToZero(l.costPrice),
          taxRate: blankToZero(l.taxRate),
          ...discountFields(l.discountMode, l.discountValue),
        })),
        ...discountFields(discMode, discValue),
        initialPayment: payAmount.trim()
          ? { amount: payAmount.trim(), method: payMethod }
          : undefined,
      };
      // Only after the server commits its transaction do we get a 201 + saved purchase.
      const saved = await apiRequest<PurchaseDetail>('/purchases', { method: 'POST', body });
      onRecorded(saved);
    } catch (err) {
      // All entered data is kept so the user can correct and retry.
      setError(err instanceof ApiError ? err.message : 'Failed to record the purchase.');
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (canSubmit) setConfirming(true);
  };

  if (loadingRefs) return <Spinner label="Loading purchase form…" />;
  if (refError) return <ErrorBanner message={refError} />;

  const supplierName = suppliers.find((s) => s.id === supplierId)?.name ?? '';

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">New Purchase</h1>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error ? <ErrorBanner message={error} /> : null}

      <Card>
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div>
            <Label htmlFor="pu-supplier">Supplier</Label>
            <select
              id="pu-supplier"
              className={selectClass}
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              required
            >
              <option value="" disabled>
                {suppliers.length === 0 ? 'No suppliers - add one first' : 'Select supplier…'}
              </option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="pu-store">Branch</Label>
            <select
              id="pu-store"
              className={selectClass}
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              required
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="pu-invoice">Supplier invoice / reference no.</Label>
            <Input
              id="pu-invoice"
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="pu-date">Purchase date</Label>
            <Input
              id="pu-date"
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              required
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="relative min-w-[16rem] flex-1">
              <Label htmlFor="pu-search">Add product (name, SKU, or scan barcode)</Label>
              <Search
                className="pointer-events-none absolute left-2.5 top-[2.35rem] text-slate-400"
                size={16}
              />
              <Input
                id="pu-search"
                className="pl-8"
                autoComplete="off"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => void onSearchKey(e)}
                placeholder="Type to search, Enter to add"
              />
              {results.length > 0 ? (
                <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                  {results.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700"
                        onClick={() => addProduct(p)}
                      >
                        <span>{p.name}</span>
                        <span className="font-mono text-xs text-slate-500">{p.sku}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowCreate(true)}
              disabled={categories.length === 0}
            >
              <Plus size={16} /> Create New Product
            </Button>
          </div>

          {lines.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              No items yet. Search for a product, scan a barcode, or create a new product.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <th className="py-2 pr-2">Product</th>
                    <th className="py-2 pr-2">Qty</th>
                    <th className="py-2 pr-2">Cost</th>
                    <th className="py-2 pr-2">Discount</th>
                    <th className="py-2 pr-2">Tax %</th>
                    <th className="py-2 pr-2 text-right">Line total</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const c = preview.computed[i];
                    return (
                      <tr
                        key={l.key}
                        className="border-b border-slate-100 align-top dark:border-slate-800"
                      >
                        <td className="py-2 pr-2">
                          <p className="font-medium">{l.product.name}</p>
                          <p className="font-mono text-xs text-slate-500">{l.product.sku}</p>
                        </td>
                        <td className="py-2 pr-2">
                          <Input
                            aria-label={`Quantity for ${l.product.name}`}
                            inputMode="decimal"
                            className="w-20"
                            value={l.quantity}
                            onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <Input
                            aria-label={`Cost price for ${l.product.name}`}
                            inputMode="decimal"
                            className="w-28"
                            value={l.costPrice}
                            onChange={(e) => updateLine(l.key, { costPrice: e.target.value })}
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <div className="flex gap-1">
                            <Input
                              aria-label={`Discount for ${l.product.name}`}
                              inputMode="decimal"
                              className="w-20"
                              value={l.discountValue}
                              onChange={(e) => updateLine(l.key, { discountValue: e.target.value })}
                              placeholder="0"
                            />
                            <select
                              aria-label="Discount type"
                              className={`${selectClass} w-20`}
                              value={l.discountMode}
                              onChange={(e) =>
                                updateLine(l.key, { discountMode: e.target.value as DiscountMode })
                              }
                            >
                              <option value="percent">%</option>
                              <option value="amount">Rs</option>
                            </select>
                          </div>
                        </td>
                        <td className="py-2 pr-2">
                          <Input
                            aria-label={`Tax percent for ${l.product.name}`}
                            inputMode="decimal"
                            className="w-20"
                            value={l.taxRate}
                            onChange={(e) => updateLine(l.key, { taxRate: e.target.value })}
                          />
                        </td>
                        <td className="py-2 pr-2 text-right">
                          {c?.line ? (
                            <>
                              <p className="font-medium">{c.line.lineTotal}</p>
                              {c.line.discountAmount !== '0' ? (
                                <p className="text-xs text-slate-500">
                                  −{c.line.discountAmount} disc.
                                </p>
                              ) : null}
                            </>
                          ) : (
                            <p className="text-xs text-red-600 dark:text-red-400">{c?.problem}</p>
                          )}
                        </td>
                        <td className="py-2">
                          <Button
                            type="button"
                            variant="ghost"
                            aria-label={`Remove ${l.product.name}`}
                            onClick={() => setLines((cur) => cur.filter((x) => x.key !== l.key))}
                          >
                            <Trash2 size={16} />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardBody className="space-y-3">
            <p className="text-sm font-medium">Purchase-level discount</p>
            <div className="flex gap-2">
              <Input
                aria-label="Purchase discount"
                inputMode="decimal"
                value={discValue}
                onChange={(e) => setDiscValue(e.target.value)}
                placeholder="0"
              />
              <select
                aria-label="Purchase discount type"
                className={`${selectClass} w-24`}
                value={discMode}
                onChange={(e) => setDiscMode(e.target.value as DiscountMode)}
              >
                <option value="percent">%</option>
                <option value="amount">Rs</option>
              </select>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Each discount is either a percentage or a fixed amount, never both. The purchase
              discount applies after line discounts.
            </p>
            <p className="pt-2 text-sm font-medium">Payment now (optional)</p>
            <div className="flex gap-2">
              <Input
                aria-label="Initial payment amount"
                inputMode="decimal"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="0.00"
              />
              <select
                aria-label="Payment method"
                className={`${selectClass} w-44`}
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
              >
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
                <option value="BANK_TRANSFER">Bank transfer</option>
              </select>
            </div>
            {!payValid ? (
              <p className="text-xs text-red-600 dark:text-red-400">
                Enter a valid payment amount.
              </p>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
              Preview — final amounts are calculated and saved by the server.
            </p>
            {preview.totals ? (
              <dl className="space-y-1 text-sm">
                <Tot label="Subtotal" value={preview.totals.subtotal} />
                <Tot label="Line discounts" value={preview.totals.itemDiscountTotal} />
                <Tot label={`Purchase discount`} value={preview.totals.discountAmount} />
                <Tot label="Tax" value={preview.totals.taxTotal} />
                <Tot label="Grand total" value={preview.totals.total} bold />
              </dl>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {preview.totalsProblem ??
                  'Add items with valid quantities and prices to see totals.'}
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={!canSubmit}>
          {submitting ? 'Recording…' : 'Record Purchase'}
        </Button>
      </div>

      {confirming ? (
        <Overlay label="Confirm purchase">
          <p className="text-sm">
            Record this purchase from <strong>{supplierName}</strong> (invoice{' '}
            <strong>{invoiceNo.trim()}</strong>) for a total of{' '}
            <strong>{preview.totals?.total}</strong>? Stock will be increased immediately.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              Back
            </Button>
            <Button type="button" onClick={() => void record()} disabled={submitting}>
              Confirm &amp; record
            </Button>
          </div>
        </Overlay>
      ) : null}

      {showCreate ? (
        <Overlay label="Create new product" wide>
          <h2 className="mb-3 text-base font-semibold">Create New Product</h2>
          <ProductForm
            categories={categories}
            subDepartments={subDepartments}
            brands={brands}
            suppliers={suppliers}
            defaultSupplierId={supplierId}
            submitLabel="Save & add to purchase"
            onCancel={() => setShowCreate(false)}
            onCreated={(product) => {
              // The purchase (header + lines) is untouched; the new product is
              // simply appended as a new line, ready for a quantity.
              addProduct(product);
              setShowCreate(false);
            }}
          />
        </Overlay>
      ) : null}
    </form>
  );
};

const Tot = ({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) => (
  <div
    className={`flex justify-between ${bold ? 'border-t border-slate-200 pt-1 text-base font-semibold dark:border-slate-700' : ''}`}
  >
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);

const Overlay = ({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) => {
  useEffect(() => {
    // Keep the dialog keyboard-reachable: focus moves into it on open.
    const el = document.querySelector<HTMLElement>(
      '[data-overlay-root] input, [data-overlay-root] button',
    );
    el?.focus();
  }, []);
  // Portalled to <body> so the dialog's <form> is never nested inside the
  // purchase <form> (invalid HTML); React state/ownership stay with PurchaseForm,
  // so nothing the user has entered is lost.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div
        data-overlay-root
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`my-6 w-full ${wide ? 'max-w-3xl' : 'max-w-md'} rounded-lg bg-white p-5 shadow-xl dark:bg-slate-900`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
};
