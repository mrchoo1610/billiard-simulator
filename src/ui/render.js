// Canvas rendering + view transform. Auto-rotates the table 90 degrees on portrait canvases.
import { R, RAIL, buildTable } from '../core/table.js';
import { rotateByQuat } from '../core/physics.js';

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
};

const PAD = 8;

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let geo = buildTable();
  let { W, H, POCKETS, RAIL_SEGMENTS, HEAD_X, HEAD_SPOT, FOOT_SPOT } = geo;
  let cornerMouth = 127;
  let sideMouth = 140;
  const view = { cssW: 1, cssH: 1, dpr: 1, scale: 1, rot: false, cx: 0, cy: 0, m: [1, 0, 0, 1, 0, 0] };

  /** Switch to another table geometry (see buildTable). */
  function setTable(g, profile) {
    geo = g;
    ({ W, H, POCKETS, RAIL_SEGMENTS, HEAD_X, HEAD_SPOT, FOOT_SPOT } = g);
    if (profile) {
      cornerMouth = profile.cornerMouth;
      sideMouth = profile.sideMouth;
    }
    resize();
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
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

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawTable(showHead) {
    // wood frame
    const g = ctx.createLinearGradient(-RAIL, -RAIL, W + RAIL, H + RAIL);
    g.addColorStop(0, '#6d4524');
    g.addColorStop(1, '#4a2c14');
    ctx.fillStyle = g;
    roundRect(-RAIL, -RAIL, W + 2 * RAIL, H + 2 * RAIL, 40);
    ctx.fill();
    ctx.lineWidth = px(1.5);
    ctx.strokeStyle = '#25150a';
    ctx.stroke();
    // cushion band
    ctx.fillStyle = '#0a5a41';
    ctx.fillRect(-36, -36, W + 72, H + 72);
    // felt
    ctx.fillStyle = '#0b6e4f';
    ctx.fillRect(0, 0, W, H);
    // cushion nose
    ctx.strokeStyle = '#13926a';
    ctx.lineWidth = px(1.5);
    ctx.beginPath();
    for (const s of RAIL_SEGMENTS) {
      ctx.moveTo(s.a.x, s.a.y);
      ctx.lineTo(s.b.x, s.b.y);
    }
    ctx.stroke();
    // pockets
    ctx.fillStyle = '#050a08';
    for (const pk of POCKETS) {
      const out = pk.type === 'corner' ? 20 : 16;
      const r = pk.type === 'corner' ? 0.44 * cornerMouth : 0.34 * sideMouth;
      ctx.beginPath();
      ctx.arc(pk.x - pk.axis.x * out, pk.y - pk.axis.y * out, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // diamonds
    ctx.fillStyle = '#e9dfc4';
    const dia = (x, y) => {
      ctx.beginPath();
      ctx.moveTo(x, y - 9);
      ctx.lineTo(x + 9, y);
      ctx.lineTo(x, y + 9);
      ctx.lineTo(x - 9, y);
      ctx.closePath();
      ctx.fill();
    };
    for (let i = 1; i < 8; i++) {
      if (i === 4) continue;
      dia((i * W) / 8, -RAIL / 2 - 4);
      dia((i * W) / 8, H + RAIL / 2 + 4);
    }
    for (let j = 1; j < 4; j++) {
      dia(-RAIL / 2 - 4, (j * H) / 4);
      dia(W + RAIL / 2 + 4, (j * H) / 4);
    }
    // head string + spots
    if (showHead) {
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = px(1.2);
      ctx.beginPath();
      ctx.moveTo(HEAD_X, 0);
      ctx.lineTo(HEAD_X, H);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    for (const sp of [HEAD_SPOT, FOOT_SPOT, { x: W / 2, y: H / 2 }]) {
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2);
      ctx.fill();
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
      ctx.font = '700 1.25px system-ui, sans-serif';
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
  const STRIPE_H = 0.56;
  const STRIPE_N = 40;
  const STRIPE_LEVELS = [-STRIPE_H, -STRIPE_H / 2, 0, STRIPE_H / 2, STRIPE_H];

  /** 9-ball stripe: band |p . a| < h around the body axis a = (0,1,0), as front-facing quads. */
  function drawStripe(x, y, r, q, color) {
    const pts = [];
    for (let li = 0; li < STRIPE_LEVELS.length; li++) {
      const z = STRIPE_LEVELS[li];
      const rad = Math.sqrt(1 - z * z);
      const row = [];
      for (let i = 0; i <= STRIPE_N; i++) {
        const ph = (i / STRIPE_N) * Math.PI * 2;
        row.push(rotateByQuat(q, { x: rad * Math.cos(ph), y: z, z: rad * Math.sin(ph) }));
      }
      pts.push(row);
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let li = 0; li + 1 < pts.length; li++) {
      for (let i = 0; i < STRIPE_N; i++) {
        const a = pts[li][i];
        const b = pts[li][i + 1];
        const c = pts[li + 1][i + 1];
        const d = pts[li + 1][i];
        if (-a.z < -0.08 || -b.z < -0.08 || -c.z < -0.08 || -d.z < -0.08) continue;
        ctx.moveTo(x + r * a.x, y + r * a.y);
        ctx.lineTo(x + r * b.x, y + r * b.y);
        ctx.lineTo(x + r * c.x, y + r * c.y);
        ctx.lineTo(x + r * d.x, y + r * d.y);
        ctx.closePath();
      }
    }
    ctx.fill();
  }

  function drawBallBody(b, r, withText) {
    const { x, y } = b.pos;
    const q = b.q || IDENT_Q;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.arc(x + r * 0.14, y + r * 0.14, r, 0, Math.PI * 2);
    ctx.fill();
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
      if (b.id === 9) {
        ctx.fillStyle = white;
        ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
        drawStripe(x, y, r, q, BALL_COLORS[9]);
      } else {
        ctx.fillStyle = BALL_COLORS[b.id] || '#888';
        ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
      const rho = Math.asin(0.46);
      const label = withText ? String(b.id) : '';
      discOnBall(x, y, r, bodyFeature(q, UP, EX), rho, white, label);
      discOnBall(x, y, r, bodyFeature(q, DOWN, NEG_EX), rho, white, label);
    }
    const gr = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.05, x - r * 0.15, y - r * 0.15, r * 1.1);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.08)');
    gr.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = gr;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    ctx.restore();
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

  /** Cue stick behind the cue ball along the aim line; pulled back proportionally to power. */
  function drawStick(st) {
    const d = st.dir;
    const n = { x: -d.y, y: d.x };
    const gap = R * 0.5 + 6 + st.power * 230; // tip distance from the ball surface
    const len = W * 0.6;
    const at = (k, w) => ({
      x: st.pos.x - d.x * (R + gap + k) + n.x * w,
      y: st.pos.y - d.y * (R + gap + k) + n.y * w,
    });
    const seg = (k0, k1, w0, w1, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      const a = at(k0, -w0), b = at(k1, -w1), c = at(k1, w1), e = at(k0, w0);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(e.x, e.y);
      ctx.closePath();
      ctx.fill();
    };
    ctx.save();
    ctx.globalAlpha = 0.95;
    seg(0, 6, 5.5, 5.5, '#4fc3f7'); // tip
    seg(6, 30, 5.6, 5.8, '#f4f1e6'); // ferrule
    seg(30, len * 0.62, 5.8, 8.5, '#e5c68a'); // shaft
    seg(len * 0.62, len, 8.5, 13, '#3b2412'); // butt
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
      ctx.strokeStyle = blocked ? 'rgba(255,82,82,0.95)' : 'rgba(255,255,255,0.85)';
      ctx.lineWidth = px(2);
      line(info.cue, along(info.cue, info.aimDir, info.aimLen));
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
      line(info.obj, along(info.obj, info.objDir, 500));
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
    setScreen();
    ctx.clearRect(0, 0, view.cssW, view.cssH);
    setWorld();
    drawTable(true);

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
      ctx.arc(pk.x - pk.axis.x * 18, pk.y - pk.axis.y * 18, (pk.type === 'corner' ? 0.44 * cornerMouth : 0.34 * sideMouth) + 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const sorted = [...scene.balls].filter((b) => !b.potted).sort((a, b) => (a.id === 0) - (b.id === 0));
    const withText = R * view.scale >= 7;
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
