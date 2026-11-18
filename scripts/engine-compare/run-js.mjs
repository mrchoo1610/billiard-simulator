// Runs every shot in shots.json through the app engine (src/core/physics.js) and writes sampled trajectories.
// Usage: node scripts/engine-compare/run-js.mjs [out=tmp/engine-compare/js.json]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { R } from '../../src/core/table.js';
import { Sim, createBall } from '../../src/core/physics.js';
import { tablePreset, tableDims } from '../../src/core/equipment.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const spec = JSON.parse(readFileSync(join(here, 'shots.json'), 'utf8'));
const out = process.argv[2] || join(root, 'tmp', 'engine-compare', 'js.json');
const table = tablePreset(spec.table);
const { W, H } = tableDims(table);

/** Cue-ball initial state from the shared shot description (app frame, z down: rolling +x has w.y = -v/R). */
export function cueState(c) {
  const a = (c.angleDeg * Math.PI) / 180;
  const vel = { x: c.speed * Math.cos(a), y: c.speed * Math.sin(a) };
  const w = { x: (c.topspin * vel.y) / R, y: (-c.topspin * vel.x) / R, z: -c.side / R };
  return { vel, w };
}

function runShot(shot) {
  const balls = shot.balls.map((b) => createBall(b.id, b.x, b.y));
  const sim = new Sim(balls, { table, rng: () => 0.5, orientation: false });
  const cue = sim.balls.find((b) => b.id === 0);
  Object.assign(cue, cueState(shot.cue));
  cue.sliding = true;

  const samples = [];
  const snap = () =>
    samples.push({ t: +sim.time.toFixed(4), balls: sim.balls.map((b) => ({ id: b.id, x: b.pos.x, y: b.pos.y, potted: b.potted })) });
  snap();
  while (sim.isMoving() && sim.time < spec.maxTime) {
    sim.step(spec.sampleDt);
    snap();
  }
  const ev = sim.events;
  return {
    id: shot.id,
    duration: sim.time,
    samples,
    events: {
      contacts: ev.contacts.map((c) => ({ a: c.a, b: c.b, t: c.time })),
      cushions: ev.cushionHits.map((c) => ({ id: c.id, t: c.time, wall: c.wall })),
      potted: ev.potted,
    },
  };
}

const result = { engine: 'app', table: { id: spec.table, W, H, ...table }, R, shots: spec.shots.map(runShot) };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result));
console.log(`app engine: ${result.shots.length} shots -> ${out}`);
