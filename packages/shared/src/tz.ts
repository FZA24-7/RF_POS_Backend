/**
 * Time-zone helpers for reports. A report date such as "2026-10-12" means that calendar day in the TENANT's time zone
 * (e.g. Asia/Karachi), not in UTC and not in the server's zone. Implemented with Intl only (no dependency); works
 * identically on Windows, macOS and Linux Node builds that ship full ICU (all official Node 22 builds do).
 */
export const isValidTimeZone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const partsIn = (date: Date, tz: string): Record<string, number> => {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out;
};

/** Offset of `tz` from UTC at `date`, in milliseconds (positive east of Greenwich). */
export const tzOffsetMs = (date: Date, tz: string): number => {
  const p = partsIn(date, tz);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The UTC instant at which calendar day `ymd` (YYYY-MM-DD) starts in `tz`. */
export const startOfLocalDay = (ymd: string, tz: string): Date => {
  const m = DATE_RE.exec(ymd);
  if (!m) throw new Error(`"${ymd}" is not a YYYY-MM-DD date`);
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  let instant = guess - tzOffsetMs(new Date(guess), tz);
  // The offset can differ at the corrected instant (daylight-saving edges): correct once more.
  instant = guess - tzOffsetMs(new Date(instant), tz);
  return new Date(instant);
};

/** `YYYY-MM-DD` of `date` as seen in `tz`. */
export const localDateString = (date: Date, tz: string): string => {
  const p = partsIn(date, tz);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};

export const addDaysToYmd = (ymd: string, days: number): string => {
  const m = DATE_RE.exec(ymd);
  if (!m) throw new Error(`"${ymd}" is not a YYYY-MM-DD date`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
};

/**
 * Half-open range [start, end) covering local days `from` through `to` inclusive.
 * `end` is the start of the day AFTER `to`, so no instant is ever counted in two adjacent reports.
 */
export const localDayRange = (from: string, to: string, tz: string): { start: Date; end: Date } => {
  if (from > to) throw new Error('"from" must not be after "to"');
  return { start: startOfLocalDay(from, tz), end: startOfLocalDay(addDaysToYmd(to, 1), tz) };
};

export const daysBetweenInclusive = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
