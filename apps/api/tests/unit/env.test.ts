import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';

const base = {
  DATABASE_URL: 'postgresql://mafk:mafk_local_dev@localhost:5432/mafk_pos',
  JWT_SECRET: 'dev-only-local-secret-do-not-use-in-production-0123456789abcdef',
  CLIENT_URL: 'http://localhost:5173',
};

describe('loadEnv', () => {
  it('accepts the dev-only example values in development', () => {
    expect(loadEnv({ ...base, NODE_ENV: 'development' }).PORT).toBe(4000);
  });

  it('refuses the dev-only JWT secret in production', () => {
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://app:pw@db.example.com/x',
      }),
    ).toThrow(/JWT_SECRET/);
  });

  it('refuses the dev-only database password in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(48) })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('accepts real production values', () => {
    const env = loadEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://app:pw@db.example.com:5432/pos',
      JWT_SECRET: 'q'.repeat(48),
      CLIENT_URL: 'https://pos.example.com',
    });
    expect(env.NODE_ENV).toBe('production');
  });

  it('still requires the secrets', () => {
    expect(() => loadEnv({ NODE_ENV: 'development' })).toThrow(/Invalid environment/);
  });
});
