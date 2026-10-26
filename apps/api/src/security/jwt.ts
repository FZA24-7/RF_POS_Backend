import { jwtVerify, SignJWT } from 'jose';
import type { SystemRole } from '@mafk/shared';

export interface AccessTokenClaims {
  sub: string; // user id
  tid: string | null; // tenant id
  sid: string; // session id
  role: SystemRole;
  perms: readonly string[]; // permission keys, snapshot at issue time (short TTL bounds staleness)
}

export interface AccessTokenService {
  sign(claims: AccessTokenClaims): Promise<string>;
  verify(token: string): Promise<AccessTokenClaims>;
}

const ISSUER = 'mafk-retail-flow-pos';
const AUDIENCE = 'mafk-retail-flow-pos-client';

export class JoseAccessTokenService implements AccessTokenService {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly ttlMinutes: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async sign(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({ tid: claims.tid, sid: claims.sid, role: claims.role, perms: claims.perms })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.ttlMinutes}m`)
      .sign(this.key);
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: AUDIENCE });
    if (typeof payload.sub !== 'string') throw new Error('Token missing subject');
    return {
      sub: payload.sub,
      tid: (payload.tid as string | null) ?? null,
      sid: payload.sid as string,
      role: payload.role as SystemRole,
      perms: (payload.perms as string[]) ?? [],
    };
  }
}
