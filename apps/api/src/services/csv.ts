/**
 * Minimal RFC-4180-ish CSV parser: supports quoted fields, escaped quotes
 * (`""`), commas and newlines inside quotes. Intentionally small and
 * dependency-free rather than pulling in a CSV library for this one use.
 */
export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Trailing field/row (file may or may not end with a newline).
  if (field.length > 0 || row.length > 0) pushRow();

  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
};

const needsQuoting = (value: string): boolean => /[",\n]/.test(value);
const escapeField = (value: string): string =>
  needsQuoting(value) ? `"${value.replace(/"/g, '""')}"` : value;

export const toCsv = (rows: readonly (readonly string[])[]): string =>
  rows.map((row) => row.map(escapeField).join(',')).join('\r\n');

/** Parses a CSV with a header row into an array of plain objects keyed by header name. */
export const parseCsvWithHeader = (text: string): Record<string, string>[] => {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const [header, ...dataRows] = rows;
  return dataRows.map((row) => {
    const obj: Record<string, string> = {};
    header!.forEach((key, idx) => {
      obj[key.trim()] = (row[idx] ?? '').trim();
    });
    return obj;
  });
};

const NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * Serialises rows to RFC-4180 CSV (CRLF, quoted when needed). Cells that a spreadsheet could execute as a formula
 * (leading = + @ tab CR, or a leading - that is not a plain number) are prefixed with an apostrophe (CSV injection).
 */
export const toReportCsv = (rows: (string | number | null | undefined)[][]): string =>
  rows
    .map((row) =>
      row
        .map((cell) => {
          let v = cell === null || cell === undefined ? '' : String(cell);
          if (/^[=+@\t\r]/.test(v) || (v.startsWith('-') && !NUMBER.test(v))) v = `'${v}`;
          return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        })
        .join(','),
    )
    .join('\r\n') + '\r\n';
