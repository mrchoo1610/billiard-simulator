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

const RAIL_NOSE_H = 36;
const RAIL_TOP_H = 46;
const RAIL_BEVEL_W = 36;
export const RAIL_MAX_ELEVATION_DEG = 72;

/**
 * Cushion / wood-rail top height above the cloth (mm) under world point (x, y).
 * Returns 0 over the playing bed or outside the outer cabinet rim.
 */
export function railSurfaceHeight(x, y, geo) {
  const W = geo?.W ?? 2540;
  const H = geo?.H ?? 1270;
  const rail = geo?.RAIL ?? 110;
  const ox = x < 0 ? -x : x > W ? x - W : 0;
  const oy = y < 0 ? -y : y > H ? y - H : 0;
  const out = Math.max(ox, oy);
  if (out <= 0.25 || out > rail + 2) return 0;
  if (out < RAIL_BEVEL_W) return RAIL_NOSE_H + (out / RAIL_BEVEL_W) * (RAIL_TOP_H - RAIL_NOSE_H);
  return RAIL_TOP_H;
}

/**
 * Minimum cue butt elevation (degrees) so the stick clears cushions and wood rails
 * from impact (pull = 0) through backswing without clipping into the rail.
 */
export function minCueElevationDeg(cuePos, aimDir, tip = { x: 0, y: 0 }, geo = {}, opts = {}) {
  if (!cuePos || !aimDir) return 0;
  const d = norm(aimDir);
  if (Math.hypot(d.x, d.y) < 1e-6) return 0;
  const R_BALL = geo.R ?? 28.575;
  const right2d = { x: -d.y, y: d.x };
  let tx = tip?.x || 0;
  let ty = tip?.y || 0;
  const tl = Math.hypot(tx, ty);
  if (tl > 1) {
    tx /= tl;
    ty /= tl;
  }
  const depth = Math.sqrt(Math.max(0, 1 - tx * tx - ty * ty));
  const pullBack = opts.pull ?? 200;
  const pulls = pullBack > 0 ? [0, pullBack] : [0];
  const minDeg = opts.minDeg ?? 0;
  const maxDeg = opts.maxDeg ?? RAIL_MAX_ELEVATION_DEG;

  const blockers = [];
  if (Array.isArray(opts.balls)) {
    for (const b of opts.balls) {
      if (!b || b.potted || !b.pos || b.id === 0) continue;
      const dx = b.pos.x - cuePos.x;
      const dy = b.pos.y - cuePos.y;
      if (Math.hypot(dx, dy) < 1e-3) continue;
      const along = -(dx * d.x + dy * d.y);
      const lat = Math.abs(dx * right2d.x + dy * right2d.y);
      if (along >= -2 * R_BALL && along <= pullBack + 1500 && lat <= 2 * R_BALL + 25) {
        blockers.push({ x: b.pos.x, y: b.pos.y });
      }
    }
  }

  for (let elev = Math.max(0, minDeg); elev <= maxDeg; elev += 0.5) {
    const e = rad(elev);
    const ce = Math.cos(e);
    const se = Math.sin(e);
    const cx = cuePos.x + R_BALL * (tx * right2d.x + ty * se * d.x - depth * ce * d.x);
    const cy = cuePos.y + R_BALL * (tx * right2d.y + ty * se * d.y - depth * ce * d.y);
    const ch = R_BALL * (1 + ty * ce + depth * se);
    const ux = -d.x * ce;
    const uy = -d.y * ce;

    let clear = true;
    for (const pull of pulls) {
      for (let s = 0; s <= 380; s += 6) {
        const px = cx + ux * s;
        const py = cy + uy * s;
        const rh = railSurfaceHeight(px, py, geo);
        if (rh <= 0) continue;
        const ph = ch + s * se;
        const shaftDist = Math.max(0, s - pull);
        const rStick = 6.3 + Math.min(8.5, shaftDist * 0.008);
        const rVert = rStick / Math.max(0.5, ce) + 1.5;
        if (ph - rVert < rh) {
          clear = false;
          break;
        }
      }
      if (!clear) break;
      if (blockers.length) {
        const sEnd = pull + 1480;
        for (const blk of blockers) {
          const sProj = (blk.x - cx) * ux + (blk.y - cy) * uy + (R_BALL - ch) * se;
          const sMid = Math.max(pull, Math.min(sEnd, sProj));
          const sLo = Math.max(pull, sMid - 32);
          const sHi = Math.min(sEnd, sMid + 32);
          for (let s = sLo; s <= sHi + 1e-6; s += 4) {
            const sc = Math.min(s, sHi);
            const dx = cx + ux * sc - blk.x;
            const dy = cy + uy * sc - blk.y;
            const dz = ch + se * sc - R_BALL;
            const rStick = 6.3 + Math.min(8.7, (sc - pull) * 0.007);
            const need = R_BALL + rStick + 1.5;
            if (dx * dx + dy * dy + dz * dz < need * need) {
              clear = false;
              break;
            }
          }
          if (!clear) break;
        }
      }
      if (!clear) break;
    }
    if (clear) return Math.ceil(elev * 2) / 2;
  }
  return maxDeg;
}

export function effectiveCueElevationDeg(baseDeg, cuePos, aimDir, tip, geo, opts) {
  return Math.max(baseDeg ?? 0, minCueElevationDeg(cuePos, aimDir, tip, geo, opts));
}
