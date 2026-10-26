import { loadExampleEnv } from '@mafk/database/load-example-env';
import { loadEnv } from '../config/env.js';
import { createLogger } from '../logger.js';
import { buildProductionApp } from '../composition/production.js';

// Local dev: defaults come from the repo-root .env.example. Real environment variables win; skipped in production.
loadExampleEnv();

const env = loadEnv();
const logger = createLogger(env);

const { app, prisma } = buildProductionApp(env, logger);

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'MAFK-24/7 Retail-Flow POS API listening');
});

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'Shutting down');
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
