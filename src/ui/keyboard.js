// Keyboard control for PC (Phase 5): pure helpers (unit-tested, no DOM at import time) + createKeyboard() wiring.
// All state changes go through the `api` object supplied by app.js, i.e. the same setters the touch UI uses.

/* ------------------------------------------------------------------ pure helpers */

export const AIM_STEP = 0.1; // degrees per press
export const AIM_STEP_COARSE = 1; // Shift
export const AIM_STEP_FINE = 0.02; // Alt
export const POWER_STEP = 0.01;
export const POWER_STEP_COARSE = 0.05;
export const TIP_STEP = 0.05; // fraction of the ball radius
export const TIP_STEP_COARSE = 0.1;
export const ELEVATION_MIN = 0;
export const ELEVATION_MAX = 30;
export const REPEAT_DELAY_MS = 250;
export const REPEAT_INTERVAL_MS = 40;
export const ACCEL_AFTER_MS = 1000;
export const FAST_FORWARD = 4;
export const CAM_STEP = 0.02; // metres per press (3D camera height / distance)
export const CAM_STEP_COARSE = 0.1;

const round = (v, digits) => {
  const k = 10 ** digits;
  const r = Math.round(v * k) / k;
  return r === 0 ? 0 : r; // never -0
};

export const aimStep = (m = {}) => (m.altKey || m.alt ? AIM_STEP_FINE : m.shiftKey || m.shift ? AIM_STEP_COARSE : AIM_STEP);
export const powerStep = (m = {}) => (m.shiftKey || m.shift ? POWER_STEP_COARSE : POWER_STEP);
export const tipStep = (m = {}) => (m.shiftKey || m.shift ? TIP_STEP_COARSE : TIP_STEP);

/** Per-action repeat settings: null = fires once per physical press. */
export function repeatSpec(type) {
  switch (type) {
    case 'aim':
      return { interval: REPEAT_INTERVAL_MS, boost: 5 };
    case 'power':
      return { interval: REPEAT_INTERVAL_MS, boost: 3 };
    case 'tip':
      return { interval: REPEAT_INTERVAL_MS, boost: 1 };
    case 'elevation':
      return { interval: 90, boost: 1 };
    case 'camHeight':
    case 'camDist':
      return { interval: REPEAT_INTERVAL_MS, boost: 1 };
    default:
      return null;
  }
}

/** Step multiplier after the key has been held for `heldMs` (x5 aim / x3 power after 1 s). */
export function holdMultiplier(type, heldMs) {
  const spec = repeatSpec(type);
  return spec && heldMs >= ACCEL_AFTER_MS ? spec.boost : 1;
}

