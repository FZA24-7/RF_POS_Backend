import * as argon2 from 'argon2';

export interface PasswordHasherConfig {
  memoryCostKib: number;
  timeCost: number;
}

/**
 * Argon2id wrapper. Parameters are read from the environment (see config/env.ts)
 * rather than hardcoded, so cost can be tuned per deployment without a code change.
 */
export class PasswordHasher {
  constructor(private readonly config: PasswordHasherConfig) {}

  async hash(plainPassword: string): Promise<string> {
    return argon2.hash(plainPassword, {
      type: argon2.argon2id,
      memoryCost: this.config.memoryCostKib,
      timeCost: this.config.timeCost,
      parallelism: 1,
    });
  }

  async verify(hash: string, plainPassword: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plainPassword);
    } catch {
      // Malformed/unknown hash format - treat as a failed verification, never throw.
      return false;
    }
  }
}
