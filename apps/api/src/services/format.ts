/** Stable text forms shared by the Prisma adapter and the in-memory fake, so both return identical strings. */

/** '10' -> '10.00'; '10.5000' -> '10.50'; '10.1250' -> '10.125'. Never fewer than 2 decimals, never trailing zeros beyond that. */
export const formatUnitPrice = (value: string): string => {
  const [whole = '0', frac = ''] = value.trim().split('.');
  const trimmed = frac.replace(/0+$/, '');
  return `${whole}.${trimmed.padEnd(2, '0')}`;
};

/** '10.5000' -> '10.5'; '0.0000' -> '0'; '10' -> '10'. Used for percentages / rates. */
export const formatRate = (value: string): string => {
  if (!value.includes('.')) return value;
  const out = value.replace(/0+$/, '').replace(/\.$/, '');
  return out === '' ? '0' : out;
};

/** Quantity with exactly 3 decimals, like Decimal(14,3). */
export const formatQuantity = (value: string): string => {
  const [whole = '0', frac = ''] = value.trim().split('.');
  return `${whole}.${(frac + '000').slice(0, 3)}`;
};
