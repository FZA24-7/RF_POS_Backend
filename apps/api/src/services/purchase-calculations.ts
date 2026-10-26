import {
  computeLine as sharedComputeLine,
  computeTotals as sharedComputeTotals,
  PurchaseMathError,
  resolvePaymentStatus,
  type LineComputed,
  type LineInput,
  type PurchaseLevelDiscount,
  type PurchaseTotals,
} from '@mafk/shared';
import { DomainError } from '../domain/types.js';

/**
 * The purchase money math lives in `@mafk/shared/purchase-math` so the web
 * client's live preview and the server's authoritative calculation are the
 * SAME code (one rounding rule, half-up at 2dp, no floats). This module only
 * adapts its rule-violation error to the API's `DomainError` (HTTP 422).
 */
export type { LineComputed, LineInput, PurchaseLevelDiscount, PurchaseTotals };
export { resolvePaymentStatus };

const adapt = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch (err) {
    if (err instanceof PurchaseMathError)
      throw new DomainError('VALIDATION_ERROR', err.message, 422);
    throw err;
  }
};

export const computeLine = (input: LineInput): LineComputed =>
  adapt(() => sharedComputeLine(input));

export const computeTotals = (
  lines: LineComputed[],
  purchaseLevel: PurchaseLevelDiscount,
): PurchaseTotals => adapt(() => sharedComputeTotals(lines, purchaseLevel));
