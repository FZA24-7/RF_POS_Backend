import pino from 'pino';
import type { Env } from './config/env.js';

export const createLogger = (env: Pick<Env, 'NODE_ENV'>): pino.Logger =>
  pino({
    level: env.NODE_ENV === 'production' ? 'info' : env.NODE_ENV === 'test' ? 'silent' : 'debug',
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash'],
      remove: true,
    },
  });

export type Logger = pino.Logger;
