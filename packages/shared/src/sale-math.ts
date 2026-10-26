import {
  addDecimalStrings,
  multiplyDecimalStrings,
  percentageOf,
  roundDecimalString,
  subtractDecimalStrings,
} from './decimal.js';

const isZero = (value: string): boolean => /^0+(\.0+)?$/.test(value.trim());

/** Thrown for a sale money-rule violation. Callers map it to their own error type (the API uses HTTP 422). */
export class SaleMathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaleMathError';
  }
}

const MONEY_SCALE = 2;

export interface SaleLineInput {
  quantity: string;
  unitPrice: string;
  discountPercent?: string;
  discountAmount?: string;
  taxRate?: string;
}

export interface SaleLineComputed {
  grossAmount: string;
  discountPercent: string;
  discountAmount: string;
  /** gross - line discount (before the cart discount share). */
  netAmount: string;
  /** This line's share of the cart-level discount (sums exactly to the cart discount). */
  cartDiscountShare: string;
  /** net - cart share: the base tax is charged on. */
  taxableAmount: string;
  taxRate: string;
  taxAmount: string;
  /** taxable + tax. The sum of every lineTotal is exactly the sale's grandTotal. */
  lineTotal: string;
}

export interface SaleTotals {
  subtotal: string;
  itemDiscountTotal: string;
  cartDiscountPercent: string;
  cartDiscountAmount: string;
  taxTotal: string;
  grandTotal: string;
}

export interface CartDiscount {
  discountPercent?: string;
  discountAmount?: string;
}

const toCents = (value: string): bigint =>
  BigInt(roundDecimalString(value, MONEY_SCALE).replace('.', ''));

const fromCents = (cents: bigint): string => {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
};

/**
 * Splits `totalCents` across `weights` so the parts sum EXACTLY to the total (largest-remainder method).
 * A part never exceeds its weight when total <= sum(weights), so no line is discounted below zero.
 */
export const allocateCents = (totalCents: bigint, weights: bigint[]): bigint[] => {
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n || totalCents === 0n) return weights.map(() => 0n);
  const floors = weights.map((w) => (totalCents * w) / sum);
  const rems = weights.map((w, i) => ({ i, rem: (totalCents * w) % sum }));
  let leftover = totalCents - floors.reduce((a, b) => a + b, 0n);
  rems.sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  const out = [...floors];
  for (const { i } of rems) {
    if (leftover === 0n) break;
    out[i] = (out[i] ?? 0n) + 1n;
    leftover -= 1n;
  }
  return out;
};

/**
 * Computes a whole sale, exact to the cent, no floating point.
 *
 * Order of operations (the single rounding rule is half-up at 2 decimals, applied once per step):
 *   gross      = quantity x unitPrice
 *   line disc  = percent OR fixed amount (never both - enforced by validation; percent wins if both are given)
 *   net        = gross - line discount
 *   cart disc  = percent of sum(net) OR fixed amount; allocated across lines by net value, exactly (cents never lost)
 *   taxable    = net - cart share
 *   tax        = taxRate% of taxable
 *   lineTotal  = taxable + tax
 *   grandTotal = sum(lineTotal) = subtotal - itemDiscounts - cartDiscount + tax
 *
 * Because the cart discount is allocated to lines, a partial refund of one line returns exactly what that line
 * actually cost the customer (discount and tax included).
 */
