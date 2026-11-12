// Pointer input: drag balls, tap ball / pocket, and the spin pad widget.
import { R } from '../core/table.js';
import { clamp } from '../core/vec.js';

/** Move `ball` towards `p`, keeping it on the table and not overlapping others. */
export function placeBall(ball, p, balls, geo) {
  const { W, H } = geo;
  let x = clamp(p.x, R, W - R);
  let y = clamp(p.y, R, H - R);
  const others = balls.filter((o) => o !== ball && !o.potted);
  for (let iter = 0; iter < 10; iter++) {
    let moved = false;
    for (const o of others) {
      let dx = x - o.pos.x;
      let dy = y - o.pos.y;
      let d = Math.hypot(dx, dy);
      if (d < 2 * R) {
        if (d < 1e-6) {
          dx = 0;
          dy = -1;
          d = 1;
        }
        x = o.pos.x + (dx / d) * (2 * R + 0.01);
        y = o.pos.y + (dy / d) * (2 * R + 0.01);
        moved = true;
      }
    }
    x = clamp(x, R, W - R);
    y = clamp(y, R, H - R);
    if (!moved) break;
  }
  for (const o of others) {
    if (Math.hypot(x - o.pos.x, y - o.pos.y) < 2 * R - 0.05) return false; // no valid spot, keep old
  }
  ball.pos = { x, y };
  return true;
}

/**
 * handlers: { getBalls, canDrag, onMove(ball), onDragEnd(ball), onTapBall(ball), onTapPocket(index) }
 */
export function createInput({ canvas, renderer, getBalls, getTable, getCuePos, canRotate = () => false, onRotate = () => {}, canDrag, onMove, onDragEnd, onTapBall, onTapPocket }) {
  let drag = null;

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function hitBall(w) {
    const hitR = Math.max(R * 1.15, 24 / renderer.view.scale); // >= ~48px touch target
    let best = null;
    let bd = hitR;
    for (const b of getBalls()) {
      if (b.potted) continue;
      const d = Math.hypot(b.pos.x - w.x, b.pos.y - w.y);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  function hitPocket(w) {
    const lim = Math.max(140, 36 / renderer.view.scale);
    let best = -1;
    let bd = lim;
    getTable().POCKETS.forEach((pk, i) => {
      const d = Math.hypot(pk.x - w.x, pk.y - w.y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const s = local(e);
    const w = renderer.screenToWorld(s);
    const ball = hitBall(w);
    drag = {
      id: e.pointerId,
      start: s,
      rotating: false,
      lastAng: null,
      ball,
      offset: ball ? { x: ball.pos.x - w.x, y: ball.pos.y - w.y } : null,
      moved: false,
      world: w,
    };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const s = local(e);
    if (!drag.moved && Math.hypot(s.x - drag.start.x, s.y - drag.start.y) > 8) drag.moved = true;
    if (drag.moved && !drag.ball && canRotate()) {
      // relative angular drag around the cue ball: far-away drags give finer angles
      const cue = getCuePos();
      const w = renderer.screenToWorld(s);
      if (cue) {
        if (Math.hypot(w.x - cue.x, w.y - cue.y) > R * 1.5) {
          const ang = Math.atan2(w.y - cue.y, w.x - cue.x);
          if (drag.lastAng === null) {
            // reference angle = where the pointer went down
            drag.lastAng = Math.atan2(drag.world.y - cue.y, drag.world.x - cue.x);
          }
          let dth = ang - drag.lastAng;
          while (dth > Math.PI) dth -= 2 * Math.PI;
          while (dth < -Math.PI) dth += 2 * Math.PI;
          drag.lastAng = ang;
          drag.rotating = true;
          onRotate((dth * 180) / Math.PI);
        }
      }
    }
    if (drag.moved && drag.ball && canDrag()) {
      const w = renderer.screenToWorld(s);
      const target = { x: w.x + drag.offset.x, y: w.y + drag.offset.y };
      if (placeBall(drag.ball, target, getBalls(), getTable())) onMove(drag.ball);
    }
  });

  function finish(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    if (cancelled) return;
    if (d.rotating) return;
    if (!d.moved) {
      if (d.ball) onTapBall(d.ball);
      else {
        const i = hitPocket(d.world);
        if (i >= 0) onTapPocket(i);
      }
    } else if (d.ball && canDrag()) {
      onDragEnd(d.ball);
    }
  }
  canvas.addEventListener('pointerup', (e) => finish(e, false));
  canvas.addEventListener('pointercancel', (e) => finish(e, true));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

/**
 * Spin pad: shows the cue-ball face; tip position in the unit circle.
 * tip.x > 0 right english, tip.y > 0 top (follow), tip.y < 0 draw.
 */
export function createSpinPad(canvas, onChange) {
  const ctx = canvas.getContext('2d');
  let tip = { x: 0, y: 0 };
  let active = null;
  let lastTap = 0;
  let size = 120;
  let miscueLimit = 0.55; // tip radius (fraction of R) beyond which the cue miscues
  const MAXR = 0.85; // fraction of the pad radius used by tip = 1

  function resize() {
    const rect = canvas.getBoundingClientRect();
    size = Math.max(40, rect.width || 120);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    draw();
  }

  function draw() {
    const dpr = canvas.width / size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const c = size / 2;
    const r = c - 3;
    const g = ctx.createRadialGradient(c - r * 0.3, c - r * 0.3, r * 0.1, c, c, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#d9d8cf');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(c - r, c);
    ctx.lineTo(c + r, c);
    ctx.moveTo(c, c - r);
    ctx.lineTo(c, c + r);
    ctx.stroke();
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(c, c, r * MAXR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // miscue limit ring: hitting outside it miscues
    ctx.strokeStyle = 'rgba(211,47,47,0.75)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.arc(c, c, r * MAXR * Math.min(1, miscueLimit), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#d32f2f';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c + tip.x * r * MAXR, c - tip.y * r * MAXR, Math.max(5, r * 0.11), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  function fromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const c = rect.width / 2;
    const r = c - 3;
    let x = (e.clientX - rect.left - c) / (r * MAXR);
    let y = -(e.clientY - rect.top - c) / (r * MAXR);
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return { x, y };
  }

  function set(t, silent) {
    tip = { x: t.x, y: t.y };
    draw();
    if (!silent) onChange(tip);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (active !== null) return;
    active = e.pointerId;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    const now = performance.now();
    if (now - lastTap < 350) {
      set({ x: 0, y: 0 }); // double tap resets to centre
      lastTap = 0;
    } else {
      lastTap = now;
      set(fromEvent(e));
    }
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== active) return;
    set(fromEvent(e));
  });
  const end = (e) => {
    if (e.pointerId !== active) return;
    active = null;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('dblclick', () => set({ x: 0, y: 0 }));

  resize();
  function setMiscueLimit(m) {
    miscueLimit = m;
    draw();
  }

  return { set, get: () => ({ ...tip }), draw, resize, setMiscueLimit };
}
