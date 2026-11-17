// Pure helpers for the 3D view (Phase 6): no three.js import, no DOM. Unit-tested in tests/core/view3d.test.mjs.
// Physics frame: x right, y down (table plane), z down (right-handed), millimetres.
// three frame: metres, y up, x right, z toward the viewer. Mapping (a proper rotation, +90 degrees about X):
//   three.x = (x - W/2)/1000, three.z = (y - H/2)/1000, three.y = -z/1000.

export const MM = 0.001;
export const BALL_R = 28.575;
export const CAM_DIST_MIN = 0.25;
export const CAM_DIST_MAX = 2.0;
export const CAM_HEIGHT_MIN = 0.06;
export const CAM_HEIGHT_MAX = 0.8;
export const CAM_DIST_DEFAULT = 0.55;
export const CAM_HEIGHT_DEFAULT = 0.2;
export const LOOK_AHEAD = 1.2;
export const RAIL_WIDTH_3D = 110; // wood rail width in 3D (the 2D view draws a slimmer one)
export const RAD = Math.PI / 180;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const norm3 = (v) => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const cross3 = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

/* ------------------------------------------------------------------ coordinates */

/** Physics point {x,y,z=0} (mm) -> three metres, table centred at the origin. */
export function toThree(p, dims) {
  return { x: (p.x - dims.W / 2) * MM, y: -(p.z || 0) * MM, z: (p.y - dims.H / 2) * MM };
}
export function fromThree(v, dims) {
  return { x: v.x / MM + dims.W / 2, y: v.z / MM + dims.H / 2, z: -v.y / MM };
}

const S2 = Math.SQRT1_2;
/** three quaternion that maps physics-world vectors to three-world vectors (R_x(+90deg)). */
export const AXIS_QUAT = { w: S2, x: S2, y: 0, z: 0 };

/**
 * Orientation for a mesh whose local frame IS the physics body frame (sphere pole on the body y axis):
 * q_three = AXIS_QUAT * q_phys, so world = M * (q * p_body).
 */
export function physQuatToThree(q) {
  const a = AXIS_QUAT;
  return {
    w: a.w * q.w - a.x * q.x - a.y * q.y - a.z * q.z,
    x: a.w * q.x + a.x * q.w + a.y * q.z - a.z * q.y,
    y: a.w * q.y - a.x * q.z + a.y * q.w + a.z * q.x,
    z: a.w * q.z + a.x * q.y - a.y * q.x + a.z * q.w,
  };
}

