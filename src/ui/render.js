// Canvas rendering + view transform. Auto-rotates the table 90 degrees on portrait canvases.
import { R, RAIL, buildTable, railStripBevel, pocketThroatPolygon } from '../core/table.js';
import { cueVisualStyle } from '../core/equipment.js';
import { rotateByQuat } from '../core/physics.js';
import { rad } from '../core/vec.js';
import { dropVisual } from './drop-anim.js';

export const BALL_COLORS = {
  1: '#f4c20d',
  2: '#1456c8',
  3: '#d62828',
  4: '#6a2c91',
  5: '#f77f00',
  6: '#1b8a3c',
  7: '#7b1e1e',
  8: '#151515',
  9: '#f4c20d',
  10: '#1456c8',
  11: '#d62828',
  12: '#6a2c91',
  13: '#f77f00',
  14: '#1b8a3c',
  15: '#7b1e1e',
};

const PAD = 8;

export function createRenderer(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  const maxDpr = opts.maxDpr || Infinity;
  let geo = buildTable();
  let { W, H, POCKETS, RAIL_SEGMENTS, JAWS, HEAD_X, HEAD_SPOT, FOOT_SPOT } = geo;
  const view = { cssW: 1, cssH: 1, dpr: 1, scale: 1, rot: false, cx: 0, cy: 0, m: [1, 0, 0, 1, 0, 0] };
  let tableCache = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  let tableDirty = true;
  let cachedHead = null;

  /** Switch to another table geometry (see buildTable). */
  function setTable(g) {
    geo = g;
    ({ W, H, POCKETS, RAIL_SEGMENTS, JAWS, HEAD_X, HEAD_SPOT, FOOT_SPOT } = g);
    tableDirty = true;
    resize();
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    view.cssW = Math.max(1, rect.width);
    view.cssH = Math.max(1, rect.height);
    view.dpr = dpr;
    const bw = W + 2 * RAIL;
    const bh = H + 2 * RAIL;
    view.rot = view.cssH > view.cssW;
    const dw = view.rot ? bh : bw;
    const dh = view.rot ? bw : bh;
    view.scale = Math.max(0.01, Math.min((view.cssW - 2 * PAD) / dw, (view.cssH - 2 * PAD) / dh));
    view.cx = view.cssW / 2;
    view.cy = view.cssH / 2;
    const s = view.scale;
    if (view.rot) {
      // sx = cx - (y - H/2) s ; sy = cy + (x - W/2) s
      view.m = [0, s, -s, 0, view.cx + (s * H) / 2, view.cy - (s * W) / 2];
    } else {
      view.m = [s, 0, 0, s, view.cx - (s * W) / 2, view.cy - (s * H) / 2];
    }
    canvas.width = Math.max(1, Math.round(view.cssW * dpr));
    canvas.height = Math.max(1, Math.round(view.cssH * dpr));
    tableDirty = true;
  }

  function worldToScreen(p) {
    const dx = p.x - W / 2;
    const dy = p.y - H / 2;
    const s = view.scale;
    return view.rot ? { x: view.cx - dy * s, y: view.cy + dx * s } : { x: view.cx + dx * s, y: view.cy + dy * s };
  }

  function screenToWorld(p) {
    const ux = (p.x - view.cx) / view.scale;
    const uy = (p.y - view.cy) / view.scale;
    return view.rot ? { x: uy + W / 2, y: -ux + H / 2 } : { x: ux + W / 2, y: uy + H / 2 };
  }

  const px = (n) => n / view.scale; // screen px -> world mm

  function setWorld() {
    const m = view.m;
    const d = view.dpr;
    ctx.setTransform(d * m[0], d * m[1], d * m[2], d * m[3], d * m[4], d * m[5]);
  }
  function setScreen() {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  }

  function roundRectTo(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawTableTo(c, showHead) {
    const IN = 36;
    const rRect = (x, y, w, h, r) => roundRectTo(c, x, y, w, h, r);
    // wood frame
    const g = c.createLinearGradient(-RAIL, -RAIL, W + RAIL, H + RAIL);
    g.addColorStop(0, '#6d4524');
    g.addColorStop(1, '#4a2c14');
    c.fillStyle = g;
    rRect(-RAIL, -RAIL, W + 2 * RAIL, H + 2 * RAIL, 48);
    c.fill();
    c.lineWidth = px(1.5);
    c.strokeStyle = '#25150a';
    c.stroke();
    // pocket leather hood collars recessed into the wood rails
    for (const pk of POCKETS) {
      c.fillStyle = '#17191a';
      c.beginPath();
      c.arc(pk.cx, pk.cy, pk.dropR + 10, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.08)';
      c.lineWidth = px(1);
      c.stroke();
    }
    // felt with subtle overhead lamp spotlight (playing surface + tapered pocket throat shelves)
    const feltGrad = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.12, W / 2, H / 2, Math.max(W, H) * 0.65);
    feltGrad.addColorStop(0, '#0f835e');
    feltGrad.addColorStop(0.6, '#0b6e4f');
    feltGrad.addColorStop(1, '#08583e');
    c.fillStyle = feltGrad;
    c.fillRect(0, 0, W, H);
    for (const pk of POCKETS) {
      const throat = pocketThroatPolygon(pk, true);
      c.beginPath();
      throat.forEach((pt, i) => (i ? c.lineTo(pt.x, pt.y) : c.moveTo(pt.x, pt.y)));
      c.closePath();
      c.fill();
    }
    // beveled cushion rails (angled cleanly into pocket jaws instead of square block ends)
    for (const s of RAIL_SEGMENTS) {
      const { pts } = railStripBevel(s, JAWS, IN);
      c.fillStyle = '#0a5a41';
      c.beginPath();
      pts.forEach((pt, i) => (i ? c.lineTo(pt.x, pt.y) : c.moveTo(pt.x, pt.y)));
      c.closePath();
      c.fill();
      c.strokeStyle = '#063d2b';
      c.lineWidth = px(1);
      c.beginPath();
      c.moveTo(pts[2].x, pts[2].y);
      c.lineTo(pts[3].x, pts[3].y);
      c.stroke();
    }
    // pocket drop wells + beveled jaw facings + leather hoods
    for (const pk of POCKETS) {
      const pg = c.createRadialGradient(pk.cx, pk.cy, pk.dropR * 0.2, pk.cx, pk.cy, pk.dropR);
      pg.addColorStop(0, '#020303');
      pg.addColorStop(0.76, '#050908');
      pg.addColorStop(1, '#101b17');
      c.fillStyle = pg;
      c.beginPath();
      c.arc(pk.cx, pk.cy, pk.dropR, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.65)';
      c.lineWidth = px(1.2);
      c.stroke();
      // outer pocket leather rim around the back of the well
      const [j0, j1] = pk.jaws;
      const a0 = Math.atan2(j0.b.y - pk.cy, j0.b.x - pk.cx);
      const a1 = Math.atan2(j1.b.y - pk.cy, j1.b.x - pk.cx);
      let d1 = (a1 - a0) % (2 * Math.PI);
      if (d1 < 0) d1 += 2 * Math.PI;
      const d2 = d1 - 2 * Math.PI;
      const midAngle = a0 + d1 / 2;
      const backClockwise = Math.cos(midAngle) * pk.axis.x + Math.sin(midAngle) * pk.axis.y < 0;
      c.strokeStyle = '#25292b';
      c.lineWidth = Math.max(px(2), 5);
      c.lineCap = 'round';
      c.beginPath();
      c.arc(pk.cx, pk.cy, pk.dropR + 3, a0, backClockwise ? a0 + d1 : a0 + d2, !backClockwise);
      c.stroke();
      // angled rubber jaw facings from rounded cushion knuckles into the well
      for (const j of pk.jaws) {
        c.strokeStyle = '#1b201e';
        c.lineWidth = Math.max(px(1.5), 3.2);
        c.beginPath();
        c.moveTo(j.a.x, j.a.y);
        c.lineTo(j.b.x, j.b.y);
        c.stroke();
        c.strokeStyle = '#15a074';
        c.lineWidth = px(1.1);
        c.beginPath();
        c.moveTo(j.a.x + j.n.x * 1.4, j.a.y + j.n.y * 1.4);
        c.lineTo(j.b.x + j.n.x * 1.4, j.b.y + j.n.y * 1.4);
        c.stroke();
      }
    }
    c.lineCap = 'butt';
    // cushion nose highlight
    c.strokeStyle = '#15a074';
    c.lineWidth = px(1.5);
    c.beginPath();
    for (const s of RAIL_SEGMENTS) {
      c.moveTo(s.a.x, s.a.y);
      c.lineTo(s.b.x, s.b.y);
    }
    c.stroke();
    // diamonds centred on the wood rails
    const mid = (IN + RAIL) / 2;
    c.fillStyle = '#e9dfc4';
    const dia = (x, y) => {
      c.beginPath();
      c.moveTo(x, y - 9);
      c.lineTo(x + 9, y);
      c.lineTo(x, y + 9);
      c.lineTo(x - 9, y);
      c.closePath();
      c.fill();
    };
    for (let i = 1; i < 8; i++) {
      if (i === 4) continue;
      dia((i * W) / 8, -mid);
      dia((i * W) / 8, H + mid);
    }
    for (let j = 1; j < 4; j++) {
      dia(-mid, (j * H) / 4);
      dia(W + mid, (j * H) / 4);
    }
    // head string + spots
    if (showHead) {
      c.strokeStyle = 'rgba(255,255,255,0.14)';
      c.lineWidth = px(1.2);
      c.beginPath();
      c.moveTo(HEAD_X, 0);
      c.lineTo(HEAD_X, H);
      c.stroke();
    }
    c.fillStyle = 'rgba(255,255,255,0.28)';
    for (const sp of [HEAD_SPOT, FOOT_SPOT, { x: W / 2, y: H / 2 }]) {
      c.beginPath();
      c.arc(sp.x, sp.y, 5, 0, Math.PI * 2);
      c.fill();
    }
  }

  /**
   * Body-fixed features are projected orthographically. A feature with outward normal n (world) and in-plane
   * tangent u is a flat disc of angular radius rho: centre R*cos(rho)*n_xy, radius R*sin(rho), drawn only while it
   * faces the viewer (up = -z). Basis (u, v = u x n) keeps text un-mirrored.
   */
  function bodyFeature(q, nb, ub) {
    const n = rotateByQuat(q, nb);
    const u = rotateByQuat(q, ub);
    return { n, u, v: { x: u.y * n.z - u.z * n.y, y: u.z * n.x - u.x * n.z, z: u.x * n.y - u.y * n.x } };
  }

  function discOnBall(x, y, r, f, rho, fill, text) {
    if (-f.n.z <= 0.03) return;
    const c = Math.cos(rho);
    const k = r * Math.sin(rho);
    ctx.save();
    ctx.translate(x + r * c * f.n.x, y + r * c * f.n.y);
    ctx.transform(f.u.x * k, f.u.y * k, f.v.x * k, f.v.y * k, 0, 0);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    if (text) {
      ctx.fillStyle = '#111';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = text.length > 1 ? '700 1.0px system-ui, sans-serif' : '700 1.25px system-ui, sans-serif';
      ctx.fillText(text, 0, 0.06);
    }
    ctx.restore();
  }

  const UP = { x: 0, y: 0, z: -1 };
  const DOWN = { x: 0, y: 0, z: 1 };
  const EX = { x: 1, y: 0, z: 0 };
  const NEG_EX = { x: -1, y: 0, z: 0 };
  const CUE_DOT = (() => {
    const l = Math.hypot(0.55, 0.35, 0.76);
    const n = { x: 0.55 / l, y: 0.35 / l, z: -0.76 / l };
    const m = Math.hypot(n.z, n.y); // u = n x ex normalised: any tangent works for a round dot
    return { n, neg: { x: -n.x, y: -n.y, z: -n.z }, u: { x: 0, y: n.z / m, z: -n.y / m } };
  })();
  const IDENT_Q = { w: 1, x: 0, y: 0, z: 0 };
  const unitShadeGrad = ctx.createRadialGradient(-0.4, -0.4, 0.05, -0.15, -0.15, 1.1);
  unitShadeGrad.addColorStop(0, 'rgba(255,255,255,0.55)');
  unitShadeGrad.addColorStop(0.35, 'rgba(255,255,255,0.08)');
  unitShadeGrad.addColorStop(1, 'rgba(0,0,0,0.30)');

  const STRIPE_H = 0.56;
  const STRIPE_N = 32;
  const STRIPE_LEVELS = [-STRIPE_H, -STRIPE_H / 2, 0, STRIPE_H / 2, STRIPE_H];
  const STRIPE_STRIDE = STRIPE_N + 1;
  const STRIPE_TOTAL = STRIPE_LEVELS.length * STRIPE_STRIDE;
  const stripeBX = new Float64Array(STRIPE_TOTAL);
  const stripeBY = new Float64Array(STRIPE_TOTAL);
  const stripeBZ = new Float64Array(STRIPE_TOTAL);
  for (let li = 0; li < STRIPE_LEVELS.length; li++) {
    const z = STRIPE_LEVELS[li];
    const rad = Math.sqrt(1 - z * z);
    const base = li * STRIPE_STRIDE;
    for (let i = 0; i <= STRIPE_N; i++) {
      const ph = (i / STRIPE_N) * Math.PI * 2;
      stripeBX[base + i] = rad * Math.cos(ph);
      stripeBY[base + i] = z;
      stripeBZ[base + i] = rad * Math.sin(ph);
    }
  }
  const srx = new Float64Array(STRIPE_TOTAL);
  const sry = new Float64Array(STRIPE_TOTAL);
  const srz = new Float64Array(STRIPE_TOTAL);

  /** 9-ball stripe: band |p . a| < h around the body axis a = (0,1,0), as front-facing quads. */
  function drawStripe(x, y, r, q, color) {
    const { w, x: qx, y: qy, z: qz } = q;
    const xx = 2 * qx * qx;
    const yy = 2 * qy * qy;
    const zz = 2 * qz * qz;
    const xy = 2 * qx * qy;
    const xz = 2 * qx * qz;
    const yz = 2 * qy * qz;
    const wx = 2 * w * qx;
    const wy = 2 * w * qy;
    const wz = 2 * w * qz;
    const m00 = 1 - yy - zz, m01 = xy - wz, m02 = xz + wy;
    const m10 = xy + wz, m11 = 1 - xx - zz, m12 = yz - wx;
    const m20 = xz - wy, m21 = yz + wx, m22 = 1 - xx - yy;

    for (let idx = 0; idx < STRIPE_TOTAL; idx++) {
      const bx = stripeBX[idx], by = stripeBY[idx], bz = stripeBZ[idx];
      srx[idx] = m00 * bx + m01 * by + m02 * bz;
      sry[idx] = m10 * bx + m11 * by + m12 * bz;
      srz[idx] = m20 * bx + m21 * by + m22 * bz;
    }

    ctx.fillStyle = color;
    ctx.beginPath();
    for (let li = 0; li + 1 < STRIPE_LEVELS.length; li++) {
      const rowA = li * STRIPE_STRIDE;
      const rowB = rowA + STRIPE_STRIDE;
      for (let i = 0; i < STRIPE_N; i++) {
        const ia = rowA + i;
        const ib = ia + 1;
        const ic = rowB + i + 1;
        const id = rowB + i;
        if (-srz[ia] < -0.08 || -srz[ib] < -0.08 || -srz[ic] < -0.08 || -srz[id] < -0.08) continue;
        ctx.moveTo(x + r * srx[ia], y + r * sry[ia]);
        ctx.lineTo(x + r * srx[ib], y + r * sry[ib]);
        ctx.lineTo(x + r * srx[ic], y + r * sry[ic]);
        ctx.lineTo(x + r * srx[id], y + r * sry[id]);
        ctx.closePath();
      }
    }
    ctx.fill();
  }

  function drawBallBody(b, r, withText, shade = 0) {
    const { x, y } = b.pos;
    const q = b.q || IDENT_Q;
    // shadow (shrinks/fades as ball drops into the pocket)
    if (shade < 0.7) {
      ctx.fillStyle = `rgba(0,0,0,${(0.28 * (1 - shade)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x + r * 0.14 * (1 - shade), y + r * 0.14 * (1 - shade), r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    const white = '#f7f6ef';
    if (b.id === 0) {
      ctx.fillStyle = white;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      const rho = Math.asin(0.17);
      discOnBall(x, y, r, bodyFeature(q, CUE_DOT.n, CUE_DOT.u), rho, '#d32f2f');
      discOnBall(x, y, r, bodyFeature(q, CUE_DOT.neg, CUE_DOT.u), rho, '#d32f2f');
    } else {
      if (b.id >= 9) {
        ctx.fillStyle = white;
        ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
        drawStripe(x, y, r, q, BALL_COLORS[b.id] || BALL_COLORS[9]);
      } else {
        ctx.fillStyle = BALL_COLORS[b.id] || '#888';
        ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
      const rho = Math.asin(0.46);
      const label = withText ? String(b.id) : '';
      discOnBall(x, y, r, bodyFeature(q, UP, EX), rho, white, label);
      discOnBall(x, y, r, bodyFeature(q, DOWN, NEG_EX), rho, white, label);
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(r, r);
    ctx.fillStyle = unitShadeGrad;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
    if (shade > 0) {
      ctx.fillStyle = `rgba(3,5,4,${shade.toFixed(3)})`;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    ctx.restore();
  }

  function drawDropBalls(drops, withText) {
    if (!drops || !drops.length) return;
    for (const d of drops) {
      const { fade, scale, shade, u } = dropVisual(d);
      if (fade <= 0.01) continue;
      // subtle pocket-capture ripple around the mouth
      if (u < 0.85) {
        const ru = u / 0.85;
        ctx.save();
        ctx.globalAlpha = (1 - ru) * 0.65;
        ctx.strokeStyle = d.id === 0 ? '#ff6b6b' : '#69f0ae';
        ctx.lineWidth = px(2);
        ctx.beginPath();
        ctx.arc(d.px, d.py, d.pr * (0.88 + 0.36 * ru), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      // clip to the pocket opening as the ball drops below the slate lip
      ctx.save();
      ctx.beginPath();
      ctx.arc(d.px, d.py, d.pr + Math.max(0, R * (1 - d.z / 18)), 0, Math.PI * 2);
      ctx.clip();
      ctx.globalAlpha = fade;
      drawBallBody({ id: d.id, pos: { x: d.x, y: d.y }, q: d.q }, R * scale, withText && scale > 0.7, shade);
      ctx.restore();
    }
  }

  function line(a, b) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  const along = (p, d, k) => ({ x: p.x + d.x * k, y: p.y + d.y * k });

  const SLIDE_COLOR = '#ff9800';

  /** Stroke one path coloured by state: sliding = orange, rolling = white / ball colour; ring where it reaches natural roll. */
  function strokePath(path, rollColor, width, dash) {
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    let i = 1;
    while (i < path.length) {
      const sl = path[i].s === 1;
      ctx.strokeStyle = sl ? SLIDE_COLOR : rollColor;
      ctx.beginPath();
      ctx.moveTo(path[i - 1].x, path[i - 1].y);
      while (i < path.length && (path[i].s === 1) === sl) {
        ctx.lineTo(path[i].x, path[i].y);
        i++;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (let k = 1; k < path.length; k++) {
      if (path[k].s === 0 && path[k - 1].s === 1) {
        ctx.lineWidth = px(1.6);
        ctx.strokeStyle = '#ffffff';
        ctx.fillStyle = SLIDE_COLOR;
        ctx.beginPath();
        ctx.arc(path[k].x, path[k].y, px(4.2), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      }
    }
  }

  /** paths: {id: [{x,y,s}]}. solid = replay trail (thin, translucent); otherwise dashed prediction. */
  function drawPaths(paths, solid) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const id of Object.keys(paths)) {
      const path = paths[id];
      if (!path || path.length < 2) continue;
      const nid = Number(id);
      const rollColor = nid === 0 ? 'rgba(255,255,255,0.9)' : BALL_COLORS[nid] || '#ccc';
      ctx.globalAlpha = solid ? 0.6 : nid !== 0 && nid !== 8 ? 0.95 : 1;
      const dash = solid ? [] : nid === 0 ? [px(7), px(6)] : [px(3), px(4)];
      strokePath(path, rollColor, px(solid ? 1.6 : nid === 0 ? 2 : 2.4), dash);
      ctx.globalAlpha = 1;
    }
  }

  function drawPredictions(pred, balls) {
    if (!pred) return;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    drawPaths(pred.paths, false);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // end markers
    for (const b of pred.balls) {
      const start = balls.find((o) => o.id === b.id);
      if (!start) continue;
      if (b.potted) {
        ctx.strokeStyle = b.id === 0 ? '#ff5252' : '#69f0ae';
        ctx.lineWidth = px(2.5);
        ctx.beginPath();
        ctx.arc(b.pos.x, b.pos.y, R * 1.2, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      if (Math.hypot(b.pos.x - start.pos.x, b.pos.y - start.pos.y) < 6) continue;
      ctx.strokeStyle = b.id === 0 ? 'rgba(255,255,255,0.8)' : BALL_COLORS[b.id] || '#ccc';
      ctx.lineWidth = px(1.8);
      ctx.beginPath();
      ctx.arc(b.pos.x, b.pos.y, R, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** Cue stick behind the cue ball along the aim line; pulled back proportionally to power and foreshortened when elevated over a rail. */
  function drawStick(st) {
    const d = st.dir;
    const n = { x: -d.y, y: d.x };
    const elev = rad(st.elevationDeg || 0);
    const ce = Math.cos(elev);
    const se = Math.sin(elev);
    const tipX = st.tip?.x || 0;
    const tipY = st.tip?.y || 0;
    const t2 = tipX * tipX + tipY * tipY;
    const tScale = t2 > 1 ? 1 / Math.sqrt(t2) : 1;
    const tx = tipX * tScale;
    const ty = tipY * tScale;
    const depth = Math.sqrt(Math.max(0, 1 - tx * tx - ty * ty));
    // Horizontal start distance from ball centre to contact point + pull-back projected onto the cloth plane
    const contactS = R * (depth * ce - ty * se);
    const contactLat = R * tx;
    const contactH = R * (1 + ty * ce + depth * se);
    const gap = (R * 0.5 + 6 + st.power * 230) * ce;
    const len = W * 0.6 * ce;
    const at = (k, w, ox = 0, oy = 0) => ({
      x: st.pos.x - d.x * (contactS + gap + k) + n.x * (contactLat + w) + ox,
      y: st.pos.y - d.y * (contactS + gap + k) + n.y * (contactLat + w) + oy,
    });
    const seg = (k0, k1, w0, w1, color, off = { x: 0, y: 0 }) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      const a = at(k0, -w0, off.x, off.y);
      const b = at(k1, -w1, off.x, off.y);
      const c = at(k1, w1, off.x, off.y);
      const e = at(k0, w0, off.x, off.y);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(e.x, e.y);
      ctx.closePath();
      ctx.fill();
    };
    const heightAt = (k) => Math.max(4, contactH + ((gap + k) / Math.max(0.4, ce)) * se - 22);
    const shadowOff = { x: heightAt(len * 0.35) * 0.25, y: heightAt(len * 0.35) * 0.3 };

    const vis = cueVisualStyle(st.cue);
    const sScale = vis.profileScale;
    const rt = (vis.tipDiameterMm / 2) * (5.5 / 6.25); // 12.5 mm maps cleanly to ~5.5 mm 2D stroke width
    const fLen = (vis.ferruleLenMm / 24) * 24 * ce;
    const tipEnd = 6 * ce;
    const ferrEnd = tipEnd + fLen;
    const shaftEnd = len * 0.6;
    const collarEnd = shaftEnd + 16 * ce;
    const forearmEnd = len * 0.74;
    const wrapEnd = len * 0.91;
    const capStart = len - 14 * ce;
    const rMid = (rt + 0.3) + (8.6 * sScale - (rt + 0.3)) * 0.95;

    ctx.save();
    // Cast shadow beneath the cue shaft (separates visibly above the wood rail when elevated)
    seg(0, len, rt, 13.2 * sScale, 'rgba(0, 0, 0, 0.32)', shadowOff);
    ctx.globalAlpha = 0.96;
    seg(0, tipEnd, rt, rt, vis.tipColor2d); // tip
    seg(tipEnd, ferrEnd, rt, rt + 0.3, vis.ferruleColor); // ferrule
    seg(ferrEnd, shaftEnd, rt + 0.3, 8.6 * sScale, vis.shaftColor); // shaft
    seg(shaftEnd, collarEnd, 8.6 * sScale, rMid, vis.collarColor); // joint collar
    seg(collarEnd, forearmEnd, rMid, 10.6 * sScale, vis.forearmColor); // forearm
    seg(forearmEnd, wrapEnd, 10.6 * sScale, 12.2 * sScale, vis.wrapColor); // wrap
    seg(wrapEnd, capStart, 12.2 * sScale, 13.0 * sScale, vis.buttColor); // butt sleeve
    seg(capStart, len, 13.0 * sScale, 13.2 * sScale, vis.capColor); // butt cap
    ctx.restore();
  }

  function drawOverlays(scene) {
    const o = scene.overlays;
    const info = scene.info;
    if (!info) return;
    ctx.lineCap = 'round';
    const blocked = info.blockedCue !== null;
    const hasGhost = !!info.ghost;
    if (o.aim) {
      if (scene.simpleAim) {
        ctx.strokeStyle = 'rgba(255,255,255,0.42)';
        ctx.lineWidth = px(1.6);
        ctx.setLineDash([px(6), px(6)]);
        line(info.cue, along(info.cue, info.aimDir, info.aimLen));
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = blocked ? 'rgba(255,82,82,0.95)' : 'rgba(255,255,255,0.85)';
        ctx.lineWidth = px(2);
        line(info.cue, along(info.cue, info.aimDir, info.aimLen));
      }
    }
    if (o.actual && info.actualDir && Math.abs(info.squirtDeg) > 0.005) {
      // where the cue ball really leaves (after squirt) vs the aim line
      ctx.strokeStyle = '#ff9800';
      ctx.lineWidth = px(2);
      ctx.setLineDash([px(9), px(5)]);
      const e = along(info.cue, info.actualDir, info.aimLen);
      line(info.cue, e);
      ctx.setLineDash([]);
      ctx.fillStyle = '#ff9800';
      ctx.beginPath();
      ctx.arc(e.x, e.y, px(3.5), 0, Math.PI * 2);
      ctx.fill();
    }
    if (o.ghost && hasGhost) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = px(1.6);
      ctx.setLineDash([px(5), px(4)]);
      ctx.beginPath();
      ctx.arc(info.ghost.x, info.ghost.y, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      line({ x: info.ghost.x - px(4), y: info.ghost.y }, { x: info.ghost.x + px(4), y: info.ghost.y });
      line({ x: info.ghost.x, y: info.ghost.y - px(4) }, { x: info.ghost.x, y: info.ghost.y + px(4) });
    }
    if (o.pocket && info.manual && hasGhost) {
      // manual aim: direction the object ball leaves in
      ctx.strokeStyle = '#ffd54a';
      ctx.lineWidth = px(2);
      line(info.obj, along(info.obj, info.objDir, scene.objLineLen || 500));
    } else if (o.pocket && !info.manual) {
      ctx.strokeStyle = info.blockedObj !== null ? 'rgba(255,82,82,0.95)' : '#ffd54a';
      ctx.lineWidth = px(2);
      line(info.obj, info.pocketAim);
    }
    if (o.tangent && hasGhost) {
      ctx.strokeStyle = '#4fc3f7';
      ctx.lineWidth = px(1.8);
      ctx.setLineDash([px(8), px(5)]);
      line(info.ghost, along(info.ghost, info.stunDir, 420));
      ctx.setLineDash([]);
    }
    if (o.roll && hasGhost) {
      ctx.strokeStyle = '#ce93d8';
      ctx.lineWidth = px(1.8);
      ctx.setLineDash([px(3), px(5)]);
      line(info.ghost, along(info.ghost, info.rollDir, 380));
      ctx.setLineDash([]);
    }
    // blocking ball highlights
    for (const id of [info.blockedCue, info.blockedObj]) {
      if (id === null) continue;
      const b = scene.balls.find((x) => x.id === id);
      if (!b) continue;
      ctx.strokeStyle = '#ff5252';
      ctx.lineWidth = px(2.5);
      ctx.beginPath();
      ctx.arc(b.pos.x, b.pos.y, R + px(5), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function draw(scene) {
    ctx.save();
    if (tableCache) {
      if (tableDirty || cachedHead !== true || tableCache.width !== canvas.width || tableCache.height !== canvas.height) {
        tableCache.width = canvas.width;
        tableCache.height = canvas.height;
        const tctx = tableCache.getContext('2d');
        tctx.clearRect(0, 0, tableCache.width, tableCache.height);
        const m = view.m;
        const d = view.dpr;
        tctx.setTransform(d * m[0], d * m[1], d * m[2], d * m[3], d * m[4], d * m[5]);
        drawTableTo(tctx, true);
        tableDirty = false;
        cachedHead = true;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(tableCache, 0, 0);
      setWorld();
    } else {
      setScreen();
      ctx.clearRect(0, 0, view.cssW, view.cssH);
      setWorld();
      drawTableTo(ctx, true);
    }

    if (scene.zone) {
      const z = scene.zone;
      ctx.fillStyle = 'rgba(255,213,74,0.14)';
      ctx.strokeStyle = 'rgba(255,213,74,0.9)';
      ctx.lineWidth = px(2);
      ctx.setLineDash([px(8), px(6)]);
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (scene.prediction && scene.overlays.predict) drawPredictions(scene.prediction, scene.balls);
    if (scene.trail) drawPaths(scene.trail, true);

    // pocket highlight
    if (scene.info && scene.info.pocketIdx !== null && (scene.overlays.pocket || scene.showPocketRing)) {
      const pk = POCKETS[scene.info.pocketIdx];
      ctx.strokeStyle = '#ffd54a';
      ctx.lineWidth = px(2.2);
      ctx.setLineDash(scene.pocketExplicit ? [] : [px(4), px(4)]);
      ctx.beginPath();
      ctx.arc(pk.cx, pk.cy, pk.dropR + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const sorted = [...scene.balls].filter((b) => !b.potted).sort((a, b) => (a.id === 0) - (b.id === 0));
    const withText = R * view.scale >= 7;
    drawDropBalls(scene.drops, withText);
    for (const b of sorted) drawBallBody(b, R, withText);

    if (scene.targetId && scene.showTarget) {
      const t = scene.balls.find((b) => b.id === scene.targetId && !b.potted);
      if (t) {
        ctx.strokeStyle = '#ffd54a';
        ctx.lineWidth = px(2.2);
        ctx.beginPath();
        ctx.arc(t.pos.x, t.pos.y, R + px(4), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    drawOverlays(scene);
    if (scene.stick) drawStick(scene.stick);
    ctx.restore();
  }

  resize();
  return { view, resize, draw, worldToScreen, screenToWorld, setTable };
}
