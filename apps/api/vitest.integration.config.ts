import { defineConfig } from 'vitest/config';

// Real-PostgreSQL integration tests only. Requires TEST_DATABASE_URL (isolated, migrated database).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