/** Rotate v by quaternion q (generic helper, same convention as physics.rotateByQuat). */
export function rotateVec(q, v) {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/* ------------------------------------------------------------------ camera (player's eye) */

export const clampCamDist = (d) => clamp(d, CAM_DIST_MIN, CAM_DIST_MAX);
export const clampCamHeight = (h) => clamp(h, CAM_HEIGHT_MIN, CAM_HEIGHT_MAX);

/** Vertical FOV in degrees: 50 on landscape; on portrait widened so the horizontal FOV stays about 50. */
export function fovForAspect(aspect) {
  if (!(aspect > 0) || aspect >= 1) return 50;
  return Math.min(75, (2 * Math.atan(Math.tan(25 * RAD) / aspect)) / RAD);
}

/**
 * Camera behind the cue ball along -aim at `height` above the cloth, looking `lookAhead` metres ahead along the aim
 * line at ball-centre height. heading = physics angle atan2(y, x) of the aim in radians.
 */
export function cameraPose({ cue, heading, distance = CAM_DIST_DEFAULT, height = CAM_HEIGHT_DEFAULT, lookAhead = LOOK_AHEAD, dims, R = BALL_R }) {
  const c = toThree({ x: cue.x, y: cue.y, z: -R }, dims);
  const ax = Math.cos(heading);
  const az = Math.sin(heading);
  return {
    position: { x: c.x - ax * distance, y: height, z: c.z - az * distance },
    target: { x: c.x + ax * lookAhead, y: R * MM, z: c.z + az * lookAhead },
    aim: { x: ax, y: 0, z: az },
  };
}

/** Exponential smoothing factor for a frame of dt seconds with rate k (1/s). */
export const smoothAlpha = (dt, k) => 1 - Math.exp(-Math.max(0, dt) * k);
export const easeInOut = (t) => {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 2 * x * x : 1 - ((-2 * x + 2) ** 2) / 2;
};
export function lerpAngle(a, b, t) {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

/** Horizontal drag (CSS px) -> aim rotation in degrees. */
export const dragToAimDeg = (dxPx, degPerPx = 0.06) => dxPx * degPerPx;

/* ------------------------------------------------------------------ top-down pose + camera director (6.7) */

/**
 * Overhead pose that fits the whole table + rails in the viewport. The table's long axis (x) is mapped to the
 * screen's long side (landscape: horizontal, portrait: vertical). Looks straight down with a tiny tilt (3 deg).
 */
export function topDownPose(tableW, tableH, fovDeg, aspect, { margin = 1.06, railMm = RAIL_WIDTH_3D, tiltDeg = 3 } = {}) {
  const halfX = (tableW / 2 + railMm) * MM;
  const halfZ = (tableH / 2 + railMm) * MM;
  const t = Math.tan((fovDeg * RAD) / 2);
  const asp = aspect > 0 ? aspect : 1;
  const landscape = asp >= 1;
  // screen half extents in metres at height h: vertical = h*t, horizontal = h*t*aspect
  const needX = landscape ? halfX / (t * asp) : halfX / t;
  const needZ = landscape ? halfZ / t : halfZ / (t * asp);
  const h = Math.max(needX, needZ) * margin;
  const tz = h * Math.tan(tiltDeg * RAD);
  return {
    position: { x: 0, y: h, z: tz },
    target: { x: 0, y: 0, z: 0 },
    up: landscape ? { x: 0, y: 0, z: -1 } : { x: 1, y: 0, z: 0 },
    fov: fovDeg,
    height: h,
  };
}

/**
 * Situational camera director ("Tự động"). update({shooting, scratch, userInput}, nowMs) returns
 * { state, progress, blend, moving } where blend (0 = player-eye pose, 1 = top-down) is eased.
 * States: eye -> hold1 (250 ms after the shot) -> toTop (600 ms) -> top -> [balls stop] hold2 (300 ms; 1200 ms after a
 * scratch so the re-spotted cue ball is seen) -> toEye (600 ms) -> eye. Any user input snaps to the pending target.
 */
export function createCameraDirector(cfg = {}) {
  // Slow, eased moves: fast eye <-> top-down swings made players dizzy. hold1 keeps the player view long enough to see the hit.
  const c = { hold1: 700, toTop: 1300, hold2: 700, scratchHold: 1500, toEye: 1200, ...cfg };
  let state = 'eye';
  let t0 = 0;
  let p = 0;
  let from = 0;
  let holdLen = c.hold2;
  const out = () => ({ state, progress: p, blend: easeInOut(p), moving: state === 'toTop' || state === 'toEye' });

  function update({ shooting = false, scratch = false, userInput = false } = {}, now = 0) {
    if (userInput) {
      if (state === 'toTop' || state === 'hold1') {
        state = 'top';
        p = 1;
      } else if (state === 'toEye' || state === 'hold2') {
        state = 'eye';
        p = 0;
      }
    }
    switch (state) {
      case 'eye':
        if (shooting) {
          state = 'hold1';
          t0 = now;
        }
        break;
      case 'hold1':
        if (!shooting) {
          if (p > 0) {
            state = 'toEye';
            t0 = now;
            from = p;
          } else state = 'eye';
        } else if (now - t0 >= c.hold1) {
          state = 'toTop';
          t0 = now;
          from = p;
        }
        break;
      case 'toTop': {
        const u = clamp((now - t0) / c.toTop, 0, 1);
        p = from + (1 - from) * u;
        if (u >= 1) {
          state = 'top';
          p = 1;
        }
        break;
      }
      case 'top':
        p = 1;
        if (!shooting) {
          state = 'hold2';
          t0 = now;
          holdLen = scratch ? c.scratchHold : c.hold2;
        }
        break;
      case 'hold2':
        if (shooting) state = 'top';
        else if (now - t0 >= holdLen) {
          state = 'toEye';
          t0 = now;
          from = p;
        }
        break;
      case 'toEye': {
        if (shooting) {
          state = 'hold1';
          t0 = now;
          break;
        }
        const u = clamp((now - t0) / c.toEye, 0, 1);
        p = from * (1 - u);
        if (u >= 1) {
          state = 'eye';
          p = 0;
        }
        break;
      }
      default:
        break;
    }
    return out();
  }
  function reset() {
    state = 'eye';
    p = 0;
    from = 0;
  }
  return { update, reset, get state() { return state; } };
}

export const CAMERA_MODES = ['auto', 'orbit', 'follow', 'fixed'];
export const CAMERA_MODE_LABEL = {
  auto: 'Tự động',
  orbit: 'Quay TV',
  follow: 'Theo bi cái',
  fixed: 'Cố định',
};
export const nextCameraMode = (m) => CAMERA_MODES[(CAMERA_MODES.indexOf(m) + 1) % CAMERA_MODES.length];

/* ------------------------------------------------------------------ cue stick */

/** Tip distance from the ball surface (mm) for power 0..1: 5 cm .. 25 cm. */
export const pullMm = (power) => 50 + 200 * clamp(power, 0, 1);
/** Forward stroke: pull-back at progress t (0..1), accelerating to 0 (tip touches the ball). */
export const strokePull = (from, t) => from * (1 - clamp(t, 0, 1) ** 2);

/**
 * Cue pose. aimDir (physics x,y) is the aim direction (squirt NOT applied), tip = {x,y} fractions of R
 * (x right, y up), elevation in degrees (butt up). Returns, in three metres: contact point on the ball surface,
 * tip position (contact pulled back by pullMm), unit travel direction d and butt direction (-d).
 */
export function cuePose({ ball, aimDir, elevationDeg = 0, tip = { x: 0, y: 0 }, pull = 0, dims, R = BALL_R }) {
  const l = Math.hypot(aimDir.x, aimDir.y) || 1;
  const e = elevationDeg * RAD;
  const d = { x: (aimDir.x / l) * Math.cos(e), y: -Math.sin(e), z: (aimDir.y / l) * Math.cos(e) };
  const r = norm3(cross3(d, { x: 0, y: 1, z: 0 })); // right of the travel direction
  const u = cross3(r, d); // up, perpendicular to d
  let tx = tip.x;
  let ty = tip.y;
  const tl = Math.hypot(tx, ty);
  if (tl > 1) {
    tx /= tl;
    ty /= tl;
  }
  const off = { x: R * (tx * r.x + ty * u.x), y: R * (tx * r.y + ty * u.y), z: R * (tx * r.z + ty * u.z) };
  const s = Math.sqrt(Math.max(0, R * R - (off.x ** 2 + off.y ** 2 + off.z ** 2)));
  const c = toThree({ x: ball.x, y: ball.y, z: -R }, dims);
  const contact = {
    x: c.x + (off.x - d.x * s) * MM,
    y: c.y + (off.y - d.y * s) * MM,
    z: c.z + (off.z - d.z * s) * MM,
  };
  const tipPos = { x: contact.x - d.x * pull * MM, y: contact.y - d.y * pull * MM, z: contact.z - d.z * pull * MM };
  return { contact, tip: tipPos, dir: d, butt: { x: -d.x, y: -d.y, z: -d.z }, right: r, up: u, center: c };
}

/* ------------------------------------------------------------------ table geometry helpers */

/**
 * Frames for cushion strips: mesh-local x = outward depth, y = up, z = along the rail. `origin` is in physics mm,
 * n3/e3 are three unit vectors. The basis (n3, up, e3) is right-handed (segment ends are swapped when needed).
 */
export function cushionFrames(segments) {
  return segments.map((s) => {
    let a = s.a;
    let b = s.b;
    const n3 = { x: s.n.x, y: 0, z: s.n.y };
    let e = { x: b.x - a.x, y: 0, z: b.y - a.y };
    const len = Math.hypot(e.x, e.z);
    e = { x: e.x / len, y: 0, z: e.z / len };
    if (dot3(cross3(n3, { x: 0, y: 1, z: 0 }), e) < 0) {
      [a, b] = [b, a];
      e = { x: -e.x, y: 0, z: -e.z };
    }
    return { origin: { x: a.x, y: a.y }, n3, e3: e, len };
  });
}

function rectCircleBooleanOutline({ x0, y0, x1, y1, circles = [], step = 3, keepOutside = true }) {
  const pts = [];
  const edge = (ax, ay, bx, by) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let i = 0; i < n; i++) pts.push({ x: ax + ((bx - ax) * i) / n, y: ay + ((by - ay) * i) / n });
  };
  edge(x0, y0, x1, y0);
  edge(x1, y0, x1, y1);
  edge(x1, y1, x0, y1);
  edge(x0, y1, x0, y0);
  const member = pts.map((p) => circles.findIndex((c) => Math.hypot(p.x - c.cx, p.y - c.cy) < c.r));
  const start = member.findIndex((m) => m < 0);
  if (start < 0) return pts;
  const n = pts.length;
  const outsideRect = (p) => p.x < x0 - 1e-6 || p.x > x1 + 1e-6 || p.y < y0 - 1e-6 || p.y > y1 + 1e-6;
  const insideRect = (p) => p.x > x0 + 1e-6 && p.x < x1 - 1e-6 && p.y > y0 + 1e-6 && p.y < y1 - 1e-6;
  const crossing = (pin, pout, c) => {
    let a = pin;
    let b = pout;
    for (let i = 0; i < 30; i++) {
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (Math.hypot(m.x - c.cx, m.y - c.cy) < c.r) a = m;
      else b = m;
    }
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  const out = [];
  let k = 0;
  while (k < n) {
    const idx = (start + k) % n;
    const m = member[idx];
    if (m < 0) {
      out.push(pts[idx]);
      k++;
      continue;
    }
    // inside run of circle m: find its end
    const prev = pts[(idx - 1 + n) % n];
    let j = k;
    while (j < n && member[(start + j) % n] === m) j++;
    const last = pts[(start + j - 1) % n];
    const next = pts[(start + j) % n];
    const c = circles[m];
    const E = crossing(last, next, c);
    const X = crossing(pts[idx], prev, c);
    // walking direction: from X (entry, between prev and first inside) to E (exit)
    const aX = Math.atan2(X.y - c.cy, X.x - c.cx);
    const aE = Math.atan2(E.y - c.cy, E.x - c.cx);
    let d1 = (aE - aX) % (2 * Math.PI);
    if (d1 < 0) d1 += 2 * Math.PI;
    const d2 = d1 - 2 * Math.PI;
    const mid = (d) => ({ x: c.cx + c.r * Math.cos(aX + d / 2), y: c.cy + c.r * Math.sin(aX + d / 2) });
    const ok = keepOutside
      ? outsideRect(mid(d1)) || !outsideRect(mid(d2))
      : insideRect(mid(d1)) || !insideRect(mid(d2));
    const sweep = ok ? d1 : d2;
    const segs = Math.max(2, Math.ceil((Math.abs(sweep) * c.r) / step));
    out.push(X);
    for (let i = 1; i < segs; i++) {
      const a = aX + (sweep * i) / segs;
      out.push({ x: c.cx + c.r * Math.cos(a), y: c.cy + c.r * Math.sin(a) });
    }
    out.push(E);
    k = j;
  }
  return out;
}

/**
 * Outline of the opening in the wood rail top: the playing area + cushions rectangle (inset mm beyond the
 * cushion nose line) united with the pocket circles [{cx, cy, r}]. Returns points {x,y} (physics mm).
 */
export function railHoleOutline({ W, H, inset = 36, circles = [], step = 3 }) {
  return rectCircleBooleanOutline({ x0: -inset, y0: -inset, x1: W + inset, y1: H + inset, circles, step, keepOutside: true });
}

/**
 * Outline of the playing cloth surface [0..W] x [0..H] with the pocket circles subtracted,
 * so potted balls visually drop into open pocket wells instead of clipping through solid cloth.
 */
export function clothCutoutOutline({ W, H, circles = [], step = 3 }) {
  return rectCircleBooleanOutline({ x0: 0, y0: 0, x1: W, y1: H, circles, step, keepOutside: false });
}

/** Walk arc on circle (cx, cy, r) from pStart to pEnd picking the front (dot(axis) > 0) or back arc. */
function pocketArcPoints(pk, pStart, pEnd, frontSide, step = 3) {
  const a0 = Math.atan2(pStart.y - pk.cy, pStart.x - pk.cx);
  const a1 = Math.atan2(pEnd.y - pk.cy, pEnd.x - pk.cx);
  let d1 = (a1 - a0) % (2 * Math.PI);
  if (d1 < 0) d1 += 2 * Math.PI;
  const d2 = d1 - 2 * Math.PI;
  const mid1 = { x: Math.cos(a0 + d1 / 2), y: Math.sin(a0 + d1 / 2) };
  const isFront1 = mid1.x * pk.axis.x + mid1.y * pk.axis.y > 0;
  const sweep = frontSide ? (isFront1 ? d1 : d2) : isFront1 ? d2 : d1;
  const segs = Math.max(4, Math.ceil((Math.abs(sweep) * pk.dropR) / step));
  const out = [{ x: pStart.x, y: pStart.y }];
  for (let i = 1; i < segs; i++) {
    const a = a0 + (sweep * i) / segs;
    out.push({ x: pk.cx + pk.dropR * Math.cos(a), y: pk.cy + pk.dropR * Math.sin(a) });
  }
  out.push({ x: pEnd.x, y: pEnd.y });
  return out;
}

/** Intersect segment a->b with axis-aligned box [x0..x1] x [y0..y1]; returns exit parameter t in [0,1] or null. */
function segmentExitBox(a, b, x0, y0, x1, y1) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ts = [];
  if (Math.abs(dx) > 1e-9) {
    for (const bx of [x0, x1]) {
      const t = (bx - a.x) / dx;
      if (t >= -1e-6 && t <= 1 + 1e-6) ts.push(t);
    }
  }
  if (Math.abs(dy) > 1e-9) {
    for (const by of [y0, y1]) {
      const t = (by - a.y) / dy;
      if (t >= -1e-6 && t <= 1 + 1e-6) ts.push(t);
    }
  }
  let best = null;
  for (const t of ts) {
    const tc = clamp(t, 0, 1);
    const px = a.x + dx * tc;
    const py = a.y + dy * tc;
    if (px >= x0 - 1e-4 && px <= x1 + 1e-4 && py >= y0 - 1e-4 && py <= y1 + 1e-4) {
      if (best === null || tc > best.t) best = { t: tc, x: px, y: py };
    }
  }
  return best;
}

