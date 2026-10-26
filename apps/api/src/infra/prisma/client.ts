import { createPrismaClient, type PrismaClient } from '@mafk/database';

// DATABASE STATUS (Phase 4.2): typechecked against the generated client and used by the running API against
// PostgreSQL 16 in the sandbox.
export const buildPrismaClient = (databaseUrl: string): PrismaClient =>
  createPrismaClient({ databaseUrl });
