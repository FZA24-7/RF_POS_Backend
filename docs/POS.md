# POS, sales, refunds and receipts (Phase 5)

What it does, the rules it enforces, and what has and has not been verified.

## 1. Flow

1. **Search / scan** - `GET /api/pos/products?storeId=&search=` returns active products (exact barcode first, then name/SKU)
   with the **branch's stock**.
2. **Checkout** - `POST /api/sales`. The client sends product ids, quantities, optional discounts, payments and a
   `clientRequestId`. **The client never sends a price or a total.** The server prices every line from the catalogue,
   computes totals with `@mafk/shared` `computeSale`, checks the tender, and writes everything in ONE database transaction.
3. **Receipt** - `GET /api/sales/:id/receipt?format=58mm|80mm|a4` (JSON + fixed-width text for thermal) and
   `.../receipt.pdf?format=` (real PDF). Always built from the **saved** sale: a reprint cannot change a figure.
4. **Refund** - `POST /api/sales/:id/returns`, then `GET /api/sale-returns/:id/receipt[.pdf]` for the refund slip.

## 2. Money rules (exact, no floating point)

All amounts are decimal **strings**; arithmetic is BigInt fixed point in `@mafk/shared` (`sale-math.ts`). One rounding
rule: half-up at 2 decimals, applied once per step.

```
gross      = quantity x unitPrice
line disc  = percent OR fixed amount (never both)
net        = gross - line discount
cart disc  = percent of sum(net) OR fixed amount, allocated to lines by net value (largest-remainder: cents are never lost)
taxable    = net - cart share          tax = taxRate% of taxable
lineTotal  = taxable + tax             grandTotal = sum(lineTotal)
```

Because the cart discount is allocated to lines, a partial refund returns exactly what that line cost the customer.
Refunds are pro-rata per line (half-up); the **final** return of a line takes the exact remainder, so refunds always sum
to the line total. The web screen uses the same functions for its live preview.

## 3. Tender rules

- Payments must cover the grand total; change is allowed only up to the **cash** amount.
- Methods accepted: `CASH`, `CARD`, `BANK_TRANSFER`. **`CUSTOMER_CREDIT` is rejected (422)** - selling on account needs the
  customer ledger from Phase 6.
- Zero or negative payment amounts are rejected.

## 4. Permissions (server-enforced, central catalogue)

| Action                                   | Permission                                          |
| ---------------------------------------- | --------------------------------------------------- |
| Search products, make a sale             | `pos.view`, `pos.create`                            |
| List / view sales                        | `sales.view`                                        |
| Sale receipt (text/PDF)                  | `sales.print`                                       |
| Any discount (line or cart)              | `discount.apply` (403 without it)                   |
| Price different from the catalogue price | `price.change` (403 without it; same price is fine) |
| Refund                                   | `sale.refund`                                       |
| View a refund / its slip                 | `sale_returns.view` / `sale_returns.print`          |

Default roles: Cashier can sell and print, but cannot discount, change prices or refund. Manager and Client Master Admin can.

## 5. Safety properties

- **All-or-nothing.** Sale row, items, payments, document number, every `SALE` stock movement and the audit record commit
  together or not at all (same for refunds with `SALE_RETURN` movements).
- **No overselling.** The stock decrement is atomic in SQL and rejected below zero (`INSUFFICIENT_STOCK`, 409, nothing written).
  Proven with 5 concurrent sales of 3 units against 10 in stock: exactly 3 succeed, stock ends at 1.
- **Idempotent checkout.** `clientRequestId` is unique per tenant. A repeat (double click, retry after a timeout) returns the
  same sale (`200`, header `Idempotent-Replayed: true`) and writes nothing. The web screen keeps the key until the sale succeeds.
- **Race-free refunds.** The sale row is locked (`SELECT ... FOR UPDATE`) while a return is planned and written, so two
  concurrent refunds cannot over-return a line.
- **Tenant isolation.** The tenant comes from the verified token. Another tenant gets 404 for a sale, receipt or refund.
- **Document numbers.** `INV-<BRANCH>-000001` and `RET-<BRANCH>-000001`, sequential per branch, unique per tenant.

## 6. Receipts

| Format | Output                                                                        |
| ------ | ----------------------------------------------------------------------------- |
| `58mm` | 32-column fixed-width text (JSON `text`) and a 58 mm wide continuous-roll PDF |
| `80mm` | 48-column fixed-width text and an 80 mm wide continuous-roll PDF              |
| `a4`   | Structured JSON (the web renders an A4 table) and an A4 PDF                   |

The web receipt dialog previews all three, prints with a matching `@page` size, and downloads the PDF. Printing a PDF is audited
(`RECEIPT_PRINTED`).

## 7. Not in Phase 5 (stated plainly)

- Selling on account / customer ledger and customer-linked sales (Phase 6). A free-text customer name/phone is stored on the sale.
- Voiding a sale (`sale.void` exists in the catalogue but no route uses it yet) - use a full refund.
- Hardware: direct ESC/POS or cash-drawer control (Electron, Phase 7). Thermal output is text/PDF today; printing goes through
  the browser or the PDF.
- `trackInventory = false` products are still stock-tracked (the flag is not used anywhere yet).
- Offline sales / sync (the idempotency key is the groundwork).
- A discount/price **approval** workflow: the permission is simply required.

## 8. Verification status

See `docs/TESTING.md` "Phase 5". In short: the money math, services, HTTP routes and web screen are covered by automated
tests that ran and passed in the sandbox; the sale/refund integrity contract also ran against **real PostgreSQL 16**. It has
**not** been run on the author's Windows machine.