/** Order the two jaws of a pocket clockwise around the rect perimeter (corner/top-right-bottom-left). */
function orderedPocketJaws(pk, W, H) {
  // Walk perimeter of [0..W] x [0..H]: top(0), right(1), bottom(2), left(3)
  const param = (p) => {
    const eps = 1e-3;
    if (Math.abs(p.y) < eps) return p.x;
    if (Math.abs(p.x - W) < eps) return W + p.y;
    if (Math.abs(p.y - H) < eps) return W + H + (W - p.x);
    return W + H + W + (H - p.y);
  };
  const perim = 2 * (W + H);
  const p0 = param(pk.jaws[0].a);
  const p1 = param(pk.jaws[1].a);
  let d = (p1 - p0) % perim;
  if (d < 0) d += perim;
  return d < perim / 2 ? [pk.jaws[0], pk.jaws[1]] : [pk.jaws[1], pk.jaws[0]];
}

/**
 * Closed outline of the wood rail opening matching both the beveled cushion jaws (at offset `inset`)
 * and the circular pocket wells behind them. Used by 3D wood rail extrusion.
 */
export function tableOpeningOutline({ W, H, inset = 36, pockets = [], step = 3 }) {
  if (!pockets.length) return railHoleOutline({ W, H, inset, circles: [], step });
  // Pockets sorted in clockwise perimeter order starting from top-left corner:
  // top-left corner(0), top-side(4), top-right(1), bottom-right(3), bottom-side(5), bottom-left(2)
  const order = [0, 4, 1, 3, 5, 2].map((id) => pockets.find((p) => p.id === id)).filter(Boolean);
  const pts = [];
  for (const pk of order) {
    const [jIn, jOut] = orderedPocketJaws(pk, W, H);
    const eIn = segmentExitBox(jIn.a, jIn.b, -inset, -inset, W + inset, H + inset) || { x: jIn.a.x, y: jIn.a.y };
    const eOut = segmentExitBox(jOut.a, jOut.b, -inset, -inset, W + inset, H + inset) || { x: jOut.a.x, y: jOut.a.y };
    pts.push({ x: eIn.x, y: eIn.y });
    pts.push(...pocketArcPoints(pk, jIn.b, jOut.b, false, step));
    pts.push({ x: eOut.x, y: eOut.y });
  }
  return pts;
}

