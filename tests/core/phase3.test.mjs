import test from 'node:test';
import assert from 'node:assert/strict';
import { R, buildTable } from '../../src/core/table.js';
import { computeShot } from '../../src/core/geometry.js';
import { createBall, createSim, simulate, Sim, integrateQuat, rotateByQuat, quatLength, quatIdentity } from '../../src/core/physics.js';
import { solveAim } from '../../src/core/aim-solver.js';
import { defaultTable, cuePreset } from '../../src/core/equipment.js';
import { rad, deg } from '../../src/core/vec.js';

const TABLE = defaultTable();
const GEO = buildTable(TABLE);
const STD = cuePreset('standard');
const near = (a, b, eps) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b} (eps ${eps})`);

/** Cue-ball positions (sampled every ~16 ms) until it nears a cushion. */
function cueTrack(tip, elevationDeg, cue = STD) {
  const sim = createSim([createBall(0, 300, 635)], { cue, orientation: false });
  const launch = sim.strike({ aimDir: { x: 1, y: 0 }, power: 0.15, tip, elevationDeg });
  const pts = [];
  while (sim.isMoving() && sim.balls[0].pos.x < GEO.W - 150) {
    sim.step(1 / 60);
    pts.push({ x: sim.balls[0].pos.x, y: sim.balls[0].pos.y });
  }
  return { launch, pts, start: { x: 300, y: 635 } };
}
const lateral = (t) => t.pts.map((p) => (p.y - t.start.y) * t.launch.dir.x - (p.x - t.start.x) * t.launch.dir.y);

test('swerve: elevation + right english curves the cue ball to the right of its launch line; level cue stays straight', () => {
  const lvl = lateral(cueTrack({ x: 0.5, y: 0 }, 0));
  assert.ok(Math.max(...lvl.map(Math.abs)) < 0.5, 'level cue: straight line along the squirted launch direction');
  const up = lateral(cueTrack({ x: 0.5, y: 0 }, 15));
  assert.ok(up.length > 20);
  assert.ok(up[up.length - 1] > 10, `final deviation ${up[up.length - 1]}`);
  for (let i = 5; i < up.length; i++) assert.ok(up[i] >= up[i - 1] - 0.05, 'deviation grows over time');
  const left = lateral(cueTrack({ x: -0.5, y: 0 }, 15));
  assert.ok(left[left.length - 1] < -10);
});

/** Stun cut of `cutDeg`: heading of the object ball (deg) and the line of centres at contact (deg). */
function cutShot(cutDeg, cutSign = 1) {
  const th = rad(cutDeg * cutSign);
  const objDir = { x: Math.cos(th), y: Math.sin(th) };
  const obj = { x: 1000, y: 635 };
  const ghost = { x: obj.x - objDir.x * 2 * R, y: obj.y - objDir.y * 2 * R };
  const cue = { x: ghost.x - 400, y: ghost.y };
  const sim = new Sim([createBall(0, cue.x, cue.y), createBall(1, obj.x, obj.y)], { orientation: false });
  sim.strike({ aimDir: { x: 1, y: 0 }, power: 0.2, tip: { x: 0, y: 0 }, elevationDeg: 0 });
  assert.equal(sim.runToContact(), 1);
  const o = sim.balls[1];
  const ev = sim.events;
  const centres = deg(Math.atan2(ev.firstContactObjPos.y - ev.firstContactPos.y, ev.firstContactObjPos.x - ev.firstContactPos.x));
  return { heading: deg(Math.atan2(o.vel.y, o.vel.x)), centres };
}

test('throw: stun 30 degree cut throws the object ball 0.5-4 deg towards the cue ball travel direction', () => {
  for (const sign of [1, -1]) {
    const { heading, centres } = cutShot(30, sign);
    const diff = (heading - centres) * sign; // negative = rotated towards the aim line
    assert.ok(diff < -0.5 && diff > -4, `throw ${diff}`);
  }
});

test('throw: left english on a straight-on hit throws the object ball right, right english throws it left', () => {
  const noSquirt = { ...STD, squirtDegPerFullSide: 0 };
  const run = (tipX) => {
    const sim = new Sim([createBall(0, 400, 635), createBall(1, 1000, 635)], { cue: noSquirt, orientation: false });
    sim.strike({ aimDir: { x: 1, y: 0 }, power: 0.2, tip: { x: tipX, y: 0 }, elevationDeg: 0 });
    sim.runToContact();
    const o = sim.balls[1];
    return deg(Math.atan2(o.vel.y, o.vel.x));
  };
  const leftEng = run(-0.5); // +y = right of the aim direction
  const rightEng = run(0.5);
  assert.ok(leftEng > 0.5, `left english -> thrown right (+y): ${leftEng}`);
  assert.ok(rightEng < -0.5, `right english -> thrown left (-y): ${rightEng}`);
  near(leftEng, -rightEng, 0.3);
});

test('auto aim: ghost aim misses with english + elevation, solveAim pots the ball', () => {
  const cue = createBall(0, 700, 900);
  const obj = createBall(1, 1500, 400);
  const balls = [cue, obj];
  const pk = GEO.POCKETS[1]; // top-right corner
  // power 0.5 (was 0.25): with speed-dependent throw the slow shot's uncompensated aim happens to pot this layout
  const shot = { power: 0.5, tip: { x: 0.5, y: 0 }, elevationDeg: 5 };
  const ghost = computeShot(cue.pos, obj.pos, pk.aim, R);
  const plain = simulate(balls, { aimDir: ghost.aimDir, ...shot }, { cue: STD, rng: () => 0.5 });
  assert.ok(!plain.events.potted.includes(1), 'uncompensated aim misses');
  const sol = solveAim(balls, 1, pk.aim, shot, TABLE, STD);
  assert.ok(sol.ok, JSON.stringify({ r: sol.reason, res: sol.residualDeg }));
  assert.ok(Math.abs(sol.correctionDeg) > 0.2, `correction ${sol.correctionDeg}`);
  assert.ok(sol.probes <= 40);
  const r = simulate(balls, { aimDir: sol.aimDir, ...shot }, { cue: STD, rng: () => 0.5 });
  assert.equal(r.events.firstContact, 1);
  assert.ok(r.events.potted.includes(1), 'compensated aim pots');
  assert.ok(sol.parts && Number.isFinite(sol.parts.squirt + sol.parts.swerve + sol.parts.throw));
  const bad = solveAim([cue, createBall(1, 700, 100)], 1, pk.aim, { power: 0.25, tip: { x: 0, y: 0 } }, TABLE, STD);
  assert.equal(typeof bad.ok, 'boolean');
});

test('quaternion: unit length after 10 s of rolling; number disc advances by distance / R', () => {
  const sim = createSim([createBall(0, 200, 635)]);
  sim.strike({ aimDir: { x: 1, y: 0 }, power: 0.1, tip: { x: 0, y: 0.4 }, elevationDeg: 0 });
  for (let i = 0; i < 600 * 10; i++) {
    sim.substep();
    if (i % 100 === 0) near(quatLength(sim.balls[0].q), 1, 1e-12);
  }
  near(quatLength(sim.balls[0].q), 1, 1e-12);

  const q = quatIdentity();
  const v = 300;
  const w = { x: 0, y: -v / R, z: 0 };
  for (let i = 0; i < 120; i++) integrateQuat(q, w, 0.2 / 120);
  const n = rotateByQuat(q, { x: 0, y: 0, z: -1 }); // number disc axis (up)
  near(Math.acos(-n.z), (v * 0.2) / R, 1e-9);
  assert.ok(n.x > 0, 'the disc moves towards the rolling direction');

  // in the engine: ball struck to roll immediately; angle = travelled distance / R
  const s2 = createSim([createBall(0, 300, 635)], { cue: { ...STD, spinEfficiency: 1, squirtDegPerFullSide: 0 } });
  s2.strike({ aimDir: { x: 1, y: 0 }, power: 0.02, tip: { x: 0, y: 0.4 }, elevationDeg: 0 });
  const b = s2.balls[0];
  for (let i = 0; i < 30; i++) s2.substep();
  const up = rotateByQuat(b.q, { x: 0, y: 0, z: -1 });
  near(Math.acos(-up.z), (b.pos.x - 300) / R, 0.05);
});

test('3D spin model: tip positions give the expected spin signs; slide turns into 5/7 roll', () => {
  const top = createSim([createBall(0, 500, 635)]);
  top.strike({ aimDir: { x: 1, y: 0 }, power: 0.3, tip: { x: 0, y: 0.4 }, elevationDeg: 0 });
  assert.ok(top.balls[0].spin.x > 0 && top.balls[0].side === 0);
  const right = createSim([createBall(0, 500, 635)]);
  right.strike({ aimDir: { x: 1, y: 0 }, power: 0.3, tip: { x: 0.4, y: 0 }, elevationDeg: 0 });
  assert.ok(right.balls[0].side > 0);
  const stun = createSim([createBall(0, 300, 635)]);
  stun.strike({ aimDir: { x: 1, y: 0 }, power: 0.3, tip: { x: 0, y: 0 }, elevationDeg: 0 });
  const v0 = stun.balls[0].vel.x;
  while (stun.balls[0].sliding || stun.time === 0) stun.substep();
  near(stun.balls[0].vel.x, (5 / 7) * v0, v0 * 0.01);
});
