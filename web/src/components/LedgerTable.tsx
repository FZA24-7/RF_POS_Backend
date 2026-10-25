import type { Ledger } from '../api/types.js';

const TYPE_LABEL: Record<string, string> = {
  OPENING: 'Opening balance',
  CREDIT_SALE: 'Sale on account',
  CREDIT_REFUND: 'Refund to account',
  CUSTOMER_PAYMENT: 'Payment received',
  PURCHASE: 'Purchase',
  SUPPLIER_PAYMENT: 'Payment made',
};

/** A running ledger. "Increase" raises what is owed; "Decrease" lowers it. */
export const LedgerTable = ({ ledger }: { ledger: Ledger }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-left text-sm" aria-label="Ledger">
      <thead>
        <tr className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <th className="py-2 pr-4">Date</th>
          <th className="py-2 pr-4">Entry</th>
          <th className="py-2 pr-4">Reference</th>
          <th className="py-2 pr-4 text-right">Increase</th>
          <th className="py-2 pr-4 text-right">Decrease</th>
          <th className="py-2 text-right">Balance</th>
        </tr>
      </thead>
      <tbody>
        {ledger.entries.map((e, i) => (
          <tr
            key={`${e.reference}-${i}`}
            className="border-b border-slate-100 dark:border-slate-800"
          >
            <td className="py-2 pr-4">{e.date.slice(0, 10)}</td>
            <td className="py-2 pr-4">
              {TYPE_LABEL[e.type] ?? e.type}
              {e.description && e.type !== 'OPENING' ? (
                <span className="block text-xs text-slate-500">{e.description}</span>
              ) : null}
            </td>
            <td className="py-2 pr-4">{e.reference}</td>
            <td className="py-2 pr-4 text-right">{e.increase === '0.00' ? '' : e.increase}</td>
            <td className="py-2 pr-4 text-right">{e.decrease === '0.00' ? '' : e.decrease}</td>
            <td className="py-2 text-right font-medium">{e.balance}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
