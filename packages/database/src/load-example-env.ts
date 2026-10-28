import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Walks up from `startDir` to the repository root (the folder that contains `pnpm-workspace.yaml`). */
export const findRepoRoot = (startDir: string = process.cwd()): string | null => {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};

/**
 * LOCAL DEVELOPMENT ONLY. Loads `<repo root>/.env.example` into `process.env` so no `.env` file is needed.
 *
 *  - Variables that are already set (real environment, CI, a service manager) are never overridden.
 *  - Never runs when `NODE_ENV=production`: production configuration must come from real environment variables,
 *    and the API additionally refuses the example secrets in production (see `apps/api/src/config/env.ts`).
 *
 * Returns the file that was loaded, or null when nothing was loaded.
 */
export const loadExampleEnv = (startDir?: string): string | null => {
  if (process.env.NODE_ENV === 'production') return null;
  const root = findRepoRoot(startDir);
  if (!root) return null;
  const file = join(root, '.env.example');
  if (!existsSync(file)) return null;
  process.loadEnvFile(file); // Node >= 20.12: parses KEY=value lines, skips comments, keeps existing variables
  return file;
};
