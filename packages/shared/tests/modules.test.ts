import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENABLED_MODULES,
  isValidModuleKey,
  MODULE_CATALOG,
  sanitizeModuleKeys,
} from '../src/modules.js';

describe('module catalog', () => {
  it('has no duplicates', () => {
    expect(new Set(MODULE_CATALOG).size).toBe(MODULE_CATALOG.length);
  });

  it('validates known and unknown keys', () => {
    expect(isValidModuleKey('pos')).toBe(true);
    expect(isValidModuleKey('not-a-module')).toBe(false);
  });

  it('defaults to every module enabled', () => {
    expect(DEFAULT_ENABLED_MODULES).toEqual(MODULE_CATALOG);
  });

  it('sanitize drops unknown keys and de-duplicates', () => {
    expect(sanitizeModuleKeys(['pos', 'pos', 'bogus', 'reports'])).toEqual(['pos', 'reports']);
  });
});