/**
 * Closed outline of the playing cloth bed + tapered pocket throat shelves up to each circular drop rim.
 */
export function clothBedOutline({ W, H, pockets = [], step = 3 }) {
  if (!pockets.length) return clothCutoutOutline({ W, H, circles: [], step });
  const order = [0, 4, 1, 3, 5, 2].map((id) => pockets.find((p) => p.id === id)).filter(Boolean);
  const pts = [];
  for (const pk of order) {
    const [jIn, jOut] = orderedPocketJaws(pk, W, H);
    pts.push({ x: jIn.a.x, y: jIn.a.y });
    pts.push(...pocketArcPoints(pk, jIn.b, jOut.b, true, step));
    pts.push({ x: jOut.a.x, y: jOut.a.y });
  }
  return pts;
}

/* ------------------------------------------------------------------ paths -> 3D polylines */

/** Dash a segment a->b: returns [{a,b}]. */
export function dashSegments(a, b, dash, gap) {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  const out = [];
  if (L < 1e-9) return out;
  const ux = (b.x - a.x) / L;
  const uy = (b.y - a.y) / L;
  for (let t = 0; t < L; t += dash + gap) {
    const t1 = Math.min(L, t + dash);
    out.push({ a: { x: a.x + ux * t, y: a.y + uy * t }, b: { x: a.x + ux * t1, y: a.y + uy * t1 } });
  }
  return out;
}

