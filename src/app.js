// App state + wiring. DOM details live in ui/panel.js (controls) and ui/settings.js (equipment sheet).
import { R, buildTable } from './core/table.js';
import { computeShot, bestPocket, isPathBlocked, firstHit } from './core/geometry.js';
import { createBall, createSim, simulate, computeLaunch, DEFAULT_ELEVATION_DEG } from './core/physics.js';
import { solveAim } from './core/aim-solver.js';
import { createRenderer } from './ui/render.js';
import { createInput } from './ui/input.js';
import { createPanel, tipText, fmtDeg } from './ui/panel.js';
import { createSettings } from './ui/settings.js';
import { createKeyboard, cycleTarget, nextPocket } from './ui/keyboard.js';
import * as drills from './features/drills.js';
import { encodeState, decodeState } from './features/share.js';
import { rotate, rad, deg, dist, clamp } from './core/vec.js';
import { CAMERA_MODES, CAMERA_MODE_LABEL, nextCameraMode } from './ui/view3d-math.js'; // pure; three.js itself is only fetched on first 3D open

const PRED_INTERVAL = 50; // ms between prediction recomputes while dragging
const PRED_MAX_TIME = 5; // seconds of predicted motion
const noMiscueRng = () => 0.5; // prediction never randomises the miscue angle
const SOLVE_INTERVAL = 90; // ms: minimum gap between aim-solver runs while the state keeps changing

const state = {
  balls: [],
  targetId: 1,
  pocket: null, // null = automatic best pocket
  power: 0.3,
  tip: { x: 0, y: 0 },
  elevation: DEFAULT_ELEVATION_DEG, // cue elevation in degrees (free mode only; drills keep the default)
  compensate: true, // 'Tự bù effet': solve squirt + swerve + throw
  aimOffset: 0, // auto aim: +-5 degrees from the ghost-ball line
  aimMode: 'auto', // 'auto' (ghost ball to target/pocket) | 'manual' (free aim at aimAngle)
  aimAngle: 0, // manual aim direction, degrees in world coordinates (atan2(y, x))
  overlays: { aim: true, actual: true, ghost: true, pocket: true, tangent: true, roll: false, predict: true },
  mode: 'free', // 'free' | 'thickness' | 'position' | 'squirt'
  phase: 'aim', // 'aim' | 'shooting'
  preShot: null,
  sim: null,
  freeBackup: null,
  drill: null, // current drill scenario
  revealed: false,
  answered: false,
  zone: null,
};
let stats = drills.loadStats();

// current equipment (profiles) + derived table geometry
let eq = null;
let eqKey = '';
let geo = buildTable();

const canvas = document.getElementById('table');
const renderer = createRenderer(canvas);

/* 3D view state (Phase 6): ui/render3d.js + three.js are imported lazily by setView('3d'). */
const lsRead = (k) => {
  try {
    return localStorage.getItem(k);
  } catch (e) {
    return null;
  }
};
const lsWrite = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch (e) {
    /* ignore */
  }
};
const canvas3d = document.getElementById('table3d');
const miniCanvas = document.getElementById('minimap');
const STROKE_MS = 120;
let view = '2d';
let v3 = null; // render3d instance
let mini = null; // 2D renderer on the minimap canvas
let v3Loading = false;
let v3Hinted = false;
let camMode = CAMERA_MODES.includes(lsRead('bida9-v3-cam')) ? lsRead('bida9-v3-cam') : 'auto';
let quality3d = lsRead('bida9-v3-quality') === 'low' || lsRead('bida9-v3-quality') === 'high' ? lsRead('bida9-v3-quality') : null;
let lastScratch = false; // the last shot potted the cue ball (camera director keeps the overhead view a bit longer)
let strokePending = false;
function resizeViews() {
  renderer.resize();
  if (view === '3d' && v3) {
    v3.resize();
    if (mini) mini.resize();
  }
}

/* ------------------------------------------------------------------ helpers */

const ball = (id) => state.balls.find((b) => b.id === id);
const lowestObjectId = () => {
  const ids = state.balls.filter((b) => b.id !== 0).map((b) => b.id);
  return ids.length ? Math.min(...ids) : null;
};
function ensureTarget() {
  const t = ball(state.targetId);
  if (!t || t.id === 0) {
    state.targetId = lowestObjectId();
    state.pocket = null;
  }
}

function isFree(p, ignore = null, gap = 0) {
  if (p.x < R || p.x > geo.W - R || p.y < R || p.y > geo.H - R) return false;
  return state.balls.every((b) => b === ignore || dist(b.pos, p) >= 2 * R + gap);
}

function findFreeSpot(near, gap = 4) {
  if (isFree(near, null, gap)) return { ...near };
  for (let r = 20; r < 1500; r += 20) {
    for (let a = 0; a < 360; a += 20) {
      const p = { x: near.x + r * Math.cos(rad(a)), y: near.y + r * Math.sin(rad(a)) };
      if (isFree(p, null, gap)) return p;
    }
  }
  return { ...near };
}

function randomPoint(margin = 70) {
  return { x: margin + Math.random() * (geo.W - 2 * margin), y: margin + Math.random() * (geo.H - 2 * margin) };
}

function setBalls(list) {
  state.balls = list.map((b) => createBall(b.id, b.x, b.y));
}

/** Clamp balls to the table and push overlapping ones to a free spot (after a resize or a hand-edited link). */
function normalizeBalls() {
  const placed = [];
  for (const b of state.balls) {
    b.pos = geo.clampToTable(b.pos);
    if (!placed.every((o) => dist(o.pos, b.pos) >= 2 * R)) b.pos = findFreeSpot(b.pos);
    placed.push(b);
  }
}

function snapshot() {
  return {
    balls: state.balls.map((b) => ({ id: b.id, x: b.pos.x, y: b.pos.y })),
    targetId: state.targetId,
    pocket: state.pocket,
  };
}
function restore(s) {
  setBalls(s.balls);
  normalizeBalls();
  state.targetId = s.targetId;
  state.pocket = s.pocket;
}

/* ------------------------------------------------------------------ equipment */

