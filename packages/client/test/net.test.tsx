import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { GamePayload, LobbyView } from '@ada/protocol';
import { dictionaries } from '../src/i18n';
import { I18nProvider } from '../src/i18n/context';
import { Connection } from '../src/net/connection';
import { createStorage, type KeyValueStore } from '../src/net/storage';
import { LOG_LIMIT, initialState, reducer, type AppState, type Msg } from '../src/net/store';
import { IncompatibleScreen } from '../src/ui/Gate';

describe('storage', () => {
  const memoryBackend = (): KeyValueStore & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
  };

  it('stores and reads values under its own prefix', () => {
    const b = memoryBackend();
    const s = createStorage(() => b);
    s.set('token', 'abc');
    expect(s.get('token')).toBe('abc');
    expect(b.data.get('ada.token')).toBe('abc');
    s.remove('token');
    expect(s.get('token')).toBeNull();
  });

  it('keeps working in memory when storage throws on every call (blocked)', () => {
    const s = createStorage(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => s.set('token', 'abc')).not.toThrow();
    expect(s.get('token')).toBe('abc');
    expect(() => s.remove('token')).not.toThrow();
    expect(s.get('token')).toBeNull();
  });

  it('keeps working when it is full (writes throw, reads still work)', () => {
    const full: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem: () => {},
    };
    const s = createStorage(() => full);
    s.set('name', 'Ada');
    expect(s.get('name')).toBe('Ada');
  });

  it('works with no storage at all', () => {
    const s = createStorage(() => null);
    s.set('x', 'y');
    expect(s.get('x')).toBe('y');
  });
});

const lobby = (over: Partial<LobbyView> = {}): LobbyView => ({
  code: 'KMTP', me: 'a', hostId: 'a', mode: 'standard', phase: 'lobby', minPlayers: 2, maxPlayers: 5, players: [], ...over,
});
const payload = (events: GamePayload['events'] = []): GamePayload => ({ view: { me: 'a', phase: 'setup' } as never, legal: { phase: 'setup' } as never, events });
const run = (msgs: Msg[], from: AppState = initialState) => msgs.reduce(reducer, from);

describe('the store', () => {
  it('follows the connection', () => {
    expect(run([{ t: 'conn', status: 'reconnecting', attempt: 3 }])).toMatchObject({ conn: 'reconnecting', attempt: 3 });
    expect(run([{ t: 'conn', status: 'online' }]).attempt).toBe(0);
  });

  it('keeps the lobby, replaces the game on every update, and appends events to the log', () => {
    const s = run([
      { t: 'lobby', lobby: lobby({ phase: 'playing' }) },
      { t: 'game', kind: 'snapshot', payload: payload() },
      { t: 'game', kind: 'update', payload: payload([{ type: 'turnEnded', player: 'a' }, { type: 'turnStarted', player: 'b', turn: 2 }]) },
    ]);
    expect(s.lobby?.phase).toBe('playing');
    expect(s.game?.view.me).toBe('a');
    expect(s.log.map((l) => l.event.type)).toEqual(['turnEnded', 'turnStarted']);
    expect(new Set(s.log.map((l) => l.id)).size).toBe(2);
  });

  it('a snapshot after reconnecting does not repeat the log', () => {
    const before = run([{ t: 'game', kind: 'update', payload: payload([{ type: 'turnEnded', player: 'a' }]) }]);
    const after = run([{ t: 'game', kind: 'snapshot', payload: payload() }], before);
    expect(after.log).toHaveLength(1);
  });

  it('returning to the lobby clears the game and the log', () => {
    const s = run([
      { t: 'lobby', lobby: lobby({ phase: 'playing' }) },
      { t: 'game', kind: 'update', payload: payload([{ type: 'turnEnded', player: 'a' }]) },
      { t: 'lobby', lobby: lobby({ phase: 'lobby' }) },
    ]);
    expect(s.game).toBeNull();
    expect(s.log).toEqual([]);
  });

  it('caps the log', () => {
    const many = Array.from({ length: LOG_LIMIT + 50 }, () => ({ type: 'turnEnded', player: 'a' }) as const);
    expect(run([{ t: 'game', kind: 'update', payload: payload(many) }]).log).toHaveLength(LOG_LIMIT);
  });

  it('notices come and go, and leaving a room forgets it', () => {
    const e = run([{ t: 'error', error: { key: 'roomFull' } }]);
    expect(e.notice).toMatchObject({ kind: 'error', error: { key: 'roomFull' } });
    expect(reducer(e, { t: 'dismiss' }).notice).toBeNull();
    const p = run([{ t: 'presence', notice: { type: 'playerDisconnected', player: 'b' } }]);
    expect(p.notice).toMatchObject({ kind: 'presence' });
    expect(run([{ t: 'lobby', lobby: lobby() }, { t: 'leftRoom' }]).lobby).toBeNull();
  });
});

