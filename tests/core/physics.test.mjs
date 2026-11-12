import test from 'node:test';
import assert from 'node:assert/strict';
import { R, buildTable } from '../../src/core/table.js';
import { computeShot, isPathBlocked, bestPocket, firstHit } from '../../src/core/geometry.js';
import { createBall, createSim, simulate, computeLaunch, DT } from '../../src/core/physics.js';
import { tablePreset, cuePreset, defaultTable, defaultCue } from '../../src/core/equipment.js';

const GEO = buildTable(defaultTable());
const { W, H, POCKETS } = GEO;

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('straight-in shot: cut 0, fullness 1, ghost 2R behind object', () => {
  const s = computeShot({ x: 500, y: 635 }, { x: 1000, y: 635 }, { x: W, y: 635 }, R);
  near(s.cutAngleDeg, 0, 1e-6);
  near(s.fullness, 1, 1e-9);
  near(s.ghost.x, 1000 - 2 * R, 1e-9);
  near(s.ghost.y, 635, 1e-9);
  assert.equal(s.fullnessLabel, 'Đầy');
  assert.ok(s.possible);
});

test('30 degree cut gives half-ball fullness', () => {
  const th = (30 * Math.PI) / 180;
  const objDir = { x: Math.cos(th), y: Math.sin(th) };
  const obj = { x: 1000, y: 500 };
  const ghost = { x: obj.x - objDir.x * 2 * R, y: obj.y - objDir.y * 2 * R };
  const cue = { x: ghost.x - 500, y: ghost.y }; // aimDir = (1,0)
  const s = computeShot(cue, obj, { x: obj.x + objDir.x * 500, y: obj.y + objDir.y * 500 }, R);
  near(s.cutAngleDeg, 30, 1e-6);
  near(s.fullness, 0.5, 1e-9);
  assert.equal(s.fullnessLabel, '1/2');
  // stun line is perpendicular to the object line
  near(s.cueAfterStunDir.x * objDir.x + s.cueAfterStunDir.y * objDir.y, 0, 1e-9);
});

test('isPathBlocked / bestPocket', () => {
  const balls = [createBall(0, 500, 635), createBall(1, 1000, 635), createBall(2, 750, 640)];
  assert.equal(isPathBlocked({ x: 500, y: 635 }, { x: 1000 - 2 * R, y: 635 }, balls, R, [0, 1]), 2);
  assert.equal(isPathBlocked({ x: 500, y: 635 }, { x: 1000 - 2 * R, y: 635 }, balls, R, [0, 1, 2]), null);
  const idx = bestPocket(balls[0], balls[1], [balls[0], balls[1]], R, POCKETS);
  assert.ok(idx >= 0 && idx < POCKETS.length);
});

function lineShot(tip, power, gap = 400) {
  // cue and object on the horizontal centre line, object contact at x = objX - 2R
  const objX = 1200;
  const cue = createBall(0, objX - 2 * R - gap, H / 2);
  const obj = createBall(1, objX, H / 2);
  return { balls: [cue, obj], contactX: objX - 2 * R, objX, shot: { aimDir: { x: 1, y: 0 }, power, tip } };
}

test('stun shot (close range): cue ball stops near contact, object ball moves forward', () => {
  const { balls, contactX, objX, shot } = lineShot({ x: 0, y: 0 }, 0.14, 8);
  const sim = createSim(balls);
  sim.strike(shot);
  sim.run(0.2);
  const cue = sim.balls[0];
  const obj = sim.balls[1];
  assert.ok(obj.pos.x > objX + 100, 'object ball moved forward');
  sim.run(0.5); // before the object ball can rebound off the far rail
  assert.equal(cue.vel.x, 0);
  assert.equal(cue.vel.y, 0);
  assert.ok(Math.abs(cue.pos.x - contactX) < 40, `cue stayed near contact: ${cue.pos.x - contactX}`);
  assert.equal(sim.events.firstContact, 1);
  assert.ok(cue.pos.x < obj.pos.x);
});