function rescaleLayout(sx, sy) {
  for (const b of state.balls) b.pos = { x: b.pos.x * sx, y: b.pos.y * sy };
  const scaleSnap = (s) => {
    if (!s) return;
    for (const b of s.balls) {
      b.x *= sx;
      b.y *= sy;
    }
  };
  scaleSnap(state.preShot);
  scaleSnap(state.freeBackup);
  if (state.zone) state.zone = { ...state.zone, x: state.zone.x * sx, y: state.zone.y * sy };
  normalizeBalls();
}

function onEquipmentChange(next) {
  const oldGeo = geo;
  eq = next;
  eqKey = JSON.stringify(next);
  geo = buildTable(eq.table);
  renderer.setTable(geo, eq.table);
  if (v3) v3.setTable(geo, eq.table);
  if (mini) mini.setTable(geo, eq.table);
  panel.spinPad.setMiscueLimit(eq.cue.miscueLimit);
  if (oldGeo.W !== geo.W || oldGeo.H !== geo.H) {
    rescaleLayout(geo.W / oldGeo.W, geo.H / oldGeo.H);
    panel.toast(`Bàn ${geo.size}: vị trí bi đã được co giãn theo kích thước mới`, 'ok');
  }
  // drill solutions depend on the equipment: start a fresh round
  if (state.mode === 'position') newPositionRound();
  else if (state.mode === 'squirt') newSquirtRound();
  invalidate();
}

/* ------------------------------------------------------------------ derived data */

let info = null;
let prediction = null;
let infoDirty = true;
let predDirty = true;
let lastPred = 0;
let rafId = 0;

function effOverlays() {
  const o = state.overlays;
  if (state.mode === 'thickness') {
    const v = state.revealed;
    return { aim: v, actual: false, ghost: v, pocket: v, tangent: v, roll: false, predict: false };
  }
  if (state.mode === 'position') return { ...o, predict: false };
  if (state.mode === 'squirt') return { ...o, predict: false, actual: o.actual && state.revealed };
  return o;
}

const elevation = () => (state.mode === 'free' ? state.elevation : DEFAULT_ELEVATION_DEG);
const compAllowedMode = () => state.mode === 'free' || state.mode === 'position';
const compEnabled = () => state.compensate && compAllowedMode() && state.aimMode === 'auto';

const compCache = new Map();
let lastComp = null;
let lastSolveAt = 0;
let compStale = false;

/** Aim solver result for the current state: cached by state key, throttled while the state keeps changing. */
function getComp(cue, obj, pocketPoint, force) {
  const key = [
    eqKey,
    obj.id,
    pocketPoint.x.toFixed(1),
    pocketPoint.y.toFixed(1),
    state.power.toFixed(3),
    state.tip.x.toFixed(3),
    state.tip.y.toFixed(3),
    elevation(),
    state.balls.map((b) => `${b.id}:${b.pos.x.toFixed(1)},${b.pos.y.toFixed(1)}`).join('|'),
  ].join(';');
  const hit = compCache.get(key);
  if (hit) {
    compStale = false;
    return hit;
  }
  const now = performance.now();
  if (!force && lastComp && now - lastSolveAt < SOLVE_INTERVAL) {
    compStale = true; // keep showing the previous correction until the throttle window ends
    return lastComp;
  }
  const res = solveAim(
    state.balls,
    obj.id,
    pocketPoint,
    { power: state.power, tip: state.tip, elevationDeg: elevation() },
    eq.table,
    eq.cue,
  );
  lastSolveAt = performance.now();
  compStale = false;
  lastComp = res;
  compCache.set(key, res);
  if (compCache.size > 60) compCache.delete(compCache.keys().next().value);
  predDirty = true;
  return res;
}

const normAngle = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
const manualAllowed = () => state.mode === 'free' || state.mode === 'position';

/** Distance along dir until the ball centre reaches a cushion. */
function rayWallT(o, d) {
  let t = Infinity;
  if (d.x > 1e-9) t = Math.min(t, (geo.W - R - o.x) / d.x);
  else if (d.x < -1e-9) t = Math.min(t, (R - o.x) / d.x);
  if (d.y > 1e-9) t = Math.min(t, (geo.H - R - o.y) / d.y);
  else if (d.y < -1e-9) t = Math.min(t, (R - o.y) / d.y);
  return Math.max(0, t);
}

/** Free aim: ray-cast the squirt-adjusted cue-ball path to the first ball it would hit. */
function computeManualInfo(cue) {
  const aimDir = { x: Math.cos(rad(state.aimAngle)), y: Math.sin(rad(state.aimAngle)) };
  const launch = computeLaunch(aimDir, state.power, state.tip, eq.cue, noMiscueRng, elevation());
  const wallT = rayWallT(cue.pos, launch.dir);
  let hit = firstHit(cue.pos, launch.dir, state.balls, R, [0]);
  if (hit && hit.t > wallT) hit = null; // the cue ball reaches a cushion first
  const base = {
    cue: cue.pos,
    manual: true,
    hit: !!hit,
    aimDir,
    actualDir: launch.dir,
    squirtDeg: launch.squirtDeg,
    launch,
    pocketIdx: null,
    pocketExplicit: false,
    pocketAim: null,
    blockedCue: null,
    blockedObj: null,
    possible: true,
    distPocket: null,
  };
  if (!hit) {
    return {
      ...base, obj: null, objId: null, ghost: null, objDir: null, stunDir: null, rollDir: null,
      aimLen: Math.min(wallT, 4000), cutAngleDeg: null, fullness: null, fullnessLabel: '', distCue: null,
    };
  }
  const obj = ball(hit.id);
  const shot = computeShot(cue.pos, obj.pos, { x: obj.pos.x + hit.objDir.x * 100, y: obj.pos.y + hit.objDir.y * 100 }, R);
  return {
    ...base,
    obj: obj.pos,
    objId: obj.id,
    ghost: hit.ghost,
    objDir: hit.objDir,
    stunDir: shot.cueAfterStunDir,
    rollDir: shot.cueAfterRollDir,
    aimLen: hit.t,
    cutAngleDeg: hit.cutAngleDeg,
    fullness: hit.fullness,
    fullnessLabel: hit.fullnessLabel,
    distCue: dist(cue.pos, obj.pos),
  };
}

