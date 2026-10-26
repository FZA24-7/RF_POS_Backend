import { describe, expect, it } from 'vitest';
import { parseCsv, parseCsvWithHeader, toCsv } from '../../src/services/csv.js';

describe('parseCsv', () => {
  it('parses a simple CSV', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields containing commas', () => {
    expect(parseCsv('name,note\n"Smith, John",hello')).toEqual([
      ['name', 'note'],
      ['Smith, John', 'hello'],
    ]);
  });

  it('handles escaped quotes inside a quoted field', () => {
    expect(parseCsv('a\n"She said ""hi"""')).toEqual([['a'], ['She said "hi"']]);
  });

  it('handles a trailing newline without producing an empty extra row', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('toCsv / round-trip', () => {
  it('quotes fields that contain commas', () => {
    expect(toCsv([['Smith, John', 'ok']])).toBe('"Smith, John",ok');
  });

  it('round-trips through parseCsv', () => {
    const original = [
      ['name', 'note'],
      ['Smith, John', 'has "quotes"'],
    ];
    const csv = toCsv(original);
    expect(parseCsv(csv)).toEqual(original);
  });
});

describe('parseCsvWithHeader', () => {
  it('maps rows to objects keyed by header', () => {
    const rows = parseCsvWithHeader('sku,name\nABC-1,Widget\nABC-2,Gadget');
    expect(rows).toEqual([
      { sku: 'ABC-1', name: 'Widget' },
      { sku: 'ABC-2', name: 'Gadget' },
    ]);
  });

  it('returns an empty array for an empty file', () => {
    expect(parseCsvWithHeader('')).toEqual([]);
  });
});