export const computeSale = (
  inputs: SaleLineInput[],
  cart: CartDiscount = {},
): { lines: SaleLineComputed[]; totals: SaleTotals } => {
  if (inputs.length === 0) throw new SaleMathError('A sale must have at least one line.');

  const base = inputs.map((input) => {
    const taxRate = input.taxRate ?? '0';
    const grossAmount = multiplyDecimalStrings(input.quantity, input.unitPrice, MONEY_SCALE);
    let discountPercent = input.discountPercent ?? '0';
    let discountAmount = input.discountAmount ?? '0';
    if (!isZero(discountPercent)) {
      discountAmount = percentageOf(grossAmount, discountPercent, MONEY_SCALE);
    } else {
      discountPercent = '0';
      discountAmount = roundDecimalString(discountAmount, MONEY_SCALE);
    }
    const netAmount = subtractDecimalStrings(grossAmount, discountAmount, MONEY_SCALE);
    if (netAmount.startsWith('-')) {
      throw new SaleMathError('Line discount cannot exceed the line amount.');
    }
    return { grossAmount, discountPercent, discountAmount, netAmount, taxRate };
  });

  const subtotal = base.reduce((acc, l) => addDecimalStrings(acc, l.grossAmount, MONEY_SCALE), '0');
  const itemDiscountTotal = base.reduce(
    (acc, l) => addDecimalStrings(acc, l.discountAmount, MONEY_SCALE),
    '0',
  );
  const afterItemDiscounts = subtractDecimalStrings(subtotal, itemDiscountTotal, MONEY_SCALE);

  let cartDiscountPercent = cart.discountPercent ?? '0';
  let cartDiscountAmount = cart.discountAmount ?? '0';
  if (!isZero(cartDiscountPercent)) {
    cartDiscountAmount = percentageOf(afterItemDiscounts, cartDiscountPercent, MONEY_SCALE);
  } else {
    cartDiscountPercent = '0';
    cartDiscountAmount = roundDecimalString(cartDiscountAmount, MONEY_SCALE);
  }
  if (subtractDecimalStrings(afterItemDiscounts, cartDiscountAmount, MONEY_SCALE).startsWith('-')) {
    throw new SaleMathError('Cart discount cannot exceed the discounted subtotal.');
  }

  const shares = allocateCents(
    toCents(cartDiscountAmount),
    base.map((l) => toCents(l.netAmount)),
  );

  const lines: SaleLineComputed[] = base.map((l, i) => {
    const cartDiscountShare = fromCents(shares[i] ?? 0n);
    const taxableAmount = subtractDecimalStrings(l.netAmount, cartDiscountShare, MONEY_SCALE);
    const taxAmount = percentageOf(taxableAmount, l.taxRate, MONEY_SCALE);
    const lineTotal = addDecimalStrings(taxableAmount, taxAmount, MONEY_SCALE);
    return { ...l, cartDiscountShare, taxableAmount, taxAmount, lineTotal };
  });

  const taxTotal = lines.reduce((acc, l) => addDecimalStrings(acc, l.taxAmount, MONEY_SCALE), '0');
  const grandTotal = lines.reduce(
    (acc, l) => addDecimalStrings(acc, l.lineTotal, MONEY_SCALE),
    '0',
  );

  return {
    lines,
    totals: {
      subtotal,
      itemDiscountTotal,
      cartDiscountPercent,
      cartDiscountAmount,
      taxTotal,
      grandTotal,
    },
  };
};

const toMilli = (qty: string): bigint => {
  const [whole = '0', frac = ''] = qty.trim().split('.');
  return BigInt(`${whole}${(frac + '000').slice(0, 3)}`);
};

/**
 * Amount to refund for returning `returnQty` of a line that sold `quantity` for `lineTotal`.
 * Pro-rata, rounded half-up to the cent - EXCEPT when this return takes the last remaining units, in which case it
 * is exactly `lineTotal - alreadyRefunded`, so a line can never be refunded more or less than it cost in total.
 */
export const lineRefundAmount = (args: {
  lineTotal: string;
  quantity: string;
  returnQty: string;
  alreadyReturnedQty: string;
  alreadyRefunded: string;
}): string => {
  const qty = toMilli(args.quantity);
  const ret = toMilli(args.returnQty);
  const done = toMilli(args.alreadyReturnedQty);
  if (ret <= 0n) throw new SaleMathError('Return quantity must be greater than zero.');
  if (done + ret > qty)
    throw new SaleMathError('Return quantity exceeds the quantity still returnable.');
  if (done + ret === qty) {
    return subtractDecimalStrings(args.lineTotal, args.alreadyRefunded, MONEY_SCALE);
  }
  const num = toCents(args.lineTotal) * ret;
  return fromCents((2n * num + qty) / (2n * qty));
};

/** Refund per unit at 4 decimals (informational; the authoritative figure is the line refund amount). */
export const unitRefundAmount = (lineRefund: string, returnQty: string): string => {
  const q = toMilli(returnQty);
  const r = toCents(lineRefund);
  const scaled = (2n * r * 100_000n + q) / (2n * q); // R/100 / (Q/1000) in 1e-4 units
  const s = scaled.toString().padStart(5, '0');
  return `${s.slice(0, -4)}.${s.slice(-4)}`;
};

export const isPositiveMoney = (value: string): boolean => toCents(value) > 0n;