function computeInfo(force = false) {
  const cue = ball(0);
  if (cue && state.aimMode === 'manual' && manualAllowed()) return computeManualInfo(cue);
  const obj = ball(state.targetId);
  if (!cue || !obj || obj.id === 0) return null;
  const pocketExplicit = state.pocket !== null;
  const pocketIdx = pocketExplicit ? state.pocket : bestPocket(cue, obj, state.balls, R, geo.POCKETS);
  const pk = geo.POCKETS[pocketIdx];
  const shot = computeShot(cue.pos, obj.pos, pk.aim, R);
  const comp = { enabled: compEnabled(), result: null };
  if (comp.enabled) comp.result = getComp(cue, obj, pk.aim, force);
  // correction relative to the ghost-ball line (a stale result still applies as a small relative rotation)
  const baseAim = comp.result && comp.result.ok ? rotate(shot.aimDir, rad(comp.result.correctionDeg)) : shot.aimDir;
  const aimDir = rotate(baseAim, rad(state.aimOffset));
  const aimLen = dist(cue.pos, shot.ghost);
  // where the cue ball really leaves after squirt / miscue (miscue angle not randomised in previews)
  const launch = computeLaunch(aimDir, state.power, state.tip, eq.cue, noMiscueRng, elevation());
  const end = { x: cue.pos.x + aimDir.x * aimLen, y: cue.pos.y + aimDir.y * aimLen };
  return {
    cue: cue.pos,
    obj: obj.pos,
    objId: obj.id,
    pocketIdx,
    pocketExplicit,
    pocketAim: pk.aim,
    ghost: shot.ghost,
    aimDir,
    aimLen,
    comp,
    actualDir: launch.dir,
    squirtDeg: launch.squirtDeg,
    launch,
    stunDir: shot.cueAfterStunDir,
    rollDir: shot.cueAfterRollDir,
    cutAngleDeg: shot.cutAngleDeg,
    fullness: shot.fullness,
    fullnessLabel: shot.fullnessLabel,
    possible: shot.possible,
    blockedCue: isPathBlocked(cue.pos, end, state.balls, R, [0, obj.id]),
    blockedObj: isPathBlocked(obj.pos, pk.aim, state.balls, R, [0, obj.id]),
    distCue: dist(cue.pos, obj.pos),
    distPocket: dist(obj.pos, pk.aim),
  };
}

function updateInfoPanel() {
  panel.updateInfo(info, {
    hideAnswer: state.mode === 'thickness' && !state.revealed,
    launch: info ? info.launch : null,
    tipX: state.tip.x,
    hideSquirtValue: state.mode === 'squirt' && !state.revealed,
    comp: info ? info.comp || null : null,
  });
  if (keys) keys.refresh();
}

function computePrediction() {
  prediction = null;
  if (!info || state.phase !== 'aim' || !effOverlays().predict) return;
  prediction = simulate(
    state.balls,
    { aimDir: info.aimDir, power: state.power, tip: state.tip, elevationDeg: elevation() },
    { recordPaths: true, maxTime: PRED_MAX_TIME, table: eq.table, cue: eq.cue, rng: noMiscueRng },
  );
}

function invalidate({ pred = true } = {}) {
  infoDirty = true;
  if (pred) predDirty = true;
  schedule();
}
function schedule() {
  if (!rafId) rafId = requestAnimationFrame(frame);
}

let lastT = 0;
let timeScale = 1; // 1 = normal, 4 = fast-forward (Space while balls move)
function frame(now) {
  rafId = 0;
  if (state.phase === 'shooting' && state.sim) {
    const dt = lastT ? Math.min((now - lastT) / 1000, 0.05) : 1 / 60;
    lastT = now;
    for (let i = 0; i < timeScale && state.sim.isMoving(); i++) state.sim.step(dt);
    if (!state.sim.isMoving() || state.sim.time > 25) finishShot();
  }
  if (infoDirty || compStale) {
    info = computeInfo();
    updateInfoPanel();
    updateButtons();
    infoDirty = false;
  }
  if (predDirty && state.phase === 'aim') {
    if (now - lastPred >= PRED_INTERVAL) {
      computePrediction();
      lastPred = now;
      predDirty = false;
    }
  }
  render();
  if (state.phase === 'shooting' || compStale || (predDirty && state.phase === 'aim') || (view === '3d' && v3 && v3.animating())) schedule();
}

function buildScene() {
  const shooting = state.phase === 'shooting' && state.sim;
  const stickOn = !shooting && info && (state.mode !== 'thickness' || state.revealed);
  let headingHint = null;
  if (view === '3d' && state.mode === 'thickness' && !state.revealed) {
    // do not leak the answer: look at the target ball instead of along the (auto) aim line
    const c = ball(0);
    const t = ball(state.targetId);
    if (c && t) headingHint = Math.atan2(t.pos.y - c.pos.y, t.pos.x - c.pos.x);
  }
  return {
    balls: shooting ? state.sim.balls : state.balls,
    targetId: info && info.manual ? info.objId : state.targetId,
    showTarget: !shooting && state.mode !== 'thickness',
    stick: stickOn
      ? { pos: info.cue, dir: info.aimDir, power: state.power, tip: state.tip, elevationDeg: elevation() }
      : null,
    showPocketRing: !shooting && state.mode === 'thickness',
    overlays: shooting
      ? { aim: false, actual: false, ghost: false, pocket: false, tangent: false, roll: false, predict: false }
      : effOverlays(),
    info: shooting ? null : info,
    pocketExplicit: info ? info.pocketExplicit : false,
    prediction: shooting ? null : prediction,
    trail: shooting ? Object.fromEntries(state.sim.balls.map((b) => [b.id, b.path])) : null,
    zone: state.mode === 'position' ? state.zone : null,
    phase: state.phase,
    scratch: lastScratch,
    headingHint,
    tipDiameterMm: eq ? eq.cue.tipDiameterMm : 12.5,
  };
}

