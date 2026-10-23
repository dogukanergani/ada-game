/**
 * Role balance report: bots play many games; roles are spread evenly over the
 * games (least-played roles are picked first), and the win rate is computed per
 * game played, overall and for each player count. Everyone at the table plays
 * the same kind of bot: `random` (legal moves at random) or `greedy` (builds
 * cities, settlements and cards, trades surplus, demolishes with the Soldier, robs the leader).
 *
 *   npm run balance                       (random and greedy, 300 games per player count and mode)
 *   npm run balance -- --bot=greedy --games=300 --seed=7
 *   npm run balance -- --compact          (only the overall and per-player-count win rates)
 *   npm run balance -- --costs="settlement=ore:1,wool:1,grain:1/city=ore:2,wool:2,grain:2"
 *                                         (measure a candidate demolition price list without changing it in the code:
 *                                          kinds are separated by /, a kind not named keeps its price)
 */
import { DEMOLISH_COSTS, RESOURCES, type Hand } from '../src';
import { MAX_STEPS, ROLE_IDS, gap, measure, type DemolitionStats, type MoveFn, type RoleTally } from '../sim/balance';
import { moves as randomMoves } from '../sim/bot';
import { greedyMoves } from '../sim/greedy';

const arg = (name: string, fallback: number): number => {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? Number(m.split('=')[1]) : fallback;
};
const strArg = (name: string, fallback: string): string => {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? m.split('=')[1] : fallback;
};
const GAMES = arg('games', 300);
const SEED = arg('seed', 1);
const COMPACT = process.argv.includes('--compact');

/** `--costs=...`: the prices to measure, in place of DEMOLISH_COSTS for this run only (the table in the code is not touched). */
const COSTS_ARG = process.argv.find((a) => a.startsWith('--costs='))?.slice('--costs='.length);
if (COSTS_ARG) {
  for (const part of COSTS_ARG.split('/')) {
    const [kind, list] = part.split('=');
    if (kind !== 'road' && kind !== 'settlement' && kind !== 'city') throw new Error(`--costs: unknown piece "${kind}"`);
    const hand: Hand = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
    for (const item of (list ?? '').split(',').filter(Boolean)) {
      const [r, n] = item.split(':');
      if (!(RESOURCES as readonly string[]).includes(r) || !Number.isInteger(Number(n)) || Number(n) < 0) throw new Error(`--costs: bad item "${item}"`);
      hand[r as keyof Hand] = Number(n);
    }
    DEMOLISH_COSTS[kind] = hand;
  }
}

const BOTS: Record<string, MoveFn> = { random: randomMoves, greedy: greedyMoves };
const botArg = strArg('bot', 'both');
const botNames = botArg === 'both' ? Object.keys(BOTS) : [botArg];
for (const b of botNames) if (!BOTS[b]) throw new Error(`unknown bot ${b}`);

const roles = ROLE_IDS;

/** Rough 95% noise of one win-rate cell, in percentage points, from how many games each role played in it. */
function noise(t: RoleTally): number {
  const cells = ROLE_IDS.map((r) => t[r]).filter((x) => x.played > 0);
  const played = cells.reduce((a, x) => a + x.played, 0) / cells.length;
  const p = cells.reduce((a, x) => a + x.expected / x.played, 0) / cells.length;
  return 196 * Math.sqrt((p * (1 - p)) / played);
}

