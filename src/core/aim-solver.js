// Aim solver (pure): finds the aim direction that sends the object ball towards a pocket point
// even with english, cue elevation (swerve), squirt and ball-ball throw, by probing the real engine.
import { computeShot } from './geometry.js';
import { Sim, DEFAULT_ELEVATION_DEG } from './physics.js';
import { R } from './table.js';
import { rotate, rad, deg, norm, sub, cross, dot, clamp } from './vec.js';

export const SOLVE_RANGE_DEG = 8;
export const SOLVE_TOL_DEG = 0.02;
export const SOLVE_MAX_ITER = 12;
const noMiscue = () => 0.5;

const signedDeg = (a, b) => deg(Math.atan2(cross(a, b), dot(a, b)));

/**
 * state: array of balls or { balls }. Ball ids: 0 = cue. pocketPoint: {x,y}.
 * shot: { power, tip, elevationDeg }. Returns
 *  { ok, reason?, aimDir, correctionDeg (+ = aim rotated to the right/clockwise on screen, vs the ghost-ball line),
 *    residualDeg, iterations, probes, parts: { squirt, swerve, throw } (deg, + = deviates to the right of travel) }.
 * Each probe simulates only until the first ball contact + 50 ms.
 */
export function solveAim(state, targetId, pocketPoint, shot, table, cue) {
  const balls = Array.isArray(state) ? state : state.balls;
  const cueBall = balls.find((b) => b.id === 0 && !b.potted);
  const obj = balls.find((b) => b.id === targetId && !b.potted);
  const fail = (reason, base) => ({
    ok: false,
    reason,
    aimDir: base ? base.aimDir : { x: 1, y: 0 },
    correctionDeg: 0,
    residualDeg: null,
    iterations: 0,
    probes: 0,
    parts: null,
  });
  if (!cueBall || !obj || targetId === 0) return fail('missing');
  const base = computeShot(cueBall.pos, obj.pos, pocketPoint, R);
  const toPocket = norm(sub(pocketPoint, obj.pos));
  let probes = 0;

  const probe = (delta) => {
    probes++;
    const aimDir = rotate(base.aimDir, rad(delta));
    const sim = new Sim(balls, { table, cue, rng: noMiscue, orientation: false });
    const launch = sim.strike({
      aimDir,
      power: shot.power,
      tip: shot.tip,
      elevationDeg: shot.elevationDeg ?? DEFAULT_ELEVATION_DEG,
    });
    if (!launch) return null;
    const first = sim.runToContact(6, 0.05);
    if (first !== targetId) return null;
    const t = sim.balls.find((b) => b.id === targetId);
    if (Math.hypot(t.vel.x, t.vel.y) < 1) return null;
    return { delta, err: signedDeg(toPocket, norm(t.vel)), sim, launch };
  };

  let p0 = probe(0);
  let d0 = 0;
  if (!p0) {
    for (const k of [1, -1, 2, -2, 3, -3, 4, -4, 6, -6, 8, -8]) {
      const pr = probe(k);
      if (pr) {
        p0 = pr;
        d0 = k;
        break;
      }
    }
  }
  if (!p0) return { ...fail('no-contact', base), probes };

  let best = p0;
  let iterations = 0;
  if (Math.abs(p0.err) >= SOLVE_TOL_DEG) {
    let pa = p0;
    let pb = probe(d0 + 0.1) || probe(d0 - 0.1);
    while (pb && iterations < SOLVE_MAX_ITER) {
      iterations++;
      if (Math.abs(pb.err) < Math.abs(best.err)) best = pb;
      if (Math.abs(pb.err) < SOLVE_TOL_DEG) break;
      const slope = (pb.err - pa.err) / (pb.delta - pa.delta);
      if (!Number.isFinite(slope) || Math.abs(slope) < 1e-6) break;
      let d2 = clamp(pb.delta - pb.err / slope, -SOLVE_RANGE_DEG, SOLVE_RANGE_DEG);
      let pc = probe(d2);
      for (let h = 0; !pc && h < 3; h++) {
        d2 = (pb.delta + d2) / 2; // step landed on a miss: pull back towards the last good probe
        pc = probe(d2);
      }
      if (!pc) break;
      pa = pb;
      pb = pc;
      if (Math.abs(pb.err) < Math.abs(best.err)) best = pb;
      if (Math.abs(pb.err) < SOLVE_TOL_DEG) break;
    }
  }

  const ev = best.sim.events;
  const start = cueBall.pos;
  const contact = ev.firstContactPos;
  const straight = best.launch.dir;
  const swerve = signedDeg(straight, norm(sub(contact, start)));
  const centres = norm(sub(ev.firstContactObjPos, contact));
  const t = best.sim.balls.find((b) => b.id === targetId);
  const thr = signedDeg(centres, norm(t.vel));
  return {
    ok: Math.abs(best.err) < 0.25,
    aimDir: rotate(base.aimDir, rad(best.delta)),
    correctionDeg: best.delta,
    residualDeg: best.err,
    iterations,
    probes,
    parts: { squirt: best.launch.squirtDeg, swerve, throw: thr },
  };
}