describe('fonts', () => {
  const css = readFileSync(join(__dirname, '..', 'src', 'fonts.css'), 'utf8');
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);

  const covers = (range: string, ch: string) => {
    const cp = ch.codePointAt(0)!;
    return range.split(',').some((part) => {
      const [lo, hi = lo] = part.trim().replace(/^U+/i, '').split('-').map((x) => parseInt(x.replace(/^U+/i, ''), 16));
      return cp >= lo && cp <= hi;
    });
  };

  it('load the Latin and Latin Extended subsets of both families, and nothing else', () => {
    expect(faces).toHaveLength(4);
    for (const family of ['Bricolage Grotesque Variable', 'Instrument Sans Variable']) {
      const mine = faces.filter((f) => f.includes(family));
      expect(mine.map((f) => /-(latin(?:-ext)?)-wght/.exec(f)?.[1]).sort()).toEqual(['latin', 'latin-ext']);
    }
  });

  it('together cover every Turkish letter, each from a face that is actually loaded for it', () => {
    for (const family of ['Bricolage Grotesque Variable', 'Instrument Sans Variable']) {
      const ranges = faces.filter((f) => f.includes(family)).map((f) => /unicode-range:\s*([^;]+);/.exec(f)![1]);
      for (const ch of 'çÇöÖüÜığĞşŞİ') {
        expect(
          ranges.some((r) => covers(r, ch)),
          `${family} has no face for ${ch}`,
        ).toBe(true);
      }
      // the letters that are not in Latin-1 come from the extended subset
      const ext = faces.find((f) => f.includes(family) && f.includes('latin-ext'))!;
      const extRange = /unicode-range:\s*([^;]+);/.exec(ext)![1];
      for (const ch of 'ğĞşŞİ') expect(covers(extRange, ch), `${ch} must come from latin-ext`).toBe(true);
    }
  });

  it('point at font files that exist in the installed packages', () => {
    for (const f of faces) {
      const m = /url\('(@fontsource-variable\/[^']+)'\)/.exec(f)!;
      const file = join(__dirname, '..', '..', '..', 'node_modules', m[1]);
      expect(() => readFileSync(file), m[1]).not.toThrow();
    }
  });
});

describe('the "app is out of date" screen', () => {
  it('says so in plain words in both languages and offers a reload', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <IncompatibleScreen />
      </I18nProvider>,
    );
    const inEnglish = html.includes(dictionaries.en['conn.incompatible.title']) && html.includes(dictionaries.en['conn.incompatible.reload']);
    const inTurkish = html.includes(dictionaries.tr['conn.incompatible.title']) && html.includes(dictionaries.tr['conn.incompatible.reload']);
    expect(inEnglish || inTurkish).toBe(true);
    expect(html).toContain('role="alert"');
  });
});

/* ---------------- the real connection against a real server ---------------- */

describe('Connection', () => {
  const closers: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const c of closers.splice(0)) await c();
  });

  async function boot(protocolVersion?: number) {
    const { createAdaServer } = await import('../../server/src/server');
    const server = createAdaServer({
      config: { port: 0, corsOrigins: ['*'], secret: 's', clientDir: null, testVp: null, testSeed: null, testResources: null, testCreateLimit: null },
      sweepIntervalMs: 0,
    });
    const port = await server.listen(0);
    closers.push(() => server.close());
    const seen: Msg[] = [];
    const conn = new Connection((m) => seen.push(m), `http://127.0.0.1:${port}`, protocolVersion);
    closers.push(() => conn.close());
    const until = async (pred: (m: Msg) => boolean) => {
      for (let i = 0; i < 100; i++) {
        const hit = seen.find(pred);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 30));
      }
      throw new Error('timed out: ' + JSON.stringify(seen));
    };
    return { conn, seen, until };
  }

  it('says hello with the protocol version and goes online', async () => {
    const { conn, until } = await boot();
    conn.start();
    expect(await until((m) => m.t === 'hello')).toMatchObject({ t: 'hello' });
    expect(await until((m) => m.t === 'conn' && m.status === 'online')).toBeTruthy();
  });

  it('shows the "app is out of date" state, and stops, when the server refuses its version', async () => {
    const { conn, seen, until } = await boot(999);
    conn.start();
    expect(await until((m) => m.t === 'conn' && m.status === 'incompatible')).toBeTruthy();
    expect(seen.some((m) => m.t === 'conn' && m.status === 'online')).toBe(false);
    // and it does not keep knocking
    const n = seen.length;
    await new Promise((r) => setTimeout(r, 800));
    expect(seen.length).toBe(n);
  });

  it('a request without a connection fails with a timeout error instead of hanging', async () => {
    const { conn } = await boot();
    const r = await conn.emit('room:create', { name: 'A' });
    expect(r).toMatchObject({ ok: false, error: { timeout: true } });
  });
});