/** Path samples {x,y,s} -> coloured segments (sliding = s 1 on the end sample, like the 2D view). */
export function pathSegments(path) {
  const segs = [];
  for (let i = 1; i < path.length; i++) {
    segs.push({ a: path[i - 1], b: path[i], slide: path[i].s === 1 });
  }
  return segs;
}

/** Index of the first sample where sliding turns into natural roll, or -1. */
export function naturalRollIndex(path) {
  for (let k = 1; k < path.length; k++) if (path[k].s === 0 && path[k - 1].s === 1) return k;
  return -1;
}

/**
 * Flat ribbons on the cloth: segs [{a:{x,y}, b:{x,y}, w (mm), c:[r,g,b] 0..1}] -> arrays for a BufferGeometry.
 * Vertices are (x, yLevel, y) in physics-mm / three-local axes (three.z = physics y).
 */
export function ribbonQuads(segs, yLevel = 1) {
  const positions = [];
  const colors = [];
  const indices = [];
  let vi = 0;
  for (const s of segs) {
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const L = Math.hypot(dx, dy);
    if (L < 1e-6) continue;
    const nx = (-dy / L) * (s.w / 2);
    const ny = (dx / L) * (s.w / 2);
    positions.push(s.a.x + nx, yLevel, s.a.y + ny, s.a.x - nx, yLevel, s.a.y - ny, s.b.x + nx, yLevel, s.b.y + ny, s.b.x - nx, yLevel, s.b.y - ny);
    for (let i = 0; i < 4; i++) colors.push(s.c[0], s.c[1], s.c[2]);
    indices.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
    vi += 4;
  }
  return { positions, colors, indices };
}

