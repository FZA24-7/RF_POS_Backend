import rateLimit from 'express-rate-limit';

/**
 * Coarse, IP-based defence against credential-stuffing / brute force at the
 * network layer. This is deliberately generous - the precise, per-account
 * lockout policy (see AuthService) is what actually enforces the product's
 * lockout requirement; this middleware just stops a single IP hammering the
 * endpoint outright.
 */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
  },
});
