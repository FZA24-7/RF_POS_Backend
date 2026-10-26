import type { NextFunction, Request, Response } from 'express';
import type { Logger } from '../../logger.js';
import { DomainError } from '../../domain/types.js';

/**
 * Last middleware in the chain. Known `DomainError`s are translated to their
 * declared HTTP status with a stable error code. Anything unexpected is
 * logged with full detail server-side but returned to the client as a
 * generic 500 - stack traces and internals never reach the response body.
 */
export const errorHandler =
  (logger: Logger) =>
  (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    if (err instanceof DomainError) {
      res.status(err.httpStatus).json({ error: { code: err.code, message: err.message } });
      return;
    }
    logger.error({ err, requestId: req.requestId, path: req.path }, 'Unhandled error');
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        requestId: req.requestId,
      },
    });
  };

export const notFoundHandler = (req: Request, res: Response): void => {
  res
    .status(404)
    .json({ error: { code: 'NOT_FOUND', message: `No route: ${req.method} ${req.path}` } });
};
