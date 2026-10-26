import { describe, expect, it } from 'vitest';
import {
  addDecimalStrings,
  compareDecimalStrings,
  isNonNegativeDecimalString,
  isValidDecimalString,
  multiplyDecimalStrings,
  percentageOf,
  roundDecimalString,
  subtractDecimalStrings,
} from '../src/decimal.js';

describe('isValidDecimalString', () => {
  it('accepts integers and decimals, positive and negative', () => {
    expect(isValidDecimalString('10')).toBe(true);
    expect(isValidDecimalString('10.5')).toBe(true);
    expect(isValidDecimalString('-3.250')).toBe(true);
  });
  it('rejects garbage', () => {
    expect(isValidDecimalString('abc')).toBe(false);
    expect(isValidDecimalString('1.2.3')).toBe(false);
    expect(isValidDecimalString('')).toBe(false);
  });
});

describe('addDecimalStrings', () => {
  it('adds two positive quantities exactly (no float drift)', () => {
    expect(addDecimalStrings('10.1', '0.2', 3)).toBe('10.300');
  });
  it('subtracts via a negative operand', () => {
    expect(addDecimalStrings('10', '-3.5', 3)).toBe('6.500');
  });
  it('produces a negative result when going below zero', () => {
    expect(addDecimalStrings('2', '-5', 3)).toBe('-3.000');
  });
  it('handles the classic float-trap case exactly', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in plain JS numbers - must not happen here.
    expect(addDecimalStrings('0.1', '0.2', 3)).toBe('0.300');
  });
});

describe('compareDecimalStrings', () => {
  it('orders correctly, including negatives and differing scales of input text', () => {
    expect(compareDecimalStrings('5', '5.0')).toBe(0);
    expect(compareDecimalStrings('5', '5.001')).toBe(-1);
    expect(compareDecimalStrings('-1', '0')).toBe(-1);
    expect(compareDecimalStrings('2.5', '2.4')).toBe(1);
  });
});

describe('isNonNegativeDecimalString', () => {
  it('true for zero and positives, false for negatives or invalid text', () => {
    expect(isNonNegativeDecimalString('0')).toBe(true);
    expect(isNonNegativeDecimalString('3.2')).toBe(true);
    expect(isNonNegativeDecimalString('-0.001')).toBe(false);
    expect(isNonNegativeDecimalString('nope')).toBe(false);
  });
});

describe('roundDecimalString', () => {
  it('rounds half-up on the first dropped digit', () => {
    expect(roundDecimalString('1.005', 2)).toBe('1.01');
    expect(roundDecimalString('1.004', 2)).toBe('1.00');
  });
  it('carries correctly through 9s', () => {
    expect(roundDecimalString('0.999', 2)).toBe('1.00');
    expect(roundDecimalString('-0.999', 2)).toBe('-1.00');
  });
  it('pads when there are fewer decimals than the target scale', () => {
    expect(roundDecimalString('5', 2)).toBe('5.00');
  });
});

describe('multiplyDecimalStrings', () => {
  it('multiplies quantity by unit cost exactly, then rounds', () => {
    expect(multiplyDecimalStrings('3', '150.5000', 2)).toBe('451.50');
  });
  it('matches the classic float-trap case exactly (0.1 * 3)', () => {
    // In plain JS, 0.1 * 3 === 0.30000000000000004.
    expect(multiplyDecimalStrings('0.1', '3', 2)).toBe('0.30');
  });
  it('handles fractional quantities (e.g. weighted goods)', () => {
    expect(multiplyDecimalStrings('2.5', '10', 2)).toBe('25.00');
  });
});

describe('percentageOf', () => {
  it('computes a simple percentage', () => {
    expect(percentageOf('200', '10', 2)).toBe('20.00');
  });
  it('computes a fractional percentage', () => {
    expect(percentageOf('451.50', '7.5', 2)).toBe('33.86');
  });
  it('zero percent is zero', () => {
    expect(percentageOf('999.99', '0', 2)).toBe('0.00');
  });
});

describe('subtractDecimalStrings', () => {
  it('subtracts correctly', () => {
    expect(subtractDecimalStrings('100', '30.5', 2)).toBe('69.50');
  });
  it('can go negative', () => {
    expect(subtractDecimalStrings('10', '25', 2)).toBe('-15.00');
  });
});
