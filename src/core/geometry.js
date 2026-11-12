// Aiming geometry (pure). Accepts points {x,y} or ball objects with .pos.
import { sub, scale, dot, cross, norm, perp, len, dist, distPointSeg, deg, rad, clamp, rotate } from './vec.js';


const pt = (b) => (b && b.pos ? b.pos : b);

/** Overlap fraction (0..1) -> label. */
export function fullnessLabel(f) {
  const table = [
    [1, 'Đầy'],
    [0.75, '3/4'],
    [0.5, '1/2'],
    [0.25, '1/4'],
    [0.125, '1/8'],
    [0, 'Lướt'],
  ];
  let best = table[0];
  for (const row of table) if (Math.abs(row[0] - f) < Math.abs(best[0] - f)) best = row;
  return best[1];
}

export const FULLNESS_LABELS = ['Đầy', '3/4', '1/2', '1/4', '1/8', 'Lướt'];

/**
 * Ghost-ball geometry for cue -> obj aimed so the object ball travels toward aimPoint.
 */
export function computeShot(cueIn, objIn, aimPoint, R) {
  const cue = pt(cueIn);
  const obj = pt(objIn);
  const objDir = norm(sub(aimPoint, obj));
  const ghost = sub(obj, scale(objDir, 2 * R));
  const aimDir = norm(sub(ghost, cue));
  const d = clamp(dot(aimDir, objDir), -1, 1);
  const cutAngleDeg = deg(Math.acos(d));
  const cutRad = rad(cutAngleDeg);
  const fullness = clamp(1 - Math.sin(cutRad), 0, 1);

  // 90 degree rule: stun cue ball leaves along the tangent line.
  let tangent = perp(objDir);
  if (dot(tangent, aimDir) < 0) tangent = scale(tangent, -1);
  const cueAfterStunDir = tangent;

  // ~30 degree rule for a rolling cue ball (approximation).
  const ang = Math.min(30 * Math.min(1, cutAngleDeg / 14.5), Math.max(0, 90 - cutAngleDeg));
  const sign = cross(aimDir, tangent) >= 0 ? 1 : -1;
  const cueAfterRollDir = rotate(aimDir, sign * rad(ang));

  return {
    ghost,
    aimDir,
    objDir,
    cutAngleDeg,
    fullness,
    fullnessLabel: fullnessLabel(fullness),
    cueAfterStunDir,
    cueAfterRollDir,
    possible: cutAngleDeg < 88,
  };
}

/**
 * First ball (nearest to a along the path) whose centre is closer than 2R to
 * segment ab. Returns the ball id or null.
 */
export function isPathBlocked(a, b, balls, R, ignoreIds = []) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  let best = null;
  let bestT = Infinity;
  for (const ball of balls) {
    if (ball.potted || ignoreIds.includes(ball.id)) continue;
    const p = pt(ball);
    if (distPointSeg(p, a, b) < 2 * R - 0.5) {
      const t = l2 > 1e-9 ? dot(sub(p, a), ab) / l2 : 0;
      if (t < bestT) {
        bestT = t;
        best = ball.id;
      }
    }
  }
  return best;
}

/** Pocket index with smallest cut angle; unobstructed pockets preferred. */
export function bestPocket(cueIn, objIn, balls, R, pockets) {
  const cue = pt(cueIn);
  const obj = pt(objIn);
  // Ignore the cue ball and the object ball itself (matched by id or position).
  const ignore = [0];
  if (objIn && objIn.id !== undefined) ignore.push(objIn.id);
  for (const b of balls) if (dist(pt(b), obj) < 0.01) ignore.push(b.id);
  let bestFree = -1;
  let bestFreeCut = Infinity;
  let bestAny = 0;
  let bestAnyCut = Infinity;
  pockets.forEach((pk, i) => {
    const s = computeShot(cue, obj, pk.aim, R);
    if (!s.possible) return;
    if (s.cutAngleDeg < bestAnyCut) {
      bestAnyCut = s.cutAngleDeg;
      bestAny = i;
    }
    const blocked =
      isPathBlocked(cue, s.ghost, balls, R, ignore) !== null ||
      isPathBlocked(obj, pk.aim, balls, R, ignore) !== null;
    if (!blocked && s.cutAngleDeg < bestFreeCut) {
      bestFreeCut = s.cutAngleDeg;
      bestFree = i;
    }
  });
  return bestFree >= 0 ? bestFree : bestAny;
}

export { len, dist };

/**
 * Ray-cast the cue-ball centre from `origin` along `dir` and find the first ball it hits
 * (first centre distance of 2R). Balls with ids in `ignoreIds` (default: the cue ball) are skipped.
 * Returns null when nothing is hit, else
 * { id, t (distance to contact, mm), ghost (cue centre at contact), objDir, cutAngleDeg, fullness, fullnessLabel }.
 * Cushions are not considered here (callers compare `t` with the distance to the rail).
 */
export function firstHit(origin, dir, balls, R, ignoreIds = [0]) {
  const d = norm(dir);
  let best = null;
  for (const b of balls) {
    if (b.potted || ignoreIds.includes(b.id)) continue;
    const p = pt(b);
    const fx = origin.x - p.x;
    const fy = origin.y - p.y;
    const bq = fx * d.x + fy * d.y;
    const c = fx * fx + fy * fy - 4 * R * R;
    const disc = bq * bq - c;
    if (disc < 0) continue;
    const t = -bq - Math.sqrt(disc);
    if (t < 0) continue;
    if (!best || t < best.t) best = { id: b.id, t, p };
  }
  if (!best) return null;
  const ghost = { x: origin.x + d.x * best.t, y: origin.y + d.y * best.t };
  const objDir = norm(sub(best.p, ghost));
  const cutAngleDeg = deg(Math.acos(clamp(dot(d, objDir), -1, 1)));
  const fullness = clamp(1 - Math.sin(rad(cutAngleDeg)), 0, 1);
  return { id: best.id, t: best.t, ghost, objDir, cutAngleDeg, fullness, fullnessLabel: fullnessLabel(fullness) };
}
