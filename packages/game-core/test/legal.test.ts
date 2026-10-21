import { describe, expect, it } from 'vitest';
import { applyAction, createGame, legalMovesFor, validate, type GameState } from '../src';
import { chooseWeighted, moves } from '../sim/bot';
import { mulberry32 } from '../sim/rng';

function* states(seed: number, n: number): Generator<GameState> {
  const rng = mulberry32(seed);
  const created = createGame({ players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, role: ['soldier', 'sage', 'sailor', 'diplomat', 'harvester'][i] })), mode: 'short' }, rng);
  if (!created.ok) throw new Error('create');
  let s = created.state;
  let actions = 0;
  let turn = s.turn;
  for (let i = 0; i < 400 && s.phase !== 'finished'; i++) {
    yield s;
    const m = chooseWeighted(moves(s, rng, actions), rng);
    const r = applyAction(s, m.pid, m.action, rng);
    if (!r.ok) throw new Error('move refused');
    s = r.state;
    if (s.turn !== turn) { turn = s.turn; actions = 0; } else actions++;
  }
}

describe('legalMovesFor', () => {
  it('lists only moves the validator accepts, for every player at every step, and nothing out of turn', () => {
    const phases = new Set<string>();
    for (const seed of [1, 2, 3]) {
      for (const s of states(seed, 3)) {
        phases.add(s.phase);
        for (const p of s.players) {
          const l = legalMovesFor(s, p.id);
          for (const v of l.settlements) expect(validate(s, p.id, { type: 'placeSettlement', vertex: v })).toBeNull();
          for (const v of l.cities) expect(validate(s, p.id, { type: 'upgradeCity', vertex: v })).toBeNull();
          for (const e of l.roads) expect(validate(s, p.id, { type: 'placeRoad', edge: e })).toBeNull();
          for (const t of l.robberTiles) expect(validate(s, p.id, { type: 'moveRobber', tile: t })).toBeNull();
          for (const a of [...l.devPlays, ...l.roleActions, ...l.bankTrades.map((t) => ({ type: 'bankTrade' as const, ...t }))]) expect(validate(s, p.id, a)).toBeNull();
          for (const k of Object.keys(l.roadOpenings)) expect(l.roads).toContain(Number(k));
          for (const v of l.settlements) expect(l.settlementSites).toContain(v);
          for (const v of l.cities) expect(l.citySites).toContain(v);
          expect(l.canRoll).toBe(validate(s, p.id, { type: 'roll' }) === null);
          if (s.phase === 'discard') expect(l.mustDiscard).toBe(s.pendingDiscards[p.id] ?? 0);
          else expect(l.mustDiscard).toBe(0);
          if (p.id !== s.current && s.phase !== 'discard') {
            expect(l.canRoll || l.canEndTurn || l.canBuyDevCard || l.settlements.length || l.roads.length || l.cities.length).toBeFalsy();
          }
        }
      }
    }
    expect([...phases]).toEqual(expect.arrayContaining(['setup', 'roll', 'main']));
  });

  it('marks roads that open new settlement sites', () => {
    let found = false;
    for (const s of states(4, 2)) {
      const l = legalMovesFor(s, s.current);
      if (Object.keys(l.roadOpenings).length) found = true;
    }
    expect(found).toBe(true);
  });
});
