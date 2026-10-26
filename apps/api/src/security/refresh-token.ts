import { createHash, randomBytes } from 'node:crypto';

/** A refresh token is a random opaque string. Only its SHA-256 hash is ever persisted. */
export interface IssuedRefreshToken {
  token: string;
  hash: string;
}

export const generateRefreshToken = (): IssuedRefreshToken => {
  const token = randomBytes(48).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
};

export const hashRefreshToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
