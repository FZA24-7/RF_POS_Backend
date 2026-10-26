import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

type Location = 'body' | 'params' | 'query';

/**
 * Validates `req[location]` against a Zod schema.
 *  - On success the PARSED value replaces the raw one, so handlers receive normalised data
 *    (upper-cased tenant codes, lower-cased Login IDs, real `Date` objects, defaults applied).
 *  - On failure the request is rejected with HTTP 422 / `VALIDATION_ERROR` and a readable message that the
 *    web UI shows as-is. Invalid input is NEVER forwarded to the handlers or the database.
 */
export const validate =
  (schema: ZodType, location: Location = 'body') =>
  (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[location]);

    if (!result.success) {
      const issues = result.error.issues.map((issue) => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      });
      res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: issues.slice(0, 5).join(' | ') || 'Invalid request.',
          issues,
        },
      });
      return;
    }

    if (location === 'query') {
      // Express 5 exposes `req.query` as a getter-only property, so it has to be redefined, not assigned.
      Object.defineProperty(req, 'query', {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } else {
      (req as unknown as Record<string, unknown>)[location] = result.data;
    }
    next();
  };
