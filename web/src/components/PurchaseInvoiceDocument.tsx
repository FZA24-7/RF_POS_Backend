import type { PurchaseInvoice } from '../api/types.js';

const dateOnly = (iso: string): string => iso.slice(0, 10);

/**
 * The printable purchase invoice. It renders ONLY the saved purchase returned
 * by `GET /purchases/:id/invoice` - no value is recomputed or invented here.
 * `id="invoice-print"` is the element the print stylesheet isolates.
 */
export const PurchaseInvoiceDocument = ({ invoice }: { invoice: PurchaseInvoice }) => {
  const p = invoice.purchase;
  return (
    <div id="invoice-print" className="bg-white p-6 text-sm text-slate-900">
      <div className="flex items-start justify-between gap-4 border-b border-slate-300 pb-4">
        <div className="flex items-start gap-3">
          {invoice.business.logoUrl ? (
            <img
              src={invoice.business.logoUrl}
              alt="Business logo"
              className="h-14 w-auto object-contain"
            />
          ) : null}
          <div>
            <p className="text-lg font-bold">{invoice.business.name}</p>
            {invoice.business.address ? <p>{invoice.business.address}</p> : null}
            <p className="text-xs text-slate-600">
              {[invoice.business.phone, invoice.business.email].filter(Boolean).join(' | ')}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold">PURCHASE INVOICE</p>
          <p>
            Purchase No: <span className="font-mono">{p.purchaseNo}</span>
          </p>
          <p>
            Supplier Invoice: <span className="font-mono">{p.invoiceNo}</span>
          </p>
          <p>Date: {dateOnly(p.purchaseDate)}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 py-4">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Supplier</p>
          <p className="font-medium">{invoice.supplier.name}</p>
          {invoice.supplier.phone ? <p>{invoice.supplier.phone}</p> : null}
          {invoice.supplier.email ? <p>{invoice.supplier.email}</p> : null}
          {invoice.supplier.address ? <p>{invoice.supplier.address}</p> : null}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Branch</p>
          <p className="font-medium">{invoice.branch.name}</p>
          <p className="text-xs text-slate-600">{invoice.branch.code}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Created by</p>
          <p className="font-medium">{invoice.createdBy?.displayName ?? '—'}</p>
          <p className="text-xs text-slate-600">{p.createdAt.slice(0, 16).replace('T', ' ')}</p>
        </div>
      </div>

      <table className="w-full text-left">
        <thead>
          <tr className="bg-slate-100 text-xs uppercase">
            <th className="px-2 py-1.5">Product</th>
            <th className="px-2 py-1.5">SKU</th>
            <th className="px-2 py-1.5">Barcode</th>
            <th className="px-2 py-1.5 text-right">Qty</th>
            <th className="px-2 py-1.5 text-right">Cost</th>
            <th className="px-2 py-1.5 text-right">Disc %</th>
            <th className="px-2 py-1.5 text-right">Disc Rs</th>
            <th className="px-2 py-1.5 text-right">Tax</th>
            <th className="px-2 py-1.5 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {p.items.map((it) => (
            <tr key={it.id} className="border-b border-slate-200">
              <td className="px-2 py-1.5">{it.productName}</td>
              <td className="px-2 py-1.5 font-mono text-xs">{it.sku}</td>
              <td className="px-2 py-1.5 font-mono text-xs">{it.barcodes[0] ?? '—'}</td>
              <td className="px-2 py-1.5 text-right">{it.quantity}</td>
              <td className="px-2 py-1.5 text-right">{it.costPrice}</td>
              <td className="px-2 py-1.5 text-right">{it.discountPercent}</td>
              <td className="px-2 py-1.5 text-right">{it.discountAmount}</td>
              <td className="px-2 py-1.5 text-right">{it.taxAmount}</td>
              <td className="px-2 py-1.5 text-right font-medium">{it.lineTotal}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ml-auto mt-4 w-72 space-y-1">
        <Row label="Subtotal" value={p.subtotal} />
        <Row label={`Purchase discount (${p.discountPercent}%)`} value={p.discountAmount} />
        <Row label="Tax" value={p.taxTotal} />
        <Row label="Grand total" value={p.total} bold />
        <Row label="Amount paid" value={invoice.amountPaid} />
        <Row label="Outstanding" value={invoice.outstanding} bold />
        <Row label="Payment status" value={p.paymentStatus} bold />
      </dl>
    </div>
  );
};

const Row = ({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) => (
  <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}>
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);
