// Practice drills + scoring. Generators are pure (take an rng); storage is guarded.
import { R, buildTable } from '../core/table.js';
import { computeShot, isPathBlocked, FULLNESS_LABELS } from '../core/geometry.js';
import { simulate, createBall, DEFAULT_ELEVATION_DEG } from '../core/physics.js';
import { defaultTable, defaultCue } from '../core/equipment.js';
import { dist, rotate, rad } from '../core/vec.js';

export { FULLNESS_LABELS };

const STORE_KEY = 'bida9.stats.v1';

export function defaultStats() {
  return {
    thickness: { rounds: 0, correct: 0, streak: 0, best: 0 },
    position: { attempts: 0, success: 0, streak: 0, best: 0 },
    squirt: { attempts: 0, success: 0, streak: 0, best: 0 },
  };
}

export function loadStats() {
  const base = defaultStats();
  try {
    if (typeof localStorage === 'undefined') return base;
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return base;
    const s = JSON.parse(raw);
    return {
      thickness: { ...base.thickness, ...(s && s.thickness) },
      position: { ...base.position, ...(s && s.position) },
      squirt: { ...base.squirt, ...(s && s.squirt) },
    };
  } catch (e) {
    return base;
  }
}

export function saveStats(stats) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORE_KEY, JSON.stringify(stats));
  } catch (e) {
    /* storage unavailable (private mode) - ignore */
  }
}

export function recordThickness(stats, correct) {
  const t = stats.thickness;
  t.rounds++;
  if (correct) {
    t.correct++;
    t.streak++;
    t.best = Math.max(t.best, t.streak);
  } else t.streak = 0;
  return stats;
}

export function recordPosition(stats, success) {
  const t = stats.position;
  t.attempts++;
  if (success) {
    t.success++;
    t.streak++;
    t.best = Math.max(t.best, t.streak);
  } else t.streak = 0;
  return stats;
}

export function recordSquirt(stats, success) {
  const t = stats.squirt;
  t.attempts++;
  if (success) {
    t.success++;
    t.streak++;
    t.best = Math.max(t.best, t.streak);
  } else t.streak = 0;
  return stats;
}

const randPos = (rng, geo, margin = 90) => ({
  x: margin + rng() * (geo.W - 2 * margin),
  y: margin + rng() * (geo.H - 2 * margin),
});

const inTable = (geo, p) => p.x >= R && p.x <= geo.W - R && p.y >= R && p.y <= geo.H - R;

const noMiscueRng = () => 0.5; // deterministic: miscue angle 0

/** Scenario: cue + object + pocket with cut 5..75 degrees. */
export function genThicknessDrill(rng = Math.random, tableProfile = defaultTable()) {
  const geo = buildTable(tableProfile);
  const POCKETS = geo.POCKETS;
  for (let i = 0; i < 2000; i++) {
    const cue = randPos(rng, geo);
    const obj = randPos(rng, geo);
    if (dist(cue, obj) < 350 || dist(cue, obj) > 1700) continue;
    const pocket = Math.floor(rng() * POCKETS.length);
    const pk = POCKETS[pocket];
    if (dist(obj, pk.aim) < 300) continue;
    const s = computeShot(cue, obj, pk.aim, R);
    if (s.cutAngleDeg < 5 || s.cutAngleDeg > 75) continue;
    if (!inTable(geo, s.ghost) || dist(cue, s.ghost) < 120) continue;
    const balls = [createBall(0, cue.x, cue.y), createBall(1, obj.x, obj.y)];
    if (isPathBlocked(obj, pk.aim, balls, R, [1]) !== null) continue;
    return { cue, obj, pocket, cutAngleDeg: s.cutAngleDeg, label: s.fullnessLabel, fullness: s.fullness };
  }
  // fallback: fixed scenario (30 degree cut into the top-left corner)
  const cue = { x: geo.W * 0.55, y: geo.H * 0.55 };
  const obj = { x: geo.W * 0.28, y: geo.H * 0.4 };
  const s = computeShot(cue, obj, POCKETS[0].aim, R);
  return { cue, obj, pocket: 0, cutAngleDeg: s.cutAngleDeg, label: s.fullnessLabel, fullness: s.fullness };
}

export function answerThickness(scenario, label) {
  return {
    correct: label === scenario.label,
    truth: scenario.label,
    cutAngleDeg: scenario.cutAngleDeg,
    fullnessPct: Math.round(scenario.fullness * 100),
  };
}

/**
 * Position-play scenario: an easy pot plus a target circle (r = 150 mm).
 * The circle is centred near where a real (power, draw/follow) solution leaves the cue ball.
 */
