import { ApiError } from '../api/client.js';

/**
 * Turns whatever the login call threw into one safe, human sentence. Server error CODES are matched (not the
 * server's wording), and "unknown user" vs "wrong password" are never distinguished - the API returns the same
 * INVALID_CREDENTIALS for both on purpose.
 */
export const describeLoginError = (err: unknown): string => {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'INVALID_CREDENTIALS':
        return 'Invalid Login ID or password.';
      case 'ACCOUNT_LOCKED':
        return 'Too many failed attempts. Please wait a few minutes and try again.';
      case 'ACCOUNT_DISABLED':
        return 'This account has been disabled. Please contact your administrator.';
      case 'TENANT_SUSPENDED':
        return 'This account is currently unavailable. Please contact your administrator.';
      case 'RATE_LIMITED':
        return 'Too many requests. Please wait a moment and try again.';
      case 'VALIDATION_ERROR':
        return 'Please check your Login ID and password.';
      case 'SERVER_UNREACHABLE': // the desktop app could not reach the configured server (answered 502 itself)
        return 'Cannot reach the server. Check your connection and try again.';
      default:
        if (err.status === 429) return 'Too many requests. Please wait a moment and try again.';
        if (err.status >= 500) return 'The server had a problem. Please try again in a moment.';
        return 'Unable to sign in. Please try again.';
    }
  }
  // fetch() rejects with a TypeError when the API is unreachable (server down, offline, CORS/network failure).
  return 'Cannot reach the server. Check your connection and try again.';
};
