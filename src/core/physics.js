// Billiard physics engine (pure, no DOM). Units: mm, seconds.
//
// Frame: x right, y down (screen), z DOWN into the cloth (right-handed). "Up" is -z.
// Ball: { id, pos, vel, w:{x,y,z} (rad/s, world frame), q (orientation quaternion body->world), potted, path, sliding }
//   Contact point with the cloth is r = (0,0,+R). Contact slip u = v + w x r = (vx + R*wy, vy - R*wx).
//   Rolling without slipping <=> u = 0 <=> wy = -vx/R, wx = vy/R.
//   Helper getters (derived from w, velocity units):
//     ball.spin = R*(-wy, wx)  ("roll vector": equals vel when rolling)
//     ball.side = -R*wz        (english; positive = tip to the right of the aim direction)
// Table/cloth/cushion constants come from a TableProfile, cue constants from a CueProfile (see equipment.js).
import { norm, clamp, rotate, rad, deg } from './vec.js';
import { R, buildTable } from './table.js';
import { defaultTable, defaultCue, stickSpeed, ballSpeed, squirtDeg } from './equipment.js';

export const G = 9810;
export const E_BALL = 0.95; // ball-ball restitution
// Ball-ball friction (throw): mu(s) = a + b*exp(-c*s), s = contact slip speed in m/s [Unverified: estimate of a published fit].
// TableProfile.ballFrictionA/B/C override; TableProfile.ballFriction is a multiplier (1 = as fitted).
export const MU_BALL_A = 0.01;
export const MU_BALL_B = 0.108;
export const MU_BALL_C = 1.088;
export const SPIN_NORMAL_KEEP = -0.5; // cushion: normal spin component multiplier
export const SIDE_KEEP = 0.5; // cushion: english kept after a bounce
export const DT = 1 / 600;
export const STOP_SPEED = 5;
export const CUE_ID = 0;
export const MISCUE_SPEED_FACTOR = 0.3;
export const MISCUE_MAX_DEG = 3;
export const DEFAULT_ELEVATION_DEG = 5; // UI / drill default; the engine itself defaults to a level cue (0) when a shot omits it
export const MAX_ELEVATION_DEG = 30;

/* ------------------------------------------------------------------ quaternions (pure helpers) */

export const quatIdentity = () => ({ w: 1, x: 0, y: 0, z: 0 });

/** In-place: q <- dq(w*dt) * q  (w in the world frame, exact axis-angle step), then renormalise. */
export function integrateQuat(q, w, dt) {
  const wl = Math.sqrt(w.x * w.x + w.y * w.y + w.z * w.z);
  if (wl < 1e-12) return q;
  const half = 0.5 * wl * dt;
  const s = Math.sin(half) / wl;
  const dw = Math.cos(half);
  const dx = w.x * s;
  const dy = w.y * s;
  const dz = w.z * s;
  const nw = dw * q.w - dx * q.x - dy * q.y - dz * q.z;
  const nx = dw * q.x + dx * q.w + dy * q.z - dz * q.y;
  const ny = dw * q.y - dx * q.z + dy * q.w + dz * q.x;
  const nz = dw * q.z + dx * q.y - dy * q.x + dz * q.w;
  const inv = 1 / Math.sqrt(nw * nw + nx * nx + ny * ny + nz * nz);
  q.w = nw * inv;
  q.x = nx * inv;
  q.y = ny * inv;
  q.z = nz * inv;
  return q;
}

