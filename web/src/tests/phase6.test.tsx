import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PosPage } from '../pages/PosPage.js';
import { CustomersPage } from '../pages/CustomersPage.js';
import { ExpensesPage } from '../pages/ExpensesPage.js';
import { ReportsPage } from '../pages/ReportsPage.js';
import { AnalyticsPage } from '../pages/AnalyticsPage.js';
import type { CustomerWithBalance, Ledger, PosProduct, SaleDetail } from '../api/types.js';

/**
 * Screen behaviour for the Phase 6 pages. `fetch` is a small in-test router with well-formed API payloads: these verify
 * the SCREENS (what is shown, what is sent, what is blocked) - not the server, which has its own tests.
 */
interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}
let calls: Call[] = [];
let routes: (
  path: string,
  method: string,
  body: Record<string, unknown> | undefined,
) => Response | undefined;
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const hassan: CustomerWithBalance = {
  id: 'c1',
  name: 'Hassan Traders',
  phone: '0300-1',
  email: null,
  address: null,
  customerType: 'RETAIL',
  openingBalance: '0.00',
  creditLimit: '5000.00',
  isActive: true,
  balance: '1398.00',
};
const ledger: Ledger = {
  openingBalance: '0.00',
  balance: '1398.00',
  entries: [
    {
      date: '2026-10-01T00:00:00.000Z',
      type: 'OPENING',
      reference: 'OPENING',
      description: 'Opening balance',
      increase: '0.00',
      decrease: '0.00',
      balance: '0.00',
    },
    {
      date: '2026-10-02T09:00:00.000Z',
      type: 'CREDIT_SALE',
      reference: 'INV-MAIN-000007',
      description: 'Sale on account',
      increase: '1398.00',
      decrease: '0.00',
      balance: '1398.00',
    },
  ],
};

beforeEach(() => {
  calls = [];
  routes = () => undefined;
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
      return (
        routes(path, method, body) ??
        json(404, { error: { code: 'NOT_FOUND', message: `unrouted ${path}` } })
      );
    }),
  );
});
afterEach(() => cleanup());

