/**
 * ada-cli: a terminal client for trying the server by hand.
 *
 *   npm run cli -w @ada/server -- --id ayse [--url http://localhost:3001] [--raw]
 *
 * The identity (token) is kept in ~/.ada-cli/<id>.json, so closing the program
 * and starting it again with the same --id puts you back in your room.
 * This is a developer tool: its own messages are plain English; the server
 * still sends only keys and values.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { io } from 'socket.io-client';
import type { GameView, LegalMoves } from '@ada/game-core';
import { PROTOCOL_VERSION, type LobbyView } from '@ada/protocol';
import { autoStep } from './autoplay';
import { HELP, parseCommand } from './commands';
import { renderEvent, renderLegal, renderLobby, renderMap, renderState } from './render';

const flag = (name: string, fallback?: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const ID = flag('id', 'default')!;
const URL = flag('url', 'http://localhost:3001')!;
const RAW = process.argv.includes('--raw');

const tokenFile = join(homedir(), '.ada-cli', `${ID.replace(/[^\w.-]/g, '_')}.json`);
function loadToken(): string | undefined {
  try {
    return JSON.parse(readFileSync(tokenFile, 'utf8')).token;
  } catch {
    return undefined;
  }
}
function saveToken(token: string) {
  mkdirSync(join(homedir(), '.ada-cli'), { recursive: true });
  writeFileSync(tokenFile, JSON.stringify({ token }));
}

const socket = io(URL, { transports: ['websocket'], reconnection: false });
let playerId = '';
let lobby: LobbyView | null = null;
let view: GameView | null = null;
let autoplay = false;
let busy = false;
let refusals = 0;

const say = (text: string) => console.log(text);
const send = (event: string, payload?: unknown): Promise<any> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: { key: 'noAnswer' } }), 5000);
    const done = (r: unknown) => {
      clearTimeout(timer);
      resolve(r);
    };
    if (payload === undefined) socket.emit(event, done);
    else socket.emit(event, payload, done);
  });

function show(r: any, label: string) {
  if (RAW) say(`<- ack ${label} ${JSON.stringify(r)}`);
  else if (r.ok) say(`ok${r.code ? ` (room ${r.code})` : ''}`);
  else say(`error: ${r.error?.key}${r.error?.error ? ` / ${r.error.error.type}` : ''} ${JSON.stringify(r.error)}`);
}

/* ---------------- incoming ---------------- */

socket.onAny((event: string, ...args: unknown[]) => {
  if (RAW) say(`<- ${event} ${JSON.stringify(args[0])}`);
});
socket.on('lobby:update', (l: LobbyView) => {
  lobby = l;
  if (!RAW) say(renderLobby(l));
});
const onGame = (kind: string) => (p: { view: GameView; events: { type: string }[] }) => {
  view = p.view;
  if (!RAW) {
    for (const e of p.events) say(`  * ${renderEvent(e as never)}`);
    if (kind === 'snapshot') say('game state received (type "state" or "map")');
    else if (p.view.current === p.view.me && p.view.phase !== 'finished') say(`  your move (phase ${p.view.phase})`);
    if (p.view.phase === 'finished') say(`game over, winner: ${p.view.players.filter((q) => p.view.winners.includes(q.id)).map((q) => q.name).join(' & ')}`);
  }
  scheduleAuto();
};
socket.on('game:update', onGame('update'));
socket.on('game:snapshot', onGame('snapshot'));
socket.on('presence', (n: { type: string; player: string }) => {
  if (!RAW) say(`  ! ${n.type}: ${lobby?.players.find((p) => p.id === n.player)?.name ?? n.player.slice(0, 4)}`);
});
socket.on('replaced', () => say('this identity connected somewhere else; closing'));
socket.on('disconnect', () => {
  say('disconnected from the server');
  process.exit(0);
});

/* ---------------- autoplay ---------------- */

function scheduleAuto() {
  if (autoplay) setTimeout(step, 250);
}
async function step() {
  if (!autoplay || busy || !view) return;
  busy = true;
  try {
    const r = await autoStep({ emit: send }, view, Math.random);
    if (r.kind === 'acted') {
      refusals = 0;
      say(`  [auto] ${JSON.stringify(r.action)}`);
    } else if (r.kind === 'refused') {
      say(`  [auto] refused ${JSON.stringify(r.action)}: ${JSON.stringify(r.error)}`);
      if (++refusals >= 5) {
        autoplay = false;
        say('  [auto] too many refusals, autoplay off');
      }
    }
  } finally {
    busy = false;
  }
}

/* ---------------- typed commands ---------------- */

async function run(line: string) {
  const cmd = parseCommand(line);
  if (!cmd) return;
  if (cmd.kind === 'error') return say(cmd.message);
  if (cmd.kind === 'local') {
    switch (cmd.name) {
      case 'help': return say(HELP);
      case 'quit': return process.exit(0);
      case 'whoami': return say(`${ID}  player id ${playerId}`);
      case 'state': return say(view ? renderState(view) : lobby ? renderLobby(lobby) : 'not in a room (create / join)');
      case 'map': return say(view ? renderMap(view) : 'no game yet');
      case 'legal': {
        const r = await send('game:legal', {});
        return r.ok ? say(renderLegal(r.legal as LegalMoves)) : show(r, 'game:legal');
      }
      case 'autoplay':
        autoplay = cmd.arg ? cmd.arg === 'on' : !autoplay;
        refusals = 0;
        say(`autoplay ${autoplay ? 'on' : 'off'}`);
        return scheduleAuto();
    }
    return;
  }
  let payload = cmd.payload as Record<string, unknown> | undefined;
  if (cmd.victimRef && view && payload) {
    const ref = cmd.victimRef.toLowerCase();
    const hit = view.players.find((p) => p.name.toLowerCase() === ref || p.id.startsWith(ref));
    if (hit) payload = { ...payload, victim: hit.id };
  }
  const r = await send(cmd.event, payload);
  show(r, cmd.event);
  if (cmd.event === 'room:leave' && r.ok) {
    lobby = null;
    view = null;
  }
}

socket.on('connect', async () => {
  const r = await send('identity:hello', { token: loadToken(), protocolVersion: PROTOCOL_VERSION });
  if (!r.ok) {
    say(`hello failed: ${JSON.stringify(r)}`);
    return process.exit(1);
  }
  playerId = r.playerId;
  saveToken(r.token);
  say(`connected as "${ID}" (${playerId.slice(0, 8)}...)${r.room ? `, back in room ${r.room}` : ''}. Type "help".`);
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  rl.prompt();
  // commands run one after another, so piped input behaves like typed input
  let queue: Promise<void> = Promise.resolve();
  let closed = false;
  rl.on('line', (line) => {
    queue = queue.then(() => run(line)).then(() => {
      if (!closed) rl.prompt();
    });
  });
  rl.on('close', () => {
    closed = true;
    void queue.then(() => {
      if (!autoplay) process.exit(0);
    });
  });
});
socket.on('connect_error', (e: Error) => {
  say(`cannot connect to ${URL}: ${e.message}`);
  process.exit(1);
});