/** Rotate vector v (3D) by quaternion q (body -> world). */
export function rotateByQuat(q, v) {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

export const quatLength = (q) => Math.hypot(q.w, q.x, q.y, q.z);

/* ------------------------------------------------------------------ balls */

/** Roll vector (velocity units) and english from the angular velocity. `+ 0` removes negative zeros. */
export const rollSpin = (b) => ({ x: -R * b.w.y + 0, y: R * b.w.x + 0 });
export const sideSpin = (b) => -R * b.w.z + 0;

function attachGetters(b) {
  Object.defineProperty(b, 'spin', { get() { return rollSpin(this); }, enumerable: false, configurable: true });
  Object.defineProperty(b, 'side', { get() { return sideSpin(this); }, enumerable: false, configurable: true });
  return b;
}

export function createBall(id, x = 0, y = 0) {
  return attachGetters({
    id,
    pos: { x, y },
    vel: { x: 0, y: 0 },
    w: { x: 0, y: 0, z: 0 },
    q: quatIdentity(),
    potted: false,
    sliding: false,
    path: [],
  });
}

export function cloneBall(b) {
  let w = { x: 0, y: 0, z: 0 };
  if (b.w) w = { x: b.w.x, y: b.w.y, z: b.w.z };
  return attachGetters({
    id: b.id,
    pos: { x: b.pos.x, y: b.pos.y },
    vel: { x: b.vel ? b.vel.x : 0, y: b.vel ? b.vel.y : 0 },
    w,
    q: b.q ? { w: b.q.w, x: b.q.x, y: b.q.y, z: b.q.z } : quatIdentity(),
    potted: !!b.potted,
    sliding: false,
    path: [],
  });
}

export const cloneBalls = (balls) => balls.map(cloneBall);

/* ------------------------------------------------------------------ cue strike */

const cross3 = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/**
 * Cue-ball launch from a tip hit (pure; does not touch any ball).
 *  - tip = {x,y}: contact point offset from the ball centre as a fraction of R (unit circle) in the plane
 *    perpendicular to the cue. x>0 right english, y>0 top (follow), y<0 draw.
 *  - elevationDeg: butt-up angle of the cue (0 = level). The cue travels downwards, the vertical impulse is
 *    absorbed by the table; only the horizontal part launches the ball. Elevation + side english makes the
 *    spin axis tilt out of the vertical => lateral slip => swerve.
 *  - ball speed v = (1 + e_tip) * m_cue / (m_cue + m_ball) * v_stick  (horizontal speed, independent of elevation)
 *  - angular velocity w = (p x J) / I with I = 2/5 m R^2, scaled by spinEfficiency
 *  - squirt: launch direction = aimDir rotated by -squirtDegPerFullSide * tip.x degrees (right english -> left)
 *  - miscue: |tip| > miscueLimit  =>  30 % speed, random +-3 deg, no spin
 * Returns { dir, speed, w, spin, side, miscue, squirtDeg, stick, elevationDeg }.
 */
export function computeLaunch(aimDir, power, tip = { x: 0, y: 0 }, cue = defaultCue(), rng = Math.random, elevationDeg = 0) {
  const d = norm(aimDir);
  let tx = tip.x || 0;
  let ty = tip.y || 0;
  const tl = Math.hypot(tx, ty);
  if (tl > 1) {
    tx /= tl;
    ty /= tl;
  }
  const elev = clamp(elevationDeg, 0, MAX_ELEVATION_DEG);
  const stick = stickSpeed(power);
  const full = ballSpeed(cue, stick);
  if (Math.hypot(tx, ty) > cue.miscueLimit + 1e-9) {
    const ang = (rng() * 2 - 1) * MISCUE_MAX_DEG;
    return {
      dir: rotate(d, rad(ang)),
      speed: full * MISCUE_SPEED_FACTOR,
      w: { x: 0, y: 0, z: 0 },
      spin: { x: 0, y: 0 },
      side: 0,
      miscue: true,
      squirtDeg: ang,
      stick,
      elevationDeg: elev,
    };
  }
  const sq = squirtDeg(cue, tx);
  const dir = Math.abs(sq) > 1e-12 ? rotate(d, rad(sq)) : d;

  const th = rad(elev);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const dc = { x: c * d.x, y: c * d.y, z: s }; // cue direction (unit), pointing into the ball and downwards
  const rt = { x: -d.y, y: d.x, z: 0 }; // right of the aim direction
  const up = { x: s * d.x, y: s * d.y, z: -c }; // "up" in the plane perpendicular to the cue
  const depth = Math.sqrt(Math.max(0, 1 - tx * tx - ty * ty));
  const p = {
    x: R * (tx * rt.x + ty * up.x - depth * dc.x),
    y: R * (tx * rt.y + ty * up.y - depth * dc.y),
    z: R * (tx * rt.z + ty * up.z - depth * dc.z),
  };
  const jm = full / c; // impulse per unit mass so that the horizontal speed is `full`
  const pxj = cross3(p, { x: dc.x * jm, y: dc.y * jm, z: dc.z * jm });
  const k = cue.spinEfficiency / (0.4 * R * R);
  const w = { x: pxj.x * k + 0, y: pxj.y * k + 0, z: pxj.z * k + 0 };
  return {
    dir,
    speed: full,
    w,
    spin: { x: -R * w.y + 0, y: R * w.x + 0 },
    side: -R * w.z + 0,
    miscue: false,
    squirtDeg: sq,
    stick,
    elevationDeg: elev,
  };
}

/** Apply a cue strike to `ball`. Returns the launch info (see computeLaunch). */
export function strike(ball, aimDir, power, tip = { x: 0, y: 0 }, cue = defaultCue(), rng = Math.random, elevationDeg = 0) {
  const L = computeLaunch(aimDir, power, tip, cue, rng, elevationDeg);
  ball.vel = { x: L.dir.x * L.speed, y: L.dir.y * L.speed };
  ball.w = { x: L.w.x, y: L.w.y, z: L.w.z };
  return L;
}

/* ------------------------------------------------------------------ simulation */

export class Sim {
  /** opts: { table: TableProfile, cue: CueProfile, rng, dt, recordPaths, pathEvery, orientation (default true) } */
  constructor(balls, opts = {}) {
    this.tableProfile = opts.table || defaultTable();
    this.cueProfile = opts.cue || defaultCue();
    this.geo = buildTable(this.tableProfile);
    this.rng = opts.rng || Math.random;
    this.dt = opts.dt || DT;
    this.recordPaths = !!opts.recordPaths;
    this.pathEvery = opts.pathEvery || 5;
    this.orient = opts.orientation !== false;
    this.balls = cloneBalls(balls);
    this.time = 0;
    this.steps = 0;
    this.acc = 0;
    this.muSlide = this.tableProfile.muSlide;
    this.muRoll = this.tableProfile.muRoll;
    this.eCushion = this.tableProfile.cushionRestitution;
    this.sideKick = this.tableProfile.cushionSpinTransfer;
    const tp = this.tableProfile;
    this.ballFrictionScale = tp.ballFriction ?? 1;
    this.ballMuA = tp.ballFrictionA ?? MU_BALL_A;
    this.ballMuB = tp.ballFrictionB ?? MU_BALL_B;
    this.ballMuC = tp.ballFrictionC ?? MU_BALL_C;
    this.sideDecay = Math.exp(-this.tableProfile.sideSpinDecay * this.dt);
    this.events = {
      firstContact: null,
      firstContactPos: null, // cue-ball centre at the first contact
      firstContactObjPos: null, // object-ball centre at the first contact
      potted: [],
      cushionHits: [],
      contacts: [],
      miscue: false,
    };
    this.launch = null;
    if (this.recordPaths) for (const b of this.balls) b.path.push({ x: b.pos.x, y: b.pos.y, s: 0 });
  }

  get cue() {
    return this.balls.find((b) => b.id === CUE_ID);
  }

  /** shot = { aimDir, power 0..1, tip, elevationDeg }. Returns launch info or null. */
  strike(shot) {
    const c = this.cue;
    if (!c || c.potted) return null;
    this.launch = strike(c, shot.aimDir, shot.power, shot.tip, this.cueProfile, this.rng, shot.elevationDeg ?? 0);
    this.events.miscue = this.launch.miscue;
    return this.launch;
  }

  isMoving() {
    for (const b of this.balls) {
      if (b.potted) continue;
      if (b.vel.x !== 0 || b.vel.y !== 0 || b.w.x !== 0 || b.w.y !== 0) return true;
    }
    return false;
  }

  /** Advance by dt seconds (any size) using fixed internal substeps. */
  step(dt) {
    this.acc += dt;
    while (this.acc >= this.dt - 1e-9) {
      this.substep();
      this.acc -= this.dt;
    }
  }

  _endPaths() {
    if (!this.recordPaths) return;
    for (const b of this.balls) {
      const last = b.path[b.path.length - 1];
      if (!last || last.x !== b.pos.x || last.y !== b.pos.y) b.path.push({ x: b.pos.x, y: b.pos.y, s: 0 });
    }
  }

  run(maxTime = 20) {
    while (this.isMoving() && this.time < maxTime) this.substep();
    this._endPaths();
  }

  /**
   * Run only until the first ball-ball contact of the cue ball plus `extraSec` (default 50 ms), for the aim solver.
   * Aborts early (returns null) if the cue ball reaches a cushion or a pocket before touching a ball.
   * Returns the id of the first ball touched, or null.
   */
  runToContact(maxTime = 6, extraSec = 0.05) {
    const extra = Math.max(1, Math.ceil(extraSec / this.dt));
    let left = -1;
    while (this.isMoving() && this.time < maxTime) {
      this.substep();
      if (left < 0) {
        if (this.events.firstContact !== null) left = extra;
        else if (this.events.cushionHits.length || this.events.potted.length) break;
      } else if (--left <= 0) break;
    }
    return this.events.firstContact;
  }

  substep() {
    const dt = this.dt;
    const balls = this.balls;
    for (const b of balls) if (!b.potted) this._move(b, dt);
    this._collide();
    for (const b of balls) if (!b.potted && (b.vel.x !== 0 || b.vel.y !== 0)) this._boundaries(b);
    this.time += dt;
    this.steps++;
    if (this.recordPaths && this.steps % this.pathEvery === 0) {
      for (const b of balls) {
        if (!b.potted && (b.vel.x !== 0 || b.vel.y !== 0)) b.path.push({ x: b.pos.x, y: b.pos.y, s: b.sliding ? 1 : 0 });
      }
    }
  }

  _move(b, dt) {
    const v = b.vel;
    const w = b.w;
    if (v.x === 0 && v.y === 0 && w.x === 0 && w.y === 0) {
      w.z = 0;
      b.sliding = false;
      return;
    }
    // contact-point slip
    const ux = v.x + R * w.y;
    const uy = v.y - R * w.x;
    const ul = Math.hypot(ux, uy);
    if (ul > 1e-3) {
      // sliding: friction F = -mu m g u/|u| at the contact point; dw = (r x F)/I
      const a = this.muSlide * G * dt;
      let dvx;
      let dvy;
      if (ul <= 3.5 * a) {
        // slip would reverse within this step: remove it exactly (v -= 2/7 u, w follows)
        dvx = (-2 / 7) * ux;
        dvy = (-2 / 7) * uy;
      } else {
        dvx = (-ux / ul) * a;
        dvy = (-uy / ul) * a;
      }
      v.x += dvx;
      v.y += dvy;
      w.x += (-2.5 * dvy) / R;
      w.y += (2.5 * dvx) / R;
      b.sliding = true;
    } else {
      // rolling
      b.sliding = false;
      const sp = Math.hypot(v.x, v.y);
      const dec = this.muRoll * G * dt;
      if (sp <= dec) {
        v.x = v.y = w.x = w.y = 0;
      } else {
        const k = (sp - dec) / sp;
        v.x *= k;
        v.y *= k;
        w.x = v.y / R;
        w.y = -v.x / R;
      }
    }
    if (Math.hypot(v.x, v.y) < STOP_SPEED && R * Math.hypot(w.x, w.y) < STOP_SPEED) {
      v.x = v.y = w.x = w.y = w.z = 0;
      b.sliding = false;
      return;
    }
    b.pos.x += v.x * dt;
    b.pos.y += v.y * dt;
    w.z *= this.sideDecay;
    if (this.orient) integrateQuat(b.q, w, dt);
  }

  _collide() {
    const balls = this.balls;
    const n = balls.length;
    const min2 = 4 * R * R;
    for (let i = 0; i < n; i++) {
      const a = balls[i];
      if (a.potted) continue;
      for (let j = i + 1; j < n; j++) {
        const b = balls[j];
        if (b.potted) continue;
        if (a.vel.x === 0 && a.vel.y === 0 && b.vel.x === 0 && b.vel.y === 0) continue;
        let dx = b.pos.x - a.pos.x;
        let dy = b.pos.y - a.pos.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min2) continue;
        // Sub-step impact time: back both balls up to the exact moment their centres were 2R apart,
        // resolve the collision there, then advance with the new velocities (removes the +-v*dt contact jitter).
        let tau = 0;
        {
          const rvx = a.vel.x - b.vel.x;
          const rvy = a.vel.y - b.vel.y;
          const rr = rvx * rvx + rvy * rvy;
          const bq = -(dx * rvx + dy * rvy); // dpos . rel with dpos = a - b = -(dx,dy)
          if (rr > 1e-9 && bq < 0) {
            const disc = bq * bq - rr * (d2 - min2);
            tau = Math.min(2 * this.dt, Math.max(0, (bq + Math.sqrt(Math.max(0, disc))) / rr));
            a.pos.x -= a.vel.x * tau;
            a.pos.y -= a.vel.y * tau;
            b.pos.x -= b.vel.x * tau;
            b.pos.y -= b.vel.y * tau;
            dx = b.pos.x - a.pos.x;
            dy = b.pos.y - a.pos.y;
          }
        }
        let d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1e-9) {
          dx = 1;
          dy = 0;
          d = 1e-9;
        } else {
          dx /= d;
          dy /= d;
        }
        const vn = (a.vel.x - b.vel.x) * dx + (a.vel.y - b.vel.y) * dy;
        if (vn > 0) {
          const jn = ((1 + E_BALL) / 2) * vn; // normal impulse per unit mass (each ball)
          // Contact points: r1 = +R n (ball a), r2 = -R n (ball b); n = (dx, dy, 0), linear velocities have z = 0.
          // vrel = (v1 + w1 x r1) - (v2 + w2 x r2); only its component perpendicular to n slips (3D: includes the
          // vertical part produced by top/back spin).
          const rvx = a.vel.x - b.vel.x;
          const rvy = a.vel.y - b.vel.y;
          // w x n for each ball (n has z = 0)
          const wan = { x: -a.w.z * dy, y: a.w.z * dx, z: a.w.x * dy - a.w.y * dx };
          const wbn = { x: -b.w.z * dy, y: b.w.z * dx, z: b.w.x * dy - b.w.y * dx };
          // (w1 x r1) - (w2 x r2) = R (w1 x n) + R (w2 x n)
          let ux = rvx + R * (wan.x + wbn.x);
          let uy = rvy + R * (wan.y + wbn.y);
          let uz = R * (wan.z + wbn.z);
          const un = ux * dx + uy * dy; // (vrel . n); uz has no n component
          ux -= un * dx;
          uy -= un * dy;
          a.vel.x -= jn * dx;
          a.vel.y -= jn * dy;
          b.vel.x += jn * dx;
          b.vel.y += jn * dy;
          const slip = Math.sqrt(ux * ux + uy * uy + uz * uz);
          if (slip > 1e-9 && this.ballFrictionScale > 0) {
            const mu = this.ballFrictionScale * (this.ballMuA + this.ballMuB * Math.exp((-this.ballMuC * slip) / 1000));
            // friction impulse (per unit mass), Coulomb-limited; sticks when the slip would reverse (|vt|/7)
            const jt = Math.min(mu * jn, slip / 7);
            const fx = (-ux / slip) * jt;
            const fy = (-uy / slip) * jt;
            const fz = (-uz / slip) * jt;
            // linear: horizontal part only (the vertical part is absorbed by the table)
            a.vel.x += fx;
            a.vel.y += fy;
            b.vel.x -= fx;
            b.vel.y -= fy;
            // angular: dw = (r x F)/I, I = 0.4 m R^2; r1 = +R n on a with F, r2 = -R n on b with -F  => same dw
            const k = 2.5 / R;
            const dwx = k * (dy * fz);
            const dwy = k * (-dx * fz);
            const dwz = k * (dx * fy - dy * fx);
            a.w.x += dwx;
            a.w.y += dwy;
            a.w.z += dwz;
            b.w.x += dwx;
            b.w.y += dwy;
            b.w.z += dwz;
          }
          const ev = this.events;
          if (ev.contacts.length < 60) {
            ev.contacts.push({
              a: a.id,
              b: b.id,
              time: this.time,
              pos: { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 },
            });
          }
          if (ev.firstContact === null && (a.id === CUE_ID || b.id === CUE_ID)) {
            const cueB = a.id === CUE_ID ? a : b;
            const objB = a.id === CUE_ID ? b : a;
            ev.firstContact = objB.id;
            ev.firstContactPos = { x: cueB.pos.x, y: cueB.pos.y };
            ev.firstContactObjPos = { x: objB.pos.x, y: objB.pos.y };
          }
        }
        if (tau > 0) {
          a.pos.x += a.vel.x * tau;
          a.pos.y += a.vel.y * tau;
          b.pos.x += b.vel.x * tau;
          b.pos.y += b.vel.y * tau;
          dx = b.pos.x - a.pos.x;
          dy = b.pos.y - a.pos.y;
          d = Math.sqrt(dx * dx + dy * dy) || 1e-9;
          dx /= d;
          dy /= d;
        }
        const overlap = 2 * R - d;
        if (overlap > 0) {
          const push = overlap / 2 + 1e-6;
          a.pos.x -= dx * push;
          a.pos.y -= dy * push;
          b.pos.x += dx * push;
          b.pos.y += dy * push;
        }
      }
    }
  }

  _pot(b, pk) {
    b.potted = true;
    b.vel.x = b.vel.y = 0;
    b.w.x = b.w.y = b.w.z = 0;
    b.sliding = false;
    b.pos.x = pk.x;
    b.pos.y = pk.y;
    this.events.potted.push(b.id);
    if (this.recordPaths) b.path.push({ x: pk.x, y: pk.y, s: 0 });
  }

  _boundaries(b) {
    const p = b.pos;
    const v = b.vel;
    const sp = Math.hypot(v.x, v.y);
    if (sp > 1e-9) {
      for (const pk of this.geo.POCKETS) {
        const dx = p.x - pk.x;
        const dy = p.y - pk.y;
        if (dx * dx + dy * dy < pk.capture * pk.capture) {
          const c = (v.x * pk.axis.x + v.y * pk.axis.y) / sp;
          if (c < -pk.minCos) {
            this._pot(b, pk);
            return;
          }
        }
      }
    }
    for (const w of this.geo.WALLS) {
      const d = w.depth(p);
      if (d >= R) continue;
      const inGap = w.gap(w.along(p));
      if (d < 0 && inGap) {
        // crossed the rail line inside a pocket opening
        let best = this.geo.POCKETS[0];
        let bd = Infinity;
        for (const pk of this.geo.POCKETS) {
          const dd = (p.x - pk.x) ** 2 + (p.y - pk.y) ** 2;
          if (dd < bd) {
            bd = dd;
            best = pk;
          }
        }
        this._pot(b, best);
        return;
      }
      if (inGap) continue;
      const vn = v.x * w.n.x + v.y * w.n.y;
      if (vn > 0) this._reflect(b, w, vn);
      else if (d < 0) this._fixDepth(b, w);
    }
    this._tips(b);
  }

  /** Cushion tips (jaw points) act as point obstacles: the ball centre cannot come closer than R. */
  _tips(b) {
    const p = b.pos;
    const v = b.vel;
    for (const t of this.geo.TIPS) {
      const dx = p.x - t.x;
      const dy = p.y - t.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= R * R) continue;
      const d = Math.sqrt(d2) || 1e-9;
      const nx = dx / d;
      const ny = dy / d;
      const vn = v.x * nx + v.y * ny;
      if (vn < 0) {
        v.x -= (1 + this.eCushion) * vn * nx;
        v.y -= (1 + this.eCushion) * vn * ny;
        b.w.z *= SIDE_KEEP;
        const ch = this.events.cushionHits;
        if (ch.length < 200) ch.push({ id: b.id, time: this.time, wall: 'tip' });
      }
      p.x = t.x + nx * (R + 1e-6);
      p.y = t.y + ny * (R + 1e-6);
    }
  }

  _fixDepth(b, w) {
    const d = w.depth(b.pos);
    if (d < R) {
      b.pos.x -= w.n.x * (R - d);
      b.pos.y -= w.n.y * (R - d);
    }
  }

  _reflect(b, w, vn) {
    const n = w.n;
    const v = b.vel;
    const wv = b.w;
    v.x -= (1 + this.eCushion) * vn * n.x;
    v.y -= (1 + this.eCushion) * vn * n.y;
    // roll vector (velocity units): normal component reversed and damped
    const sx = -R * wv.y;
    const sy = R * wv.x;
    const sn = sx * n.x + sy * n.y;
    const k = 1 - SPIN_NORMAL_KEEP; // sn -> SPIN_NORMAL_KEEP * sn
    const nsx = sx - k * sn * n.x;
    const nsy = sy - k * sn * n.y;
    wv.y = -nsx / R;
    wv.x = nsy / R;
    // english kicks the ball along the cushion (capped by the normal speed); side = -R*wz
    let kick = this.sideKick * (-R * wv.z);
    const cap = 0.6 * vn;
    kick = clamp(kick, -cap, cap);
    v.x += kick * -n.y;
    v.y += kick * n.x;
    wv.z *= SIDE_KEEP;
    this._fixDepth(b, w);
    const ch = this.events.cushionHits;
    if (ch.length < 200) ch.push({ id: b.id, time: this.time, wall: w.name });
  }
}

export function createSim(balls, opts = {}) {
  return new Sim(balls, opts);
}

/**
 * Simulate a copy of `balls` (input is not mutated). shot = {aimDir, power, tip, elevationDeg} applied to cue ball (id 0).
 * Returns { balls, paths: {id: [{x,y,s}]}, events, time, launch }. s = 1 while the ball slides, 0 while it rolls.
 * Orientation is not integrated unless opts.orientation === true.
 */
export function simulate(balls, shot, opts = {}) {
  const sim = new Sim(balls, {
    recordPaths: opts.recordPaths !== false,
    table: opts.table,
    cue: opts.cue,
    rng: opts.rng,
    dt: opts.dt,
    pathEvery: opts.pathEvery,
    orientation: opts.orientation === true,
  });
  const launch = shot ? sim.strike(shot) : null;
  sim.run(opts.maxTime ?? 20);
  const paths = {};
  for (const b of sim.balls) paths[b.id] = b.path;
  return { balls: sim.balls, paths, events: sim.events, time: sim.time, launch };
}

export { deg };