test('draw shot: cue ball ends behind its collision point; follow ends ahead', () => {
  const draw = lineShot({ x: 0, y: -0.5 }, 0.2);
  const rd = simulate(draw.balls, draw.shot, { maxTime: 1.2 });
  const drawAt = rd.balls[0].pos.x;
  assert.ok(drawAt < draw.contactX - 20, `draw: ${drawAt} vs ${draw.contactX}`);

  const fol = lineShot({ x: 0, y: 0.5 }, 0.2);
  const rf = simulate(fol.balls, fol.shot, { maxTime: 1.2 });
  const folAt = rf.balls[0].pos.x;
  assert.ok(folAt > fol.contactX + 20, `follow: ${folAt} vs ${fol.contactX}`);
});

test('cushion bounces keep balls inside the table', () => {
  for (const deg of [7, 17, 33, 52, 71, 100, 130, 200, 250, 300]) {
    const a = (deg * Math.PI) / 180;
    const cue = createBall(0, 1300, 640);
    const sim = createSim([cue]);
    sim.strike({ aimDir: { x: Math.cos(a), y: Math.sin(a) }, power: 0.6, tip: { x: 0, y: 0 } });
    let steps = 0;
    while (sim.isMoving() && steps++ < 600 * 25) {
      sim.step(DT);
      const b = sim.balls[0];
      if (b.potted) break;
      assert.ok(b.pos.x >= -1 && b.pos.x <= W + 1 && b.pos.y >= -1 && b.pos.y <= H + 1, `outside at ${deg}`);
      // unless in a pocket opening, centre stays at least R from rails
      const inside = b.pos.x >= R - 1 && b.pos.x <= W - R + 1 && b.pos.y >= R - 1 && b.pos.y <= H - R + 1;
      const nearPocket = POCKETS.some((p) => Math.hypot(b.pos.x - p.x, b.pos.y - p.y) < 130);
      assert.ok(inside || nearPocket, `escaped rail at ${deg}: ${b.pos.x},${b.pos.y}`);
    }
  }
});

test('ball aimed directly into a corner pocket is potted', () => {
  const cue = createBall(0, 700, 700);
  const r = simulate([cue], { aimDir: { x: -1, y: -1 }, power: 0.25, tip: { x: 0, y: 0 } });
  assert.ok(r.balls[0].potted);
  assert.deepEqual(r.events.potted, [0]);
});

test('object ball potted into corner via straight shot', () => {
  const cue = createBall(0, 800, 800);
  const obj = createBall(1, 400, 400);
  const s = computeShot(cue, obj, POCKETS[0].aim, R);
  const r = simulate([cue, obj], { aimDir: s.aimDir, power: 0.28, tip: { x: 0, y: 0 } });
  assert.equal(r.events.firstContact, 1);
  assert.ok(r.events.potted.includes(1));
});

test('energy sanity: no speedup without collisions (centre ball, no english)', () => {
  for (const deg of [15, 40, 95, 160]) {
    for (const tipY of [0, -0.5]) {
      const a = (deg * Math.PI) / 180;
      const sim = createSim([createBall(0, 1300, 640)]);
      sim.strike({ aimDir: { x: Math.cos(a), y: Math.sin(a) }, power: 0.5, tip: { x: 0, y: tipY } });
      // with draw the ball may first slow then reverse; the speed still must not exceed the initial speed
      let prev = Math.hypot(sim.balls[0].vel.x, sim.balls[0].vel.y);
      const v0 = prev;
      let n = 0;
      while (sim.isMoving() && n++ < 600 * 20) {
        sim.step(DT);
        const b = sim.balls[0];
        const sp = Math.hypot(b.vel.x, b.vel.y);
        assert.ok(sp <= v0 + 1e-6, `exceeds initial speed ${sp} > ${v0}`);
        if (tipY === 0) assert.ok(sp <= prev + 1e-6, `speed increased ${prev} -> ${sp} (deg ${deg})`);
        prev = sp;
        if (b.potted) break;
      }
    }
  }
});