function drawMinimap(sc) {
  mini.draw({ ...sc, trail: null });
  const m = v3.cameraMarker();
  if (!m) return;
  const ctx = miniCanvas.getContext('2d');
  const p = mini.worldToScreen(m);
  const q = mini.worldToScreen({ x: m.x + Math.cos(m.h) * 100, y: m.y + Math.sin(m.h) * 100 });
  const ang = Math.atan2(q.y - p.y, q.x - p.x);
  ctx.save();
  ctx.setTransform(mini.view.dpr, 0, 0, mini.view.dpr, 0, 0);
  ctx.translate(p.x, p.y);
  ctx.rotate(ang);
  ctx.fillStyle = 'rgba(255,213,74,0.95)';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-9, -5);
  ctx.lineTo(-9, 5);
  ctx.lineTo(1, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function render() {
  const sc = buildScene();
  if (view === '3d' && v3) {
    v3.draw(sc);
    drawMinimap(sc);
  } else {
    renderer.draw(sc);
  }
}

function updateButtons() {
  const can = !!info && state.phase === 'aim' && state.mode !== 'thickness';
  panel.setButtons({ shoot: can, reset: state.phase === 'aim' && !!state.preShot });
}

/* ------------------------------------------------------------------ shooting */

function startShot() {
  if (strokePending || !info || state.phase !== 'aim') return;
  if (state.mode === 'thickness' && !state.answered) return;
  if (view === '3d' && v3 && (state.mode !== 'thickness' || state.revealed)) {
    // 3D: quick forward stroke of the cue, then the balls start moving
    strokePending = true;
    v3.stroke(STROKE_MS);
    schedule();
    setTimeout(() => {
      strokePending = false;
      doShot();
    }, STROKE_MS + 10);
    return;
  }
  doShot();
}

function doShot() {
  if (!info || state.phase !== 'aim') return;
  lastScratch = false;
  info = computeInfo(true); // fresh aim-solver result, never a throttled stale one
  state.preShot = snapshot();
  state.preShot.lowest = lowestObjectId();
  state.preShot.aimOffset = state.aimOffset;
  state.sim = createSim(state.balls, { recordPaths: true, table: eq.table, cue: eq.cue });
  const launch = state.sim.strike({ aimDir: info.aimDir, power: state.power, tip: state.tip, elevationDeg: elevation() });
  state.phase = 'shooting';
  lastT = 0;
  timeScale = 1;
  prediction = null;
  if (launch && launch.miscue) panel.toast('Trượt cơ (miscue)!', 'bad');
  updateButtons();
  schedule();
}

function finishShot() {
  const sim = state.sim;
  const ev = sim.events;
  const lowest = state.preShot ? state.preShot.lowest : null;
  const targetWas = state.targetId;
  const cuePotted = ev.potted.includes(0);
  lastScratch = cuePotted;
  const objPotted = ev.potted.filter((id) => id !== 0);
  const finalBalls = sim.balls;
  const miscue = ev.miscue;
  const toast = (msg, kind) => {
    // keep the miscue notice visible when the shot result would overwrite it
    panel.toast(miscue && kind !== 'ok' ? `${msg} (trượt cơ)` : msg, kind);
  };

  // new table state
  state.balls = finalBalls
    .filter((b) => !b.potted)
    .map((b) => {
      const nb = createBall(b.id, b.pos.x, b.pos.y);
      nb.q = { ...b.q }; // keep the rolled orientation (numbers / stripe / dots)
      return nb;
    });
  if (cuePotted) {
    const spot = findFreeSpot({ x: geo.HEAD_SPOT.x - 150, y: geo.HEAD_SPOT.y });
    state.balls.push(createBall(0, spot.x, spot.y));
  }
  state.sim = null;
  state.phase = 'aim';
  timeScale = 1;
  if (!ball(state.targetId) || objPotted.includes(state.targetId)) {
    state.targetId = lowestObjectId();
    state.pocket = null;
  }

  const mode = state.mode;
  if (mode === 'thickness') {
    panel.setNextThick(true);
  } else if (mode === 'position') {
    const res = drills.evaluatePosition({ balls: finalBalls, events: ev }, state.drill);
    drills.recordPosition(stats, res.success);
    drills.saveStats(stats);
    let msg;
    let kind;
    if (res.success) {
      msg = 'Tuyệt! Vào lỗ và bi cái dừng trong vòng.';
      kind = 'ok';
    } else if (res.cuePotted) {
      msg = 'Bi cái vào lỗ – lỗi';
      kind = 'bad';
    } else if (!res.objPotted) {
      msg = 'Trượt – bi mục tiêu chưa vào lỗ';
      kind = 'bad';
    } else {
      msg = `Vào lỗ nhưng bi cái dừng cách vòng ${Math.max(0, Math.round((res.distance - state.drill.zone.r) / 10))} cm`;
      kind = 'warn';
    }
    panel.setPosResult(msg);
    toast(msg, kind);
    panel.updateStats(stats);
  } else if (mode === 'squirt') {
    const res = drills.evaluateSquirt({ balls: finalBalls, events: ev });
    drills.recordSquirt(stats, res.success);
    drills.saveStats(stats);
    state.revealed = true;
    const need = fmtDeg(state.drill.offsetDeg);
    const used = fmtDeg(state.preShot ? state.preShot.aimOffset : 0);
    let msg;
    let kind;
    if (res.success) {
      msg = `Vào lỗ! Bù squirt tốt (bạn đặt ${used}, cần khoảng ${need}).`;
      kind = 'ok';
    } else if (res.cuePotted) {
      msg = 'Bi cái vào lỗ – lỗi';
      kind = 'bad';
    } else {
      msg = `Trượt. Bạn đặt lệch ngắm ${used}, cần khoảng ${need}.`;
      kind = 'bad';
    }
    panel.setSquirtResult(msg);
    toast(msg, kind);
    panel.updateStats(stats);
  } else {
    let msg;
    let kind;
    if (cuePotted) {
      msg = 'Bi cái vào lỗ – lỗi';
      kind = 'bad';
    } else if (ev.firstContact !== null && lowest !== null && ev.firstContact !== lowest) {
      msg = 'Chạm sai bi trước';
      kind = 'bad';
    } else if (ev.potted.includes(9)) {
      msg = 'Vào lỗ! Bi 9 xuống lỗ';
      kind = 'ok';
    } else if (objPotted.includes(targetWas)) {
      msg = objPotted.length > 1 ? `Vào lỗ! (bi ${objPotted.join(', ')})` : 'Vào lỗ!';
      kind = 'ok';
    } else if (objPotted.length) {
      msg = `Bi ${objPotted.join(', ')} vào lỗ (không phải bi mục tiêu)`;
      kind = 'warn';
    } else {
      msg = ev.firstContact === null ? 'Trượt – bi cái không chạm bi nào' : 'Trượt';
      kind = 'bad';
    }
    toast(msg, kind);
  }
  panel.refreshTray((id) => !!ball(id));
  invalidate();
}

/* ------------------------------------------------------------------ table setup */

function rackNine() {
  const d = 2 * R + 0.3;
  const dx = (d * Math.sqrt(3)) / 2;
  const rows = [1, 2, 3, 2, 1];
  const spots = [];
  rows.forEach((n, k) => {
    for (let j = 0; j < n; j++) spots.push({ x: geo.FOOT_SPOT.x + k * dx, y: geo.FOOT_SPOT.y + (j - (n - 1) / 2) * d });
  });
  // spots: 0 apex, 4 centre of the 3-row
  const rest = [2, 3, 4, 5, 6, 7, 8].sort(() => Math.random() - 0.5);
  const list = [{ id: 1, ...spots[0] }, { id: 9, ...spots[4] }];
  const free = [1, 2, 3, 5, 6, 7, 8];
  free.forEach((si, i) => list.push({ id: rest[i], ...spots[si] }));
  list.push({ id: 0, x: geo.HEAD_SPOT.x - 100, y: geo.HEAD_SPOT.y });
  setBalls(list);
  state.targetId = 1;
  state.pocket = null;
  state.preShot = null;
}

function randomize(ids) {
  const placed = [];
  const out = [];
  for (const id of ids) {
    let p = null;
    for (let i = 0; i < 400; i++) {
      const c = randomPoint(R + 25);
      if (placed.every((q) => dist(q, c) > 2 * R + 20)) {
        p = c;
        break;
      }
    }
    p = p || randomPoint();
    placed.push(p);
    out.push({ id, ...p });
  }
  setBalls(out);
}

function defaultLayout() {
  setBalls([
    { id: 0, x: geo.W * 0.25, y: geo.H * 0.5 },
    { id: 1, x: geo.W * 0.59, y: geo.H * 0.63 },
    { id: 9, x: geo.W * 0.75, y: geo.H * 0.39 },
  ]);
  state.targetId = 1;
  state.pocket = null;
  state.preShot = null;
}

function applyShare(decoded) {
  setBalls(decoded.balls);
  normalizeBalls(); // clamps to the table and resolves overlaps from hand-edited links
  if (!ball(0)) {
    const sp = findFreeSpot({ x: geo.HEAD_SPOT.x - 100, y: geo.HEAD_SPOT.y });
    state.balls.push(createBall(0, sp.x, sp.y));
  }
  state.targetId = decoded.targetId !== null && ball(decoded.targetId) ? decoded.targetId : lowestObjectId();
  state.pocket = decoded.pocket;
  state.preShot = null;
}

/* ------------------------------------------------------------------ modes + drills */

function setMode(mode) {
  if (state.phase !== 'aim') return;
  if (mode === state.mode) return;
  if (state.mode === 'free') state.freeBackup = snapshot();
  state.mode = mode;
  panel.setActiveTab(mode);
  state.preShot = null;
  state.aimOffset = 0;
  state.aimMode = 'auto';
  state.revealed = false;
  syncControls();
  if (mode === 'free') {
    if (state.freeBackup) restore(state.freeBackup);
    else defaultLayout();
    state.zone = null;
    state.drill = null;
  } else if (mode === 'thickness') {
    newThicknessRound();
  } else if (mode === 'position') {
    newPositionRound();
  } else {
    newSquirtRound();
  }
  panel.refreshTray((id) => !!ball(id));
  panel.updateStats(stats);
  invalidate();
}

function newThicknessRound() {
  const sc = drills.genThicknessDrill(Math.random, eq.table);
  state.drill = sc;
  state.zone = null;
  setBalls([
    { id: 0, x: sc.cue.x, y: sc.cue.y },
    { id: 1, x: sc.obj.x, y: sc.obj.y },
  ]);
  state.targetId = 1;
  state.pocket = sc.pocket;
  state.revealed = false;
  state.answered = false;
  state.aimOffset = 0;
  panel.resetThickness();
  syncControls();
}

function answerThickness(label) {
  if (state.mode !== 'thickness' || state.answered || state.phase !== 'aim') return;
  state.answered = true;
  const res = drills.answerThickness(state.drill, label);
  drills.recordThickness(stats, res.correct);
  drills.saveStats(stats);
  state.revealed = true;
  panel.showThickAnswer(res, label);
  panel.updateStats(stats);
  invalidate();
  // auto-play the shot (stun, medium power) after the reveal
  setTimeout(() => {
    if (state.mode !== 'thickness' || state.phase !== 'aim') return;
    info = computeInfo();
    state.power = 0.28;
    state.tip = { x: 0, y: 0 };
    panel.spinPad.set(state.tip, true);
    syncControls();
    startShot();
  }, 800);
}

function newPositionRound() {
  const sc = drills.genPositionDrill(Math.random, eq);
  state.drill = sc;
  state.zone = sc.zone;
  setBalls([
    { id: 0, x: sc.cue.x, y: sc.cue.y },
    { id: 1, x: sc.obj.x, y: sc.obj.y },
  ]);
  state.targetId = 1;
  state.pocket = sc.pocket;
  state.aimOffset = 0;
  state.power = 0.2;
  state.tip = { x: 0, y: 0 };
  panel.spinPad.set(state.tip, true);
  state.preShot = null;
  panel.setPosResult('');
  syncControls();
}

function newSquirtRound() {
  const sc = drills.genSquirtDrill(Math.random, eq);
  state.drill = sc;
  state.zone = null;
  setBalls([
    { id: 0, x: sc.cue.x, y: sc.cue.y },
    { id: 1, x: sc.obj.x, y: sc.obj.y },
  ]);
  state.targetId = 1;
  state.pocket = sc.pocket;
  state.aimOffset = 0;
  state.power = sc.power;
  state.tip = { x: sc.tipX, y: 0 };
  state.revealed = false;
  state.preShot = null;
  panel.spinPad.set(state.tip, true);
  panel.setSquirtResult('');
  panel.setSquirtTitle(`Đánh với effet <b>${tipText(state.tip)}</b>: chỉnh <b>Lệch ngắm</b> để bù squirt của gậy rồi đánh.`);
  syncControls();
}

/* ------------------------------------------------------------------ UI wiring */

function syncControls() {
  panel.syncControls({
    power: state.power,
    aimOffset: state.aimOffset,
    tip: state.tip,
    elevation: elevation(),
    comp: state.compensate && compAllowedMode(),
    elevationLocked: state.mode !== 'free',
    compLocked: !compAllowedMode(),
  });
  updateAimUi();
}

function updateAimUi() {
  const manual = state.aimMode === 'manual';
  panel.setAimMode(state.aimMode, manual ? fmtDeg(state.aimAngle) : `Δ ${fmtDeg(state.aimOffset)}`);
}

/** Switch to free aim, starting from the current auto aim direction so nothing jumps. */
function ensureManual() {
  if (state.aimMode === 'manual') return true;
  if (state.phase !== 'aim' || !manualAllowed()) return false;
  if (info && info.aimDir) state.aimAngle = normAngle(Math.round(deg(Math.atan2(info.aimDir.y, info.aimDir.x)) * 100) / 100);
  state.aimMode = 'manual';
  updateAimUi();
  return true;
}

function rotateAim(d) {
  if (v3) v3.userInput();
  if (state.phase !== 'aim' || !ensureManual()) return;
  state.aimAngle = normAngle(Math.round((state.aimAngle + d) * 100) / 100);
  updateAimUi();
  invalidate();
}

function nudgeAim(d) {
  if (v3) v3.userInput();
  if (state.mode === 'thickness') return;
  if (state.mode === 'squirt') {
    // squirt drill trains the auto-aim offset, so the buttons move that
    state.aimOffset = clamp(Math.round((state.aimOffset + d) * 10) / 10, -5, 5);
    syncControls();
    invalidate();
    return;
  }
  rotateAim(d);
}

function resetShot() {
  if (state.phase !== 'aim' || !state.preShot) return;
  restore(state.preShot);
  state.preShot = null;
  if (state.mode === 'thickness') panel.setNextThick(state.answered);
  panel.refreshTray((id) => !!ball(id));
  invalidate();
}

function randomLayout() {
  if (state.mode !== 'free' || state.phase !== 'aim') return;
  state.preShot = null;
  randomize(state.balls.map((b) => b.id));
  ensureTarget();
  state.pocket = null;
  invalidate();
}

let keys = null; // keyboard controller (created below, after the panel exists)

const panel = createPanel({
  onPower: (p) => {
    state.power = p;
    invalidate();
  },
  onAim: (d) => {
    state.aimOffset = d;
    updateAimUi();
    invalidate();
  },
  onElevation: (e) => {
    state.elevation = e;
    invalidate();
  },
  onComp: (on) => {
    state.compensate = on;
    invalidate();
  },
  onNudge: nudgeAim,
  onAimMode: () => {
    if (state.phase !== 'aim' || !manualAllowed()) return;
    if (state.aimMode === 'manual') {
      state.aimMode = 'auto';
      updateAimUi();
      invalidate();
    } else {
      ensureManual();
      invalidate();
    }
  },
  onTip: (tip) => {
    state.tip = tip;
    invalidate();
  },
  onShoot: startShot,
  onReset: resetShot,
  onRandom: randomLayout,
  onRack: () => {
    if (state.mode !== 'free' || state.phase !== 'aim') return;
    rackNine();
    panel.refreshTray((id) => !!ball(id));
    invalidate();
    panel.toast('Đã xếp 9 bi', 'ok');
  },
  onShare: async () => {
    const ids = settings.ids();
    const hash = encodeState({
      balls: state.balls,
      targetId: state.targetId,
      pocket: state.pocket,
      tableId: ids.tb,
      cueId: ids.cu,
      aimDeg: state.aimMode === 'manual' ? state.aimAngle : null,
    });
    const url = `${location.origin === 'null' ? '' : location.origin}${location.pathname}#${hash}`;
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch (e2) {
        ok = false;
      }
    }
    if (ok) panel.toast('Đã sao chép liên kết', 'ok');
    else {
      history.replaceState(null, '', `#${hash}`);
      panel.toast('Không sao chép được – hãy sao chép liên kết trên thanh địa chỉ', 'warn');
    }
  },
  onOverlay: (key, on) => {
    state.overlays[key] = on;
    invalidate();
  },
  onMode: setMode,
  onThickPick: answerThickness,
  onNextThick: () => {
    if (state.phase !== 'aim') return;
    newThicknessRound();
    invalidate();
  },
  onNextPos: () => {
    if (state.phase !== 'aim') return;
    newPositionRound();
    invalidate();
  },
  onHint: () => {
    if (!state.drill || !state.drill.solution) return;
    const s = state.drill.solution;
    const y = Math.round(s.tipY * 100);
    const spin = Math.abs(y) < 5 ? 'giữa' : y > 0 ? `cao ${y}%` : `thấp ${-y}%`;
    panel.setPosResult(`Gợi ý: lực khoảng ${Math.round(s.power * 100)}%, điểm chạm ${spin}.`);
  },
  onNextSquirt: () => {
    if (state.phase !== 'aim') return;
    newSquirtRound();
    invalidate();
  },
  onHintSquirt: () => {
    if (state.mode !== 'squirt' || !state.drill) return;
    const o = state.drill.offsetDeg;
    state.revealed = true;
    panel.setSquirtResult(
      `Gợi ý: squirt ${fmtDeg(Math.abs(o))}. Đặt Lệch ngắm khoảng ${o >= 0 ? '+' : '−'}${fmtDeg(Math.abs(o))} (${o >= 0 ? 'sang phải' : 'sang trái'}).`,
    );
    invalidate();
  },
  onToggleBall: toggleBall,
  onPanelToggle: () => {
    requestAnimationFrame(() => {
      resizeViews();
      invalidate({ pred: false });
    });
  },
});

