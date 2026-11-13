// Table geometry derived from a TableProfile. All units are millimetres. Pure module (no DOM).
import { SIZES, defaultTable } from './equipment.js';

export const R = 28.575; // ball radius (2.25 in ball)
export const RAIL = 110; // wood rail width (draw only; matches 3D rail width)

const S = Math.SQRT1_2;
const cache = new Map();

/**
 * Outer tangent point on pocket well circle (cx, cy, r) from cushion tip `tip`.
 * `axis` points from pocket into the table; selects the tangent on the same lateral side as `tip`.
 */
function jawTangent(cx, cy, r, axis, tip) {
  const dx = tip.x - cx;
  const dy = tip.y - cy;
  const d2 = dx * dx + dy * dy;
  const l = Math.sqrt(Math.max(0, d2 - r * r));
  const rx = -dy;
  const ry = dx;
  const px = -axis.y;
  const py = axis.x;
  const side = Math.sign(dx * px + dy * py) || 1;
  const bx = cx + (r * r * dx) / d2;
  const by = cy + (r * r * dy) / d2;
  const ox = (r * l * rx) / d2;
  const oy = (r * l * ry) / d2;
  const q1 = { x: bx + ox, y: by + oy };
  const q2 = { x: bx - ox, y: by - oy };
  const s1 = ((q1.x - cx) * px + (q1.y - cy) * py) * side;
  const s2 = ((q2.x - cx) * px + (q2.y - cy) * py) * side;
  return s1 >= s2 ? q1 : q2;
}

/** Build a jaw capsule segment from cushion tip `a` to pocket well tangent `b`, with normal `n` into the opening. */
function makeJaw(pocketId, a, b, center) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const len = Math.sqrt(len2) || 1;
  let nx = -aby / len;
  let ny = abx / len;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  if (nx * (center.x - mx) + ny * (center.y - my) < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { pocketId, a, b, len, len2, n: { x: nx, y: ny } };
}

/**
 * Build geometry for a profile: size, pockets (with drop wells & angled jaws), walls, rail segments, cushion tips.
 *
 * Pocket mouth = distance between the two cushion tips of a pocket.
 *  - corner: tips lie at (g, 0) and (0, g) from the corner, mouth = g * sqrt(2)  =>  g = mouth / sqrt(2)
 *  - side:   tips lie at W/2 +- mouth/2
 * Each pocket has a circular drop well (cx, cy, dropR) behind the mouth and two angled jaw segments
 * running from the cushion tips tangent to the drop well (~140 deg corner, ~106 deg side), allowing
 * realistic jaw rebounds and pocket rattle when shots miss the drop zone slightly.
 */
