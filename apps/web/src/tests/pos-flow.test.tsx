import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PosPage } from '../pages/PosPage.js';
import type { PosProduct, ReceiptResponse, SaleDetail } from '../api/types.js';

/**
 * UI behaviour tests for the POS screen. `fetch` is replaced by a small in-test router returning well-formed API
 * payloads: these tests verify the SCREEN (live totals via the shared money math, idempotency key handling, double
 * submit guard, error handling) - not the server; server behaviour is covered by the API tests.
 */

const shirt: PosProduct = {
  id: 'p1',
  name: 'Cotton Shirt',
  sku: 'SHIRT-1',
  barcodes: ['111222'],
  unit: 'pcs',
  sellingPrice: '150.00',
  taxRate: '10',
  stock: '20.000',
};

const savedSale: SaleDetail = {
  id: 'sale1',
  storeId: 's1',
  invoiceNo: 'INV-MAIN-000001',
  status: 'COMPLETED',
  grandTotal: '330.00',
  paidTotal: '400.00',
  changeDue: '70.00',
  customerId: null,
  customerName: null,
  soldAt: '2026-10-12T10:00:00.000Z',
  subtotal: '300.00',
  itemDiscountTotal: '0.00',
  cartDiscountPercent: '0',
  cartDiscountAmount: '0.00',
  taxTotal: '30.00',
  notes: null,
  items: [],
  payments: [],
  returns: [],
};

const receipt: ReceiptResponse = {
  format: '80mm',
  text: 'RECEIPT-TEXT-BODY',
  receipt: {
    kind: 'SALE',
    business: { name: 'Acme Retail', legalName: null, address: null, phone: null, email: null },
    branch: { code: 'MAIN', name: 'Main Branch' },
    title: 'SALES RECEIPT',
    number: 'INV-MAIN-000001',
    relatedNumber: null,
    date: '2026-10-12T10:00:00.000Z',
    cashier: 'cashier1',
    customer: null,
    lines: [],
    totals: [],
    payments: [],
    footer: 'Thank you',
  },
};

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}
let calls: Call[] = [];
let salePost: () => Response | Promise<Response>;
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls = [];
  salePost = () => json(201, savedSale);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const path = url.pathname.replace(/^\/api/, '') + url.search;
      const method = init?.method ?? 'GET';
      const body = init?.body
        ? (JSON.parse(init.body as string) as Record<string, unknown>)
        : undefined;
      calls.push({ method, path, body });
      if (path.startsWith('/pos/products')) {
        return json(200, { items: url.searchParams.get('search') === 'zzz' ? [] : [shirt] });
      }
      if (path === '/sales' && method === 'POST') return salePost();
      if (path.startsWith('/sales/sale1/receipt')) return json(200, receipt);
      return json(404, { error: { code: 'NOT_FOUND', message: `unrouted ${path}` } });
    }),
  );
});
afterEach(() => cleanup());

const scan = async (user: ReturnType<typeof userEvent.setup>, code = '111222') => {
  await user.type(screen.getByLabelText(/scan barcode or search product/i), `${code}{enter}`);
  await screen.findByText('Cotton Shirt');
};

