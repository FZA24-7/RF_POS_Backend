import {
  addDecimalStrings,
  multiplyDecimalStrings,
  percentageOf,
  subtractDecimalStrings,
} from './decimal.js';

/** Thrown for a money-rule violation (e.g. a discount larger than the amount). Callers map it to their own error type. */
export class PurchaseMathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurchaseMathError';
  }
}

const MONEY_SCALE = 2;

export interface LineInput {
  quantity: string;
  costPrice: string;
  discountPercent?: string;
  discountAmount?: string;
  taxRate?: string;
}

export interface LineComputed {
  grossAmount: string;
  discountPercent: string;
  discountAmount: string;
  netAmount: string;
  taxRate: string;
  taxAmount: string;
  lineTotal: string;
}

export interface PurchaseTotals {
  subtotal: string;
  itemDiscountTotal: string;
  discountPercent: string;
  discountAmount: string;
  taxTotal: string;
  total: string;
}

/**
 * The single, consistent rounding rule for the entire Purchase module (and
 * reusable by POS/Sales once those phases exist): every money amount is
 * rounded to 2 decimal places, half-up, via `@mafk/shared`'s
 * `multiplyDecimalStrings` / `percentageOf` (both round internally) -
 * never a raw JS number. Quantity × unit cost is computed first at full
 * precision then rounded once to money scale; a percentage discount or tax
 * is computed on that already-rounded base, then rounded again - a value is
 * never rounded more than once per step, and every step rounds the same way.
 *
 * Discount rule: `discountPercent` and `discountAmount` are mutually
 * exclusive per line (enforced by `@mafk/validation`'s `createPurchaseSchema`
 * before this function ever runs) - exactly one of them is the source of
 * truth for the line's discount; the other is normalized to match so the
 * stored row always has both fields populated consistently for display.
 */
export const computeLine = (input: LineInput): LineComputed => {
  const taxRate = input.taxRate ?? '0';
  const grossAmount = multiplyDecimalStrings(input.quantity, input.costPrice, MONEY_SCALE);

  let discountPercent = input.discountPercent ?? '0';
  let discountAmount = input.discountAmount ?? '0';
  if (discountPercent !== '0') {
    discountAmount = percentageOf(grossAmount, discountPercent, MONEY_SCALE);
  } else if (discountAmount !== '0') {
    discountPercent = '0';
  }

  const netAmount = subtractDecimalStrings(grossAmount, discountAmount, MONEY_SCALE);
  if (netAmount.startsWith('-')) {
    throw new PurchaseMathError('Line discount cannot exceed the line amount.');
  }
  const taxAmount = percentageOf(netAmount, taxRate, MONEY_SCALE);
  const lineTotal = addDecimalStrings(netAmount, taxAmount, MONEY_SCALE);

  return { grossAmount, discountPercent, discountAmount, netAmount, taxRate, taxAmount, lineTotal };
};

export interface PurchaseLevelDiscount {
  discountPercent?: string;
  discountAmount?: string;
}

export const computeTotals = (
  lines: LineComputed[],
  purchaseLevel: PurchaseLevelDiscount,
): PurchaseTotals => {
  const subtotal = lines.reduce(
    (acc, l) => addDecimalStrings(acc, l.grossAmount, MONEY_SCALE),
    '0',
  );
  const itemDiscountTotal = lines.reduce(
    (acc, l) => addDecimalStrings(acc, l.discountAmount, MONEY_SCALE),
    '0',
  );
  const afterItemDiscounts = subtractDecimalStrings(subtotal, itemDiscountTotal, MONEY_SCALE);

  let discountPercent = purchaseLevel.discountPercent ?? '0';
  let discountAmount = purchaseLevel.discountAmount ?? '0';
  if (discountPercent !== '0') {
    discountAmount = percentageOf(afterItemDiscounts, discountPercent, MONEY_SCALE);
  } else if (discountAmount !== '0') {
    discountPercent = '0';
  }

  const afterAllDiscounts = subtractDecimalStrings(afterItemDiscounts, discountAmount, MONEY_SCALE);
  if (afterAllDiscounts.startsWith('-')) {
    throw new PurchaseMathError('Purchase-level discount cannot exceed the discounted subtotal.');
  }

  const taxTotal = lines.reduce((acc, l) => addDecimalStrings(acc, l.taxAmount, MONEY_SCALE), '0');
  const total = addDecimalStrings(afterAllDiscounts, taxTotal, MONEY_SCALE);

  return { subtotal, itemDiscountTotal, discountPercent, discountAmount, taxTotal, total };
};

export const resolvePaymentStatus = (
  total: string,
  paidAmount: string,
): 'UNPAID' | 'PARTIAL' | 'PAID' => {
  if (paidAmount === '0' || paidAmount === '0.00') return 'UNPAID';
  const outstanding = subtractDecimalStrings(total, paidAmount, MONEY_SCALE);
  if (outstanding.startsWith('-') || outstanding === '0.00' || outstanding === '0') return 'PAID';
  return 'PARTIAL';
};
