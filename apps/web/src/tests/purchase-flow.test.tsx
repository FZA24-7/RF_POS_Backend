import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PurchasesPage } from '../pages/PurchasesPage.js';
import type { ProductSummary, PurchaseDetail, PurchaseInvoice } from '../api/types.js';

/**
 * UI behaviour tests for the Purchase screen. `fetch` is replaced with a small
 * in-test router that returns well-formed API payloads - this verifies the
 * FRONTEND's behaviour (form preservation, auto-opening the invoice, showing
 * saved values), not the server; server behaviour is covered by the API tests.
 */

const now = '2026-10-01T10:00:00.000Z';

const product = (id: string, name: string, sku: string): ProductSummary => ({
  id,
  tenantId: 't1',
  name,
  sku,
  categoryId: 'c1',
  subDepartmentId: 'sd1',
  brandId: null,
  costPrice: '100.00',
  sellingPrice: '150.00',
  wholesalePrice: null,
  taxRate: '0',
  unit: 'pcs',
  minStock: '0',
  maxStock: null,
  status: 'ACTIVE',
  barcodes: [],
  createdAt: now,
  updatedAt: now,
});

const existing = product('p1', 'Cotton Shirt', 'SHIRT-1');
const created = product('p2', 'Brand New Jacket', 'JACKET-9');

const savedPurchase: PurchaseDetail = {
  id: 'pur1',
  storeId: 's1',
  supplierId: 'sup1',
  purchaseNo: 'PO-000001',
  invoiceNo: 'INV-77',
  purchaseDate: now,
  subtotal: '1000.00',
  discountPercent: '0',
  discountAmount: '0',
  taxTotal: '0.00',
  // Deliberately NOT what a client-side recompute would give, to prove the
  // invoice shows the SAVED value rather than a recomputed one.
  total: '987.65',
  paidAmount: '0.00',
  paymentStatus: 'UNPAID',
  createdById: 'u1',
  createdAt: now,
  items: [
    {
      id: 'it1',
      productId: 'p1',
      productName: 'Cotton Shirt',
      sku: 'SHIRT-1',
      barcodes: ['111222'],
      quantity: '10',
      costPrice: '100.00',
      discountPercent: '0',
      discountAmount: '0',
      taxRate: '0',
      taxAmount: '0.00',
      lineTotal: '987.65',
    },
  ],
};

const invoice: PurchaseInvoice = {
  business: {
    name: 'Acme Retail',
    legalName: null,
    address: '1 Main St',
    phone: null,
    email: null,
    logoUrl: null,
  },
  branch: { id: 's1', code: 'MAIN', name: 'Main Branch' },
  supplier: {
    id: 'sup1',
    name: 'Textile Wholesalers Ltd',
    phone: '0300',
    email: null,
    address: null,
  },
  createdBy: { id: 'u1', displayName: 'Mina Manager' },
  purchase: savedPurchase,
  amountPaid: '0.00',
  outstanding: '987.65',
};

interface Call {
  method: string;
  path: string;
  body: unknown;
}

let calls: Call[] = [];
let purchasePostStatus = 201;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const installFetch = () => {
  calls = [];
  purchasePostStatus = 201;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const path = url.pathname.replace(/^\/api/, '') + url.search;
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined;
      calls.push({ method, path, body });

      if (path.startsWith('/suppliers'))
        return json(200, [
          {
            id: 'sup1',
            tenantId: 't1',
            name: 'Textile Wholesalers Ltd',
            phone: null,
            email: null,
            address: null,
            isActive: true,
            createdAt: now,
          },
        ]);
      if (path.startsWith('/stores'))
        return json(200, [
          {
            id: 's1',
            tenantId: 't1',
            code: 'MAIN',
            name: 'Main Branch',
            isDefault: true,
            isActive: true,
          },
        ]);
      if (path.startsWith('/catalog/categories'))
        return json(200, [
          {
            id: 'c1',
            tenantId: 't1',
            name: 'Men',
            description: null,
            status: 'ACTIVE',
            createdAt: now,
            updatedAt: now,
          },
        ]);
      if (path.startsWith('/catalog/sub-departments'))
        return json(200, [
          {
            id: 'sd1',
            tenantId: 't1',
            categoryId: 'c1',
            name: 'Shirts',
            description: null,
            status: 'ACTIVE',
            createdAt: now,
            updatedAt: now,
          },
        ]);
      if (path.startsWith('/catalog/brands')) return json(200, []);
      if (path.startsWith('/catalog/barcode/'))
        return json(404, { error: { code: 'NOT_FOUND', message: 'Unknown barcode' } });
      if (path.startsWith('/catalog/products') && method === 'POST') return json(201, created);
      if (path.startsWith('/catalog/products'))
        return json(200, { items: [existing], total: 1, page: 1, pageSize: 8 });
      if (path === '/purchases' && method === 'POST') {
        return purchasePostStatus === 201
          ? json(201, savedPurchase)
          : json(409, {
              error: {
                code: 'CONFLICT',
                message: 'A purchase with this invoice number already exists.',
              },
            });
      }
      if (path.startsWith('/purchases/pur1/invoice')) return json(200, invoice);
      if (path.startsWith('/purchases'))
        return json(200, { items: [], total: 0, page: 1, pageSize: 20 });
      return json(404, { error: { code: 'NOT_FOUND', message: `unmocked ${method} ${path}` } });
    }),
  );
};

