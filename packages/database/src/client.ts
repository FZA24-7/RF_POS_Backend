import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.js';

export interface CreatePrismaClientOptions {
  databaseUrl: string;
  log?: ('query' | 'info' | 'warn' | 'error')[];
}

/** Single factory so every app (API, seed script, tests) builds the client the same way. */
export const createPrismaClient = (opts: CreatePrismaClientOptions): PrismaClient => {
  const adapter = new PrismaPg({ connectionString: opts.databaseUrl });
  return new PrismaClient({ adapter, log: opts.log ?? ['error', 'warn'] });
};

export type { PrismaClient } from './generated/client.js';
export { Prisma } from './generated/client.js';