const settings = createSettings({
  canChange: () => state.phase === 'aim',
  onChange: onEquipmentChange,
  toast: panel.toast,
});

createInput({
  canvas,
  renderer,
  getBalls: () => state.balls,
  getTable: () => geo,
  getCuePos: () => {
    const c = ball(0);
    return c ? c.pos : null;
  },
  canRotate: () => state.phase === 'aim' && manualAllowed(),
  onRotate: rotateAim,
  canDrag: () => state.mode === 'free' && state.phase === 'aim',
  onMove: () => invalidate(),
  onDragEnd: () => invalidate(),
  onTapBall: (b) => {
    if (state.mode !== 'free' || state.phase !== 'aim' || b.id === 0) return;
    if (state.targetId !== b.id) {
      state.targetId = b.id;
      state.pocket = null;
      invalidate();
    }
  },
  onTapPocket: (i) => {
    if (state.mode !== 'free' || state.phase !== 'aim') return;
    state.pocket = state.pocket === i ? null : i;
    invalidate();
  },
});

function toggleBall(id) {
  if (state.mode !== 'free' || state.phase !== 'aim') return;
  const existing = ball(id);
  if (existing) {
    state.balls = state.balls.filter((b) => b.id !== id);
  } else {
    const spot = findFreeSpot({ x: geo.W * (0.45 + Math.random() * 0.4), y: geo.H * (0.25 + Math.random() * 0.5) }, 6);
    state.balls.push(createBall(id, spot.x, spot.y));
  }
  ensureTarget();
  panel.refreshTray((i) => !!ball(i));
  invalidate();
}