beforeEach(() => {
  installFetch();
  vi.stubGlobal('print', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const openNewPurchase = async (user: ReturnType<typeof userEvent.setup>) => {
  render(<PurchasesPage />);
  await user.click(await screen.findByRole('button', { name: /new purchase/i }));
  await screen.findByLabelText(/^supplier$/i);
};

const fillHeaderAndAddExistingProduct = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.selectOptions(screen.getByLabelText(/^supplier$/i), 'sup1');
  await user.type(screen.getByLabelText(/supplier invoice/i), 'INV-77');
  await user.type(screen.getByLabelText(/add product/i), 'Cotton');
  await user.click(await screen.findByRole('button', { name: /cotton shirt/i }));
  await screen.findByLabelText(/quantity for cotton shirt/i);
};

describe('Purchase screen', () => {
  it('keeps the entered purchase intact while a product is created inline, and adds the new product', async () => {
    const user = userEvent.setup();
    await openNewPurchase(user);
    await fillHeaderAndAddExistingProduct(user);
    const qty = screen.getByLabelText(/quantity for cotton shirt/i);
    await user.clear(qty);
    await user.type(qty, '12');

    await user.click(screen.getByRole('button', { name: /create new product/i }));
    const dialog = await screen.findByRole('dialog', { name: /create new product/i });
    await user.type(within(dialog).getByLabelText(/product name/i), 'Brand New Jacket');
    await user.type(within(dialog).getByLabelText(/^sku$/i), 'JACKET-9');
    await user.type(within(dialog).getByLabelText(/cost price/i), '100');
    await user.type(within(dialog).getByLabelText(/selling price/i), '150');
    await user.selectOptions(within(dialog).getByLabelText(/sub-department/i), 'sd1');
    await user.click(within(dialog).getByRole('button', { name: /save & add to purchase/i }));

    // Dialog closes; new product is a line; everything previously entered is still there.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /create new product/i })).toBeNull(),
    );
    expect(await screen.findByLabelText(/quantity for brand new jacket/i)).toBeTruthy();
    expect((screen.getByLabelText(/^supplier$/i) as HTMLSelectElement).value).toBe('sup1');
    expect((screen.getByLabelText(/supplier invoice/i) as HTMLInputElement).value).toBe('INV-77');
    expect((screen.getByLabelText(/quantity for cotton shirt/i) as HTMLInputElement).value).toBe(
      '12',
    );

    // The product was created through the real endpoint with the entered values.
    const post = calls.find((c) => c.method === 'POST' && c.path === '/catalog/products');
    expect(post?.body).toMatchObject({
      name: 'Brand New Jacket',
      sku: 'JACKET-9',
      costPrice: '100',
      sellingPrice: '150',
    });
  });

  it('shows an inline-product server error without discarding the purchase', async () => {
    const user = userEvent.setup();
    await openNewPurchase(user);
    await fillHeaderAndAddExistingProduct(user);
    // Make product creation fail once.
    const original = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const u = new URL(typeof input === 'string' ? input : input.toString());
        if (u.pathname.endsWith('/catalog/products') && init?.method === 'POST') {
          return json(409, { error: { code: 'CONFLICT', message: 'SKU already exists.' } });
        }
        return original(input, init);
      }),
    );
    await user.click(screen.getByRole('button', { name: /create new product/i }));
    const dialog = await screen.findByRole('dialog', { name: /create new product/i });
    await user.type(within(dialog).getByLabelText(/product name/i), 'Dup');
    await user.type(within(dialog).getByLabelText(/^sku$/i), 'SHIRT-1');
    await user.type(within(dialog).getByLabelText(/cost price/i), '1');
    await user.type(within(dialog).getByLabelText(/selling price/i), '2');
    await user.selectOptions(within(dialog).getByLabelText(/sub-department/i), 'sd1');
    await user.click(within(dialog).getByRole('button', { name: /save & add to purchase/i }));

    expect(await within(dialog).findByText(/sku already exists/i)).toBeTruthy();
    expect((within(dialog).getByLabelText(/^sku$/i) as HTMLInputElement).value).toBe('SHIRT-1');
    expect((screen.getByLabelText(/supplier invoice/i) as HTMLInputElement).value).toBe('INV-77');
    expect(screen.getByLabelText(/quantity for cotton shirt/i)).toBeTruthy();
  });

  it('previews totals with exact decimal math', async () => {
    const user = userEvent.setup();
    await openNewPurchase(user);
    await fillHeaderAndAddExistingProduct(user);
    const qty = screen.getByLabelText(/quantity for cotton shirt/i);
    await user.clear(qty);
    await user.type(qty, '3');
    const cost = screen.getByLabelText(/cost price for cotton shirt/i);
    await user.clear(cost);
    await user.type(cost, '0.1');
    // 3 x 0.10 must be exactly 0.30 (floating point would give 0.30000000000000004)
    expect(await screen.findAllByText('0.30')).not.toHaveLength(0);
  });

  it('after Record Purchase succeeds, the invoice opens automatically showing the SAVED purchase and all actions', async () => {
    const user = userEvent.setup();
    await openNewPurchase(user);
    await fillHeaderAndAddExistingProduct(user);

    await user.click(screen.getByRole('button', { name: /^record purchase$/i }));
    await user.click(await screen.findByRole('button', { name: /confirm & record/i }));

    const dialog = await screen.findByRole('dialog', { name: /purchase invoice/i });
    // Saved values (987.65 is the server's stored total, not a client recompute).
    expect((await within(dialog).findAllByText('987.65')).length).toBeGreaterThan(0);
    expect(within(dialog).getByText('PO-000001')).toBeTruthy();
    expect(within(dialog).getByText('Acme Retail')).toBeTruthy();
    expect(within(dialog).getByText('Textile Wholesalers Ltd')).toBeTruthy();
    expect(within(dialog).getByText('Mina Manager')).toBeTruthy();
    for (const label of [/^print$/i, /download pdf/i, /^close$/i, /view purchase/i, /^reprint$/i]) {
      expect(within(dialog).getByRole('button', { name: label })).toBeTruthy();
    }

    // The purchase POST happened exactly once, with decimal strings.
    const posts = calls.filter((c) => c.method === 'POST' && c.path === '/purchases');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({
      supplierId: 'sup1',
      storeId: 's1',
      invoiceNo: 'INV-77',
    });

    // Reprint re-reads the saved purchase and creates nothing new.
    const invoiceGetsBefore = calls.filter((c) =>
      c.path.startsWith('/purchases/pur1/invoice'),
    ).length;
    await user.click(within(dialog).getByRole('button', { name: /^reprint$/i }));
    await waitFor(() =>
      expect(calls.filter((c) => c.path.startsWith('/purchases/pur1/invoice')).length).toBe(
        invoiceGetsBefore + 1,
      ),
    );
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/purchases')).toHaveLength(1);

    await user.click(within(dialog).getByRole('button', { name: /^close$/i }));
    expect(screen.queryByRole('dialog', { name: /purchase invoice/i })).toBeNull();
  });

  it('keeps every entered value and shows the error when the server rejects the purchase (no invoice opens)', async () => {
    const user = userEvent.setup();
    await openNewPurchase(user);
    await fillHeaderAndAddExistingProduct(user);
    purchasePostStatus = 409;

    await user.click(screen.getByRole('button', { name: /^record purchase$/i }));
    await user.click(await screen.findByRole('button', { name: /confirm & record/i }));

    expect(await screen.findByText(/already exists/i)).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: /purchase invoice/i })).toBeNull();
    expect((screen.getByLabelText(/supplier invoice/i) as HTMLInputElement).value).toBe('INV-77');
    expect(screen.getByLabelText(/quantity for cotton shirt/i)).toBeTruthy();
  });
});
