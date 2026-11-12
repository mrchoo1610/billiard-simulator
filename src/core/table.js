// Table geometry derived from a TableProfile. All units are millimetres. Pure module (no DOM).
import { SIZES, defaultTable } from './equipment.js';

export const R = 28.575; // ball radius (2.25 in ball)
export const RAIL = 60; // wood rail width (draw only)

const S = Math.SQRT1_2;
const cache = new Map();

/**
 * Build geometry for a profile: size, pockets, walls, rail segments, cushion tips.
 *
 * Pocket mouth = distance between the two cushion tips of a pocket.
 *  - corner: tips lie at (g, 0) and (0, g) from the corner, mouth = g * sqrt(2)  =>  g = mouth / sqrt(2)
 *  - side:   tips lie at W/2 +- mouth/2
 * Capture radius = 0.5 * mouth * pocketCaptureScale.
 * The cushion tips are treated as point obstacles for the ball centre (distance < R => bounce), so the
 * effective window for the ball centre is narrower than the mouth (mouth - 2R), as on a real table.
 */
export function buildTable(profile = defaultTable()) {
  const size = SIZES[profile.size] ? profile.size : '9ft';
  const key = [size, profile.cornerMouth, profile.sideMouth, profile.pocketCaptureScale].join('|');
  const hit = cache.get(key);
  if (hit) return hit;

  const { W, H } = SIZES[size];
  const cornerGap = profile.cornerMouth * S; // cushion tip distance from the corner along each rail
  const sideGap = profile.sideMouth / 2; // half-width of the side opening
  const capC = 0.5 * profile.cornerMouth * profile.pocketCaptureScale;
  const capS = 0.5 * profile.sideMouth * profile.pocketCaptureScale;

  /**
   * Pockets. `axis` is the unit vector from the pocket into the table.
   * `minCos`: a ball is only captured when it moves toward the pocket within
   * acos(minCos) of the pocket axis (stops balls rolling along a rail dropping in).
   */
  const POCKETS = [
    { id: 0, type: 'corner', x: 0, y: 0, capture: capC, axis: { x: S, y: S }, minCos: 0.15, aim: { x: 15 * S, y: 15 * S } },
    { id: 1, type: 'corner', x: W, y: 0, capture: capC, axis: { x: -S, y: S }, minCos: 0.15, aim: { x: W - 15 * S, y: 15 * S } },
    { id: 2, type: 'corner', x: 0, y: H, capture: capC, axis: { x: S, y: -S }, minCos: 0.15, aim: { x: 15 * S, y: H - 15 * S } },
    { id: 3, type: 'corner', x: W, y: H, capture: capC, axis: { x: -S, y: -S }, minCos: 0.15, aim: { x: W - 15 * S, y: H - 15 * S } },
    { id: 4, type: 'side', x: W / 2, y: 0, capture: capS, axis: { x: 0, y: 1 }, minCos: 0.4, aim: { x: W / 2, y: -10 } },
    { id: 5, type: 'side', x: W / 2, y: H, capture: capS, axis: { x: 0, y: -1 }, minCos: 0.4, aim: { x: W / 2, y: H + 10 } },
  ];

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
