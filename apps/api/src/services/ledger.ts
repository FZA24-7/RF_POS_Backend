import { addDecimalStrings, compareDecimalStrings, subtractDecimalStrings } from '@mafk/shared';
import type { Ledger, LedgerEntry, Outstanding } from '../domain/types.js';

/** Shared by customers and suppliers: positive balances only, largest first, with an exact total. */
export const summariseOutstanding = (
  rows: { id: string; name: string; phone: string | null; balance: string }[],
): Outstanding => {
  const owing = rows
    .filter((r) => compareDecimalStrings(r.balance, '0', 2) > 0)
    .sort((a, b) => compareDecimalStrings(b.balance, a.balance, 2) || a.name.localeCompare(b.name));
  return {
    rows: owing,
    total: owing.reduce((acc, r) => addDecimalStrings(acc, r.balance, 2), '0.00'),
  };
};

/** Turns date-sorted raw movements into a ledger with a running balance. */
export const buildLedger = (
  opening: string,
  openedAt: Date,
  raw: Omit<LedgerEntry, 'balance'>[],
): Ledger => {
  let running = opening;
  const entries: LedgerEntry[] = [
    {
      date: openedAt,
      type: 'OPENING',
      reference: 'OPENING',
      description: 'Opening balance',
      increase: '0.00',
      decrease: '0.00',
      balance: opening,
    },
  ];
  for (const e of raw) {
    running = subtractDecimalStrings(addDecimalStrings(running, e.increase, 2), e.decrease, 2);
    entries.push({ ...e, balance: running });
  }
  return { openingBalance: opening, entries, balance: running };
};
