import { useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Minus, Plus, Search, Trash2 } from 'lucide-react';
import {
  addDecimalStrings,
  compareDecimalStrings,
  computeSale,
  SaleMathError,
  subtractDecimalStrings,
} from '@mafk/shared';
import { apiRequest, ApiError } from '../api/client.js';
import type {
  CustomerListResult,
  CustomerWithBalance,
  PosProduct,
  SaleDetail,
  TenderMethod,
} from '../api/types.js';
import { Card, CardBody, CardHeader } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Input, Label } from '../components/ui/Input.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { ErrorBanner } from '../components/ui/ErrorBanner.js';
import { ReceiptModal } from '../components/ReceiptModal.js';

interface CartLine {
  product: PosProduct;
  quantity: string;
  discountPercent: string;
}

const QTY_RE = /^\d{1,11}(\.\d{1,3})?$/;
const MONEY_RE = /^\d{1,14}(\.\d{1,2})?$/;
const PCT_RE = /^(\d{1,2}(\.\d{1,4})?|100(\.0{1,4})?)$/;
const isPositiveQty = (q: string): boolean => QTY_RE.test(q) && /[1-9]/.test(q);
const newRequestId = (): string => crypto.randomUUID();

const money = (v: string): string => v;

export const PosPage = ({ storeId }: { storeId: string }) => {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<PosProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartDiscount, setCartDiscount] = useState('');
  const [cash, setCash] = useState('');
  const [card, setCard] = useState('');
  const [bank, setBank] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [account, setAccount] = useState('');
  const [customer, setCustomer] = useState<CustomerWithBalance | null>(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<CustomerWithBalance[]>([]);
  const [customerMsg, setCustomerMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<SaleDetail | null>(null);
  // One idempotency key per checkout attempt: a retry after a timeout reuses it, so it can never double-charge.
  const requestId = useRef<string>(newRequestId());
  const inFlight = useRef(false);

  const preview = useMemo(() => {
    if (cart.length === 0) return { ok: true as const, totals: null, lines: [] };
    if (cart.some((l) => !isPositiveQty(l.quantity)))
      return { ok: false as const, message: 'Enter a valid quantity for every item.' };
    if (cart.some((l) => l.discountPercent !== '' && !PCT_RE.test(l.discountPercent)))
      return { ok: false as const, message: 'Item discount must be a percentage from 0 to 100.' };
    if (cartDiscount !== '' && !PCT_RE.test(cartDiscount))
      return { ok: false as const, message: 'Cart discount must be a percentage from 0 to 100.' };
    try {
      const { lines, totals } = computeSale(
        cart.map((l) => ({
          quantity: l.quantity,
          unitPrice: l.product.sellingPrice,
          taxRate: l.product.taxRate,
          discountPercent: l.discountPercent || '0',
        })),
        { discountPercent: cartDiscount || '0' },
      );
      return { ok: true as const, totals, lines };
    } catch (err) {
      if (err instanceof SaleMathError) return { ok: false as const, message: err.message };
      throw err;
    }
  }, [cart, cartDiscount]);

  const total = preview.ok && preview.totals ? preview.totals.grandTotal : '0.00';
  const amounts = [cash, card, bank, account].map((v) => (v === '' ? '0.00' : v));
  const amountsValid = [cash, card, bank, account].every((v) => v === '' || MONEY_RE.test(v));
  const tendered = amountsValid
    ? amounts.reduce((a, b) => addDecimalStrings(a, b, 2), '0.00')
    : '0.00';
  const enough = amountsValid && compareDecimalStrings(tendered, total, 2) >= 0;
  const change = enough ? subtractDecimalStrings(tendered, total, 2) : '0.00';

  const findCustomer = async (e: FormEvent) => {
    e.preventDefault();
    const q = customerQuery.trim();
    if (q.length < 2) return;
    setCustomerMsg(null);
    try {
      const res = await apiRequest<CustomerListResult>(
        `/customers?search=${encodeURIComponent(q)}&isActive=true&pageSize=8`,
      );
      setCustomerResults(res.items);
      if (res.items.length === 0) setCustomerMsg('No matching customer.');
    } catch (err) {
      setCustomerResults([]);
      setCustomerMsg(err instanceof ApiError ? err.message : 'Customer search failed.');
    }
  };

  const pickCustomer = (c: CustomerWithBalance) => {
    setCustomer(c);
    setCustomerResults([]);
    setCustomerQuery('');
    setCustomerName('');
  };

  const clearCustomer = () => {
    setCustomer(null);
    setAccount('');
  };

  const runSearch = async (e: FormEvent) => {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    try {
      const res = await apiRequest<{ items: PosProduct[] }>(
        `/pos/products?storeId=${encodeURIComponent(storeId)}&search=${encodeURIComponent(q)}`,
      );
      // A scanner types the barcode and presses Enter: an exact barcode/SKU hit goes straight into the cart.
      const exact = res.items.find(
        (p) => p.barcodes.includes(q) || p.sku.toLowerCase() === q.toLowerCase(),
      );
      if (exact) {
        addToCart(exact);
        setResults([]);
        setSearch('');
      } else {
        setResults(res.items);
        if (res.items.length === 0) setError('No matching product.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const addToCart = (product: PosProduct) => {
    setCart((prev) => {
      const i = prev.findIndex((l) => l.product.id === product.id);
      if (i >= 0) {
        const next = [...prev];
        const cur = next[i]!;
        next[i] = {
          ...cur,
          quantity: isPositiveQty(cur.quantity)
            ? addDecimalStrings(cur.quantity, '1', 3).replace(/\.?0+$/, '')
            : '1',
        };
        return next;
      }
      return [...prev, { product, quantity: '1', discountPercent: '' }];
    });
  };

  const setLine = (id: string, patch: Partial<CartLine>) =>
    setCart((prev) => prev.map((l) => (l.product.id === id ? { ...l, ...patch } : l)));

  const complete = async () => {
    if (inFlight.current || !preview.ok || cart.length === 0 || !enough) return;
    if (account !== '' && /[1-9]/.test(account) && !customer) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const payments = (
      [
        ['CASH', cash],
        ['CARD', card],
        ['BANK_TRANSFER', bank],
        ['CUSTOMER_CREDIT', account],
      ] as [TenderMethod, string][]
    )
      .filter(([, v]) => v !== '' && /[1-9]/.test(v))
      .map(([method, amount]) => ({ method, amount }));
    try {
      const sale = await apiRequest<SaleDetail>('/sales', {
        method: 'POST',
        body: {
          clientRequestId: requestId.current,
          storeId,
          items: cart.map((l) => ({
            productId: l.product.id,
            quantity: l.quantity,
            ...(l.discountPercent && /[1-9]/.test(l.discountPercent)
              ? { discountPercent: l.discountPercent }
              : {}),
          })),
          ...(cartDiscount && /[1-9]/.test(cartDiscount) ? { discountPercent: cartDiscount } : {}),
          payments,
          ...(customer ? { customerId: customer.id } : {}),
          ...(!customer && customerName.trim() ? { customerName: customerName.trim() } : {}),
        },
      });
      // Sale committed: reset for the next customer and use a NEW key.
      setReceipt(sale);
      setCart([]);
      setCartDiscount('');
      setCash('');
      setCard('');
      setBank('');
      setAccount('');
      setCustomer(null);
      setCustomerName('');
      setResults([]);
      requestId.current = newRequestId();
    } catch (err) {
      // The key is kept on failure so "Complete sale" can be pressed again safely.
      setError(err instanceof ApiError ? err.message : 'Could not complete the sale. Try again.');
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-3">
        <Card>
          <CardBody>
            <form onSubmit={(e) => void runSearch(e)} className="flex gap-2" role="search">
              <div className="flex-1">
                <Label htmlFor="pos-search">Scan barcode or search product</Label>
                <Input
                  id="pos-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                  placeholder="Barcode, SKU or name"
                />
              </div>
              <Button type="submit" className="self-end" disabled={searching}>
                <Search size={16} /> {searching ? 'Searching…' : 'Search'}
              </Button>
            </form>
            {results.length > 0 ? (
              <ul className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
                {results.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <span>
                      <span className="font-medium">{p.name}</span>{' '}
                      <span className="text-slate-500">{p.sku}</span>
                      <span className="ml-2 text-slate-500">in stock: {p.stock}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      {money(p.sellingPrice)}
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => addToCart(p)}
                        aria-label={`Add ${p.name}`}
                      >
                        <Plus size={14} /> Add
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold">Cart</h2>
          </CardHeader>
          <CardBody>
            {cart.length === 0 ? (
              <EmptyState
                title="The cart is empty"
                description="Scan or search a product to start a sale."
              />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-1">Item</th>
                    <th className="py-1">Qty</th>
                    <th className="py-1">Disc %</th>
                    <th className="py-1 text-right">Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {cart.map((l, i) => {
                    const computed = preview.ok ? preview.lines[i] : undefined;
                    return (
                      <tr
                        key={l.product.id}
                        className="border-t border-slate-200 dark:border-slate-800"
                      >
                        <td className="py-2">
                          {l.product.name}
                          <div className="text-xs text-slate-500">
                            {l.product.sellingPrice} · stock {l.product.stock}
                          </div>
                        </td>
                        <td className="py-2">
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              aria-label={`Decrease ${l.product.name}`}
                              onClick={() =>
                                isPositiveQty(l.quantity) &&
                                compareDecimalStrings(l.quantity, '1', 3) > 0 &&
                                setLine(l.product.id, {
                                  quantity: subtractDecimalStrings(l.quantity, '1', 3).replace(
                                    /\.?0+$/,
                                    '',
                                  ),
                                })
                              }
                            >
                              <Minus size={14} />
                            </Button>
                            <Input
                              aria-label={`Quantity ${l.product.name}`}
                              className="w-20"
                              value={l.quantity}
                              onChange={(e) => setLine(l.product.id, { quantity: e.target.value })}
                              inputMode="decimal"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              aria-label={`Increase ${l.product.name}`}
                              onClick={() => addToCart(l.product)}
                            >
                              <Plus size={14} />
                            </Button>
                          </div>
                        </td>
                        <td className="py-2">
                          <Input
                            aria-label={`Discount percent ${l.product.name}`}
                            className="w-20"
                            value={l.discountPercent}
                            onChange={(e) =>
                              setLine(l.product.id, { discountPercent: e.target.value })
                            }
                            inputMode="decimal"
                            placeholder="0"
                          />
                        </td>
                        <td className="py-2 text-right font-medium">
                          {computed?.lineTotal ?? '—'}
                        </td>
                        <td className="py-2 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            aria-label={`Remove ${l.product.name}`}
                            onClick={() =>
                              setCart((prev) => prev.filter((x) => x.product.id !== l.product.id))
                            }
                          >
                            <Trash2 size={14} />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold">Checkout</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            {error ? <ErrorBanner message={error} /> : null}
            {!preview.ok ? <ErrorBanner message={preview.message} /> : null}
            <div>
              <Label htmlFor="pos-cart-discount">Cart discount %</Label>
              <Input
                id="pos-cart-discount"
                value={cartDiscount}
                onChange={(e) => setCartDiscount(e.target.value)}
                inputMode="decimal"
                placeholder="0"
              />
            </div>
            <dl className="space-y-1 text-sm" aria-label="Totals">
              {preview.ok && preview.totals ? (
                <>
                  <Row label="Subtotal" value={preview.totals.subtotal} />
                  {preview.totals.itemDiscountTotal !== '0.00' ? (
                    <Row label="Item discounts" value={`-${preview.totals.itemDiscountTotal}`} />
                  ) : null}
                  {preview.totals.cartDiscountAmount !== '0.00' ? (
                    <Row label="Cart discount" value={`-${preview.totals.cartDiscountAmount}`} />
                  ) : null}
                  {preview.totals.taxTotal !== '0.00' ? (
                    <Row label="Tax" value={preview.totals.taxTotal} />
                  ) : null}
                </>
              ) : null}
              <div className="flex justify-between border-t border-slate-300 pt-2 text-lg font-bold dark:border-slate-700">
                <dt>Total</dt>
                <dd data-testid="grand-total">{total}</dd>
              </div>
            </dl>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Payment</legend>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label htmlFor="pay-cash">Cash</Label>
                  <Input
                    id="pay-cash"
                    value={cash}
                    onChange={(e) => setCash(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <Label htmlFor="pay-card">Card</Label>
                  <Input
                    id="pay-card"
                    value={card}
                    onChange={(e) => setCard(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <Label htmlFor="pay-bank">Bank</Label>
                  <Input
                    id="pay-bank"
                    value={bank}
                    onChange={(e) => setBank(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                </div>
              </div>
              {customer ? (
                <div>
                  <Label htmlFor="pay-account">On account (credit)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="pay-account"
                      value={account}
                      onChange={(e) => setAccount(e.target.value)}
                      inputMode="decimal"
                      placeholder="0.00"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={cart.length === 0 || !preview.ok || !amountsValid}
                      onClick={() => {
                        const others = [cash, card, bank]
                          .map((v) => (v === '' ? '0.00' : v))
                          .reduce((a, b) => addDecimalStrings(a, b, 2), '0.00');
                        const rest = subtractDecimalStrings(total, others, 2);
                        setAccount(rest.startsWith('-') || rest === '0.00' ? '' : rest);
                      }}
                    >
                      Rest on account
                    </Button>
                  </div>
                </div>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                disabled={cart.length === 0 || !preview.ok}
                onClick={() => {
                  setCash(total);
                  setCard('');
                  setBank('');
                  setAccount('');
                }}
              >
                Exact cash
              </Button>
              <p className="text-sm" data-testid="change-due">
                {enough ? (
                  <>
                    Change due: <strong>{change}</strong>
                  </>
                ) : (
                  <span className="text-slate-500">
                    Tendered {tendered} of {total}
                  </span>
                )}
              </p>
            </fieldset>

            <div className="space-y-2">
              {customer ? (
                <div
                  className="flex items-center justify-between rounded-md border border-slate-200 p-2 text-sm dark:border-slate-700"
                  data-testid="pos-customer-chip"
                >
                  <span>
                    <strong>{customer.name}</strong>
                    <span className="ml-2 text-xs text-slate-500">
                      owes {customer.balance} · limit{' '}
                      {customer.creditLimit && customer.creditLimit !== '0.00'
                        ? customer.creditLimit
                        : 'none'}
                    </span>
                  </span>
                  <Button type="button" variant="ghost" onClick={clearCustomer}>
                    Remove
                  </Button>
                </div>
              ) : (
                <form
                  onSubmit={(e) => void findCustomer(e)}
                  className="space-y-1"
                  role="search"
                  aria-label="Find customer"
                >
                  <Label htmlFor="pos-customer-find">Find a customer (for sales on account)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="pos-customer-find"
                      value={customerQuery}
                      onChange={(e) => setCustomerQuery(e.target.value)}
                      placeholder="Name or phone"
                    />
                    <Button
                      type="submit"
                      variant="secondary"
                      disabled={customerQuery.trim().length < 2}
                    >
                      Find
                    </Button>
                  </div>
                  {customerMsg ? <p className="text-xs text-slate-500">{customerMsg}</p> : null}
                  {customerResults.length > 0 ? (
                    <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-700">
                      {customerResults.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            className="flex w-full justify-between px-2 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                            onClick={() => pickCustomer(c)}
                          >
                            <span>{c.name}</span>
                            <span className="text-xs text-slate-500">owes {c.balance}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </form>
              )}
            </div>

            {!customer ? (
              <div>
                <Label htmlFor="pos-customer">Customer name (optional)</Label>
                <Input
                  id="pos-customer"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  maxLength={120}
                />
              </div>
            ) : null}

            <Button
              className="w-full"
              disabled={submitting || cart.length === 0 || !preview.ok || !enough}
              onClick={() => void complete()}
            >
              {submitting ? 'Completing…' : 'Complete sale'}
            </Button>
          </CardBody>
        </Card>
      </div>

      {receipt ? (
        <ReceiptModal
          basePath={`/sales/${receipt.id}`}
          number={receipt.invoiceNo}
          onClose={() => setReceipt(null)}
        />
      ) : null}
    </div>
  );
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between">
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);
