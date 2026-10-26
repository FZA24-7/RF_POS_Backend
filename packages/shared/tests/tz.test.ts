import { describe, expect, it } from 'vitest';
import {
  addDaysToYmd,
  daysBetweenInclusive,
  isValidTimeZone,
  localDateString,
  localDayRange,
  startOfLocalDay,
} from '../src/tz.js';

describe('time zone helpers', () => {
  it('validates zone names', () => {
    expect(isValidTimeZone('Asia/Karachi')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });

  it('a Karachi (UTC+5, no DST) day starts at 19:00 UTC the previous day', () => {
    expect(startOfLocalDay('2026-10-12', 'Asia/Karachi').toISOString()).toBe(
      '2026-10-11T19:00:00.000Z',
    );
  });

  it('UTC days start at midnight UTC', () => {
    expect(startOfLocalDay('2026-10-12', 'UTC').toISOString()).toBe('2026-10-12T00:00:00.000Z');
  });

  it('handles daylight saving (New York: spring-forward and fall-back days are 23 / 25 hours)', () => {
    const spring = localDayRange('2026-03-08', '2026-03-08', 'America/New_York');
    expect((spring.end.getTime() - spring.start.getTime()) / 3_600_000).toBe(23);
    const fall = localDayRange('2026-11-01', '2026-11-01', 'America/New_York');
    expect((fall.end.getTime() - fall.start.getTime()) / 3_600_000).toBe(25);
  });

  it('adjacent ranges never overlap or leave a gap', () => {
    const a = localDayRange('2026-10-01', '2026-10-10', 'Asia/Karachi');
    const b = localDayRange('2026-10-11', '2026-10-12', 'Asia/Karachi');
    expect(a.end.getTime()).toBe(b.start.getTime());
  });

  it('localDateString buckets an instant into the tenant day', () => {
    const instant = new Date('2026-10-11T20:30:00Z'); // 01:30 on the 12th in Karachi
    expect(localDateString(instant, 'Asia/Karachi')).toBe('2026-10-12');
    expect(localDateString(instant, 'UTC')).toBe('2026-10-11');
  });

  it('date arithmetic and validation', () => {
    expect(addDaysToYmd('2026-02-28', 1)).toBe('2026-03-01');
    expect(daysBetweenInclusive('2026-10-01', '2026-10-31')).toBe(31);
    expect(() => localDayRange('2026-10-02', '2026-10-01', 'UTC')).toThrow();
    expect(() => startOfLocalDay('12/10/2026', 'UTC')).toThrow();
  });
});
