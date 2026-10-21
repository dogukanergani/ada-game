import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Who a connection is. Today: a random id the server issues and signs, kept by
 * the browser. Later an account-backed implementation plugs into the same
 * interface; nothing else in the server knows how identity works.
 */
export interface PlayerIdentity {
  /** a brand-new identity */
  issue(): { playerId: string; token: string };
  /** the player id behind a token, or null when it is not valid */
  verify(token: unknown): string | null;
}

export class AnonymousIdentity implements PlayerIdentity {
  private readonly secret: Buffer;

  constructor(secret?: string | null) {
    this.secret = secret ? Buffer.from(secret) : randomBytes(32);
  }

  private sign(playerId: string): string {
    return createHmac('sha256', this.secret).update(playerId).digest('base64url');
  }

  issue() {
    const playerId = randomUUID();
    return { playerId, token: `${playerId}.${this.sign(playerId)}` };
  }

  verify(token: unknown): string | null {
    if (typeof token !== 'string' || token.length > 200) return null;
    const dot = token.indexOf('.');
    if (dot <= 0) return null;
    const playerId = token.slice(0, dot);
    const given = Buffer.from(token.slice(dot + 1));
    const expected = Buffer.from(this.sign(playerId));
    return given.length === expected.length && timingSafeEqual(given, expected) ? playerId : null;
  }
}
