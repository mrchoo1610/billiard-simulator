// Bot strength benchmark (9-ball), reproducible: Math.random is replaced by a seeded PRNG.
//  1) solo: each difficulty plays racks alone (every turn is its own) -> pot / foul / scratch rates, run-outs
//  2) h2h:  adjacent difficulties play each other (breaker alternates) -> win rate of the stronger bot
// Usage: node scripts/bot-benchmark.mjs [--racks 200] [--seed 1] [--out tmp/bot-benchmark.json]
//        [--levels easy,medium,...] [--no-h2h]   (solo stats include fouls counted per reason)
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const RACKS = Number(arg('racks', 200));
const SEED = Number(arg('seed', 1));
const OUT = arg('out', 'tmp/bot-benchmark.json');

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = mulberry32(SEED);

const { R, buildTable } = await import('../src/core/table.js');
const { defaultTable, defaultCue } = await import('../src/core/equipment.js');
const { createBall, simulate } = await import('../src/core/physics.js');
const { chooseBotShot, placeCueBallForBot, evaluateNineBallTurn, lowestBallId } = await import('../src/features/bot.js');

const TABLE = defaultTable();
const GEO = buildTable(TABLE);
const EQ = { table: TABLE, cue: defaultCue() };
const LEVELS = arg('levels', 'easy,medium,hard,pro,hero').split(',');
const H2H = !process.argv.includes('--no-h2h');
const MAX_SHOTS = 80;
const STUCK_STREAK = 8; // a rack with this many consecutive fouls is reported as "stuck"

function rack() {
  const d = 2 * R + 0.3;
  const dx = (d * Math.sqrt(3)) / 2;
  const spots = [];
  [1, 2, 3, 2, 1].forEach((n, k) => {
    for (let j = 0; j < n; j++) spots.push({ x: GEO.FOOT_SPOT.x + k * dx, y: GEO.FOOT_SPOT.y + (j - (n - 1) / 2) * d });
  });
  const rest = [2, 3, 4, 5, 6, 7, 8].sort(() => Math.random() - 0.5);
  const list = [createBall(1, spots[0].x, spots[0].y), createBall(9, spots[4].x, spots[4].y)];
  [1, 2, 3, 5, 6, 7, 8].forEach((si, i) => list.push(createBall(rest[i], spots[si].x, spots[si].y)));
  list.push(createBall(0, GEO.HEAD_SPOT.x - 100, GEO.HEAD_SPOT.y));
  return list;
}

const newStats = () => ({ shots: 0, potShots: 0, fouls: 0, scratches: 0, breaks: 0, breakPots: 0, reasons: {} });

/** Plays one rack. players = { A: level, B: level }; returns winner key and per-player stats. */
function playRack(players, breaker) {
  let balls = rack();
  let turn = breaker;
  let onBreak = true;
  let ballInHand = false;
  let winner = null;
  const stats = { A: newStats(), B: newStats() };
  let missOrFoul = false; // for run-out from the break
  let shots = 0;
  let streak = 0; // consecutive fouls
  let stuck = null; // first layout of a >= STUCK_STREAK foul streak (for reproduction)
  let streakStart = null;
  while (!winner && shots < MAX_SHOTS) {
    shots++;
    const target = lowestBallId(balls);
    if (target === null) {
      winner = turn;
      break;
    }
    if (ballInHand) {
      const p = placeCueBallForBot(balls, target, GEO, EQ, onBreak);
      let cue = balls.find((b) => b.id === 0);
      if (!cue) balls.push((cue = createBall(0, p.x, p.y)));
      cue.pos = { x: p.x, y: p.y };
      cue.potted = false;
      cue.vel = { x: 0, y: 0 };
      cue.w = { x: 0, y: 0, z: 0 };
      ballInHand = false;
    }
    const before = balls.map((b) => ({ ...b, pos: { ...b.pos } }));
    const shot = chooseBotShot(balls, GEO, EQ, players[turn], { game: '9ball', onBreak });
    const sim = simulate(balls, { aimDir: shot.aimDir, power: shot.power, tip: shot.tip, elevationDeg: shot.elevationDeg }, { table: TABLE, cue: EQ.cue, rng: Math.random, orientation: false });
    const ev = evaluateNineBallTurn({ ballsBefore: before, simBalls: sim.balls, events: sim.events, geo: GEO });
    balls = sim.balls;
    const st = stats[turn];
    if (onBreak) {
      st.breaks++;
      if (ev.pottedObj.length) st.breakPots++;
    } else {
      st.shots++;
      if (ev.pottedObj.length) st.potShots++;
      if (ev.foul) st.fouls++;
      if (ev.foul && ev.cuePotted) st.scratches++;
      if (ev.foul) {
        const key = ev.foulReason.replace(/\s*\(phải đánh bi \d+\)/, '');
        st.reasons[key] = (st.reasons[key] || 0) + 1;
      }
    }
    if (ev.foul || (!ev.keepTurn && !ev.winRack)) missOrFoul = true;
    if (ev.foul && !onBreak) {
      if (streak === 0) {
        streakStart = {
          level: players[turn],
          balls: before.filter((b) => !b.potted).map((b) => ({ id: b.id, x: +b.pos.x.toFixed(2), y: +b.pos.y.toFixed(2) })),
          shot: { aimDir: shot.aimDir, power: shot.power, tip: shot.tip, elevationDeg: shot.elevationDeg, kind: shot.kind },
          reason: ev.foulReason,
        };
      }
      streak++;
      if (streak === STUCK_STREAK && !stuck) stuck = streakStart;
    } else streak = 0;
    onBreak = false;
    if (ev.respotNine && ev.respotPos) {
      let b9 = balls.find((b) => b.id === 9);
      if (!b9) balls.push((b9 = createBall(9, ev.respotPos.x, ev.respotPos.y)));
      b9.pos = { ...ev.respotPos };
      b9.potted = false;
    }
    if (ev.winRack) winner = turn;
    else if (ev.foul) {
      turn = turn === 'A' ? 'B' : 'A';
      ballInHand = true;
    } else if (!ev.keepTurn) turn = turn === 'A' ? 'B' : 'A';
  }
  return { winner, stats, shots, runOut: !!winner && winner === breaker && !missOrFoul, capped: !winner, stuck };
}

