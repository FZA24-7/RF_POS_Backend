import { defineConfig } from 'prisma/config';
import { loadExampleEnv } from './src/load-example-env';

// Local development reads its defaults from the repo-root `.env.example` (no `.env` file needed). Real environment
// variables always win, and nothing is loaded when NODE_ENV=production.
loadExampleEnv();

// Prisma 7: connection URL lives here, not in schema.prisma.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