export function buildTable(profile = defaultTable()) {
  const size = SIZES[profile.size] ? profile.size : '9ft';
  const key = [size, profile.cornerMouth, profile.sideMouth, profile.pocketCaptureScale].join('|');
  const hit = cache.get(key);
  if (hit) return hit;

  const { W, H } = SIZES[size];
  const cornerGap = profile.cornerMouth * S; // cushion tip distance from the corner along each rail
  const sideGap = profile.sideMouth / 2; // half-width of the side opening
  const dropRC = 0.41 * profile.cornerMouth;
  const dropRS = 0.36 * profile.sideMouth;
  const capScale = profile.pocketCaptureScale;
  const capC = dropRC * capScale;
  const capS = dropRS * capScale;

  /**
   * Pockets. `axis` is the unit vector from the pocket into the table.
   * `(cx, cy, dropR)` defines the drop well circle; `jaws` holds the two tangent jaw segments.
   */
  const pocketSpecs = [
    { id: 0, type: 'corner', x: 0, y: 0, out: 20, dropR: dropRC, capture: capC, axis: { x: S, y: S }, minCos: 0.15, aim: { x: 15 * S, y: 15 * S }, tips: [{ x: cornerGap, y: 0 }, { x: 0, y: cornerGap }] },
    { id: 1, type: 'corner', x: W, y: 0, out: 20, dropR: dropRC, capture: capC, axis: { x: -S, y: S }, minCos: 0.15, aim: { x: W - 15 * S, y: 15 * S }, tips: [{ x: W - cornerGap, y: 0 }, { x: W, y: cornerGap }] },
    { id: 2, type: 'corner', x: 0, y: H, out: 20, dropR: dropRC, capture: capC, axis: { x: S, y: -S }, minCos: 0.15, aim: { x: 15 * S, y: H - 15 * S }, tips: [{ x: cornerGap, y: H }, { x: 0, y: H - cornerGap }] },
    { id: 3, type: 'corner', x: W, y: H, out: 20, dropR: dropRC, capture: capC, axis: { x: -S, y: -S }, minCos: 0.15, aim: { x: W - 15 * S, y: H - 15 * S }, tips: [{ x: W - cornerGap, y: H }, { x: W, y: H - cornerGap }] },
    { id: 4, type: 'side', x: W / 2, y: 0, out: 48, dropR: dropRS, capture: capS, axis: { x: 0, y: 1 }, minCos: 0.4, aim: { x: W / 2, y: -10 }, tips: [{ x: W / 2 - sideGap, y: 0 }, { x: W / 2 + sideGap, y: 0 }] },
    { id: 5, type: 'side', x: W / 2, y: H, out: 48, dropR: dropRS, capture: capS, axis: { x: 0, y: -1 }, minCos: 0.4, aim: { x: W / 2, y: H + 10 }, tips: [{ x: W / 2 - sideGap, y: H }, { x: W / 2 + sideGap, y: H }] },
  ];

  const JAWS = [];
  const POCKETS = pocketSpecs.map((sp) => {
    const cx = sp.x - sp.axis.x * sp.out;
    const cy = sp.y - sp.axis.y * sp.out;
    const center = { x: cx, y: cy };
    const jaws = sp.tips.map((tip) => {
      const back = jawTangent(cx, cy, sp.dropR, sp.axis, tip);
      const jaw = makeJaw(sp.id, tip, back, center);
      JAWS.push(jaw);
      return jaw;
    });
    return { id: sp.id, type: sp.type, x: sp.x, y: sp.y, cx, cy, out: sp.out, dropR: sp.dropR, capture: sp.capture, axis: sp.axis, minCos: sp.minCos, aim: sp.aim, jaws };
  });

  const gapVertical = (t) => t < cornerGap || t > H - cornerGap; // along y on left/right rails
  const gapHorizontal = (t) => t < cornerGap || t > W - cornerGap || Math.abs(t - W / 2) < sideGap;

  /**
   * Cushion walls. `n` is the outward normal, `depth(p)` the distance of a point
   * from the wall line (positive inside the table), `along(p)` the coordinate along
   * the rail and `gap(t)` whether that coordinate lies in a pocket opening.
   */
  const WALLS = [
    { name: 'left', n: { x: -1, y: 0 }, depth: (p) => p.x, along: (p) => p.y, gap: gapVertical },
    { name: 'right', n: { x: 1, y: 0 }, depth: (p) => W - p.x, along: (p) => p.y, gap: gapVertical },
    { name: 'top', n: { x: 0, y: -1 }, depth: (p) => p.y, along: (p) => p.x, gap: gapHorizontal },
    { name: 'bottom', n: { x: 0, y: 1 }, depth: (p) => H - p.y, along: (p) => p.x, gap: gapHorizontal },
  ];

  /** Solid cushion segments (between pocket openings), for drawing. */
  const RAIL_SEGMENTS = [
    { a: { x: 0, y: cornerGap }, b: { x: 0, y: H - cornerGap }, n: { x: -1, y: 0 } },
    { a: { x: W, y: cornerGap }, b: { x: W, y: H - cornerGap }, n: { x: 1, y: 0 } },
    { a: { x: cornerGap, y: 0 }, b: { x: W / 2 - sideGap, y: 0 }, n: { x: 0, y: -1 } },
    { a: { x: W / 2 + sideGap, y: 0 }, b: { x: W - cornerGap, y: 0 }, n: { x: 0, y: -1 } },
    { a: { x: cornerGap, y: H }, b: { x: W / 2 - sideGap, y: H }, n: { x: 0, y: 1 } },
    { a: { x: W / 2 + sideGap, y: H }, b: { x: W - cornerGap, y: H }, n: { x: 0, y: 1 } },
  ];

  /** Cushion tips (jaw points) bounding every pocket mouth. */
  const TIPS = [
    { x: cornerGap, y: 0 }, { x: 0, y: cornerGap },
    { x: W - cornerGap, y: 0 }, { x: W, y: cornerGap },
    { x: cornerGap, y: H }, { x: 0, y: H - cornerGap },
    { x: W - cornerGap, y: H }, { x: W, y: H - cornerGap },
    { x: W / 2 - sideGap, y: 0 }, { x: W / 2 + sideGap, y: 0 },
    { x: W / 2 - sideGap, y: H }, { x: W / 2 + sideGap, y: H },
  ];

  const geo = {
    size,
    W,
    H,
    R,
    RAIL,
    cornerGap,
    sideGap,
    HEAD_X: W / 4,
    HEAD_SPOT: { x: W / 4, y: H / 2 },
    FOOT_SPOT: { x: (3 * W) / 4, y: H / 2 },
    POCKETS,
    WALLS,
    RAIL_SEGMENTS,
    TIPS,
    JAWS,
    /** Clamp a ball centre so the ball lies fully on the playing surface. */
    clampToTable(p, margin = R) {
      return {
        x: Math.max(margin, Math.min(W - margin, p.x)),
        y: Math.max(margin, Math.min(H - margin, p.y)),
      };
    },
  };
  cache.set(key, geo);
  return geo;
}