/* ------------------------------------------------------------------ keyboard (PC) */

const canSelectTarget = () => state.mode === 'free' && state.phase === 'aim';
const canAimKeys = () => state.phase === 'aim' && state.mode !== 'thickness';

/** Selecting a target/pocket by key implies auto aim, so the choice is visible. */
function switchToAuto() {
  if (state.aimMode === 'manual') {
    state.aimMode = 'auto';
    updateAimUi();
  }
}

keys = createKeyboard({
  stage: document.getElementById('stage'),
  canvas,
  onLayout: () => {
    resizeViews();
    invalidate({ pred: false });
  },
  api: {
    phase: () => state.phase,
    canAim: canAimKeys,
    canSelectTarget,
    nudgeAim: (d) => {
      if (!canAimKeys()) return null;
      nudgeAim(d);
      return state.mode === 'squirt' ? `Lệch ngắm ${fmtDeg(state.aimOffset)}` : `Ngắm ${fmtDeg(state.aimAngle)}`;
    },
    getPower: () => state.power,
    setPower: (p) => {
      if (!canAimKeys()) return false;
      state.power = p;
      syncControls();
      invalidate();
      return true;
    },
    canTip: canAimKeys,
    getTip: () => ({ ...state.tip }),
    setTip: (t) => panel.spinPad.set(t), // non-silent: updates the label and state.tip through onTip
    miscueLimit: () => eq.cue.miscueLimit,
    elevation: () => (state.mode === 'free' && state.phase === 'aim' ? state.elevation : null),
    setElevation: (e) => {
      state.elevation = e;
      syncControls();
      invalidate();
    },
    cycleTarget: (dir) => {
      if (!canSelectTarget()) return null;
      const ids = state.balls.filter((b) => b.id !== 0).map((b) => b.id);
      const id = cycleTarget(ids, state.targetId, dir);
      if (id === null) return null;
      state.targetId = id;
      state.pocket = null;
      switchToAuto();
      invalidate();
      return id;
    },
    selectTarget: (id) => {
      if (!canSelectTarget() || id === 0 || !ball(id)) return false;
      state.targetId = id;
      state.pocket = null;
      switchToAuto();
      invalidate();
      return true;
    },
    pocket: (auto) => {
      if (!canSelectTarget()) return null;
      if (auto) {
        state.pocket = null;
      } else {
        const eff = info && !info.manual ? info.pocketIdx : null;
        state.pocket = nextPocket(state.pocket, eff, geo.POCKETS.length);
      }
      switchToAuto();
      invalidate();
      return state.pocket === null ? 'Lỗ: tự chọn' : `Lỗ ${state.pocket + 1}`;
    },
    toggleAimMode: () => {
      if (state.phase !== 'aim' || !manualAllowed()) return null;
      if (state.aimMode === 'manual') {
        state.aimMode = 'auto';
        updateAimUi();
      } else {
        ensureManual();
      }
      invalidate();
      return state.aimMode;
    },
    reset: resetShot,
    random: randomLayout,
    togglePredict: () => {
      if (state.mode !== 'free') return null;
      state.overlays.predict = !state.overlays.predict;
      const cb = document.querySelector('[data-ov="predict"]');
      if (cb) cb.checked = state.overlays.predict;
      invalidate();
      return state.overlays.predict;
    },
    shoot: startShot,
    fastForward: () => {
      if (state.phase !== 'shooting') return null;
      timeScale = timeScale === 1 ? 4 : 1;
      return timeScale;
    },
    is3D: () => view === '3d',
    toggleView: () => {
      const next = view === '3d' ? '2d' : '3d';
      setView(next);
      return `Góc nhìn: ${next.toUpperCase()}`;
    },
    camMode: () => {
      const m = nextCameraMode(camMode);
      setCamMode(m);
      return `Camera: ${CAMERA_MODE_LABEL[m]}`;
    },
    camHeight: (d) => (v3 ? v3.camHeight(d) : null),
    camDist: (d) => (v3 ? v3.camDist(d) : null),
    hud: () => ({
      visible: state.mode !== 'thickness',
      power: state.power,
      aimDeg: info && info.aimDir ? normAngle(deg(Math.atan2(info.aimDir.y, info.aimDir.x))) : null,
      aimMode: state.aimMode,
      tip: state.tip,
      miscue: eq.cue.miscueLimit,
      elevation: elevation(),
      elevEditable: state.mode === 'free',
    }),
  },
});

