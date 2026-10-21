import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ServerConfig {
  port: number;
  /** allowed browser origins; ['*'] allows any, an empty list allows none */
  corsOrigins: string[];
  /** HMAC key for player tokens; random per process when unset */
  secret: string | null;
  /** the built client to serve, if any; null serves none (the dev server does that) */
  clientDir: string | null;
  /**
   * TEST ONLY: lowers the score needed to win, so end-to-end tests can finish a
   * game quickly. Read only when NODE_ENV is exactly "test"; always null otherwise.
   */
  testVp: number | null;
  /** TEST ONLY: makes dice, decks and codes reproducible. Same rule as testVp. */
  testSeed: number | null;
  /**
   * TEST ONLY: every player starts with this many cards of each resource, taken from the bank (round-robin when the
   * bank runs short), so a role such as the Soldier can be tried by hand. Same rule as testVp.
   */
  testResources: number | null;
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): ServerConfig {
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`bad PORT: ${env.PORT}`);
  const corsOrigins = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const testVp = env.NODE_ENV === 'test' && env.ADA_TEST_VP ? Number(env.ADA_TEST_VP) : null;
  if (testVp !== null && (!Number.isInteger(testVp) || testVp < 1)) throw new Error(`bad ADA_TEST_VP: ${env.ADA_TEST_VP}`);
  const testSeed = env.NODE_ENV === 'test' && env.ADA_TEST_SEED ? Number(env.ADA_TEST_SEED) : null;
  if (testSeed !== null && !Number.isInteger(testSeed)) throw new Error(`bad ADA_TEST_SEED: ${env.ADA_TEST_SEED}`);
  const testResources = env.NODE_ENV === 'test' && env.ADA_TEST_RESOURCES ? Number(env.ADA_TEST_RESOURCES) : null;
  if (testResources !== null && (!Number.isInteger(testResources) || testResources < 1 || testResources > 19)) throw new Error(`bad ADA_TEST_RESOURCES: ${env.ADA_TEST_RESOURCES}`);
  const clientDir = env.CLIENT_DIR?.trim() ? resolve(env.CLIENT_DIR.trim()) : defaultClientDir();
  return { port, corsOrigins, secret: env.SERVER_SECRET?.trim() || null, clientDir, testVp, testSeed, testResources };
}

/** packages/client/dist next to this package, when it has been built */
function defaultClientDir(): string | null {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
  return existsSync(dir) ? dir : null;
}
