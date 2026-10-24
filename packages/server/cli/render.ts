import { topologyOf, type GameEvent, type GameView, type LegalMoves } from '@ada/game-core';
import type { LobbyView } from '@ada/protocol';

const short = (id: string) => id.slice(0, 4);
const handText = (h: Record<string, number> | null) =>
  h
    ? Object.entries(h)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k}:${n}`)
        .join(' ') || '(empty)'
    : '(hidden)';

export function renderLobby(l: LobbyView): string {
  const rows = l.players.map(
    (p) => `  ${p.host ? '*' : ' '} ${p.name} [${short(p.id)}] role=${p.role ?? '-'}${p.connected ? '' : ' (offline)'}${p.id === l.me ? ' <- you' : ''}`,
  );
  return `room ${l.code}  phase=${l.phase}  mode=${l.mode}  players ${l.players.length}/${l.maxPlayers}\n${rows.join('\n')}`;
}

export function renderState(v: GameView): string {
  const who = (id: string) => v.players.find((p) => p.id === id)?.name ?? short(id);
  const me = v.players.find((p) => p.id === v.me);
  const lines: string[] = [];
  lines.push(
    `phase=${v.phase}  turn=${v.turn}  to move: ${who(v.current)}${v.current === v.me ? ' (YOU)' : ''}  dice=${v.dice ? v.dice.join('+') : '-'}  target=${v.vpToWin} VP`,
  );
  if (v.phase === 'discard') lines.push(`must discard: ${Object.entries(v.pendingDiscards).map(([p, n]) => `${who(p)} ${n}`).join(', ')}`);
  if (v.phase === 'steal') lines.push(`steal from: ${v.stealFrom.map(who).join(', ')}`);
  if (v.phase === 'roadBuilding') lines.push(`free roads left: ${v.roadBuildingLeft}`);
  if (v.winners.length) lines.push(`WINNER: ${v.winners.map(who).join(' & ')}`);
  lines.push('');
  for (const p of v.players) {
    const own = Object.entries(v.buildings).filter(([, b]) => b.owner === p.id);
    const settlements = own.filter(([, b]) => b.kind === 'settlement').map(([id]) => id);
    const cities = own.filter(([, b]) => b.kind === 'city').map(([id]) => id);
    const roads = Object.entries(v.roads).filter(([, o]) => o === p.id).map(([id]) => id);
    lines.push(
      `${p.id === v.me ? '>' : ' '} ${p.name} [${short(p.id)}] ${p.role}  points=${p.points}${p.hiddenPoints ? `(+${p.hiddenPoints} hidden)` : ''}  cards=${p.handCount}  dev=${p.devCardCount}  knights=${p.knightsPlayed}` +
        `\n    settlements: ${settlements.join(',') || '-'}  cities: ${cities.join(',') || '-'}  roads: ${roads.join(',') || '-'}`,
    );
  }
  lines.push('');
  lines.push(`your hand: ${handText(me?.hand ?? null)}`);
  if (me?.devCards) lines.push(`your dev cards: ${me.devCards.map((c) => c.kind).join(', ') || '-'}`);
  lines.push(`bank: ${handText(v.bank)}   dev deck: ${v.devDeckCount}`);
  if (v.longestRoad.holder) lines.push(`longest road: ${who(v.longestRoad.holder)} (${v.longestRoad.length})`);
  if (v.largestArmy.holder) lines.push(`largest army: ${who(v.largestArmy.holder)} (${v.largestArmy.size})`);
  if (v.offers.length) {
    lines.push(`offers: ${v.offers.map((o) => `#${o.id} ${who(o.from)} gives ${handText(o.give)} wants ${handText(o.want)}`).join(' | ')}`);
  }
  return lines.join('\n');
}

/** Tiles by row with their corner vertex ids, then harbors, buildings and roads, so ids can be typed into settle / city / road. */
export function renderMap(v: GameView): string {
  const topo = topologyOf(v.map);
  const who = (id: string) => v.players.find((p) => p.id === id)?.name ?? short(id);
  const rows = new Map<number, string[]>();
  v.tiles.forEach((t, i) => {
    const tt = topo.tiles[i];
    const cell = `#${i} ${t.kind}${t.number ? ' ' + t.number : ''}${v.robber === i ? ' ROBBER' : ''} v[${tt.corners.join(',')}]`;
    rows.set(tt.r, [...(rows.get(tt.r) ?? []), cell]);
  });
  const lines = ['tiles (row by row; v[...] are the vertex ids around the tile):'];
  for (const r of [...rows.keys()].sort((a, b) => a - b)) lines.push(`  ${rows.get(r)!.join('   ')}`);
  lines.push('harbors: ' + (v.harbors.map((h) => `edge ${h.edge} (${topo.edges[h.edge].a}-${topo.edges[h.edge].b}) ${h.type}`).join('; ') || '-'));
  lines.push('buildings: ' + (Object.entries(v.buildings).map(([id, b]) => `${id}=${b.kind}/${who(b.owner)}`).join('  ') || '-'));
  lines.push(
    'roads: ' + (Object.entries(v.roads).map(([id, o]) => `${id}(${topo.edges[Number(id)].a}-${topo.edges[Number(id)].b})/${who(o)}`).join('  ') || '-'),
  );
  return lines.join('\n');
}

export function renderLegal(l: LegalMoves): string {
  const parts: string[] = [`phase=${l.phase}`];
  if (l.mustDiscard) parts.push(`discard ${l.mustDiscard} cards`);
  if (l.canRoll) parts.push('roll');
  if (l.settlements.length) parts.push(`settle: ${l.settlements.join(',')}`);
  if (l.cities.length) parts.push(`city: ${l.cities.join(',')}`);
  if (l.roads.length) {
    const open = Object.keys(l.roadOpenings);
    parts.push(`road: ${l.roads.join(',')}${open.length ? `  (open new sites: ${open.join(',')})` : ''}`);
  }
  if (l.canBuyDevCard) parts.push('buy');
  if (l.robberTiles.length) parts.push(`robber: ${l.robberTiles.join(',')}`);
  if (l.stealVictims.length) parts.push(`steal: ${l.stealVictims.map((p) => p.slice(0, 4)).join(',')}`);
  if (l.bankTrades.length) parts.push(`bank: ${l.bankTrades.map((t) => `${t.give}>${t.get}`).join(' ')}`);
  if (l.devPlays.length) parts.push(`cards: ${l.devPlays.map((a) => JSON.stringify(a)).join(' ')}`);
  if (l.roleActions.length) parts.push(`role actions: ${l.roleActions.map((a) => JSON.stringify((a as { params?: unknown }).params)).join(' ')}`);
  if (l.acceptableOffers.length) parts.push(`accept: ${l.acceptableOffers.join(',')}`);
  if (l.canEndTurn) parts.push('end');
  return parts.join('\n  ');
}

export const renderEvent = (e: GameEvent): string => {
  const { type, ...rest } = e as GameEvent & Record<string, unknown>;
  return `${type} ${JSON.stringify(rest)}`;
};