describe('CustomersPage', () => {
  it('lists customers, opens the ledger, and records a payment (blocked while nothing is owed)', async () => {
    let owed = true;
    routes = (path, method, body) => {
      if (path.startsWith('/customers?'))
        return json(200, { items: [hassan], total: 1, page: 1, pageSize: 100 });
      if (path === '/customers/c1')
        return json(200, owed ? hassan : { ...hassan, balance: '0.00' });
      if (path === '/customers/c1/ledger')
        return json(200, owed ? ledger : { ...ledger, balance: '0.00' });
      if (path === '/customers/c1/payments' && method === 'POST') {
        owed = false;
        return json(201, { payment: { id: 'p', amount: body?.amount }, balance: '0.00' });
      }
      return undefined;
    };
    const user = userEvent.setup();
    render(<CustomersPage />);
    await user.click(await screen.findByRole('button', { name: 'Hassan Traders' }));
    expect((await screen.findByTestId('customer-balance')).textContent).toContain('1398.00 owed');
    const table = screen.getByRole('table', { name: 'Ledger' });
    expect(table.textContent).toContain('Sale on account');
    expect(table.textContent).toContain('INV-MAIN-000007');

    const pay = screen.getByRole('button', { name: 'Record payment' }) as HTMLButtonElement;
    expect(pay.disabled).toBe(true); // no amount yet
    await user.type(screen.getByLabelText('Amount'), '1398.00');
    expect(pay.disabled).toBe(false);
    await user.click(pay);
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/customers/c1/payments')).toBe(
        true,
      ),
    );
    expect(calls.find((c) => c.path === '/customers/c1/payments')?.body).toMatchObject({
      amount: '1398.00',
      method: 'CASH',
    });
    await waitFor(() =>
      expect((screen.getByTestId('customer-balance') as HTMLElement).textContent).toContain('0.00'),
    );
    expect(
      (screen.getByRole('button', { name: 'Record payment' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/Nothing is owed/)).toBeTruthy();
  });

  it('validates the new-customer form before enabling Create', async () => {
    routes = (path) =>
      path.startsWith('/customers?')
        ? json(200, { items: [], total: 0, page: 1, pageSize: 100 })
        : undefined;
    const user = userEvent.setup();
    render(<CustomersPage />);
    await user.click(await screen.findByRole('button', { name: /New Customer/ }));
    const create = screen.getByRole('button', { name: 'Create customer' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    await user.type(screen.getByLabelText('Name'), 'Zara');
    expect(create.disabled).toBe(false);
    await user.type(screen.getByLabelText(/Credit limit/), '12.345');
    expect(create.disabled).toBe(true); // 3 decimals
  });
});

describe('POS sale on account', () => {
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
  const saved = {
    id: 'sale1',
    invoiceNo: 'INV-1',
    status: 'COMPLETED',
    grandTotal: '165.00',
    paidTotal: '165.00',
    changeDue: '0.00',
    customerId: 'c1',
    customerName: 'Hassan Traders',
    soldAt: '2026-10-12T10:00:00.000Z',
    storeId: 's1',
    subtotal: '150.00',
    itemDiscountTotal: '0.00',
    cartDiscountPercent: '0',
    cartDiscountAmount: '0.00',
    taxTotal: '15.00',
    notes: null,
    items: [],
    payments: [],
    returns: [],
  } as SaleDetail;

  it('picks a customer, puts the rest on account, and sends customerId + a CUSTOMER_CREDIT payment', async () => {
    routes = (path, method) => {
      if (path.startsWith('/pos/products')) return json(200, { items: [shirt] });
      if (path.startsWith('/customers?'))
        return json(200, { items: [hassan], total: 1, page: 1, pageSize: 8 });
      if (path === '/sales' && method === 'POST') return json(201, saved);
      if (path.startsWith('/sales/sale1/receipt'))
        return json(404, { error: { code: 'NOT_FOUND', message: 'no receipt in this test' } });
      return undefined;
    };
    const user = userEvent.setup();
    render(<PosPage storeId="s1" />);
    expect(screen.queryByLabelText('On account (credit)')).toBeNull(); // only once a customer is chosen
    await user.type(screen.getByLabelText(/scan barcode or search product/i), '111222{enter}');
    await screen.findByText('Cotton Shirt');
    await user.type(screen.getByLabelText('Find a customer (for sales on account)'), 'hassan');
    await user.click(screen.getByRole('button', { name: 'Find' }));
    await user.click(await screen.findByRole('button', { name: /Hassan Traders/ }));
    expect(screen.getByTestId('pos-customer-chip').textContent).toContain('owes 1398.00');
    expect(screen.queryByLabelText('Customer name (optional)')).toBeNull(); // the walk-in name box is replaced

    const complete = screen.getByRole('button', { name: 'Complete sale' }) as HTMLButtonElement;
    expect(complete.disabled).toBe(true);
    await user.type(screen.getByLabelText('Cash'), '65');
    await user.click(screen.getByRole('button', { name: 'Rest on account' }));
    expect((screen.getByLabelText('On account (credit)') as HTMLInputElement).value).toBe('100.00');
    expect(complete.disabled).toBe(false);
    await user.click(complete);
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/sales' && c.method === 'POST')).toBe(true),
    );
    const sent = calls.find((c) => c.path === '/sales')!.body!;
    expect(sent.customerId).toBe('c1');
    expect(sent.customerName).toBeUndefined();
    expect(sent.payments).toEqual([
      { method: 'CASH', amount: '65' },
      { method: 'CUSTOMER_CREDIT', amount: '100.00' },
    ]);
  });

  it("surfaces the server's credit-limit refusal and keeps the cart", async () => {
    routes = (path, method) => {
      if (path.startsWith('/pos/products')) return json(200, { items: [shirt] });
      if (path.startsWith('/customers?'))
        return json(200, { items: [hassan], total: 1, page: 1, pageSize: 8 });
      if (path === '/sales' && method === 'POST')
        return json(409, {
          error: {
            code: 'CREDIT_LIMIT_EXCEEDED',
            message:
              'Credit limit exceeded: balance 1398.00 + 165.00 is over the limit of 1500.00.',
          },
        });
      return undefined;
    };
    const user = userEvent.setup();
    render(<PosPage storeId="s1" />);
    await user.type(screen.getByLabelText(/scan barcode or search product/i), '111222{enter}');
    await screen.findByText('Cotton Shirt');
    await user.type(screen.getByLabelText('Find a customer (for sales on account)'), 'hassan');
    await user.click(screen.getByRole('button', { name: 'Find' }));
    await user.click(await screen.findByRole('button', { name: /Hassan Traders/ }));
    await user.click(screen.getByRole('button', { name: 'Rest on account' }));
    await user.click(screen.getByRole('button', { name: 'Complete sale' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Credit limit exceeded');
    expect(screen.getByText('Cotton Shirt')).toBeTruthy();
  });
});

describe('ExpensesPage', () => {
  it('shows the total of all matching expenses and refuses an invalid new expense', async () => {
    routes = (path) => {
      if (path.startsWith('/expenses?'))
        return json(200, {
          items: [
            {
              id: 'e1',
              storeId: 's1',
              category: 'Rent',
              description: null,
              amount: '50.00',
              expenseDay: '2026-10-01',
              method: 'CASH',
            },
          ],
          total: 1,
          totalAmount: '50.00',
          page: 1,
          pageSize: 100,
        });
      if (path === '/stores')
        return json(200, [
          { id: 's1', code: 'MAIN', name: 'Main Branch', isDefault: true, isActive: true },
        ]);
      return undefined;
    };
    const user = userEvent.setup();
    render(<ExpensesPage />);
    expect((await screen.findByTestId('expense-total')).textContent).toContain('50.00');
    expect(screen.getByText('Main Branch')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /New Expense/ }));
    const save = screen.getByRole('button', { name: 'Save expense' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.type(screen.getByLabelText('Expense category'), 'Tea');
    await user.type(screen.getByLabelText('Amount'), '0');
    expect(save.disabled).toBe(true); // zero is not an amount
    await user.clear(screen.getByLabelText('Amount'));
    await user.type(screen.getByLabelText('Amount'), '12.50');
    expect(save.disabled).toBe(false);
  });
});

describe('ReportsPage and AnalyticsPage', () => {
  const summary = {
    saleCount: 3,
    grossSales: '620.00',
    itemDiscounts: '0.00',
    cartDiscounts: '10.00',
    tax: '31.00',
    netSales: '641.00',
    refundCount: 0,
    refunds: '0.00',
    netAfterRefunds: '641.00',
    averageSale: '213.67',
    paymentsByMethod: [{ method: 'CASH', amount: '332.00' }],
    refundsByMethod: [],
  };
  const meta = {
    from: '2026-09-01',
    to: '2026-09-30',
    storeId: null,
    timeZone: 'Asia/Karachi',
    currency: 'PKR',
  };

  it('runs a report with the chosen range, shows exact figures and the time-zone note', async () => {
    routes = (path) =>
      path.startsWith('/reports/sales-summary') ? json(200, { meta, data: summary }) : undefined;
    const user = userEvent.setup();
    render(<ReportsPage />);
    expect((screen.getByRole('button', { name: /Export CSV/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.click(screen.getByRole('button', { name: 'Run report' }));
    const table = await screen.findByRole('table', { name: 'Sales summary' });
    expect(table.textContent).toContain('641.00');
    expect(table.textContent).toContain('213.67');
    expect(screen.getByText(/calendar days in Asia\/Karachi; amounts in PKR/)).toBeTruthy();
    expect(calls[0]?.path).toMatch(
      /^\/reports\/sales-summary\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/,
    );
    expect((screen.getByRole('button', { name: /Export CSV/ }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("shows the server's permission message instead of failing silently", async () => {
    routes = () =>
      json(403, { error: { code: 'PERMISSION_DENIED', message: 'Permission denied.' } });
    const user = userEvent.setup();
    render(<ReportsPage />);
    await user.click(screen.getByRole('button', { name: 'Run report' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Permission denied');
  });

  it('analytics shows the change vs the previous period and handles an empty period', async () => {
    const overview = (change: string | null, empty: boolean) => ({
      meta,
      summary: empty
        ? { ...summary, saleCount: 0, netSales: '0.00', averageSale: '0.00' }
        : summary,
      previous: {
        from: '2026-08-01',
        to: '2026-08-31',
        summary: { ...summary, netSales: '100.00', saleCount: 1 },
      },
      netSalesChangePercent: change,
      daily: empty ? [] : [{ date: '2026-09-01', saleCount: 2, netSales: '432.00' }],
      hourly: empty ? [] : [{ hour: 10, saleCount: 1, netSales: '100.00' }],
      topProducts: empty
        ? []
        : [
            {
              productId: 'p',
              productName: 'Shirt',
              sku: 'S',
              quantitySold: '3.000',
              quantityReturned: '0.000',
              revenue: '300.00',
            },
          ],
      byCategory: [],
    });
    routes = () => json(200, overview('541.0', false));
    render(<AnalyticsPage />);
    expect(await screen.findByText(/\+541\.0% vs previous period/)).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Sales by day' }).textContent).toContain('432.00');
    cleanup();
    routes = () => json(200, overview(null, true));
    render(<AnalyticsPage />);
    expect((await screen.findAllByText(/No sales in the previous period/)).length).toBe(1);
    expect(screen.getAllByText('No sales in this period.').length).toBeGreaterThan(0);
  });
});
