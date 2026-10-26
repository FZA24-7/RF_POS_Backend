import { describe, expect, it } from 'vitest';
import {
  computeLine,
  computeTotals,
  resolvePaymentStatus,
} from '../../src/services/purchase-calculations.js';

describe('computeLine', () => {
  it('computes gross, net, tax, and line total with no discount', () => {
    const line = computeLine({ quantity: '3', costPrice: '150.5000', taxRate: '10' });
    expect(line.grossAmount).toBe('451.50');
    expect(line.discountAmount).toBe('0');
    expect(line.netAmount).toBe('451.50');
    expect(line.taxAmount).toBe('45.15');
    expect(line.lineTotal).toBe('496.65');
  });

  it('applies a percentage discount and normalizes discountAmount to match', () => {
    const line = computeLine({
      quantity: '10',
      costPrice: '100',
      discountPercent: '10',
      taxRate: '0',
    });
    expect(line.grossAmount).toBe('1000.00');
    expect(line.discountAmount).toBe('100.00');
    expect(line.netAmount).toBe('900.00');
    expect(line.lineTotal).toBe('900.00');
  });

  it('applies a fixed discount amount and normalizes discountPercent to 0', () => {
    const line = computeLine({
      quantity: '10',
      costPrice: '100',
      discountAmount: '50',
      taxRate: '0',
    });
    expect(line.discountPercent).toBe('0');
    expect(line.netAmount).toBe('950.00');
  });

  it('rejects a discount that exceeds the line amount', () => {
    expect(() => computeLine({ quantity: '1', costPrice: '10', discountAmount: '50' })).toThrow();
  });

  it('matches the classic float-trap case exactly across quantity/cost/tax', () => {
    // 0.1 * 3 and subsequent percentage math must never drift via JS floats.
    const line = computeLine({ quantity: '0.1', costPrice: '3', taxRate: '10' });
    expect(line.grossAmount).toBe('0.30');
    expect(line.taxAmount).toBe('0.03');
    expect(line.lineTotal).toBe('0.33');
  });
});

describe('computeTotals', () => {
  it('sums multiple lines correctly with no purchase-level discount', () => {
    const l1 = computeLine({ quantity: '2', costPrice: '50', taxRate: '0' }); // 100.00
    const l2 = computeLine({ quantity: '1', costPrice: '25', taxRate: '0' }); // 25.00
    const totals = computeTotals([l1, l2], {});
    expect(totals.subtotal).toBe('125.00');
    expect(totals.total).toBe('125.00');
  });

  it('applies a purchase-level percentage discount on top of item discounts', () => {
    const l1 = computeLine({ quantity: '10', costPrice: '100', taxRate: '0' }); // 1000.00
    const totals = computeTotals([l1], { discountPercent: '5' });
    expect(totals.itemDiscountTotal).toBe('0.00');
    expect(totals.discountAmount).toBe('50.00'); // 5% of 1000
    expect(totals.total).toBe('950.00');
  });

  it('applies a purchase-level fixed discount', () => {
    const l1 = computeLine({ quantity: '1', costPrice: '500', taxRate: '0' });
    const totals = computeTotals([l1], { discountAmount: '20' });
    expect(totals.total).toBe('480.00');
  });

  it('combines item-level and purchase-level discounts without double-discounting either one', () => {
    const l1 = computeLine({
      quantity: '10',
      costPrice: '100',
      discountPercent: '10',
      taxRate: '0',
    }); // gross 1000, item-disc 100, net 900
    const totals = computeTotals([l1], { discountPercent: '10' }); // 10% of (1000-100)=900 -> 90
    expect(totals.itemDiscountTotal).toBe('100.00');
    expect(totals.discountAmount).toBe('90.00');
    expect(totals.total).toBe('810.00');
  });

  it('includes tax in the grand total', () => {
    const l1 = computeLine({ quantity: '1', costPrice: '100', taxRate: '15' }); // tax 15
    const totals = computeTotals([l1], {});
    expect(totals.taxTotal).toBe('15.00');
    expect(totals.total).toBe('115.00');
  });
});

describe('resolvePaymentStatus', () => {
  it('UNPAID when nothing has been paid', () => {
    expect(resolvePaymentStatus('100.00', '0')).toBe('UNPAID');
  });
  it('PARTIAL when some but not all has been paid', () => {
    expect(resolvePaymentStatus('100.00', '40.00')).toBe('PARTIAL');
  });
  it('PAID when the full amount has been paid', () => {
    expect(resolvePaymentStatus('100.00', '100.00')).toBe('PAID');
  });
});
