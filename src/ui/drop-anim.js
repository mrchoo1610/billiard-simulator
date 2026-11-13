// Visual animation for balls dropping into pockets (pure, no DOM).
// Used by both 2D and 3D renderers so potted balls roll over the lip, rebound softly off the pocket liner, and fall into the pit.
import { integrateQuat } from '../core/physics.js';
import { R } from '../core/table.js';

export const DROP_DURATION = 0.44; // seconds before the dropped ball fades completely
const GRAVITY = 9810; // mm/s^2
const LEATHER_RESTITUTION = 0.32;
const SUB_DT = 1 / 180;

/** Create an active drop animation state from a Sim `events.drops` entry. */
export function createDropAnim(d) {
  return {
    id: d.id,
    pocketId: d.pocketId,
    x: d.x,
    y: d.y,
    z: 0, // downward depth below cloth level (mm)
    vx: d.vx,
    vy: d.vy,
    vz: 0,
    w: { x: d.w.x, y: d.w.y, z: d.w.z },
    q: { w: d.q.w, x: d.q.x, y: d.q.y, z: d.q.z },
    px: d.px,
    py: d.py,
    pr: d.pr,
    t: 0,
  };
}

/** Advance one drop animation by `dt` seconds. Returns false when finished. */
export function stepDropAnim(d, dt) {
  const clamped = Math.min(0.05, Math.max(0, dt));
  const steps = Math.max(1, Math.ceil(clamped / SUB_DT));
  const h = clamped / steps;
  const maxOff = Math.max(4, d.pr - R * 0.42);

  for (let i = 0; i < steps; i++) {
    d.t += h;
    const dx = d.px - d.x;
    const dy = d.py - d.y;
    const dist = Math.hypot(dx, dy);

    // Gentle funneling toward the pocket centre + horizontal damping inside the cup
    if (dist > 0.5) {
      const pull = 16000 * h;
      d.vx += (dx / dist) * pull;
      d.vy += (dy / dist) * pull;
    }
    const damp = Math.exp(-6.5 * h);
    d.vx *= damp;
    d.vy *= damp;
    d.x += d.vx * h;
    d.y += d.vy * h;

    // Soft bounce off the back leather of the pocket cup
    const rx = d.x - d.px;
    const ry = d.y - d.py;
    const rdist = Math.hypot(rx, ry);
    if (rdist > maxOff && rdist > 1e-6) {
      const nx = rx / rdist;
      const ny = ry / rdist;
      d.x = d.px + nx * maxOff;
      d.y = d.py + ny * maxOff;
      const vn = d.vx * nx + d.vy * ny;
      if (vn > 0) {
        d.vx -= (1 + LEATHER_RESTITUTION) * vn * nx;
        d.vy -= (1 + LEATHER_RESTITUTION) * vn * ny;
      }
    }

    // Gravity drop starts immediately inside the lip (faster once near the cup centre)
    const lipFactor = rdist < d.pr * 0.85 || d.t > 0.04 ? 1 : 0.35;
    d.vz += GRAVITY * lipFactor * h;
    d.z += d.vz * h;
    if (d.z > 92) {
      d.z = 92;
      d.vz *= -0.15;
    }

    const wDamp = Math.exp(-2.2 * h);
    d.w.x *= wDamp;
    d.w.y *= wDamp;
    d.w.z *= wDamp;
    integrateQuat(d.q, d.w, h);
  }

  return d.t < DROP_DURATION;
}

/** Visual opacity (1..0) and 2D perspective scale (1..0.56) for a drop animation. */
export function dropVisual(d) {
  const u = Math.min(1, Math.max(0, d.t / DROP_DURATION));
  const fade = u < 0.52 ? 1 : Math.max(0, 1 - (u - 0.52) / 0.48);
  const scale = Math.max(0.56, 1 - d.z * 0.0048);
  const shade = Math.min(0.82, (d.z / 85) * 0.82);
  return { fade, scale, shade, u };
}
