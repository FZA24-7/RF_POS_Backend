# Phase 6 - Customers, credit, expenses, employees, reports, analytics, supplier ledger

No schema change: the shipped migration (`20261010190408_init`, 34 tables) already had `customers`, `customer_payments`,
`expenses`, `employees` and the supplier tables. Everything below is derived from rows with exact money math.

## 1. Customers and sales on account

| Rule                 | Behaviour                                                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Balance (receivable) | `opening + CUSTOMER_CREDIT payments on the customer's sales - refunds paid to account - payments received`. Never stored.                                             |
| Negative balance     | The shop owes the customer (store credit).                                                                                                                            |
| Credit limit         | Empty or `0` = **no credit allowed**. Enforced inside the sale transaction with the customer row locked (`FOR UPDATE`).                                               |
| Concurrency          | Three concurrent 200.00 credit sales against a 400.00 limit: exactly two succeed (tested on PostgreSQL).                                                              |
| Sale tender          | `CUSTOMER_CREDIT` needs a `customerId`, an active customer, and an amount no larger than `total - other payments`. It never produces change. `paidTotal` includes it. |
| Snapshot             | A sale with `customerId` copies the customer's name and phone onto the sale.                                                                                          |
| Payments received    | Cash / card / bank transfer, locked against the balance: cannot exceed what is owed, concurrent payments cannot jointly exceed it.                                    |
| Refund to account    | `refundMethod = CUSTOMER_CREDIT` lowers the balance; the sale must have a customer.                                                                                   |
| Permissions          | `customers.view/create` (cashier). Setting a **credit limit or opening balance**, editing, and taking payments need `customers.edit`.                                 |

Errors: `CREDIT_LIMIT_EXCEEDED` (409), `PAYMENT_EXCEEDS_BALANCE` (409), `VALIDATION_ERROR` (422), `NOT_FOUND` (404 across tenants).

## 2. Supplier ledger (payable)

`opening balance + purchase totals - supplier payments`. `POST /suppliers` accepts an optional `openingBalance`;
`GET /suppliers/:id/ledger` returns running entries (`OPENING`, `PURCHASE`, `SUPPLIER_PAYMENT`). `GET /reports/payables`
lists suppliers with a positive balance.

## 3. Expenses and employees

- Expenses: create / update / delete / list (`expenses.*`), audit written in the same transaction, list returns the sum over **all** matching rows,
  not just the page. The date is a calendar day in the business time zone (stored as that day's first instant).
- Employees (`employees.*`): optional link to a login user (one employee per user -> `409 CONFLICT`). **Salary and national ID are returned
  only to callers with `employees.edit`**; everyone else gets `null`.

## 4. Reports and analytics (`reports.view`, CSV also needs `reports.export`, analytics needs `analytics.view`)

All dates are calendar days in the **tenant's time zone** (`tenants.timezone`, default `Asia/Karachi`), converted to a half-open instant range
(start inclusive, end exclusive; at most 366 days). Daily/hourly buckets use `AT TIME ZONE` in PostgreSQL; the in-memory fake uses `Intl`,
and one contract suite checks both give the same answers at the exact day boundaries.

| Endpoint                                               | Definition                                                                                                                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /reports/sales-summary`                           | Sales (not VOID) sold in range: gross, discounts, tax, net; refunds **processed** in range; payments by method (cash net of change).                            |
| `/reports/daily`, `/hourly`                            | Net sales per business-local day / hour (empty buckets omitted).                                                                                                |
| `/reports/top-products`, `/by-category`, `/by-cashier` | Quantity and revenue (line totals) of sales in range; category = the product's current category.                                                                |
| `/reports/profit-loss`                                 | Revenue ex-tax **net of refunded units** - cost of goods (cost recorded at sale x units kept) - expenses in range. Refunds are attributed to the original sale. |
| `/reports/stock-valuation`                             | Quantity x cost price and x selling price, per branch (quantity > 0).                                                                                           |
| `/reports/receivables`, `/payables`                    | Customers who owe you / suppliers you owe, largest first.                                                                                                       |
| `GET /analytics/overview`                              | Summary + previous period of the same length (change %), daily, hourly, best sellers, categories.                                                               |

Add `format=csv` to any report for a CSV (UTF-8 BOM for Excel on Windows). Cells that start with `= + @` or a non-numeric `-` are prefixed with `'`
so a spreadsheet cannot execute them. Money is never floating point: SQL `numeric`, exact decimal strings, BigInt in JS.

## 5. Screens

Customers (list, credit settings, ledger, take payment), POS (find a customer, "On account", "Rest on account"), Expenses, Employees,
Reports (any report, CSV), Analytics (tiles, per-day and per-hour bars, best sellers), Suppliers (opening balance, ledger).

## 6. Not in Phase 6 / known limits

Voiding a sale, payroll runs, salary payments as expenses automation, customer statements as PDF, scheduled/emailed reports, per-product cost history
(profit uses the cost captured at sale time), multi-currency. Reports on very large data sets have not been load-tested. See `docs/TESTING.md`
"Phase 6 additions" for exactly what was and was not run.
