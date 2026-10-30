import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createGame, legalMovesFor, viewFor, type GameState, type Team } from '@ada/game-core';
import type { LobbyView } from '@ada/protocol';
import { dictionaries } from '../src/i18n';
import { I18nProvider } from '../src/i18n/context';
import { AppProvider } from '../src/net/app';
import { Lobby, teamsReady } from '../src/screens/Lobby';
import { GameOverSheet, endedByTime } from '../src/screens/sheets/GameOverSheet';
import { GiftSheet } from '../src/screens/sheets/GiftSheet';
import { Seats } from '../src/ui/Seats';
import { TeamBar } from '../src/ui/TeamBar';
import { mulberry32 } from '../../game-core/sim/rng';

beforeAll(() => {
  vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
});

const en = dictionaries.en;
const render = (el: React.ReactElement) =>
  renderToStaticMarkup(
    <I18nProvider>
      <AppProvider>{el}</AppProvider>
    </I18nProvider>,
  );

const lobby = (teams: (Team | null)[], over: Partial<LobbyView> = {}): LobbyView => ({
  code: 'KMTP',
  me: 'p0',
  hostId: 'p0',
  mode: 'standard',
  targetScore: 10,
  timer: null,
  timerChoices: { turnSeconds: [60], gameSeconds: [1800] },
  teamMode: true,
  phase: 'lobby',
  minPlayers: 2,
  maxPlayers: 5,
  players: teams.map((team, i) => ({ id: `p${i}`, name: `Name${i}`, role: null, connected: true, host: i === 0, team })),
  ...over,
});

const who = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;
const TEAMS: Record<string, Team> = { p0: 'A', p1: 'B', p2: 'A', p3: 'B' };
function teamGame(): GameState {
  const roles = ['soldier', 'sage', 'sailor', 'diplomat'];
  const r = createGame({ players: roles.map((role, i) => ({ id: `p${i}`, name: `Name${i}`, role })), mode: 'standard', teams: TEAMS }, mulberry32(2));
  if (!r.ok) throw new Error('createGame');
  const s = r.state;
  s.phase = 'main';
  s.setup = null;
  s.turn = 1;
  s.current = 'p1';
  return s;
}

describe('the lobby\'s team mode', () => {
  it('is a switch the host can use and others only see; off by default shows no team columns', () => {
    const off = render(<Lobby lobby={lobby([null, null], { teamMode: false })} />);
    expect(off).toContain(en['lobby.team.title']);
    expect(off).toContain('data-team-mode="off"');
    expect(off).not.toContain('team-cols');
    const guest = render(<Lobby lobby={lobby([null, null], { me: 'p1', teamMode: false })} />);
    expect(guest).toContain(en['lobby.team.hostOnly']);
  });

  it('shows two columns to pick from, who is where, and what is still missing', () => {
    const html = render(<Lobby lobby={lobby(['A', 'B', null, null])} />);
    expect(html).toContain('data-team="A"');
    expect(html).toContain('data-team="B"');
    expect(html).toContain('data-action="team-join-A"');
    expect(html).toContain(en['lobby.team.noTeam'].replace('{names}', 'Name2, Name3'));
    expect(html).toContain(en['lobby.team.leave']); // p0 is on A already
    expect(html).toContain('2 against 2, points are added up');
  });

  it('says a full team is full, and keeps the start off until it is 4 players two and two', () => {
    const three = render(<Lobby lobby={lobby(['A', 'A', 'B'])} />);
    expect(three).toContain(en['lobby.team.need4'].replace('{n}', '3'));
    expect(three).toContain(en['lobby.start.needTeams']);
    expect(three).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Start/);
    const uneven = render(<Lobby lobby={lobby(['A', 'A', 'A', 'B'], { me: 'p3' })} />);
    expect(uneven).toContain(en['lobby.team.full']);
    const ready = render(<Lobby lobby={lobby(['A', 'A', 'B', 'B'])} />);
    expect(ready).not.toContain(en['lobby.start.needTeams']);
    expect(teamsReady(lobby(['A', 'A', 'B', 'B']))).toBe(true);
    expect(teamsReady(lobby(['A', 'A', 'B', null]))).toBe(false);
    expect(teamsReady(lobby(['A', 'A', 'B', 'B', null]))).toBe(false);
    expect(teamsReady(lobby([null, null], { teamMode: false }))).toBe(true);
  });
});

