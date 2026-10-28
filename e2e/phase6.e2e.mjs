// Browser end-to-end test for the Phase 6 screens: real Chromium -> real web app -> real API -> real PostgreSQL.
// No mocks. Run with `pnpm run e2e` (see docs/E2E.md). Nothing here is a credential: the Master Admin login comes from
// the environment, and the throwaway tenant admin's password is generated randomly on every run.
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const need = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set (see docs/E2E.md).`);
  return v;
};
const API = (process.env.E2E_API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');
const WEB = (process.env.E2E_WEB_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const MASTER_LOGIN = need('E2E_MASTER_LOGIN_ID');
const MASTER_PASSWORD = need('E2E_MASTER_PASSWORD');

const run = randomBytes(3).toString('hex');
const adminLogin = `e2e.${run}`;
const adminPassword = `Pw-${randomBytes(9).toString('hex')}-Aa1`;

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name} ${detail}`);
    console.log(`  FAIL ${name} ${detail}`);
  }
};
const eq = (name, actual, expected) =>
  check(
    name,
    actual === expected,
    `(expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
  );

const call = async (method, path, token, body) => {
  const r = await fetch(API + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => {
    throw new Error(`Cannot reach the API at ${API}. Start it first (see docs/E2E.md).`);
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
};

// ---- Arrange through the real API (only data the screens then work on) -------------------------------------------
const { MODULE_CATALOG } = await import('../packages/shared/dist/index.js');
const master = await call('POST', '/auth/login', null, {
  loginId: MASTER_LOGIN,
  password: MASTER_PASSWORD,
});
await call('POST', '/master/tenants', master.accessToken, {
  code: `E2E${run.toUpperCase()}`,
  name: `E2E Retail ${run}`,
  defaultStoreName: 'Main Branch',
  masterAdmin: { loginId: adminLogin, password: adminPassword, displayName: 'E2E Admin' },
  license: {
    planCode: 'STANDARD',
    expiresAt: new Date(Date.now() + 365 * 864e5).toISOString(),
    maxUsers: 10,
    maxDevices: 5,
    maxStores: 3,
    enabledModules: [...MODULE_CATALOG],
  },
});
const token = (
  await call('POST', '/auth/login', null, { loginId: adminLogin, password: adminPassword })
).accessToken;
const cat = await call('POST', '/catalog/categories', token, { name: 'Apparel' });
const sub = await call('POST', '/catalog/sub-departments', token, {
  categoryId: cat.id,
  name: 'Shirts',
});
const barcode = `88${run}1`;
const product = await call('POST', '/catalog/products', token, {
  name: 'Linen Shirt',
  sku: `LIN-${run}`,
  categoryId: cat.id,
  subDepartmentId: sub.id,
  costPrice: '120',
  sellingPrice: '200',
  taxRate: '0',
  barcodes: [barcode],
});
const store = (await call('GET', '/stores', token))[0];

// ---- Drive the browser ---------------------------------------------------------------------------------------------
// Browser: E2E_CHANNEL=chrome|msedge uses the Chrome/Edge already installed (typical on Windows);
// E2E_CHROMIUM=<full path to a chrome executable> is the alternative.
const browser = await chromium.launch({
  ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}),
  ...(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}),
  args: ['--no-sandbox'],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  acceptDownloads: true,
});
const page = await context.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('dialog', (d) => void d.accept());
const nav = (name) => page.getByRole('button', { name, exact: true }).click();
const money = (s) => (s.match(/-?\d[\d,]*\.\d{2}/)?.[0] ?? '').replace(/,/g, '');

try {
  console.log('Login');
  await page.goto(WEB + '/');
  await page.getByLabel('Login ID', { exact: true }).fill(adminLogin);
  await page.getByLabel('Password', { exact: true }).fill(adminPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Customers', exact: true }).waitFor();
  check('signed in, Phase 6 navigation visible', true);

  console.log('Supplier opening balance and ledger');
  await nav('Suppliers');
  await page.getByRole('button', { name: /New Supplier/ }).click();
  await page.getByLabel('Name', { exact: true }).fill(`Weave Co ${run}`);
  await page.getByLabel(/Opening balance we owe/).fill('250');
  await page.getByRole('button', { name: /^(Create|Save|Add)/ }).click();
  await page.getByText(`Weave Co ${run}`).first().waitFor();
  const supplier =
    (await call('GET', `/suppliers?search=${encodeURIComponent(`Weave Co ${run}`)}`, token))
      .items?.[0] ??
    (await call('GET', `/suppliers?search=${encodeURIComponent(`Weave Co ${run}`)}`, token))[0];
  // 20 shirts at cost 120 = 2400, 1000 paid up front -> owes 250 + 2400 - 1000 = 1650.00
  await call('POST', '/purchases', token, {
    supplierId: supplier.id,
    storeId: store.id,
    invoiceNo: `P-${run}`,
    purchaseDate: new Date().toISOString().slice(0, 10),
    items: [{ productId: product.id, quantity: '20', costPrice: '120' }],
    initialPayment: { amount: '1000', method: 'CASH' },
  });
  await page.reload();
  await nav('Suppliers');
  await page
    .getByRole('row', { name: new RegExp(`Weave Co ${run}`) })
    .getByRole('button')
    .click();
  await page.getByTestId('supplier-balance').waitFor();
  eq(
    'supplier ledger balance = 250 + 2400 - 1000',
    money(await page.getByTestId('supplier-balance').innerText()),
    '1650.00',
  );

  console.log('Customer with opening balance and credit limit');
  await nav('Customers');
  await page.getByRole('button', { name: /New Customer/ }).click();
  await page.getByLabel('Name', { exact: true }).fill(`Ayesha ${run}`);
  await page.getByLabel('Phone', { exact: true }).fill(`0300${run}`.slice(0, 11));
  await page.getByLabel(/Opening balance owed/).fill('50');
  await page.getByLabel(/Credit limit \(optional\)/).fill('500');
  await page.getByRole('button', { name: 'Create customer' }).click();
  await page.getByTestId('customer-balance').waitFor();
  check(
    'customer opening balance 50.00 owed',
    (await page.getByTestId('customer-balance').innerText()).includes('50.00 owed'),
  );
  check(
    'customer credit limit 500.00 shown',
    (await page.getByTestId('customer-balance').innerText()).includes('500.00'),
  );

  console.log('POS sale on account');
  const sell = async (qty, cash) => {
    await nav('POS');
    await page.getByLabel(/scan barcode/i).fill(barcode);
    await page.keyboard.press('Enter');
    await page.getByText('Linen Shirt').first().waitFor();
    for (let i = 1; i < qty; i += 1)
      await page.getByRole('button', { name: 'Increase Linen Shirt' }).click();
    await page.getByLabel(/Find a customer/).fill(`Ayesha ${run}`);
    await page.getByRole('button', { name: 'Find', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(`Ayesha ${run}`) }).click();
    await page.getByTestId('pos-customer-chip').waitFor();
    if (cash) await page.getByLabel('Cash', { exact: true }).fill(cash);
    await page.getByRole('button', { name: 'Rest on account' }).click();
  };
  await sell(2, '100'); // total 400 -> 100 cash + 300 on account
  eq('POS total', money(await page.getByTestId('grand-total').innerText()), '400.00');
  eq(
    'rest on account = 300.00',
    await page.getByLabel('On account (credit)').inputValue(),
    '300.00',
  );
  await page.getByRole('button', { name: 'Complete sale' }).click();
  await page.getByRole('dialog').waitFor();
  const receipt = await page.locator('#receipt-print pre').innerText();
  check('receipt shows the customer name', receipt.includes(`Ayesha ${run}`));
  check('receipt shows the 300.00 on account', /300\.00/.test(receipt));
  // Receipt output per paper size (server-rendered fixed-width text: 32 columns at 58 mm, 48 at 80 mm).
  const widest = (t) => Math.max(...t.split('\n').map((l) => l.replace(/\r$/, '').length));
  check('80 mm receipt fits 48 columns', widest(receipt) <= 48, `(widest line ${widest(receipt)})`);
  await page.getByRole('button', { name: '58 mm' }).click();
  await page.waitForFunction(
    () => document.querySelector('#receipt-print')?.getAttribute('data-format') === '58mm',
  );
  await page.waitForTimeout(300);
  const r58 = await page.locator('#receipt-print pre').innerText();
  check('58 mm receipt fits 32 columns', widest(r58) <= 32, `(widest line ${widest(r58)})`);
  check(
    '58 mm receipt still shows customer and 300.00',
    r58.includes('Ayesha') && /300\.00/.test(r58),
  );
  await page.getByRole('button', { name: 'A4' }).click();
  await page.locator('#receipt-print table').waitFor();
  const a4 = await page.locator('#receipt-print').innerText();
  check(
    'A4 invoice shows the customer and the on-account amount',
    a4.includes(`Ayesha ${run}`) && /300\.00/.test(a4),
  );
  // Print media: only the receipt is visible (the app chrome is hidden), exactly what the printer would receive.
  await page.emulateMedia({ media: 'print' });
  const hiddenNav = await page.evaluate(() => {
    const nav = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Customers',
    );
    return nav ? getComputedStyle(nav).visibility : 'missing';
  });
  const receiptVisible = await page.evaluate(
    () => getComputedStyle(document.querySelector('#receipt-print')).visibility,
  );
  await page.emulateMedia({ media: 'screen' });
  eq('print media hides the app navigation', hiddenNav, 'hidden');
  eq('print media shows the receipt', receiptVisible, 'visible');
  await page.getByRole('button', { name: 'Close' }).click();

  await nav('Customers');
  await page.getByRole('button', { name: `Ayesha ${run}` }).click();
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="customer-balance"]')?.textContent?.includes('350.00'),
  );
  check(
    'balance = 50 + 300 = 350.00 owed',
    (await page.getByTestId('customer-balance').innerText()).includes('350.00 owed'),
  );

  console.log('Credit limit enforced (350 + 200 > 500)');
  await sell(1, '');
  await page.getByRole('button', { name: 'Complete sale' }).click();
  await page.getByRole('alert').first().waitFor();
  check(
    'limit-exceeded error is shown',
    /credit limit/i.test(await page.getByRole('alert').first().innerText()),
  );
  await nav('Customers');
  await page.getByRole('button', { name: `Ayesha ${run}` }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="customer-balance"]'));
  check(
    'balance unchanged after refused sale',
    (await page.getByTestId('customer-balance').innerText()).includes('350.00 owed'),
  );

  console.log('Customer payment, then an overpayment is refused');
  await page.getByLabel('Amount', { exact: true }).fill('120');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="customer-balance"]')?.textContent?.includes('230.00'),
  );
  check(
    'balance after paying 120 = 230.00 owed',
    (await page.getByTestId('customer-balance').innerText()).includes('230.00 owed'),
  );
  await page.getByLabel('Amount', { exact: true }).fill('1000');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.getByRole('alert').first().waitFor();
  check(
    'overpayment refused with a message',
    (await page.getByRole('alert').first().innerText()).length > 0,
  );
  check(
    'balance still 230.00 owed',
    (await page.getByTestId('customer-balance').innerText()).includes('230.00 owed'),
  );
  check(
    'ledger lists the sale and the payment',
    (await page.getByRole('table').last().innerText()).toLowerCase().includes('payment'),
  );

  console.log('Expenses');
  await nav('Expenses');
  const addExpense = async (category, amount) => {
    await page.getByRole('button', { name: /New Expense/ }).click();
    await page.getByLabel('Expense category').fill(category);
    await page.getByLabel('Amount', { exact: true }).fill(amount);
    await page
      .getByRole('button', { name: /^(Add|Save|Create|Record)/ })
      .last()
      .click();
    await page.getByText(category, { exact: true }).first().waitFor();
  };
  await addExpense('Rent', '70');
  await addExpense('Electricity', '30');
  eq(
    'expense total after two = 100.00',
    money(await page.getByTestId('expense-total').innerText()),
    '100.00',
  );
  await page.getByRole('button', { name: 'Delete Electricity expense' }).click();
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="expense-total"]')?.textContent?.includes('70.00'),
  );
  eq(
    'expense total after delete = 70.00',
    money(await page.getByTestId('expense-total').innerText()),
    '70.00',
  );

  console.log('Employees');
  await nav('Employees');
  await page.getByRole('button', { name: /New Employee/ }).click();
  await page.getByLabel('Full name').fill(`Bilal ${run}`);
  await page.getByLabel('Designation').fill('Cashier');
  await page.getByLabel('Monthly salary').fill('30000');
  await page
    .getByRole('button', { name: /^(Add|Save|Create)/ })
    .last()
    .click();
  await page.getByText(`Bilal ${run}`).first().waitFor();
  const row = await page.getByRole('row', { name: new RegExp(`Bilal ${run}`) }).innerText();
  check(
    'employee row shows designation and salary (admin has employees.edit)',
    row.includes('Cashier') && row.includes('30000'),
  );

  console.log('Reports');
  const range = async () => {
    await page
      .getByLabel('From', { exact: true })
      .fill(new Date(Date.now() - 864e5).toLocaleDateString('en-CA'));
    await page
      .getByLabel('To', { exact: true })
      .fill(new Date(Date.now() + 864e5).toLocaleDateString('en-CA'));
  };
  const report = async (label) => {
    await nav('Reports');
    await page.getByLabel('Report', { exact: true }).selectOption({ label });
    if (!/balances/.test(label) && label !== 'Stock valuation') await range();
    await page.getByRole('button', { name: 'Run report' }).click();
    await page.getByRole('heading', { level: 2 }).first().waitFor();
    return page.locator('main').innerText();
  };
  let text = await report('Sales summary');
  check('sales summary shows 400.00', text.includes('400.00'));
  text = await report('Profit & loss');
  check(
    'P&L shows revenue 400.00, cost 240.00, expenses 70.00, net 90.00',
    ['400.00', '240.00', '70.00', '90.00'].every((v) => text.includes(v)),
    text.slice(0, 400),
  );
  text = await report('Customer balances owed to you');
  check(
    'receivables list the customer at 230.00',
    text.includes(`Ayesha ${run}`) && text.includes('230.00'),
  );
  text = await report('Supplier balances you owe');
  check(
    'payables list the supplier at 1650.00',
    text.includes(`Weave Co ${run}`) && text.includes('1650.00'),
  );
  text = await report('Stock valuation');
  check('stock valuation shows 18 units', text.includes('18'));

  console.log('CSV export');
  await nav('Reports');
  await page.getByLabel('Report', { exact: true }).selectOption({ label: 'Profit & loss' });
  await range();
  await page.getByRole('button', { name: 'Run report' }).click();
  await page.getByRole('heading', { level: 2 }).first().waitFor();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Export CSV/ }).click(),
  ]);
  const csv = await readFile(await download.path(), 'utf8');
  check('CSV starts with a UTF-8 BOM', csv.charCodeAt(0) === 0xfeff);
  check('CSV contains the P&L figures', csv.includes('400.00') && csv.includes('90.00'));

  console.log('Analytics');
  await nav('Analytics');
  await page
    .getByLabel('From', { exact: true })
    .fill(new Date(Date.now() - 864e5).toLocaleDateString('en-CA'));
  await page
    .getByLabel('To', { exact: true })
    .fill(new Date(Date.now() + 864e5).toLocaleDateString('en-CA'));
  await page.getByText('Net sales').first().waitFor();
  await page.waitForFunction(() => document.body.innerText.includes('400.00'));
  check(
    'analytics shows net sales 400.00 and the best seller',
    (await page.locator('main').innerText()).includes('Linen Shirt'),
  );

  check('no uncaught page errors', consoleErrors.length === 0, consoleErrors.join(' | '));
} catch (err) {
  failures.push(`aborted: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
  console.log('ABORTED', err instanceof Error ? err.message : err);
  if (process.env.E2E_SCREENSHOT_DIR)
    await page.screenshot({
      path: `${process.env.E2E_SCREENSHOT_DIR}/e2e-failure.png`,
      fullPage: true,
    });
} finally {
  await browser.close();
}

console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