export function genPositionDrill(rng = Math.random, eq = {}) {
  const tableProfile = eq.table || defaultTable();
  const cueProfile = eq.cue || defaultCue();
  const geo = buildTable(tableProfile);
  const POCKETS = geo.POCKETS;
  const maxTip = Math.min(0.5, cueProfile.miscueLimit * 0.9);
  for (let i = 0; i < 3000; i++) {
    const cue = randPos(rng, geo, 120);
    const obj = randPos(rng, geo, 120);
    const dco = dist(cue, obj);
    if (dco < 350 || dco > 1200) continue;
    const pocket = Math.floor(rng() * POCKETS.length);
    const pk = POCKETS[pocket];
    const dop = dist(obj, pk.aim);
    if (dop < 300 || dop > 1100) continue;
    const s = computeShot(cue, obj, pk.aim, R);
    if (s.cutAngleDeg > 35 || !inTable(geo, s.ghost)) continue;
    const balls = [createBall(0, cue.x, cue.y), createBall(1, obj.x, obj.y)];
    if (isPathBlocked(obj, pk.aim, balls, R, [1]) !== null) continue;
    const power = 0.12 + rng() * 0.2;
    const tipY = (rng() * 2 - 1) * maxTip;
    const r = simulate(
      balls,
      { aimDir: s.aimDir, power, tip: { x: 0, y: tipY }, elevationDeg: DEFAULT_ELEVATION_DEG },
      { recordPaths: false, maxTime: 20, table: tableProfile, cue: cueProfile, rng: noMiscueRng },
    );
    if (!r.events.potted.includes(1) || r.balls[0].potted || r.events.firstContact !== 1) continue;
    const end = r.balls[0].pos;
    const ang = rng() * Math.PI * 2;
    const off = rng() * 60;
    const zone = {
      x: Math.max(R, Math.min(geo.W - R, end.x + Math.cos(ang) * off)),
      y: Math.max(R, Math.min(geo.H - R, end.y + Math.sin(ang) * off)),
      r: 150,
    };
    return { cue, obj, pocket, zone, solution: { power, tipY } };
  }
  const cue = { x: geo.W * 0.35, y: geo.H * 0.55 };
  const obj = { x: geo.W * 0.2, y: geo.H * 0.35 };
  return { cue, obj, pocket: 0, zone: { x: geo.W * 0.27, y: geo.H * 0.47, r: 150 }, solution: { power: 0.2, tipY: 0 } };
}

/**
 * Squirt-compensation scenario: a cut shot that must be played with side spin.
 * `offsetDeg` is the aim offset (same sign convention as the app slider: aimDir rotated by +offset)
 * that cancels the squirt of the given cue; the object ball is potted with that offset.
 */
export function genSquirtDrill(rng = Math.random, eq = {}) {
  const tableProfile = eq.table || defaultTable();
  const cueProfile = eq.cue || defaultCue();
  const geo = buildTable(tableProfile);
  const POCKETS = geo.POCKETS;
  const maxTip = Math.min(0.5, cueProfile.miscueLimit * 0.9);
  const run = (balls, aimDir, power, tipX) =>
    simulate(
      balls,
      { aimDir, power, tip: { x: tipX, y: 0 }, elevationDeg: DEFAULT_ELEVATION_DEG },
      { recordPaths: false, maxTime: 8, table: tableProfile, cue: cueProfile, rng: noMiscueRng },
    );
  for (let pass = 0; pass < 2; pass++) {
    const tries = pass === 0 ? 500 : 2500;
    for (let i = 0; i < tries; i++) {
      const cue = randPos(rng, geo, 120);
      const obj = randPos(rng, geo, 120);
      const dco = dist(cue, obj);
      if (dco < 450 || dco > 1500) continue;
      const pocket = Math.floor(rng() * POCKETS.length);
      const pk = POCKETS[pocket];
      const dop = dist(obj, pk.aim);
      if (dop < 300 || dop > 1100) continue;
      const s = computeShot(cue, obj, pk.aim, R);
      if (s.cutAngleDeg > 40 || !inTable(geo, s.ghost)) continue;
      const balls = [createBall(0, cue.x, cue.y), createBall(1, obj.x, obj.y)];
      if (isPathBlocked(obj, pk.aim, balls, R, [1]) !== null) continue;
      const tipX = (rng() < 0.5 ? -1 : 1) * (0.6 + 0.4 * rng()) * maxTip;
      const power = 0.18 + rng() * 0.1;
      const offsetDeg = cueProfile.squirtDegPerFullSide * tipX;
      const solved = run(balls, rotate(s.aimDir, rad(offsetDeg)), power, tipX);
      if (!solved.events.potted.includes(1) || solved.balls[0].potted || solved.events.firstContact !== 1) continue;
      if (pass === 0) {
        const naive = run(balls, s.aimDir, power, tipX);
        if (naive.events.potted.includes(1)) continue; // prefer shots where ignoring squirt misses
      }
      return { cue, obj, pocket, tipX, power, offsetDeg, squirtDeg: Math.abs(offsetDeg), cutAngleDeg: s.cutAngleDeg };
    }
  }
  const cue = { x: geo.W * 0.4, y: geo.H * 0.55 };
  const obj = { x: geo.W * 0.22, y: geo.H * 0.35 };
  const tipX = 0.4;
  return { cue, obj, pocket: 0, tipX, power: 0.2, offsetDeg: cueProfile.squirtDegPerFullSide * tipX, squirtDeg: cueProfile.squirtDegPerFullSide * tipX, cutAngleDeg: 0 };
}

/** Squirt drill is scored purely by potting the object ball without scratching. */
export function evaluateSquirt(result) {
  const cue = result.balls.find((b) => b.id === 0);
  const objPotted = result.events.potted.includes(1);
  const cuePotted = !!cue.potted;
  return { success: objPotted && !cuePotted, objPotted, cuePotted };
}

/** result = simulate()-like { balls, events }. */
export function evaluatePosition(result, scenario) {
  const cue = result.balls.find((b) => b.id === 0);
  const potted = result.events.potted;
  const objPotted = potted.includes(1);
  const cuePotted = !!cue.potted;
  const d = cuePotted ? Infinity : dist(cue.pos, scenario.zone);
  const inZone = d <= scenario.zone.r;
  return { success: objPotted && !cuePotted && inZone, objPotted, cuePotted, inZone, distance: d };
}
