// 2D vector helpers. All world units are millimetres.
export const v = (x, y) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a, k) => ({ x: a.x * k, y: a.y * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a) => {
  const l = len(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};
export const perp = (a) => ({ x: -a.y, y: a.x });
export const rotate = (a, rad) => {
  const c = Math.cos(rad), s = Math.sin(rad);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
};
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const deg = (rad) => (rad * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;

/** Shortest distance from point p to segment ab. */
export function distPointSeg(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-9) return dist(p, a);
  const t = clamp(dot(sub(p, a), ab) / l2, 0, 1);
  return dist(p, add(a, scale(ab, t)));
}