const ratio = (a: number, b: number) => (b ? a / b : NaN);
function printDemolitions(title: string, c: DemolitionStats) {
  const rate = (x: { played: number; won: number }) => (x.played ? `${pct(x.won / x.played)} of ${x.played}` : '-');
  console.log(`
${title}`);
  console.log(
    `  demolitions per game: ${ratio(c.demolitions, c.games).toFixed(2)}   by the soldier per soldier game: ${ratio(c.soldierDemolitions, c.soldierGames).toFixed(2)}
` +
      `  soldier main-phase turns: ${c.soldierMainTurns}; a demolition was affordable and legal in ${pct(ratio(c.soldierTurnsDemolishLegal, c.soldierMainTurns))} of them (a city or settlement target in ${pct(ratio(c.soldierTurnsBigTargetLegal, c.soldierMainTurns))}); ore in hand at those turns: ${ratio(c.soldierOreAtTurnStart, c.soldierMainTurns).toFixed(1)} on average
` +
      `  soldier win rate in games where it demolished: ${rate(c.demolished)}; where it did not: ${rate(c.notDemolished)}`,
  );
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
function print(title: string, t: RoleTally) {
  console.log(`\n${title}`);
  console.log('role        played   won   win rate   expected   won/expected');
  for (const r of roles) {
    const x = t[r];
    console.log(
      `${r.padEnd(11)} ${String(x.played).padStart(6)} ${String(x.won).padStart(5)}   ${pct(x.won / x.played).padStart(8)}   ${pct(x.expected / x.played).padStart(8)}   ${(x.won / x.expected).toFixed(2).padStart(12)}`,
    );
  }
}

console.log(
  `Balance report: ${GAMES} games per player count and mode, seed ${SEED}. Win rate = wins / games played. Expected = what equal skill would give (1 / player count).`,
);
const costText = (h: Hand) => RESOURCES.filter((r) => h[r] > 0).map((r) => `${h[r]} ${r}`).join(' + ');
console.log(`${COSTS_ARG ? 'CANDIDATE demolition costs (measured only, the code is not changed)' : 'Demolition costs (DEMOLISH_COSTS)'}: road ${costText(DEMOLISH_COSTS.road)}; settlement ${costText(DEMOLISH_COSTS.settlement)}; city ${costText(DEMOLISH_COSTS.city)}.`);

for (const botName of botNames) {
  const { overall, byCount, byMode, unfinished, unfinishedGames, demolitionStats, allDemolitionStats } = measure(BOTS[botName], GAMES, SEED);
  console.log(`\n=================== ${botName} bots ===================`);
  print('All games', overall);
  for (let n = 2; n <= 5; n++) print(n + ' players', byCount[n]);
  if (!COMPACT) {
    print('Standard mode', byMode.standard);
    print('Short mode', byMode.short);
  }
  printDemolitions('Soldier demolitions (all games)', allDemolitionStats);
  for (let n = 2; n <= 5; n++) printDemolitions(`Soldier demolitions, ${n} players`, demolitionStats[n]);
  console.log('\nSoldier win rate against the equal share (target: within +/-5 points of it):');
  const line = (label: string, t: RoleTally) => `  ${label.padEnd(12)} ${pct(t.soldier.won / t.soldier.played).padStart(6)} won, equal share ${pct(t.soldier.expected / t.soldier.played).padStart(6)}, gap ${gap(t.soldier) >= 0 ? '+' : ''}${gap(t.soldier).toFixed(1)} points  (noise +/-${noise(t).toFixed(1)})  ${Math.abs(gap(t.soldier)) <= 5 ? 'within the target' : 'OUTSIDE the target'}`;
  console.log(line('all games', overall));
  for (let n = 2; n <= 5; n++) console.log(line(`${n} players`, byCount[n]));
  const per = [2, 3, 4, 5].map((n) => `${n}p +/-${noise(byCount[n]).toFixed(1)}`).join(', ');
  console.log(
    `\nEstimated noise (95%, percentage points): all games +/-${noise(overall).toFixed(1)}; by player count ${per}; by mode +/-${noise(byMode.standard).toFixed(1)}.`,
  );
  console.log('Differences smaller than the noise are not evidence; a table with fewer games per cell is noisier than the all-games line.');
  console.log(`\nUnfinished games (step cap ${MAX_STEPS}, left out of the rates): ${unfinished}`);
  for (const g of unfinishedGames) console.log(`  seed ${g.seed}: ${g.players} players, ${g.mode} mode, roles ${g.roles.join('/')}, stopped in turn ${g.turn} (${g.phase})`);
}
