import test from 'node:test';
import assert from 'node:assert/strict';
import { R } from '../../src/core/table.js';
import { createBall, Sim, MU_BALL_A, MU_BALL_B, MU_BALL_C } from '../../src/core/physics.js';
import { defaultTable, cuePreset, BALL_MASS_G, sanitizeTable } from '../../src/core/equipment.js';
import { rad, deg } from '../../src/core/vec.js';

const STD = cuePreset('standard');
const FULL = { ...STD, squirtDegPerFullSide: 0, spinEfficiency: 1 }; // tip height 0.4 = natural roll
const near = (a, b, eps) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b} (eps ${eps})`);

/** Power slider value whose cue-ball launch speed (mm/s) is `v` for cue `c`. */
const powerFor = (v, c) => (v / (((1 + c.tipRestitution) * c.massG) / (c.massG + BALL_MASS_G)) - 500) / 8500;

/** Cut shot (object ball goes to +y by `cutDeg`), gap mm between the cue ball and the contact point. Returns throw (deg, >0 = away from the aim line). */
function throwOf({ cutDeg = 30, speed = 1000, tipY = 0, cue = FULL, table = defaultTable(), gap = 25 }) {
  const th = rad(cutDeg);
  const objDir = { x: Math.cos(th), y: Math.sin(th) };
  const obj = { x: 1000, y: 635 };
  const ghost = { x: obj.x - objDir.x * 2 * R, y: obj.y - objDir.y * 2 * R };
  const sim = new Sim([createBall(0, ghost.x - gap, ghost.y), createBall(1, obj.x, obj.y)], { cue, table, orientation: false });
  sim.strike({ aimDir: { x: 1, y: 0 }, power: powerFor(speed, cue), tip: { x: 0, y: tipY }, elevationDeg: 0 });
  assert.equal(sim.runToContact(), 1);
  const ev = sim.events;
  const centres = deg(Math.atan2(ev.firstContactObjPos.y - ev.firstContactPos.y, ev.firstContactObjPos.x - ev.firstContactPos.x));
  const o = sim.balls[1];
  return { throwDeg: -(deg(Math.atan2(o.vel.y, o.vel.x)) - centres), sim };
}

test('throw falls with speed: 5 m/s throws <= 0.6 x the 1 m/s throw (stun, 30 deg cut)', () => {
  const slow = throwOf({ speed: 1000 }).throwDeg;
  const fast = throwOf({ speed: 5000 }).throwDeg;
  assert.ok(slow > 0.5 && slow < 5, `slow throw ${slow}`);
  assert.ok(fast > 0 && fast <= 0.6 * slow, `fast ${fast} vs slow ${slow}`);
  const mid = throwOf({ speed: 2500 }).throwDeg;
  assert.ok(mid < slow && mid > fast, 'monotone in between');
});

test('throw falls when the cue ball rolls or is drawn: <= 0.8 x the stun throw at the same speed', () => {
  const stun = throwOf({ speed: 1800, tipY: 0 }).throwDeg;
  const roll = throwOf({ speed: 1800, tipY: 0.4 }).throwDeg;
  const draw = throwOf({ speed: 1800, tipY: -0.5 }).throwDeg;
  assert.ok(stun > 0.5, `stun ${stun}`);
  assert.ok(roll <= 0.8 * stun, `roll ${roll} vs stun ${stun}`);
  assert.ok(draw <= 0.8 * stun, `draw ${draw} vs stun ${stun}`);
});

test('ballFriction is a multiplier: 0 gives no throw, 2 gives more than 1', () => {
  const t = (k) => throwOf({ speed: 1000, table: { ...defaultTable(), ballFriction: k } }).throwDeg;
  near(t(0), 0, 0.02);
  assert.ok(t(2) > t(1) && t(1) > 0.5);
  assert.equal(defaultTable().ballFriction, 1);
  near(defaultTable().ballFrictionA, MU_BALL_A, 1e-12);
  near(defaultTable().ballFrictionB, MU_BALL_B, 1e-12);
  near(defaultTable().ballFrictionC, MU_BALL_C, 1e-12);
  assert.ok(sanitizeTable({ ballFrictionC: 99 }).ballFrictionC <= 3);
});

test('vertical slip alone (rolling ball, straight hit) does not push either ball sideways or hop', () => {
  const sim = new Sim([createBall(0, 700, 635), createBall(1, 1000, 635)], { cue: FULL, orientation: false });
  sim.strike({ aimDir: { x: 1, y: 0 }, power: 0.15, tip: { x: 0, y: 0.4 }, elevationDeg: 0 });
  sim.runToContact();
  for (const b of sim.balls) near(b.vel.y, 0, 1e-6);
  // the cue ball's top spin is rubbed down a little by the contact (full 3D angular impulse), never reversed
  const pre = sim.balls[0];
  assert.ok(pre.w.y < 0 && Math.abs(pre.w.y) * R < 1.01 * 2000, 'forward spin kept');
});

test('collision conserves horizontal linear momentum (friction is equal and opposite) and spins both balls', () => {
  const a = createBall(0, 500, 500);
  const b = createBall(1, 500 + 2 * R * Math.cos(0.2) - 0.01, 500 + 2 * R * Math.sin(0.2));
  a.vel = { x: 1500, y: 100 };
  a.w = { x: 5, y: -20, z: 30 };
  const sim = new Sim([a, b], { orientation: false });
  const [A, B] = sim.balls;
  sim._collide();
  const p = { x: A.vel.x + B.vel.x, y: A.vel.y + B.vel.y };
  near(p.x, 1500, 1e-6);
  near(p.y, 100, 1e-6);
  assert.ok(B.vel.x > 0 && (B.w.x !== 0 || B.w.y !== 0 || B.w.z !== 0), 'object ball hit and spun');
});