// Enter shoots on desktop (kept from earlier phases)
window.addEventListener('keydown', (e) => {
  if (e.target && /^(INPUT|TEXTAREA|BUTTON|SELECT)$/.test(e.target.tagName)) return;
  if (e.key === 'Enter') startShot();
});

// resize
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    resizeViews();
    panel.resize();
    invalidate({ pred: false });
  }).observe(document.getElementById('stage'));
}
window.addEventListener('resize', () => {
  resizeViews();
  invalidate({ pred: false });
});

// share link in the hash
function loadFromHash() {
  const d = decodeState(location.hash);
  if (!d) return false;
  if (state.mode !== 'free') {
    state.mode = 'free';
    panel.setActiveTab('free');
    state.zone = null;
    state.drill = null;
    state.revealed = false;
  }
  settings.applyIds({ tb: d.tableId, cu: d.cueId });
  applyShare(d);
  if (d.aimDeg !== null && d.aimDeg !== undefined) {
    state.aimMode = 'manual';
    state.aimAngle = d.aimDeg;
  } else {
    state.aimMode = 'auto';
  }
  updateAimUi();
  panel.refreshTray((id) => !!ball(id));
  invalidate();
  return true;
}
window.addEventListener('hashchange', () => {
  if (state.phase === 'aim') loadFromHash();
});

