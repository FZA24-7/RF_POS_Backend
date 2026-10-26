import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),
    CLIENT_URL: z.string().min(1, 'CLIENT_URL is required'),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(5),
    LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
    ARGON2_MEMORY_KIB: z.coerce.number().int().positive().default(65536),
    ARGON2_TIME_COST: z.coerce.number().int().positive().default(3),
  })
  .superRefine((env, ctx) => {
    // The dev-only values shipped in .env.example must never run in production.
    if (env.NODE_ENV !== 'production') return;
    if (env.JWT_SECRET.includes('dev-only-local-secret')) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'The dev-only JWT_SECRET from .env.example must not be used in production',
      });
    }
    if (env.DATABASE_URL.includes('mafk_local_dev')) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'The dev-only database password from .env.example must not be used in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Parses and validates `process.env`. Throws a descriptive error on startup
 * rather than letting an unset secret silently reach production.
 */
export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
};
