import { describe, expect, it } from 'vitest';
import {
  allocateCents,
  computeSale,
  lineRefundAmount,
  SaleMathError,
  unitRefundAmount,
} from '../src/sale-math.js';

const sum = (xs: string[]): string => {
  const cents = xs.reduce((a, x) => a + BigInt(x.replace('.', '')), 0n);
  const s = cents.toString().padStart(3, '0');
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
};

describe('computeSale', () => {
  it('computes a plain sale with tax', () => {
    const { lines, totals } = computeSale([
      { quantity: '2', unitPrice: '10.00', taxRate: '10' },
      { quantity: '1', unitPrice: '5.50' },
    ]);
    expect(lines[0]).toMatchObject({ grossAmount: '20.00', taxAmount: '2.00', lineTotal: '22.00' });
    expect(lines[1]).toMatchObject({ grossAmount: '5.50', taxAmount: '0.00', lineTotal: '5.50' });
    expect(totals).toMatchObject({ subtotal: '25.50', taxTotal: '2.00', grandTotal: '27.50' });
  });

  it('applies item percent and fixed discounts', () => {
    const { lines, totals } = computeSale([
      { quantity: '3', unitPrice: '10', discountPercent: '10' },
      { quantity: '1', unitPrice: '20', discountAmount: '5' },
    ]);
    expect(lines[0]?.discountAmount).toBe('3.00');
    expect(lines[1]?.discountAmount).toBe('5.00');
    expect(totals.itemDiscountTotal).toBe('8.00');
    expect(totals.grandTotal).toBe('42.00');
  });

  it('is exact where floating point is not (0.1 x 3, 19.99 x 3)', () => {
    const { totals } = computeSale([
      { quantity: '3', unitPrice: '0.10' },
      { quantity: '3', unitPrice: '19.99' },
    ]);
    expect(totals.subtotal).toBe('60.27');
    expect(totals.grandTotal).toBe('60.27');
  });

  it('allocates the cart discount to lines so line totals sum to the grand total', () => {
    const { lines, totals } = computeSale(
      [
        { quantity: '1', unitPrice: '10.00', taxRate: '5' },
        { quantity: '1', unitPrice: '10.00', taxRate: '5' },
        { quantity: '1', unitPrice: '10.00', taxRate: '5' },
      ],
      { discountAmount: '1.00' },
    );
    expect(sum(lines.map((l) => l.cartDiscountShare))).toBe('1.00');
    expect(sum(lines.map((l) => l.lineTotal))).toBe(totals.grandTotal);
    expect(totals.cartDiscountAmount).toBe('1.00');
    // tax is charged on the discounted amount
    expect(totals.taxTotal).toBe(sum(lines.map((l) => l.taxAmount)));
  });

  it('supports a cart percent discount', () => {
    const { totals } = computeSale([{ quantity: '1', unitPrice: '200' }], {
      discountPercent: '12.5',
    });
    expect(totals.cartDiscountAmount).toBe('25.00');
    expect(totals.grandTotal).toBe('175.00');
  });

  it('rejects discounts larger than the amount', () => {
    expect(() => computeSale([{ quantity: '1', unitPrice: '5', discountAmount: '6' }])).toThrow(
      SaleMathError,
    );
    expect(() =>
      computeSale([{ quantity: '1', unitPrice: '5' }], { discountAmount: '5.01' }),
    ).toThrow(SaleMathError);
  });

  it('allows a 100% cart discount (grand total zero)', () => {
    const { totals } = computeSale([{ quantity: '2', unitPrice: '3' }], { discountAmount: '6.00' });
    expect(totals.grandTotal).toBe('0.00');
  });

  it('rejects an empty sale', () => {
    expect(() => computeSale([])).toThrow(SaleMathError);
  });
});

describe('allocateCents', () => {
  it('always sums exactly to the total and never exceeds a weight', () => {
    for (const [total, weights] of [
      [100n, [333n, 333n, 334n]],
      [1n, [100n, 100n, 100n]],
      [999n, [1n, 1n, 1n, 1n, 1000n]],
      [5n, [5n]],
    ] as [bigint, bigint[]][]) {
      const parts = allocateCents(total, weights);
      expect(parts.reduce((a, b) => a + b, 0n)).toBe(total);
      parts.forEach((p, i) => expect(p <= (weights[i] ?? 0n)).toBe(true));
    }
  });
});

describe('lineRefundAmount', () => {
  it('refunds pro-rata, half-up', () => {
    expect(
      lineRefundAmount({
        lineTotal: '10.00',
        quantity: '3',
        returnQty: '1',
        alreadyReturnedQty: '0',
        alreadyRefunded: '0.00',
      }),
    ).toBe('3.33');
  });

  it('the final return takes the exact remainder so refunds sum to the line total', () => {
    const first = lineRefundAmount({
      lineTotal: '10.00',
      quantity: '3',
      returnQty: '1',
      alreadyReturnedQty: '0',
      alreadyRefunded: '0.00',
    });
    const second = lineRefundAmount({
      lineTotal: '10.00',
      quantity: '3',
      returnQty: '1',
      alreadyReturnedQty: '1',
      alreadyRefunded: first,
    });
    const third = lineRefundAmount({
      lineTotal: '10.00',
      quantity: '3',
      returnQty: '1',
      alreadyReturnedQty: '2',
      alreadyRefunded: sum([first, second]),
    });
    expect(sum([first, second, third])).toBe('10.00');
    expect(third).toBe('3.34');
  });

  it('handles fractional quantities', () => {
    expect(
      lineRefundAmount({
        lineTotal: '12.50',
        quantity: '2.500',
        returnQty: '0.500',
        alreadyReturnedQty: '0',
        alreadyRefunded: '0.00',
      }),
    ).toBe('2.50');
  });

  it('rejects over-returns and zero', () => {
    expect(() =>
      lineRefundAmount({
        lineTotal: '10.00',
        quantity: '2',
        returnQty: '2',
        alreadyReturnedQty: '1',
        alreadyRefunded: '5.00',
      }),
    ).toThrow(SaleMathError);
    expect(() =>
      lineRefundAmount({
        lineTotal: '10.00',
        quantity: '2',
        returnQty: '0',
        alreadyReturnedQty: '0',
        alreadyRefunded: '0.00',
      }),
    ).toThrow(SaleMathError);
  });
});

describe('unitRefundAmount', () => {
  it('divides to 4 decimals', () => {
    expect(unitRefundAmount('3.33', '1')).toBe('3.3300');
    expect(unitRefundAmount('10.00', '3')).toBe('3.3333');
  });
});
