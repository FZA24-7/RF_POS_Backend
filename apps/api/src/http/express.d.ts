import type { SecurityContext } from '../domain/types.js';

declare global {
  namespace Express {
    interface Request {
      auth?: SecurityContext;
      requestId: string;
    }
  }
}

export {};
