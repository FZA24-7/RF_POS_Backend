import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Eye, Printer, RotateCcw, X } from 'lucide-react';
import { apiDownload, apiRequest, ApiError } from '../api/client.js';
import type { PurchaseInvoice } from '../api/types.js';
import { Button } from './ui/Button.js';
import { Spinner } from './ui/Spinner.js';
import { ErrorBanner } from './ui/ErrorBanner.js';
import { PurchaseInvoiceDocument } from './PurchaseInvoiceDocument.js';

/** Fetches the SAVED purchase's invoice - the single source for display, print, PDF and reprint. */
export const usePurchaseInvoice = (purchaseId: string) => {
  const [invoice, setInvoice] = useState<PurchaseInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<PurchaseInvoice | null> => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<PurchaseInvoice>(`/purchases/${purchaseId}/invoice`);
      setInvoice(data);
      return data;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load the invoice.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [purchaseId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { invoice, loading, error, reload, setError };
};

export const InvoiceActions = ({
  purchaseId,
  purchaseNo,
  reprint,
  onClose,
  onViewPurchase,
}: {
  purchaseId: string;
  purchaseNo: string;
  /** Re-reads the saved purchase from the server, then prints. Never creates a transaction. */
  reprint: () => Promise<boolean>;
  onClose?: () => void;
  onViewPurchase?: () => void;
}) => {
  const [busy, setBusy] = useState<'pdf' | 'reprint' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const downloadPdf = async () => {
    setBusy('pdf');
    setError(null);
    try {
      await apiDownload(
        `/purchases/${purchaseId}/invoice.pdf`,
        `purchase-invoice-${purchaseNo}.pdf`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'PDF download failed.');
    } finally {
      setBusy(null);
    }
  };

  const doReprint = async () => {
    setBusy('reprint');
    const ok = await reprint();
    setBusy(null);
    if (ok) window.setTimeout(() => window.print(), 50);
  };

  return (
    <div className="no-print space-y-2">
      {error ? <ErrorBanner message={error} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => window.print()}>
          <Printer size={16} /> PRINT
        </Button>
        <Button variant="secondary" onClick={() => void downloadPdf()} disabled={busy === 'pdf'}>
          <Download size={16} /> {busy === 'pdf' ? 'Preparing…' : 'DOWNLOAD PDF'}
        </Button>
        <Button variant="secondary" onClick={() => void doReprint()} disabled={busy === 'reprint'}>
          <RotateCcw size={16} /> REPRINT
        </Button>
        {onViewPurchase ? (
          <Button variant="secondary" onClick={onViewPurchase}>
            <Eye size={16} /> VIEW PURCHASE
          </Button>
        ) : null}
        {onClose ? (
          <Button variant="ghost" onClick={onClose}>
            <X size={16} /> CLOSE
          </Button>
        ) : null}
      </div>
    </div>
  );
};

/** Opens automatically after "Record Purchase" succeeds, and from the list's Invoice action. */
export const PurchaseInvoiceModal = ({
  purchaseId,
  onClose,
  onViewPurchase,
}: {
  purchaseId: string;
  onClose: () => void;
  onViewPurchase: () => void;
}) => {
  const { invoice, loading, error, reload } = usePurchaseInvoice(purchaseId);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 no-print-backdrop">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Purchase invoice"
        className="my-6 w-full max-w-4xl space-y-3 rounded-lg bg-slate-50 p-4 shadow-xl outline-none dark:bg-slate-900"
      >
        {loading ? <Spinner label="Loading invoice…" /> : null}
        {error ? <ErrorBanner message={error} /> : null}
        {invoice ? (
          <>
            <div className="no-print rounded-md bg-green-50 px-4 py-2 text-sm text-green-800 dark:bg-green-900/20 dark:text-green-300">
              Purchase {invoice.purchase.purchaseNo} recorded successfully.
            </div>
            <PurchaseInvoiceDocument invoice={invoice} />
            <InvoiceActions
              purchaseId={purchaseId}
              purchaseNo={invoice.purchase.purchaseNo}
              reprint={async () => (await reload()) !== null}
              onClose={onClose}
              onViewPurchase={onViewPurchase}
            />
          </>
        ) : !loading ? (
          <Button variant="ghost" onClick={onClose}>
            <X size={16} /> CLOSE
          </Button>
        ) : null}
      </div>
    </div>
  );
};