// PWA (sw.js stays at the site root so its scope covers the whole app)
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

/* ------------------------------------------------------------------ 3D view (Phase 6) */

const viewBtns = [...document.querySelectorAll('[data-view]')];
const camBtns = [...document.querySelectorAll('[data-cam]')];
const qualBtns = [...document.querySelectorAll('[data-q3d]')];
const opts3d = document.getElementById('v3opts');
const load3d = document.getElementById('v3load');

function syncViewUi() {
  for (const b of viewBtns) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  for (const b of camBtns) b.setAttribute('aria-pressed', String(b.dataset.cam === camMode));
  const q = v3 ? v3.getQuality() : quality3d || 'high';
  for (const b of qualBtns) b.setAttribute('aria-pressed', String(b.dataset.q3d === q));
}

function setCamMode(m) {
  camMode = m;
  lsWrite('bida9-v3-cam', m);
  if (v3) v3.setCameraMode(m);
  syncViewUi();
  invalidate({ pred: false });
}

function setQuality3d(q) {
  quality3d = q;
  lsWrite('bida9-v3-quality', q);
  if (v3) v3.setQuality(q);
  syncViewUi();
  invalidate({ pred: false });
}

function tapBall3d(id) {
  const b = ball(id);
  if (!b || state.mode !== 'free' || state.phase !== 'aim' || b.id === 0) return;
  if (state.targetId !== b.id) {
    state.targetId = b.id;
    state.pocket = null;
    invalidate();
  }
}

async function setView(next) {
  if (next === view || v3Loading) return;
  if (next === '3d') {
    v3Loading = true;
    load3d.hidden = false;
    try {
      if (!v3) {
        await new Promise((r) => setTimeout(r, 30)); // let "Đang tải 3D…" paint before the heavy import
        const mod = await import('./ui/render3d.js');
        canvas3d.hidden = false; // WebGL needs a laid-out canvas
        miniCanvas.hidden = false;
        try {
          v3 = await mod.createView3D({
            canvas: canvas3d,
            requestFrame: schedule,
            canRotate: () => state.phase === 'aim' && manualAllowed(),
            onRotate: rotateAim,
            onTapBall: tapBall3d,
            onLost: () => {
              panel.toast('Mất ngữ cảnh 3D – quay về 2D', 'warn');
              setView('2d');
            },
          });
        } finally {
          canvas3d.hidden = view !== '3d';
          miniCanvas.hidden = view !== '3d';
        }
        mini = createRenderer(miniCanvas);
        if (quality3d) v3.setQuality(quality3d);
        v3.setCameraMode(camMode);
        v3.setTable(geo, eq.table);
        mini.setTable(geo, eq.table);
      }
    } catch (e) {
      v3 = null;
      mini = null;
      lsWrite('bida9-view', '2d');
      panel.toast('Thiết bị không hỗ trợ 3D', 'bad');
      return;
    } finally {
      v3Loading = false;
      load3d.hidden = true;
    }
  }
  view = next;
  lsWrite('bida9-view', next);
  const is3 = next === '3d';
  canvas.hidden = is3;
  canvas3d.hidden = !is3;
  miniCanvas.hidden = !is3;
  opts3d.hidden = !is3;
  if (is3) {
    v3.activate();
    mini.resize();
    if (!v3Hinted) {
      v3Hinted = true;
      panel.toast('Kéo ngang: xoay ngắm · Lăn/chụm: zoom · Chuột phải hoặc 2 ngón kéo dọc: độ cao', 'ok');
    }
  } else {
    renderer.resize();
  }
  syncViewUi();
  invalidate({ pred: false });
}

for (const b of viewBtns) b.addEventListener('click', () => setView(b.dataset.view));
for (const b of camBtns) b.addEventListener('click', () => setCamMode(b.dataset.cam));
for (const b of qualBtns) b.addEventListener('click', () => setQuality3d(b.dataset.q3d));
miniCanvas.addEventListener('click', () => setView('2d'));
syncViewUi();

/* ------------------------------------------------------------------ start */

eq = settings.get();
eqKey = JSON.stringify(eq);
geo = buildTable(eq.table);
renderer.setTable(geo, eq.table);
panel.spinPad.setMiscueLimit(eq.cue.miscueLimit);
defaultLayout();
if (!loadFromHash()) panel.refreshTray((id) => !!ball(id));
syncControls();
panel.updateStats(stats);
renderer.resize();
invalidate();
if (lsRead('bida9-view') === '3d') setView('3d');