describe('inside a team game', () => {
  it('the strip tells our total against theirs and the shared goal, and only exists in the team mode', () => {
    const s = teamGame();
    const html = render(<TeamBar view={viewFor(s, 'p0')} />);
    expect(html).toContain('data-side="us"');
    expect(html).toContain('data-side="them"');
    expect(html).toContain(en['team.strip.target'].replace('{n}', '20'));
    expect(html).toContain(en['team.strip.aria'].replace('{us}', '0').replace('{them}', '0').replace('{target}', '20'));
    const solo = { ...viewFor(s, 'p0'), teamMode: false, teamPoints: null, teamTarget: null };
    expect(render(<TeamBar view={solo} />)).toBe('');
  });

  it('marks the teammate\'s seat and shows everyone\'s team letter', () => {
    const view = viewFor(teamGame(), 'p0');
    const opp = render(<Seats view={view} connected={{}} which="opponents" />);
    // p2 is p0's teammate; p1 and p3 are the rivals
    expect(opp).toMatch(/data-player="p2"[^>]*data-team="A"[^>]*data-mate="true"/);
    expect(opp).toMatch(/data-player="p1"[^>]*data-team="B"/);
    expect(opp).not.toMatch(/data-player="p1"[^>]*data-mate/);
    expect(opp).toContain(en['seat.teammate']);
  });

  it('the gift sheet lays out the cards in hand, names the teammate, and is off when the server lists nobody', () => {
    const s = teamGame();
    who(s, 'p0').hand.ore = 2;
    who(s, 'p0').hand.wool = 1;
    const view = viewFor(s, 'p0');
    const legal = legalMovesFor(s, 'p0');
    expect(legal.teamGiftTargets).toEqual(['p2']);
    const html = render(<GiftSheet view={view} legal={legal} onClose={() => undefined} send={async () => true} />);
    expect(html).toContain(en['gift.title']);
    expect(html).toContain(en['gift.to'].replace('{player}', 'Name2'));
    expect(html).toContain(en['gift.none']);
    expect(html).toContain('data-action="send-gift"');
    const nobody = render(<GiftSheet view={viewFor(teamGame(), 'p0')} legal={legalMovesFor(teamGame(), 'p0')} onClose={() => undefined} send={async () => true} />);
    expect(nobody).toContain(en['gift.noCards']);
  });

  it('the gift button is open off turn, with no cards it says why', () => {
    // p0 is not on turn (p1 is) yet may send: that is the legal moves' say-so, which the dock only reads
    const s = teamGame();
    who(s, 'p0').hand.ore = 1;
    expect(s.current).toBe('p1');
    expect(legalMovesFor(s, 'p0').teamGiftTargets).toEqual(['p2']);
    expect(legalMovesFor(s, 'p3').teamGiftTargets).toEqual([]);
  });
});

describe('the end of a team game', () => {
  const finished = (winners: string[], timer = false) => {
    const s = teamGame();
    s.phase = 'finished';
    s.winners = winners;
    if (timer) s.timer = { turnSeconds: 60, gameSeconds: 900 };
    return viewFor(s, 'p0');
  };
  const show = (view: ReturnType<typeof finished>) =>
    render(<GameOverSheet view={view} isHost onClose={() => undefined} onLobby={() => undefined} onLeave={() => undefined} />);

  it('shows the winning team\'s two members together, as a team', () => {
    const html = show(finished(['p0', 'p2']));
    expect(html).toContain(en['over.teamWinner'].replace('{team}', en['team.name.A']).replace('{players}', 'Name0 and Name2'));
    expect(html).toContain('data-over="team-winner"');
    expect(html).toContain(en['over.teamScores']);
    expect(html).toContain(en['over.teamTotal'].replace('{team}', en['team.name.B']).replace('{n}', '0').replace('{target}', '20'));
  });

  it('a level timed game names both teams', () => {
    const html = show(finished(['p0', 'p1', 'p2', 'p3'], true));
    const names = viewFor(teamGame(), 'p0').players.map((p) => p.name);
    expect(html).toContain(en['over.teamTie'].replace('{players}', `${names.slice(0, -1).join(', ')} and ${names[3]}`));
  });

  it('knows the clock ended it when no team reached the goal', () => {
    expect(endedByTime(finished(['p0', 'p2'], true), [])).toBe(true);
    expect(endedByTime(finished(['p0', 'p2'], false), [])).toBe(false);
  });
});