describe('PosPage', () => {
  it('an exact barcode scan goes straight into the cart and the total uses the shared math (2 x 150 + 10% tax = 330.00)', async () => {
    const user = userEvent.setup();
    render(<PosPage storeId="s1" />);
    await scan(user);
    await user.click(screen.getByRole('button', { name: 'Increase Cotton Shirt' }));
    expect(screen.getByTestId('grand-total').textContent).toBe('330.00');
    expect(calls[0]?.path).toContain('storeId=s1');
  });

  it('shows change due for an over-tender and blocks completion until tendered covers the total', async () => {
    const user = userEvent.setup();
    render(<PosPage storeId="s1" />);
    await scan(user);
    const complete = screen.getByRole('button', { name: 'Complete sale' }) as HTMLButtonElement;
    expect(complete.disabled).toBe(true);
    await user.type(screen.getByLabelText('Cash'), '100');
    expect(complete.disabled).toBe(true);
    expect(screen.getByTestId('change-due').textContent).toContain('Tendered 100.00 of 165.00');
    await user.clear(screen.getByLabelText('Cash'));
    await user.type(screen.getByLabelText('Cash'), '200');
    expect(complete.disabled).toBe(false);
    expect(screen.getByTestId('change-due').textContent).toContain('35.00');
  });

  it('applies a cart discount in the live total', async () => {
    const user = userEvent.setup();
    render(<PosPage storeId="s1" />);
    await scan(user);
    await user.type(screen.getByLabelText('Cart discount %'), '10');
    // 150 - 15 = 135, tax 10% of 135 = 13.50 -> 148.50
    expect(screen.getByTestId('grand-total').textContent).toBe('148.50');
  });

  it('completes the sale: sends the idempotency key, server-priced items and payments, then shows the saved receipt', async () => {
    const user = userEvent.setup();
    render(<PosPage storeId="s1" />);
    await scan(user);
    await user.click(screen.getByRole('button', { name: 'Exact cash' }));
    await user.click(screen.getByRole('button', { name: 'Complete sale' }));
    const dialog = await screen.findByRole('dialog', { name: /receipt INV-MAIN-000001/i });
    expect(dialog.textContent).toContain('RECEIPT-TEXT-BODY');
    const post = calls.find((c) => c.method === 'POST' && c.path === '/sales');
    expect(post?.body).toMatchObject({
      storeId: 's1',
      items: [{ productId: 'p1', quantity: '1' }],
      payments: [{ method: 'CASH', amount: '165.00' }],
    });
    expect(typeof post?.body?.clientRequestId).toBe('string');
    // The client never sends a price or totals.
    expect(JSON.stringify(post?.body)).not.toMatch(/unitPrice|grandTotal/);
    // Cart was reset for the next customer.
    await waitFor(() => expect(screen.getByText('The cart is empty')).toBeTruthy());
  });

  it('a double click sends exactly one request', async () => {
    const user = userEvent.setup();
    let release: (r: Response) => void = () => undefined;
    salePost = () => new Promise<Response>((resolve) => (release = resolve));
    render(<PosPage storeId="s1" />);
    await scan(user);
    await user.click(screen.getByRole('button', { name: 'Exact cash' }));
    const btn = screen.getByRole('button', { name: 'Complete sale' });
    await user.dblClick(btn);
    release(json(201, savedSale));
    await screen.findByRole('dialog');
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/sales')).toHaveLength(1);
  });

  it('on a server error it keeps the cart and REUSES the same idempotency key for the retry', async () => {
    const user = userEvent.setup();
    let first = true;
    salePost = () => {
      if (first) {
        first = false;
        return json(409, {
          error: { code: 'INSUFFICIENT_STOCK', message: 'Cannot reduce stock below zero.' },
        });
      }
      return json(201, savedSale);
    };
    render(<PosPage storeId="s1" />);
    await scan(user);
    await user.click(screen.getByRole('button', { name: 'Exact cash' }));
    await user.click(screen.getByRole('button', { name: 'Complete sale' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Cannot reduce stock below zero.',
    );
    expect(screen.getByText('Cotton Shirt')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Complete sale' }));
    await screen.findByRole('dialog');
    const posts = calls.filter((c) => c.method === 'POST' && c.path === '/sales');
    expect(posts).toHaveLength(2);
    expect(posts[1]?.body?.clientRequestId).toBe(posts[0]?.body?.clientRequestId);
  });

  it('after a successful sale the NEXT sale gets a new idempotency key', async () => {
    const user = userEvent.setup();
    render(<PosPage storeId="s1" />);
    for (let n = 0; n < 2; n++) {
      await scan(user);
      await user.click(screen.getByRole('button', { name: 'Exact cash' }));
      await user.click(screen.getByRole('button', { name: 'Complete sale' }));
      await screen.findByRole('dialog');
      await user.click(screen.getByRole('button', { name: 'Close' }));
    }
    const posts = calls.filter((c) => c.method === 'POST' && c.path === '/sales');
    expect(posts).toHaveLength(2);
    expect(posts[0]?.body?.clientRequestId).not.toBe(posts[1]?.body?.clientRequestId);
  });

  it('reports "No matching product." and shows invalid quantity feedback', async () => {
    const user = userEvent.setup();
    render(<PosPage storeId="s1" />);
    await user.type(screen.getByLabelText(/scan barcode or search product/i), 'zzz{enter}');
    expect((await screen.findByRole('alert')).textContent).toContain('No matching product');
    await user.clear(screen.getByLabelText(/scan barcode or search product/i));
    await scan(user);
    await user.clear(screen.getByLabelText('Quantity Cotton Shirt'));
    await user.type(screen.getByLabelText('Quantity Cotton Shirt'), 'abc');
    expect(screen.getByText('Enter a valid quantity for every item.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Complete sale' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('receipt paper size can be switched (58mm / 80mm / A4) and refetches the saved receipt', async () => {
    const user = userEvent.setup();
    render(<PosPage storeId="s1" />);
    await scan(user);
    await user.click(screen.getByRole('button', { name: 'Exact cash' }));
    await user.click(screen.getByRole('button', { name: 'Complete sale' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: '58 mm' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/sales/sale1/receipt?format=58mm')).toBe(true),
    );
    await user.click(screen.getByRole('button', { name: 'A4' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/sales/sale1/receipt?format=a4')).toBe(true),
    );
  });
});