export function parseHex(hex) {
  const h = String(hex).replace('#', '');
  const v = parseInt(h.length === 3 ? h.replace(/./g, (m) => m + m) : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/* ------------------------------------------------------------------ ball textures */

// Mesh-local frame = physics body frame; three SphereGeometry (pole on local y) maps uv.x = phi/2pi, uv.y = 1 - theta/pi
// with x = -cos(phi) sin(theta), y = cos(theta), z = sin(phi) sin(theta).
export function uvOfBodyPoint(p) {
  const l = Math.hypot(p.x, p.y, p.z) || 1;
  let u = Math.atan2(p.z / l, -p.x / l) / (2 * Math.PI);
  if (u < 0) u += 1;
  return { u, v: 1 - Math.acos(clamp(p.y / l, -1, 1)) / Math.PI };
}

export const NUMBER_SIN = 0.46; // number disc angular radius = asin(0.46), as in the 2D renderer
export const STRIPE_HALF = 0.56;
const CUE_N = (() => {
  const l = Math.hypot(0.55, 0.35, 0.76);
  return { x: 0.55 / l, y: 0.35 / l, z: -0.76 / l };
})();
const NUM_DISCS = [
  { n: { x: 0, y: 0, z: -1 }, u: { x: 1, y: 0, z: 0 } },
  { n: { x: 0, y: 0, z: 1 }, u: { x: -1, y: 0, z: 0 } },
];

/** Position of body point p inside a number disc: gx right / gy down in [-1, 1] (text space), inside flag. */
export function discLocal(p, disc) {
  const vv = cross3(disc.u, disc.n);
  return {
    gx: dot3(p, disc.u) / NUMBER_SIN,
    gy: dot3(p, vv) / NUMBER_SIN,
    d: dot3(p, disc.n),
  };
}
export const NUMBER_DISCS = NUM_DISCS;

const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Per-texel ball texture (RGBA, row 0 = v 0 as THREE.DataTexture expects).
 * spec: { id, base:[r,g,b], stripe:[r,g,b]|null, dots:boolean, number:boolean, glyph:{size, alpha:Uint8Array}|null }
 */
export function ballTexturePixels(spec, w, h) {
  const out = new Uint8Array(w * h * 4);
  const cosRho = Math.sqrt(1 - NUMBER_SIN * NUMBER_SIN);
  const dotThr = Math.sqrt(1 - 0.17 * 0.17);
  const white = [247, 246, 239];
  const dark = 17;
  const cphi = new Float64Array(w);
  const sphi = new Float64Array(w);
  for (let c = 0; c < w; c++) {
    const phi = (2 * Math.PI * (c + 0.5)) / w;
    cphi[c] = Math.cos(phi);
    sphi[c] = Math.sin(phi);
  }
  const eps = 0.012;
  const g = spec.glyph;
  const glyphAt = (gx, gy) => {
    if (!g) return 0;
    const fx = ((gx + 1) / 2) * (g.size - 1);
    const fy = ((gy + 1) / 2) * (g.size - 1);
    if (fx < 0 || fy < 0 || fx > g.size - 1 || fy > g.size - 1) return 0;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(g.size - 1, x0 + 1);
    const y1 = Math.min(g.size - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const a = (x, y) => g.alpha[y * g.size + x] / 255;
    return (a(x0, y0) * (1 - tx) + a(x1, y0) * tx) * (1 - ty) + (a(x0, y1) * (1 - tx) + a(x1, y1) * tx) * ty;
  };
  const mix = (c0, c1, t) => [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
  const discV = NUM_DISCS.map((d) => cross3(d.u, d.n));
  const dEps = 0.004;
  for (let r = 0; r < h; r++) {
    const theta = Math.PI * (1 - (r + 0.5) / h);
    const py = Math.cos(theta);
    const sT = Math.sin(theta);
    const ay = Math.abs(py);
    for (let c = 0; c < w; c++) {
      const px = -cphi[c] * sT;
      const pz = sphi[c] * sT;
      let col = spec.base;
      if (spec.stripe && ay < STRIPE_HALF + eps) col = mix(col, spec.stripe, smooth(STRIPE_HALF + eps, STRIPE_HALF - eps, ay));
      if (spec.dots) {
        const dd = px * CUE_N.x + py * CUE_N.y + pz * CUE_N.z;
        const t = smooth(dotThr - dEps, dotThr + dEps, Math.abs(dd));
        if (t > 0) col = mix(col, [211, 47, 47], t);
      }
      if (spec.number) {
        for (let k = 0; k < 2; k++) {
          const disc = NUM_DISCS[k];
          const dn = px * disc.n.x + py * disc.n.y + pz * disc.n.z;
          if (dn < cosRho - dEps) continue;
          const t = smooth(cosRho - dEps, cosRho + dEps, dn);
          let dc = mix(col, white, t);
          if (g) {
            const v = discV[k];
            const gx = (px * disc.u.x + py * disc.u.y + pz * disc.u.z) / NUMBER_SIN;
            const gy = (px * v.x + py * v.y + pz * v.z) / NUMBER_SIN;
            const a = glyphAt(gx, gy) * t;
            if (a > 0) dc = mix(dc, [dark, dark, dark], a);
          }
          col = dc;
        }
      }
      const o = (r * w + c) * 4;
      out[o] = col[0];
      out[o + 1] = col[1];
      out[o + 2] = col[2];
      out[o + 3] = 255;
    }
  }
  return out;
}