const pct = (a, b) => (b ? (100 * a) / b : 0);
const results = { seed: SEED, racks: RACKS, solo: {}, h2h: [] };
const t0 = performance.now();

for (const lv of LEVELS) {
  const agg = newStats();
  let cleared = 0;
  let runOuts = 0;
  let shotsToClear = 0;
  const stuckRacks = [];
  for (let r = 0; r < RACKS; r++) {
    const res = playRack({ A: lv, B: lv }, 'A');
    for (const k of Object.keys(agg)) {
      if (k === 'reasons') {
        for (const s of [res.stats.A, res.stats.B]) for (const [rk, n] of Object.entries(s.reasons)) agg.reasons[rk] = (agg.reasons[rk] || 0) + n;
      } else agg[k] += res.stats.A[k] + res.stats.B[k];
    }
    if (!res.capped) {
      cleared++;
      shotsToClear += res.shots;
    }
    if (res.runOut) runOuts++;
    if (res.stuck) stuckRacks.push({ rack: r, ...res.stuck });
  }
  results.solo[lv] = {
    potRate: pct(agg.potShots, agg.shots),
    foulRate: pct(agg.fouls, agg.shots),
    scratchRate: pct(agg.scratches, agg.shots),
    breakPotRate: pct(agg.breakPots, agg.breaks),
    runOutRate: pct(runOuts, RACKS),
    avgShotsToClear: cleared ? shotsToClear / cleared : null,
    shots: agg.shots,
    stuckRacks,
    foulReasons: Object.fromEntries(Object.entries(agg.reasons).map(([k, n]) => [k, pct(n, agg.shots)])),
  };
  console.log(`solo ${lv.padEnd(6)} pot ${results.solo[lv].potRate.toFixed(1)}%  foul ${results.solo[lv].foulRate.toFixed(1)}%  scratch ${results.solo[lv].scratchRate.toFixed(1)}%  run-out ${results.solo[lv].runOutRate.toFixed(1)}%`);
}

for (let i = 0; H2H && i + 1 < LEVELS.length; i++) {
  const strong = LEVELS[i + 1];
  const weak = LEVELS[i];
  let wins = 0;
  for (let r = 0; r < RACKS; r++) {
    const res = playRack({ A: strong, B: weak }, r % 2 ? 'B' : 'A');
    if (res.winner === 'A') wins++;
  }
  results.h2h.push({ strong, weak, winRate: pct(wins, RACKS) });
  console.log(`h2h ${strong} vs ${weak}: ${pct(wins, RACKS).toFixed(1)}%`);
}

results.cpuSec = (performance.now() - t0) / 1000;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(`done in ${results.cpuSec.toFixed(0)} s -> ${OUT}`);