const NON_TEXT_INPUTS = ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file', 'color'];
/** True when key presses belong to the element itself (text fields, selects, contenteditable). */
export function isTypingTarget(t) {
  if (!t) return false;
  const tag = String(t.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.includes(String(t.type || 'text').toLowerCase());
  return false;
}

/**
 * Map a keydown event (key, ctrlKey, shiftKey, altKey, metaKey) to an action or null.
 * Ctrl/Cmd + letter is never mapped (browser shortcuts); Ctrl + arrows move the tip.
 */
export function keyAction(e) {
  const { key } = e;
  const ctrl = !!e.ctrlKey;
  const shift = !!e.shiftKey;
  const alt = !!e.altKey;
  if (e.metaKey) return null;
  const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[key];
  if (arrow) {
    if (ctrl) return { type: 'tip', dx: arrow[0], dy: arrow[1], step: tipStep(e) };
    if (arrow[0] !== 0) return { type: 'aim', dir: arrow[0], step: aimStep(e) };
    return { type: 'power', dir: arrow[1], step: powerStep(e) };
  }
  if (ctrl || alt) return null;
  const k = typeof key === 'string' && key.length === 1 ? key.toLowerCase() : key;
  switch (k) {
    case 'a':
      return { type: 'tip', dx: -1, dy: 0, step: tipStep(e) };
    case 'd':
      return { type: 'tip', dx: 1, dy: 0, step: tipStep(e) };
    case 'w':
      return { type: 'tip', dx: 0, dy: 1, step: tipStep(e) };
    case 's':
      return { type: 'tip', dx: 0, dy: -1, step: tipStep(e) };
    case 'c':
      return { type: 'tipCentre' };
    case 'b':
      return { type: 'toggleSide' };
    case ' ':
    case 'Spacebar':
      return { type: 'shoot' };
    case 'PageUp':
      return { type: 'elevation', dir: 1 };
    case 'PageDown':
      return { type: 'elevation', dir: -1 };
    case 'Tab':
      return { type: 'target', dir: shift ? -1 : 1 };
    case 'p':
      return { type: 'pocket', auto: shift };
    case 'm':
      return { type: 'aimMode' };
    case 'r':
      return { type: 'reset' };
    case 'n':
      return { type: 'random' };
    case 'f':
      return { type: 'predict' };
    case 'l':
      return { type: 'toggleAimAid' };
    case 'v':
      return { type: 'view' };
    case 'k':
      return { type: 'camMode' };
    case '[':
    case '{':
      return { type: 'camHeight', dir: -1, step: shift ? CAM_STEP_COARSE : CAM_STEP };
    case ']':
    case '}':
      return { type: 'camHeight', dir: 1, step: shift ? CAM_STEP_COARSE : CAM_STEP };
    case '-':
    case '_':
      return { type: 'camDist', dir: 1, step: shift ? CAM_STEP_COARSE : CAM_STEP }; // farther
    case '=':
    case '+':
      return { type: 'camDist', dir: -1, step: shift ? CAM_STEP_COARSE : CAM_STEP }; // nearer
    case 'h':
    case '?':
      return { type: 'help' };
    case 'Escape':
      return { type: 'close' };
    default:
      break;
  }
  if (typeof k === 'string' && /^[1-9]$/.test(k) && !shift) return { type: 'targetBall', id: Number(k) };
  return null;
}

/** Action types that still work while a shot is animating. */
export const ACTIVE_DURING_SHOT = ['shoot', 'help', 'close'];
/** Phase 6: view / camera keys work in every phase (camera keys only act in the 3D view). */
export const ACTIVE_ANY_PHASE = ['view', 'camMode', 'camHeight', 'camDist'];
const CAMERA_ONLY = ['camMode', 'camHeight', 'camDist'];

/** New power (0..1) after a signed delta, clamped and rounded to 1 %. */
export function stepPower(power, delta) {
  return Math.min(1, Math.max(0, round(power + delta, 2)));
}

export function stepElevation(el, dir, min = ELEVATION_MIN, max = ELEVATION_MAX) {
  return Math.min(max, Math.max(min, Math.round(el) + dir));
}

/**
 * Move the spin-pad tip by (dx, dy) (fractions of the ball radius, +x right, +y high). The unit circle is the hard limit.
 * A step that would cross the miscue ring stops on the ring; `allowCross` (a fresh key press, not a repeat)
 * lets a tip that already sits on the ring go beyond it. Returns { tip, stopped, changed }.
 */
export function moveTip(tip, dx, dy, limit, allowCross = false) {
  const EPS = 1e-6;
  const lim = Math.min(1, Math.max(0, limit));
  const mag = (t) => Math.hypot(t.x, t.y);
  const scaleTo = (t, r) => {
    const m = mag(t);
    return m > r && m > 0 ? { x: (t.x / m) * r, y: (t.y / m) * r } : t;
  };
  let next = { x: tip.x + dx, y: tip.y + dy };
  let stopped = false;
  const before = mag(tip);
  if (lim < 1 && before <= lim + EPS && mag(next) > lim + EPS) {
    const onRing = before >= lim - EPS;
    if (onRing && allowCross) {
      next = scaleTo(next, 1);
    } else {
      next = scaleTo(next, lim); // stop on the ring (slides along it when moving tangentially)
      stopped = true;
    }
  } else {
    next = scaleTo(next, 1);
  }
  next = { x: round(next.x, 3), y: round(next.y, 3) };
  const changed = next.x !== round(tip.x, 3) || next.y !== round(tip.y, 3);
  return { tip: next, stopped, changed };
}

/** Next/previous object-ball id in a ring (ids sorted ascending). */
export function cycleTarget(ids, current, dir = 1) {
  const list = [...ids].sort((a, b) => a - b);
  if (!list.length) return null;
  const i = list.indexOf(current);
  if (i < 0) return dir >= 0 ? list[0] : list[list.length - 1];
  return list[(i + (dir >= 0 ? 1 : -1) + list.length) % list.length];
}

/** Next pocket index: starts from the explicit pocket, else from the automatic one. */
export function nextPocket(explicit, effective, count) {
  const base = explicit !== null && explicit !== undefined ? explicit : effective !== null && effective !== undefined ? effective : -1;
  return (base + 1) % count;
}

export const fmtAngle = (d, digits = 1) => `${Number(d).toFixed(digits).replace('.', ',')}°`;

/** Short Vietnamese description of the tip position for the value badge. */
export function tipBadge(tip) {
  const parts = [];
  const px = Math.round(Math.abs(tip.x) * 100);
  const py = Math.round(Math.abs(tip.y) * 100);
  if (py >= 1) parts.push(`${tip.y > 0 ? 'Cao' : 'Thấp'} ${py} %`);
  if (px >= 1) parts.push(`Phê ${tip.x > 0 ? 'phải' : 'trái'} ${px} %`);
  return parts.length ? parts.join(' · ') : 'Điểm chạm: giữa';
}

/** Wheel delta (any deltaMode) -> pixels. */
export function wheelPixels(e) {
  const d = e.deltaY || e.deltaX || 0;
  return e.deltaMode === 1 ? d * 33 : e.deltaMode === 2 ? d * 400 : d;
}

/** Full key table shown in the help overlay. */
export const KEY_HELP = [
  { keys: '← / →', desc: 'Xoay hướng ngắm 0,1° (Shift 1°, Alt 0,02°); chuyển sang ngắm Tự do' },
  { keys: '↑ / ↓', desc: 'Tăng / giảm lực 1 % (Shift 5 %)' },
  { keys: 'Ctrl + mũi tên  hoặc  W A S D', desc: 'Dời điểm chạm trên bi cái (Shift bước lớn). Dừng ở vòng trượt cơ; nhấn thêm để vượt' },
  { keys: 'C', desc: 'Điểm chạm về giữa' },
  { keys: 'Space', desc: 'Đánh; khi bi đang chạy: tua nhanh ×4 (bấm lại để về tốc độ thường)' },
  { keys: 'PageUp / PageDown', desc: 'Nâng cơ ±1° (chế độ Tự do)' },
  { keys: 'Tab / Shift + Tab', desc: 'Bi mục tiêu tiếp theo / trước đó (chế độ Tự do)' },
  { keys: '1 – 9', desc: 'Chọn bi đó làm mục tiêu nếu còn trên bàn' },
  { keys: 'P  /  Shift + P', desc: 'Lỗ tiếp theo cho bi mục tiêu  /  về tự chọn lỗ' },
  { keys: 'M', desc: 'Chuyển kiểu ngắm Tự động / Tự do' },
  { keys: 'R', desc: 'Đặt lại (về vị trí trước cú đánh)' },
  { keys: 'N', desc: 'Ngẫu nhiên (chế độ Tự do)' },
  { keys: 'F', desc: 'Bật / tắt dự đoán đường đi' },
  { keys: 'L', desc: 'Bật / tắt tia ngắm hỗ trợ (Góc nhìn thực tế)' },
  { keys: 'Lăn chuột trên bàn', desc: 'Xoay hướng ngắm 0,1° mỗi nấc (Shift 1°)' },
  { keys: 'V', desc: 'Chuyển góc nhìn 2D / 3D "Mắt cơ thủ"' },
  { keys: 'B', desc: 'Ẩn / hiện bảng điều khiển (Toàn màn hình bàn bida)' },
  { keys: 'K', desc: 'Camera 3D: Tự động → Quay TV → Theo bi cái → Cố định' },
  { keys: '[  /  ]', desc: 'Camera 3D: hạ / nâng độ cao mắt (Shift bước lớn)' },
  { keys: '-  /  =', desc: 'Camera 3D: lùi xa / tiến gần bi cái (Shift bước lớn); lăn chuột hoặc chụm 2 ngón cũng zoom' },
  { keys: 'H  hoặc  ?', desc: 'Hiện / ẩn bảng trợ giúp này' },
  { keys: 'Esc', desc: 'Đóng bảng trợ giúp / bảng Thiết bị' },
];

/* ------------------------------------------------------------------ DOM wiring */

const HINT_KEY = 'bida9-kbhint-dismissed';

/**
 * api: { phase(), canAim(), canSelectTarget(), nudgeAim(d)->label|null, getPower(), setPower(p)->bool,
 *   getTip(), setTip(t), miscueLimit(), canTip(), elevation()->number|null, setElevation(e), cycleTarget(dir)->id|null,
 *   selectTarget(id)->bool, pocket(auto)->label|null, toggleAimMode()->'auto'|'manual'|null, reset(), random(),
 *   togglePredict()->bool|null, shoot(), fastForward()->scale|null, hud()->data,
 *   is3D()->bool, toggleView()->label, camMode()->label, camHeight(delta m)->label, camDist(delta m)->label }
 */
export function createKeyboard({ api, stage, canvas, onLayout = () => {} }) {
  const desktop = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  /* ---- HUD + badge (desktop only) ---- */
  let hud = null;
  let badge = null;
  let badgeTimer = 0;
  if (desktop) {
    const wrap = el('div', 'kb-hudwrap');
    wrap.setAttribute('aria-hidden', 'true');
    const box = el('div', 'kb-hud');
    const rowP = el('div', 'kb-row');
    const barFill = el('i');
    const bar = el('span', 'kb-bar');
    bar.append(barFill);
    const pw = el('b', '', '');
    rowP.append(el('span', 'kb-k', 'Lực'), bar, pw);
    const rowA = el('div', 'kb-row');
    const aim = el('b', '', '');
    const mode = el('em', '', '');
    rowA.append(el('span', 'kb-k', 'Ngắm'), aim, mode);
    const rowE = el('div', 'kb-row');
    const elv = el('b', '', '');
    rowE.append(el('span', 'kb-k', 'Nâng cơ'), elv);
    const tipCanvas = el('canvas', 'kb-tip');
    box.append(rowP, rowA, rowE, tipCanvas);
    badge = el('div', 'kb-badge');
    wrap.append(box, badge);
    stage.append(wrap);
    hud = { box, barFill, pw, aim, mode, elv, rowE, tipCanvas, ctx: tipCanvas.getContext('2d') };
  }

  function drawTip(t, limit) {
    const { tipCanvas, ctx } = hud;
    const size = 46;
    const dpr = window.devicePixelRatio || 1;
    if (tipCanvas.width !== Math.round(size * dpr)) {
      tipCanvas.width = Math.round(size * dpr);
      tipCanvas.height = Math.round(size * dpr);
      tipCanvas.style.width = `${size}px`;
      tipCanvas.style.height = `${size}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const c = size / 2;
    const r = c - 2;
    const MAXR = 0.85;
    ctx.fillStyle = '#ecebe2';
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
    ctx.strokeStyle = 'rgba(211,47,47,0.85)';
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.arc(c, c, r * MAXR * Math.min(1, limit), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#d32f2f';
    ctx.beginPath();
    ctx.arc(c + t.x * r * MAXR, c - t.y * r * MAXR, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function refresh() {
    if (!hud) return;
    const d = api.hud();
    hud.box.parentElement.hidden = !d.visible;
    if (!d.visible) return;
    hud.barFill.style.width = `${Math.round(d.power * 100)}%`;
    hud.pw.textContent = `${Math.round(d.power * 100)} %`;
    hud.aim.textContent = d.aimDeg === null ? '–' : fmtAngle(d.aimDeg);
    hud.mode.textContent = d.aimMode === 'manual' ? 'Tự do' : 'Tự động';
    hud.elv.textContent = `${Math.round(d.elevation)}°`;
    hud.rowE.classList.toggle('dim', !d.elevEditable);
    drawTip(d.tip, d.miscue);
  }

  function showBadge(text) {
    if (!badge || !text) return;
    badge.textContent = text;
    badge.classList.add('show');
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => badge.classList.remove('show'), 800);
  }

  /* ---- key hint strip (desktop only, dismissible) ---- */
  if (desktop) {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(HINT_KEY) === '1';
    } catch (e) {
      dismissed = false;
    }
    if (!dismissed) {
      const strip = el('div', 'kb-hint');
      const txt = el('span', '', '←/→ ngắm · ↑/↓ lực · Ctrl+mũi tên phê · Space đánh · V 2D/3D · K camera · [ ] - = zoom 3D · H trợ giúp');
      const x = el('button', 'kb-hint-x', '×');
      x.type = 'button';
      x.setAttribute('aria-label', 'Ẩn gợi ý phím');
      x.addEventListener('click', () => {
        strip.remove();
        document.body.classList.remove('kb-hint-on');
        try {
          localStorage.setItem(HINT_KEY, '1');
        } catch (e) {
          /* ignore */
        }
        onLayout();
      });
      strip.append(txt, x);
      stage.append(strip);
      document.body.classList.add('kb-hint-on');
      onLayout();
    }
  }

  /* ---- help overlay ---- */
  let help = null;
  const helpOpen = () => !!help && !help.hidden;
  function buildHelp() {
    help = el('div', 'kb-help');
    help.hidden = true;
    help.setAttribute('role', 'dialog');
    help.setAttribute('aria-label', 'Phím tắt');
    const back = el('div', 'kb-help-back');
    back.addEventListener('click', () => toggleHelp(false));
    const box = el('div', 'kb-help-box');
    const head = el('div', 'kb-help-head');
    const close = el('button', 'btn kb-help-close', 'Đóng');
    close.type = 'button';
    close.addEventListener('click', () => toggleHelp(false));
    head.append(el('h2', '', 'Điều khiển bằng bàn phím'), close);
    const dl = el('dl', 'kb-help-list');
    for (const row of KEY_HELP) {
      const dt = el('dt');
      dt.append(el('kbd', '', row.keys));
      dl.append(dt, el('dd', '', row.desc));
    }
    box.append(head, dl);
    help.append(back, box);
    document.body.append(help);
  }
  function toggleHelp(force) {
    if (!help) buildHelp();
    help.hidden = typeof force === 'boolean' ? !force : !help.hidden;
  }

  /* ---- performing actions ---- */
  function perform(a, first, boost) {
    const phase = api.phase();
    if (phase !== 'aim' && !ACTIVE_DURING_SHOT.includes(a.type) && !ACTIVE_ANY_PHASE.includes(a.type)) return false;
    switch (a.type) {
      case 'aim':
        showBadge(api.nudgeAim(a.dir * a.step * boost));
        break;
      case 'power': {
        const p = stepPower(api.getPower(), a.dir * a.step * boost);
        if (api.setPower(p)) showBadge(`Lực ${Math.round(p * 100)} %`);
        break;
      }
      case 'tip': {
        if (!api.canTip()) break;
        const r = moveTip(api.getTip(), a.dx * a.step, a.dy * a.step, api.miscueLimit(), first);
        if (r.changed) api.setTip(r.tip);
        showBadge(tipBadge(r.tip) + (r.stopped ? ' · vòng trượt cơ (nhấn thêm để vượt)' : ''));
        break;
      }
      case 'tipCentre':
        if (api.canTip()) {
          api.setTip({ x: 0, y: 0 });
          showBadge('Điểm chạm: giữa');
        }
        break;
      case 'shoot':
        if (phase === 'shooting') {
          const s = api.fastForward();
          if (s) showBadge(s > 1 ? `Tua nhanh ×${s}` : 'Tốc độ thường');
        } else {
          api.shoot();
        }
        break;
      case 'elevation': {
        const e = api.elevation();
        if (e === null) break;
        const ne = stepElevation(e, a.dir);
        api.setElevation(ne);
        showBadge(`Nâng cơ ${ne}°`);
        break;
      }
      case 'target': {
        const id = api.cycleTarget(a.dir);
        if (id !== null) showBadge(`Mục tiêu: bi ${id}`);
        break;
      }
      case 'targetBall':
        if (api.selectTarget(a.id)) showBadge(`Mục tiêu: bi ${a.id}`);
        break;
      case 'pocket':
        showBadge(api.pocket(a.auto));
        break;
      case 'aimMode': {
        const m = api.toggleAimMode();
        if (m) showBadge(m === 'manual' ? 'Ngắm: Tự do' : 'Ngắm: Tự động');
        break;
      }
      case 'reset':
        api.reset();
        break;
      case 'random':
        api.random();
        break;
      case 'predict': {
        const on = api.togglePredict();
        if (on !== null) showBadge(`Dự đoán đường đi: ${on ? 'bật' : 'tắt'}`);
        break;
      }
      case 'view':
        showBadge(api.toggleView());
        break;
      case 'toggleSide': {
        const collapsed = api.toggleSide?.();
        if (collapsed !== undefined && collapsed !== null) {
          showBadge(collapsed ? 'Toàn màn hình bàn bida' : 'Mở bảng điều khiển');
        }
        break;
      }
      case 'toggleAimAid': {
        const on = api.toggleAimAid?.();
        if (on !== undefined && on !== null) {
          showBadge(on ? 'Tia ngắm: Bật' : 'Chế độ thực tế (Tắt tia)');
        }
        break;
      }
      case 'camMode':
        showBadge(api.camMode());
        break;
      case 'camHeight':
        showBadge(api.camHeight(a.dir * a.step * boost));
        break;
      case 'camDist':
        showBadge(api.camDist(a.dir * a.step * boost));
        break;
      case 'help':
        toggleHelp();
        break;
      case 'close':
        toggleHelp(false);
        break;
      default:
        break;
    }
    return true;
  }

  /* ---- hold-to-repeat ---- */
  const held = new Map(); // event.code -> { action, t0, timeout, interval }
  const upPrevent = new Set(); // codes whose keyup must be swallowed (Space would click a focused button)

  function stopHold(code) {
    const h = held.get(code);
    if (!h) return;
    clearTimeout(h.timeout);
    clearInterval(h.interval);
    held.delete(code);
  }
  function stopAll() {
    for (const code of [...held.keys()]) stopHold(code);
    upPrevent.clear();
  }
  function startHold(code, action) {
    stopHold(code);
    const spec = repeatSpec(action.type);
    if (!perform(action, true, 1) || !spec) return;
    const h = { action, t0: performance.now(), timeout: 0, interval: 0 };
    held.set(code, h);
    h.timeout = setTimeout(() => {
      h.interval = setInterval(() => {
        if (held.get(code) !== h) return;
        const boost = holdMultiplier(action.type, performance.now() - h.t0);
        if (!perform(action, false, boost)) stopHold(code);
      }, spec.interval);
    }, REPEAT_DELAY_MS);
  }

  function onKeyDown(e) {
    if (e.isComposing) return;
    const sheet = document.getElementById('sheet');
    if (sheet && !sheet.hidden) return; // equipment sheet: its own Esc handler only
    if (isTypingTarget(e.target)) return;
    const a = keyAction(e);
    if (!a) return;
    if (a.type === 'close' && !helpOpen()) return;
    if (a.type === 'target' && !api.canSelectTarget()) return; // keep Tab for normal focus movement
    if (CAMERA_ONLY.includes(a.type) && !api.is3D()) return; // 2D view: these keys stay untouched
    e.preventDefault();
    if (e.repeat) return; // own repeat timer drives held keys
    if (a.type === 'shoot') upPrevent.add(e.code);
    startHold(e.code, a);
  }
  function onKeyUp(e) {
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) stopAll();
    else stopHold(e.code);
    if (upPrevent.delete(e.code)) e.preventDefault();
  }

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', stopAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopAll();
  });

  /* ---- mouse wheel over the table ---- */
  let wheelAcc = 0;
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || e.metaKey) return; // browser zoom
      if (!api.canAim()) return;
      e.preventDefault();
      wheelAcc += wheelPixels(e);
      if (Math.abs(wheelAcc) < 40) return;
      const dir = wheelAcc > 0 ? 1 : -1;
      wheelAcc = 0;
      showBadge(api.nudgeAim(dir * (e.shiftKey ? AIM_STEP_COARSE : AIM_STEP)));
    },
    { passive: false },
  );

  return { refresh, stopAll, showBadge, isHelpOpen: helpOpen };
}
