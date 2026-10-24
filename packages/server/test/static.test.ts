import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { describe, expect, it } from 'vitest';
import { configFromEnv } from '../src/config';
import { TestClient, startServer } from './harness';

function get(url: string, path: string, method = 'GET'): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    // node's http client keeps the path as written, so ".." reaches the server
    const u = new URL(url);
    const req = request({ host: u.hostname, port: u.port, path, method }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

function site() {
  const root = mkdtempSync(join(tmpdir(), 'ada-site-'));
  mkdirSync(join(root, 'dist', 'assets'), { recursive: true });
  writeFileSync(join(root, 'secret.txt'), 'TOP SECRET');
  writeFileSync(join(root, 'dist', 'index.html'), '<!doctype html><title>ada</title>');
  writeFileSync(join(root, 'dist', 'sw-not-here.txt'), 'plain');
  writeFileSync(join(root, 'dist', 'assets', 'app-abc123.js'), 'console.log(1)');
  writeFileSync(join(root, 'dist', 'manifest.webmanifest'), '{}');
  return join(root, 'dist');
}

describe('serving the built client', () => {
  it('serves files with the right types and caching, and falls back to index.html for app paths', async () => {
    const clientDir = site();
    const { url } = await startServer({ config: { port: 0, corsOrigins: [], secret: 's', clientDir, testVp: null, testSeed: null, testResources: null, testCreateLimit: null, testTurnSeconds: null, testGameSeconds: null } });
    const index = await get(url, '/');
    expect(index.status).toBe(200);
    expect(index.body).toContain('<title>ada</title>');
    expect(index.headers['content-type']).toContain('text/html');
    expect(index.headers['cache-control']).toBe('no-cache');

    const asset = await get(url, '/assets/app-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['content-type']).toContain('text/javascript');
    expect(asset.headers['cache-control']).toContain('immutable');

    expect((await get(url, '/manifest.webmanifest')).headers['content-type']).toContain('manifest+json');
    expect((await get(url, '/room/ABCD')).body).toContain('<title>ada</title>');
    expect((await get(url, '/assets/missing.js')).status).toBe(404);
    expect((await get(url, '/', 'HEAD')).body).toBe('');
    expect((await get(url, '/', 'POST')).status).toBe(405);
  });

  it('never leaves the client folder', async () => {
    const clientDir = site();
    const { url } = await startServer({ config: { port: 0, corsOrigins: [], secret: 's', clientDir, testVp: null, testSeed: null, testResources: null, testCreateLimit: null, testTurnSeconds: null, testGameSeconds: null } });
    for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/assets/../../secret.txt', '/%00', '/..\\secret.txt']) {
      const r = await get(url, path);
      expect(r.body, path).not.toContain('TOP SECRET');
    }
  });

  it('leaves the socket path to socket.io, and a server with no client answers 404', async () => {
    const clientDir = site();
    const { url } = await startServer({ config: { port: 0, corsOrigins: [], secret: 's', clientDir, testVp: null, testSeed: null, testResources: null, testCreateLimit: null, testTurnSeconds: null, testGameSeconds: null } });
    const c = await TestClient.login(url);
    expect(c.playerId).toBeTruthy();
    const none = await startServer();
    expect((await get(none.url, '/')).status).toBe(404);
  });
});

describe('the test-only target score', () => {
  it('is read only when NODE_ENV is "test"', () => {
    expect(configFromEnv({ NODE_ENV: 'test', ADA_TEST_VP: '3' }).testVp).toBe(3);
    for (const env of [undefined, 'production', 'development', 'Test', 'testing']) {
      expect(configFromEnv({ NODE_ENV: env, ADA_TEST_VP: '3' }).testVp, String(env)).toBeNull();
    }
    // the test seed follows the same rule
    expect(configFromEnv({ NODE_ENV: 'test', ADA_TEST_SEED: '12' }).testSeed).toBe(12);
    for (const env of [undefined, 'production', 'development', 'Test']) {
      expect(configFromEnv({ NODE_ENV: env, ADA_TEST_SEED: '12' }).testSeed, String(env)).toBeNull();
    }
    expect(() => configFromEnv({ NODE_ENV: 'test', ADA_TEST_VP: '0' })).toThrow();
    expect(() => configFromEnv({ NODE_ENV: 'test', ADA_TEST_VP: 'x' })).toThrow();
  });

  it('lowers the winning score of games the server starts, and a server without it uses the mode\'s', async () => {
    for (const [vp, expected] of [[3, 3], [null, 7]] as const) {
      const { url } = await startServer({ config: { port: 0, corsOrigins: [], secret: 's', clientDir: null, testVp: vp, testSeed: null, testResources: null, testCreateLimit: null, testTurnSeconds: null, testGameSeconds: null } });
      const a = await TestClient.login(url);
      const b = await TestClient.login(url);
      const { code } = await a.emit('room:create', { name: 'A' });
      await b.emit('room:join', { code, name: 'B' });
      await a.emit('lobby:setMode', { mode: 'short' });
      await a.emit('lobby:start');
      expect((await a.until('game:snapshot')).view.vpToWin).toBe(expected);
    }
  });
});

describe('the test-only starting cards', () => {
  it('is read only when NODE_ENV is "test", and must be a whole number from 1 to 19', () => {
    expect(configFromEnv({ NODE_ENV: 'test', ADA_TEST_RESOURCES: '4' }).testResources).toBe(4);
    for (const env of [undefined, 'production', 'development', 'Test', 'testing']) {
      expect(configFromEnv({ NODE_ENV: env, ADA_TEST_RESOURCES: '4' }).testResources, String(env)).toBeNull();
    }
    expect(configFromEnv({ NODE_ENV: 'test' }).testResources).toBeNull();
    for (const bad of ['0', '20', 'x', '2.5', '-1']) expect(() => configFromEnv({ NODE_ENV: 'test', ADA_TEST_RESOURCES: bad }), bad).toThrow();
  });

  it('a server outside a test environment ignores it, even if the variable is set, and starts games with the usual hands', async () => {
    const config = configFromEnv({ NODE_ENV: 'production', ADA_TEST_RESOURCES: '4', CLIENT_DIR: '' });
    const { url } = await startServer({ config: { ...config, port: 0, secret: 's', clientDir: null } });
    const a = await TestClient.login(url);
    const b = await TestClient.login(url);
    const { code } = await a.emit('room:create', { name: 'A' });
    await b.emit('room:join', { code, name: 'B' });
    await a.emit('lobby:setMode', { mode: 'short' });
    await a.emit('lobby:start');
    const { view } = await a.until('game:snapshot');
    expect(view.players.find((p: any) => p.id === view.me).hand).toEqual({ lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
    expect(view.bank).toEqual({ lumber: 14, brick: 14, wool: 14, grain: 14, ore: 14 }); // the short mode's bank
  });

  async function started(n: number, testResources: number) {
    const { url } = await startServer({ config: { port: 0, corsOrigins: [], secret: 's', clientDir: null, testVp: null, testSeed: null, testResources, testCreateLimit: null, testTurnSeconds: null, testGameSeconds: null } });
    const players: TestClient[] = [];
    for (let i = 0; i < n; i++) players.push(await TestClient.login(url));
    const { code } = await players[0].emit('room:create', { name: 'P0' });
    for (const [i, p] of players.slice(1).entries()) await p.emit('room:join', { code, name: 'P' + (i + 1) });
    await players[0].emit('lobby:setMode', { mode: 'short' });
    await players[0].emit('lobby:start');
    return Promise.all(players.map((p) => p.until('game:snapshot')));
  }

  it('deals every player that many of each resource out of the bank', async () => {
    const snaps = await started(3, 4);
    for (const { view } of snaps) {
      expect(view.players.find((p: any) => p.id === view.me).hand).toEqual({ lumber: 4, brick: 4, wool: 4, grain: 4, ore: 4 });
      expect(view.bank).toEqual({ lumber: 2, brick: 2, wool: 2, grain: 2, ore: 2 });
      // a rival's hand is still only a count
      for (const p of view.players.filter((x: any) => x.id !== view.me)) {
        expect(p.hand).toBeNull();
        expect(p.handCount).toBe(20);
      }
    }
  });

  it('when the bank cannot cover everyone, nobody is left short because of their seat: every player holds the same number of cards', async () => {
    const snaps = await started(5, 5);
    const counts = snaps.map(({ view }) => Object.values(view.players.find((p: any) => p.id === view.me).hand as Record<string, number>).reduce((a, b) => a + b, 0));
    expect(new Set(counts).size).toBe(1);
    expect(counts[0]).toBe(19);
    for (const { view } of snaps) expect(view.bank).toEqual({ lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
  });
});

describe('the test-only room creation limit', () => {
  it('is read only when NODE_ENV is "test", and must be a whole number from 1 to 100000', () => {
    expect(configFromEnv({ NODE_ENV: 'test', ADA_TEST_CREATE_LIMIT: '500' }).testCreateLimit).toBe(500);
    for (const env of [undefined, 'production', 'development', 'Test', 'testing']) {
      expect(configFromEnv({ NODE_ENV: env, ADA_TEST_CREATE_LIMIT: '500' }).testCreateLimit, String(env)).toBeNull();
    }
    expect(configFromEnv({ NODE_ENV: 'test' }).testCreateLimit).toBeNull();
    for (const bad of ['0', '100001', 'x', '2.5', '-1']) expect(() => configFromEnv({ NODE_ENV: 'test', ADA_TEST_CREATE_LIMIT: bad }), bad).toThrow();
  });

  it('a test server lets one address create many rooms at once; a server outside a test environment still refuses the 11th', async () => {
    for (const [env, allowed] of [['test', true], ['production', false]] as const) {
      const config = configFromEnv({ NODE_ENV: env, ADA_TEST_CREATE_LIMIT: '1000', CLIENT_DIR: '' });
      // no createLimit option here: the config decides
      const { url } = await startServer({ config: { ...config, port: 0, secret: 's', clientDir: null }, createLimit: undefined });
      const refused: unknown[] = [];
      for (let i = 0; i < 14; i++) {
        const c = await TestClient.login(url);
        const r = (await c.emit('room:create', { name: 'A' })) as { ok?: boolean; error?: { key: string } };
        if (r.ok === false) refused.push(r.error?.key);
      }
      expect(refused.length > 0, `${env}: ${refused.length} refused`).toBe(!allowed);
      if (!allowed) expect(new Set(refused)).toEqual(new Set(['rateLimited']));
    }
  });
});
