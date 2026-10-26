import { describe, expect, it } from 'vitest';
import { toReportCsv } from '../../src/services/csv.js';

describe('toReportCsv', () => {
  it('writes CRLF rows, quotes commas/quotes/newlines and leaves plain numbers (incl. negatives) alone', () => {
    const out = toReportCsv([
      ['Name', 'Amount'],
      ['Tea, milk', 12],
      ['Say "hi"', '-5.00'],
      ['two\nlines', null],
    ]);
    expect(out).toBe('Name,Amount\r\n"Tea, milk",12\r\n"Say ""hi""",-5.00\r\n"two\nlines",\r\n');
  });

  it('neutralises spreadsheet formulas (CSV injection)', () => {
    const out = toReportCsv([['=SUM(A1)', '+1+1', '@cmd', '-cmd', '-12.50', '\tx']]);
    expect(out).toBe("'=SUM(A1),'+1+1,'@cmd,'-cmd,-12.50,'\tx\r\n");
  });
});
