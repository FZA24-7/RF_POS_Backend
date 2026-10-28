/**
 * Minimal fixed-point arithmetic over decimal STRINGS, backed by `BigInt`.
 * Used anywhere a quantity or money value needs to be added/compared without
 * ever round-tripping through a JS `number` (which cannot represent most
 * decimals exactly). Inventory quantities use `scale = 3` to match the
 * schema's `Decimal(14,3)`; money would use `scale = 2` or `4` once Phase 4/5
 * need to do arithmetic on it (Phase 3 only validates money as text - see
 * `apps/api/src/domain/types.ts`'s `ProductSummary` comment).
 */
const DECIMAL_STRING_RE = /^-?\d+(\.\d+)?$/;

export const isValidDecimalString = (value: string): boolean =>
  DECIMAL_STRING_RE.test(value.trim());

const toScaledBigInt = (value: string, scale: number): bigint => {
  const trimmed = value.trim();
  if (!isValidDecimalString(trimmed)) {
    throw new Error(`"${value}" is not a valid decimal string`);
  }
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, frac = ''] = unsigned.split('.');
  const fracPadded = (frac + '0'.repeat(scale)).slice(0, scale);
  const combined = `${whole}${fracPadded}` || '0';
  const magnitude = BigInt(combined);
  return negative ? -magnitude : magnitude;
};

const fromScaledBigInt = (scaled: bigint, scale: number): string => {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const divisor = 10n ** BigInt(scale);
  const whole = abs / divisor;
  const frac = (abs % divisor).toString().padStart(scale, '0');
  const sign = negative && (whole !== 0n || frac.replace(/0/g, '') !== '') ? '-' : '';
  return scale > 0 ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
};

export const addDecimalStrings = (a: string, b: string, scale = 3): string =>
  fromScaledBigInt(toScaledBigInt(a, scale) + toScaledBigInt(b, scale), scale);

export const compareDecimalStrings = (a: string, b: string, scale = 3): -1 | 0 | 1 => {
  const diff = toScaledBigInt(a, scale) - toScaledBigInt(b, scale);
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
};

export const isNonNegativeDecimalString = (value: string, scale = 3): boolean => {
  try {
    return toScaledBigInt(value, scale) >= 0n;
  } catch {
    return false;
  }
};

/**
 * Rescales a decimal string to exactly `scale` decimal places, rounding
 * half-up (the convention used throughout Purchases/POS money math - see
 * `docs/API.md` "Phase 4: Rounding rules"). All intermediate money
 * calculations below funnel through this one function, so every amount in a
 * purchase or invoice is rounded exactly once, the same way, everywhere.
 */
export const roundDecimalString = (value: string, scale: number): string => {
  const trimmed = value.trim();
  if (!isValidDecimalString(trimmed)) throw new Error(`"${value}" is not a valid decimal string`);
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, frac = ''] = unsigned.split('.');
  if (frac.length <= scale) {
    return fromScaledBigInt(toScaledBigInt(trimmed, scale), scale);
  }
  // Round half-up on the first dropped digit.
  const keep = frac.slice(0, scale);
  const firstDropped = frac.charCodeAt(scale) - 48;
  let scaled = BigInt(`${whole}${keep}` || '0');
  if (firstDropped >= 5) scaled += 1n;
  const result = negative ? -scaled : scaled;
  return fromScaledBigInt(result, scale);
};

/**
 * Exact decimal multiplication (e.g. quantity × unit cost), rounded to
 * `resultScale` places half-up. Implemented via `BigInt` on the fully
 * de-scaled integer representations of both operands, so there is no
 * intermediate floating-point step at all - `0.1 * 3` cannot drift here the
 * way it can with JS numbers.
 */
export const multiplyDecimalStrings = (a: string, b: string, resultScale: number): string => {
  const scaleA = (a.split('.')[1] ?? '').length;
  const scaleB = (b.split('.')[1] ?? '').length;
  const intA = toScaledBigInt(a, scaleA);
  const intB = toScaledBigInt(b, scaleB);
  const product = intA * intB; // scaled by (scaleA + scaleB)
  return roundDecimalString(fromScaledBigInt(product, scaleA + scaleB), resultScale);
};

/** `amount * (percent / 100)`, rounded to `resultScale` places half-up. */
export const percentageOf = (amount: string, percent: string, resultScale = 2): string =>
  multiplyDecimalStrings(amount, divideBy100(percent), resultScale);

const divideBy100 = (value: string): string => {
  // Shifting the decimal point two places left is exact and avoids a
  // division operation entirely - `percent / 100` as text manipulation.
  const negative = value.trim().startsWith('-');
  const unsigned = negative ? value.trim().slice(1) : value.trim();
  const [whole = '0', frac = ''] = unsigned.split('.');
  const padded = whole.padStart(3, '0');
  const result = `${padded.slice(0, -2)}.${padded.slice(-2)}${frac}`;
  return negative ? `-${result}` : result;
};

export const subtractDecimalStrings = (a: string, b: string, scale = 2): string => {
  const negatedB = b.trim().startsWith('-') ? b.trim().slice(1) : `-${b.trim()}`;
  return addDecimalStrings(a, negatedB, scale);
};
