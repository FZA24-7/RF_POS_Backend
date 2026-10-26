import { useEffect, useState } from 'react';
import { Download, Printer, X } from 'lucide-react';
import { apiDownload, apiRequest, ApiError } from '../api/client.js';
import type { ReceiptFormat, ReceiptResponse } from '../api/types.js';
import { Button } from './ui/Button.js';
import { Spinner } from './ui/Spinner.js';
import { ErrorBanner } from './ui/ErrorBanner.js';

const FORMATS: { value: ReceiptFormat; label: string }[] = [
  { value: '58mm', label: '58 mm' },
  { value: '80mm', label: '80 mm' },
  { value: 'a4', label: 'A4' },
];

const PAGE_WIDTH: Record<ReceiptFormat, string> = { '58mm': '58mm', '80mm': '80mm', a4: '190mm' };

/** Applies a `@page` size for the chosen paper while the receipt is printed, then removes it. */
const printWithPageSize = (format: ReceiptFormat): void => {
  const style = document.createElement('style');
  style.textContent =
    format === 'a4'
      ? '@page { size: A4; margin: 10mm; }'
      : `@page { size: ${format === '58mm' ? '58mm' : '80mm'} auto; margin: 2mm; }`;
  document.head.appendChild(style);
  const cleanup = () => {
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
};

/**
 * Shows a SAVED receipt (sale receipt or refund slip) in 58mm / 80mm / A4. The content always comes from the server's
 * stored records, so reprinting never recalculates anything. `basePath` is `/sales/:id` or `/sale-returns/:id`.
 */
export const ReceiptModal = ({
  basePath,
  number,
  initialFormat = '80mm',
  onClose,
}: {
  basePath: string;
  number: string;
  initialFormat?: ReceiptFormat;
  onClose: () => void;
}) => {
  const [format, setFormat] = useState<ReceiptFormat>(initialFormat);
  const [data, setData] = useState<ReceiptResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    void (async () => {
      try {
        const res = await apiRequest<ReceiptResponse>(`${basePath}/receipt?format=${format}`);
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof ApiError ? err.message : 'Failed to load the receipt.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [basePath, format]);

  const downloadPdf = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiDownload(
        `${basePath}/receipt.pdf?format=${format}`,
        `receipt-${number}-${format}.pdf`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'PDF download failed.');
    } finally {
      setBusy(false);
    }
  };

  const doc = data?.receipt;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Receipt ${number}`}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-slate-900/60 p-4"
    >
      <div className="w-full max-w-3xl rounded-lg bg-white p-4 shadow-xl dark:bg-slate-900">
        <div className="no-print mb-3 flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Paper size"
            className="inline-flex overflow-hidden rounded-md border border-slate-300 dark:border-slate-600"
          >
            {FORMATS.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={format === f.value}
                onClick={() => setFormat(f.value)}
                className={`px-3 py-1.5 text-sm ${format === f.value ? 'bg-brand-600 text-white' : 'bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <Button onClick={() => printWithPageSize(format)} disabled={!doc}>
            <Printer size={16} /> Print
          </Button>
          <Button variant="secondary" onClick={() => void downloadPdf()} disabled={!doc || busy}>
            <Download size={16} /> PDF
          </Button>
          <Button variant="ghost" onClick={onClose} className="ml-auto">
            <X size={16} /> Close
          </Button>
        </div>
        {error ? <ErrorBanner message={error} /> : null}
        {!doc && !error ? <Spinner label="Loading receipt…" /> : null}
        {doc ? (
          <div className="overflow-auto bg-slate-100 p-3 dark:bg-slate-800">
            <div
              id="receipt-print"
              data-format={format}
              style={{ width: PAGE_WIDTH[format] }}
              className="mx-auto bg-white p-2 text-black"
            >
              {data?.text ? (
                <pre
                  className="whitespace-pre font-mono leading-tight"
                  style={{ fontSize: format === '58mm' ? '10px' : '11px' }}
                >
                  {data.text}
                </pre>
              ) : (
                <A4Receipt doc={doc} />
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

const A4Receipt = ({ doc }: { doc: NonNullable<ReceiptResponse['receipt']> }) => (
  <div className="text-sm">
    <h2 className="text-xl font-bold">{doc.business.name}</h2>
    {[
      doc.business.legalName,
      doc.business.address,
      doc.business.phone,
      doc.business.email,
      doc.branch.name,
    ]
      .filter(Boolean)
      .map((l) => (
        <div key={l}>{l}</div>
      ))}
    <h3 className="mt-3 border-t border-black pt-2 text-lg font-bold">{doc.title}</h3>
    <div>No: {doc.number}</div>
    {doc.relatedNumber ? <div>Invoice: {doc.relatedNumber}</div> : null}
    <div>Date: {doc.date.slice(0, 16).replace('T', ' ')}</div>
    {doc.cashier ? <div>Cashier: {doc.cashier}</div> : null}
    {doc.customer ? <div>Customer: {doc.customer}</div> : null}
    <table className="mt-3 w-full border-t border-black">
      <thead>
        <tr className="text-left">
          <th className="py-1">Item</th>
          <th className="py-1 text-right">Qty</th>
          <th className="py-1 text-right">Unit price</th>
          <th className="py-1 text-right">Discount</th>
          <th className="py-1 text-right">Total</th>
        </tr>
      </thead>
      <tbody>
        {doc.lines.map((l, i) => (
          <tr key={`${l.sku}-${i}`}>
            <td className="py-0.5">
              {l.name} ({l.sku})
            </td>
            <td className="py-0.5 text-right">{l.quantity.replace(/\.?0+$/, '')}</td>
            <td className="py-0.5 text-right">{l.unitPrice}</td>
            <td className="py-0.5 text-right">{l.discount}</td>
            <td className="py-0.5 text-right">{l.lineTotal}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <div className="mt-2 border-t border-black pt-2">
      {doc.totals.map((t) => (
        <div key={t.label} className={`flex justify-between ${t.strong ? 'font-bold' : ''}`}>
          <span>{t.label}</span>
          <span>{t.value}</span>
        </div>
      ))}
    </div>
    <div className="mt-2 border-t border-black pt-2">
      {doc.payments.map((p) => (
        <div key={p.label} className="flex justify-between">
          <span>{p.label}</span>
          <span>{p.value}</span>
        </div>
      ))}
    </div>
    <p className="mt-3 text-center">{doc.footer}</p>
  </div>
);