/**
 * Beveled cushion strip polygon and end slopes for a rail segment between two pocket jaws.
 * Returns { pts: [a, b, backB, backA], slopeStart, slopeEnd, len, e } where slope = dz/dx along rail normal.
 */
export function railStripBevel(seg, jaws, inset = 36) {
  const dx = seg.b.x - seg.a.x;
  const dy = seg.b.y - seg.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const e = { x: dx / len, y: dy / len };
  const findJaw = (p) => jaws.find((j) => Math.hypot(j.a.x - p.x, j.a.y - p.y) < 1e-3);
  const jA = findJaw(seg.a);
  const jB = findJaw(seg.b);
  const slopeOf = (j) => {
    if (!j) return 0;
    const ux = (j.b.x - j.a.x) / j.len;
    const uy = (j.b.y - j.a.y) / j.len;
    const un = ux * seg.n.x + uy * seg.n.y;
    const ue = ux * e.x + uy * e.y;
    return Math.abs(un) > 1e-6 ? ue / un : 0;
  };
  const slopeStart = slopeOf(jA);
  const slopeEnd = slopeOf(jB);
  const backA = {
    x: seg.a.x + inset * (seg.n.x + slopeStart * e.x),
    y: seg.a.y + inset * (seg.n.y + slopeStart * e.y),
  };
  const backB = {
    x: seg.b.x + inset * (seg.n.x + slopeEnd * e.x),
    y: seg.b.y + inset * (seg.n.y + slopeEnd * e.y),
  };
  return { pts: [seg.a, seg.b, backB, backA], slopeStart, slopeEnd, len, e };
}

/**
 * Closed polygon of the pocket throat between the two jaws and the pocket well circle.
 * When `frontRim` is true, walks the drop-lip arc facing into the table; otherwise closes around the back arc.
 */
export function pocketThroatPolygon(pk, frontRim = true, step = 4) {
  const [j0, j1] = pk.jaws;
  const a0 = Math.atan2(j0.b.y - pk.cy, j0.b.x - pk.cx);
  const a1 = Math.atan2(j1.b.y - pk.cy, j1.b.x - pk.cx);
  let d1 = (a1 - a0) % (2 * Math.PI);
  if (d1 < 0) d1 += 2 * Math.PI;
  const d2 = d1 - 2 * Math.PI;
  const mid1 = { x: Math.cos(a0 + d1 / 2), y: Math.sin(a0 + d1 / 2) };
  const front1 = mid1.x * pk.axis.x + mid1.y * pk.axis.y > 0;
  const sweep = frontRim ? (front1 ? d1 : d2) : front1 ? d2 : d1;
  const segs = Math.max(4, Math.ceil((Math.abs(sweep) * pk.dropR) / step));
  const pts = [{ x: j0.a.x, y: j0.a.y }, { x: j0.b.x, y: j0.b.y }];
  for (let i = 1; i < segs; i++) {
    const a = a0 + (sweep * i) / segs;
    pts.push({ x: pk.cx + pk.dropR * Math.cos(a), y: pk.cy + pk.dropR * Math.sin(a) });
  }
  pts.push({ x: j1.b.x, y: j1.b.y }, { x: j1.a.x, y: j1.a.y });
  return pts;
}
