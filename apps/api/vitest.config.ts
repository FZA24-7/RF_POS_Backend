import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Real-PostgreSQL tests run separately via `pnpm test:integration` (needs TEST_DATABASE_URL).
    exclude: ['tests/integration/**', 'node_modules/**'],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