test('simulate does not mutate its input', () => {
  const cue = createBall(0, 600, 600);
  simulate([cue], { aimDir: { x: 1, y: 0 }, power: 0.5, tip: { x: 0, y: 0 } });
  assert.equal(cue.pos.x, 600);
  assert.equal(cue.vel.x, 0);
});

/* ------------------------------------------------------------------ phase 2: equipment */

const STD = cuePreset('standard');
const LD = cuePreset('low-deflection');

test('heavier cue gives a faster ball for the same stick speed', () => {
  const light = { ...STD, massG: 510 };
  const heavy = { ...STD, massG: 595 };
  const a = computeLaunch({ x: 1, y: 0 }, 0.5, { x: 0, y: 0 }, light);
  const b = computeLaunch({ x: 1, y: 0 }, 0.5, { x: 0, y: 0 }, heavy);
  assert.ok(b.speed > a.speed, `${b.speed} <= ${a.speed}`);
  // formula check: v = (1 + e) * m / (m + 170) * v_stick
  const c = computeLaunch({ x: 1, y: 0 }, 0.5, { x: 0, y: 0 }, STD);
  near(c.speed, ((1 + STD.tipRestitution) * STD.massG) / (STD.massG + 170) * c.stick, 1e-6);
});

test('low-deflection squirt is smaller than standard (carbon smaller still)', () => {
  const tip = { x: 0.5, y: 0 };
  const std = computeLaunch({ x: 1, y: 0 }, 0.3, tip, STD);
  const ld = computeLaunch({ x: 1, y: 0 }, 0.3, tip, LD);
  const cf = computeLaunch({ x: 1, y: 0 }, 0.3, tip, cuePreset('carbon'));
  assert.ok(Math.abs(ld.squirtDeg) < Math.abs(std.squirtDeg));
  assert.ok(Math.abs(cf.squirtDeg) < Math.abs(ld.squirtDeg));
  near(std.squirtDeg, -STD.squirtDegPerFullSide * 0.5, 1e-9);
  // right english pushes the cue ball to the left of the aim direction (negative y when aiming along +x)
  assert.ok(std.dir.y < 0);
  const left = computeLaunch({ x: 1, y: 0 }, 0.3, { x: -0.5, y: 0 }, STD);
  assert.ok(left.dir.y > 0);
  // no side english: no squirt
  near(computeLaunch({ x: 1, y: 0 }, 0.3, { x: 0, y: 0.3 }, STD).squirtDeg, 0, 1e-12);
});

test('miscue above the limit: 30 % speed, <= 3 deg error, no spin', () => {
  const ok = computeLaunch({ x: 1, y: 0 }, 0.5, { x: 0, y: 0.5 }, STD);
  assert.equal(ok.miscue, false);
  const bad = computeLaunch({ x: 1, y: 0 }, 0.5, { x: 0, y: 0.8 }, STD, () => 1);
  assert.equal(bad.miscue, true);
  near(bad.speed, 0.3 * ok.speed, 1e-6 * ok.speed + 1e-9);
  assert.deepEqual(bad.spin, { x: 0, y: 0 });
  assert.equal(bad.side, 0);
  const ang = Math.abs((Math.atan2(bad.dir.y, bad.dir.x) * 180) / Math.PI);
  assert.ok(ang <= 3 + 1e-9 && ang > 2.9, `angle ${ang}`);
  // the break cue miscues earlier (limit 0.45)
  assert.equal(computeLaunch({ x: 1, y: 0 }, 0.5, { x: 0, y: 0.5 }, cuePreset('break')).miscue, true);
  // end-to-end: the simulation reports it
  const r = simulate([createBall(0, 600, 600)], { aimDir: { x: 1, y: 0 }, power: 0.4, tip: { x: 0, y: 0.9 } }, { rng: () => 0.5 });
  assert.equal(r.events.miscue, true);
});

