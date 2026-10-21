import { describe, expect, it } from 'vitest';
import { configFromEnv } from '../src/config';
import { AnonymousIdentity } from '../src/identity';
import { TokenBucket } from '../src/rateLimit';
import { cryptoRng } from '../src/rng';

describe('config', () => {
  it('reads PORT and CORS_ORIGINS, with safe defaults', () => {
    expect(configFromEnv({})).toMatchObject({ port: 3001, corsOrigins: [], secret: null, testVp: null });
    expect(configFromEnv({ PORT: '8080', CORS_ORIGINS: 'http://a.test, http://b.test ,' })).toMatchObject({
      port: 8080,
      corsOrigins: ['http://a.test', 'http://b.test'],
    });
    expect(() => configFromEnv({ PORT: 'abc' })).toThrow();
  });
});

describe('AnonymousIdentity', () => {
  it('issues tokens it can verify, and refuses forged or malformed ones', () => {
    const id = new AnonymousIdentity('s3cret');
    const a = id.issue();
    expect(id.verify(a.token)).toBe(a.playerId);
    expect(id.issue().playerId).not.toBe(a.playerId);
    expect(id.verify(`${a.playerId}.AAAA`)).toBeNull();
    expect(id.verify(`someone-else.${a.token.split('.')[1]}`)).toBeNull();
    for (const bad of [undefined, null, 5, {}, '', '.', 'x', 'x'.repeat(500)]) expect(id.verify(bad)).toBeNull();
    expect(new AnonymousIdentity('other').verify(a.token)).toBeNull();
  });
});

describe('TokenBucket', () => {
  it('lets a burst through, then refills over time', () => {
    let t = 0;
    const b = new TokenBucket(3, 2, () => t);
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false]);
    t = 500;
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
  });
});

describe('cryptoRng', () => {
  it('returns numbers in [0, 1) and does not repeat', () => {
    const r = cryptoRng();
    const xs = Array.from({ length: 1000 }, r);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(new Set(xs).size).toBeGreaterThan(990);
  });
});