test('spinEfficiency scales spin and english', () => {
  const base = { ...STD, squirtDegPerFullSide: 0 };
  const full = computeLaunch({ x: 1, y: 0 }, 0.4, { x: 0.3, y: 0.4 }, { ...base, spinEfficiency: 1 });
  const half = computeLaunch({ x: 1, y: 0 }, 0.4, { x: 0.3, y: 0.4 }, { ...base, spinEfficiency: 0.5 });
  near(half.spin.x, full.spin.x / 2, 1e-6);
  near(half.side, full.side / 2, 1e-6);
  near(half.speed, full.speed, 1e-9);
});

test('table sizes: 7ft / 8ft / 9ft playing surface', () => {
  const dims = (p) => {
    const g = buildTable(p);
    return [g.W, g.H];
  };
  assert.deepEqual(dims(tablePreset('bar-7ft')), [1980, 990]);
  assert.deepEqual(dims(tablePreset('club-9ft')), [2540, 1270]);
  assert.deepEqual(dims(tablePreset('pro-9ft')), [2540, 1270]);
  assert.deepEqual(dims({ ...tablePreset('custom'), size: '8ft' }), [2240, 1120]);
});

test('pocket gaps and capture derive from mouth width (narrower mouth = tighter pocket)', () => {
  const pro = buildTable(tablePreset('pro-9ft'));
  const club = buildTable(tablePreset('club-9ft'));
  const bar = buildTable(tablePreset('bar-7ft'));
  assert.ok(pro.cornerGap < club.cornerGap && club.cornerGap < bar.cornerGap);
  assert.ok(pro.POCKETS[0].capture < club.POCKETS[0].capture);
  assert.ok(pro.POCKETS[4].capture < club.POCKETS[4].capture);
  // corner gap along the rail = mouth / sqrt(2): tighter than the old fixed 110 mm for standard mouths
  near(club.cornerGap, 127 / Math.SQRT2, 1e-9);
  assert.ok(club.cornerGap < 110);
  near(club.sideGap, 70, 1e-9);
  // the corner mouth is still wider than a ball
  assert.ok(pro.cornerGap * Math.SQRT2 > 2 * R);
});

test('corner pocket: diagonal entry drops, rail-hugging entry on a tight table does not fall straight in', () => {
  const pro = tablePreset('pro-9ft');
  const hit = simulate([createBall(0, 700, 700)], { aimDir: { x: -1, y: -1 }, power: 0.25, tip: { x: 0, y: 0 } }, { table: pro });
  assert.ok(hit.balls[0].potted);
  // hugging the top rail towards the corner (centre R + 8 mm from the cushion) must stay a legal ball position
  const miss = simulate([createBall(0, 600, R + 8)], { aimDir: { x: -1, y: 0 }, power: 0.25, tip: { x: 0, y: 0 } }, { table: pro, maxTime: 3 });
  assert.ok(miss.balls[0].pos.x > -5 && miss.balls[0].pos.y > -5, 'ball stays within the table / pocket area');
});

test('slower cloth gives a shorter roll distance', () => {
  const run = (muRoll) => {
    const table = { ...tablePreset('club-9ft'), muRoll };
    const r = simulate([createBall(0, 300, 635)], { aimDir: { x: 1, y: 0 }, power: 0.12, tip: { x: 0, y: 0 } }, { table, maxTime: 30 });
    return r.balls[0].pos.x - 300;
  };
  const fast = run(0.008);
  const slow = run(0.015);
  assert.ok(fast > slow + 50, `fast ${fast} vs slow ${slow}`);
  // presets: bar cloth (slow) rolls shorter than pro cloth (fast) on the same shot
  const shot = { aimDir: { x: 1, y: 0 }, power: 0.12, tip: { x: 0, y: 0 } };
  const pro = simulate([createBall(0, 300, 495)], shot, { table: tablePreset('pro-9ft'), maxTime: 30 });
  const bar = simulate([createBall(0, 300, 495)], shot, { table: tablePreset('bar-7ft'), maxTime: 30 });
  assert.ok(pro.balls[0].pos.x > bar.balls[0].pos.x);
});

test('squirt moves the cue ball sideways; compensating the aim reduces the error', () => {
  const balls = [createBall(0, 600, 635)];
  const tip = { x: 0.5, y: 0 };
  const cue = { ...STD, squirtDegPerFullSide: 2 };
  const plain = simulate(balls, { aimDir: { x: 1, y: 0 }, power: 0.25, tip }, { cue, maxTime: 0.6 });
  const a = (1 * Math.PI) / 180; // aim 1 degree to the right (+y on screen) = compensation
  const comp = simulate(balls, { aimDir: { x: Math.cos(a), y: Math.sin(a) }, power: 0.25, tip }, { cue, maxTime: 0.6 });
  assert.ok(plain.balls[0].pos.y < 635 - 1, 'right english squirts left (negative y)');
  assert.ok(Math.abs(comp.balls[0].pos.y - 635) < Math.abs(plain.balls[0].pos.y - 635));
});

test('defaults: cue = Fury TK-03 user cue preset, table = club-9ft', () => {
  const c = defaultCue();
  assert.equal(c.id, 'user-cue');
  assert.equal(c.name, 'Fury TK-03');
  assert.equal(c.shaft, 'low-deflection');
  assert.equal(c.massG, 539);
  assert.equal(c.squirtDegPerFullSide, cuePreset('low-deflection').squirtDegPerFullSide);
  assert.equal(defaultTable().id, 'club-9ft');
});

/* ------------------------------------------------------------------ free aim: ray-cast first hit */

test('firstHit: nearest ball along the ray, with cut angle and object direction', () => {
  const cue = { x: 500, y: 635 };
  const balls = [createBall(0, 500, 635), createBall(1, 1000, 635), createBall(2, 1400, 635)];
  const hit = firstHit(cue, { x: 1, y: 0 }, balls, R, [0]);
  assert.equal(hit.id, 1);
  near(hit.t, 500 - 2 * R, 1e-9);
  near(hit.ghost.x, 1000 - 2 * R, 1e-9);
  near(hit.cutAngleDeg, 0, 1e-6);
  near(hit.fullness, 1, 1e-9);
  near(hit.objDir.x, 1, 1e-9);
  assert.equal(hit.fullnessLabel, 'Đầy');
});

test('firstHit: 30 degree cut matches computeShot; misses, balls behind and ignored ids give null', () => {
  const th = (30 * Math.PI) / 180;
  const objDir = { x: Math.cos(th), y: Math.sin(th) };
  const obj = { x: 1000, y: 500 };
  const ghost = { x: obj.x - objDir.x * 2 * R, y: obj.y - objDir.y * 2 * R };
  const cue = { x: ghost.x - 500, y: ghost.y }; // aim along +x
  const balls = [createBall(0, cue.x, cue.y), createBall(1, obj.x, obj.y)];
  const hit = firstHit(cue, { x: 1, y: 0 }, balls, R);
  assert.equal(hit.id, 1);
  near(hit.cutAngleDeg, 30, 1e-6);
  near(hit.fullness, 0.5, 1e-9);
  near(hit.ghost.x, ghost.x, 1e-6);
  near(hit.objDir.x, objDir.x, 1e-9);
  near(hit.objDir.y, objDir.y, 1e-9);
  // misses: aim well above the ball
  assert.equal(firstHit(cue, { x: 1, y: -0.2 }, balls, R), null);
  // ball behind the cue ball is not hit
  assert.equal(firstHit(cue, { x: -1, y: 0 }, balls, R), null);
  // ignored ids and potted balls are skipped
  assert.equal(firstHit(cue, { x: 1, y: 0 }, balls, R, [0, 1]), null);
  balls[1].potted = true;
  assert.equal(firstHit(cue, { x: 1, y: 0 }, balls, R), null);
  // a grazing ray just inside 2R still hits, just outside misses
  const b2 = [createBall(1, 1000, 500)];
  assert.ok(firstHit({ x: 200, y: 500 + 2 * R - 0.5 }, { x: 1, y: 0 }, b2, R));
  assert.equal(firstHit({ x: 200, y: 500 + 2 * R + 0.5 }, { x: 1, y: 0 }, b2, R), null);
});
