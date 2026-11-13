// App state + wiring. DOM details live in ui/panel.js (controls) and ui/settings.js (equipment sheet).
import { R, buildTable } from './core/table.js';
import { computeShot, bestPocket, isPathBlocked, firstHit, effectiveCueElevationDeg } from './core/geometry.js';
import { createBall, createSim, simulate, computeLaunch, DEFAULT_ELEVATION_DEG } from './core/physics.js';
import { physicsEquipmentKey } from './core/equipment.js';
import { solveAim } from './core/aim-solver.js';
import { createRenderer } from './ui/render.js';
import { createInput, placeBall } from './ui/input.js';
import { createPanel, tipText, fmtDeg } from './ui/panel.js';
import { createSettings } from './ui/settings.js';
import { createKeyboard, cycleTarget, nextPocket, isTypingTarget } from './ui/keyboard.js';
import * as drills from './features/drills.js';
import { encodeState, decodeState } from './features/share.js';
import {
  BOT_DIFFICULTIES,
  BOT_GAMES,
  botAidFor,
  eightBallTargetIds,
  evaluateNineBallTurn,
  evaluateEightBallTurn,
  placeCueBallForBot,
  chooseBotShot,
  lowestBallId,
} from './features/bot.js';
import { rotate, rad, deg, dist, clamp } from './core/vec.js';
import { CAMERA_MODES, CAMERA_MODE_LABEL, nextCameraMode } from './ui/view3d-math.js'; // pure; three.js itself is only fetched on first 3D open
import { createDropAnim, stepDropAnim } from './ui/drop-anim.js';
import { createSoundEngine } from './ui/sound.js';

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
  appMode: 'practice', // 'bot' | 'practice'
  practiceMode: 'free',
  lobbyOpen: false,
  mode: 'free', // 'free' | 'thickness' | 'position' | 'squirt' | 'bot'
  phase: 'aim', // 'aim' | 'shooting'
  preShot: null,
  sim: null,
  freeBackup: null,
  drill: null, // current drill scenario
  revealed: false,
  answered: false,
  zone: null,
  pottedIds: [], // live list of ball ids dropped into pockets on the current rack/layout
  bot: {
    matchType: 'pve', // 'pve' | 'bvb'
    bot1Name: 'Alpha',
    bot2Name: 'Beta',
    bot1Diff: 'hard',
    bot2Diff: 'pro',
    paused: false,
    speed: 1, // 1 | 2
    game: '9ball',
    difficulty: 'medium',
    groups: { player: null, bot: null, bot1: null, bot2: null },
    scorePlayer: 0,
    scoreBot: 0,
    rack: 1,
    breaker: 'player',
    turn: 'player',
    onBreak: true,
    ballInHand: true,
    thinking: false,
    statusText: 'Đặt bi cái sau vạch đầu bàn và phá bi.',
    isFoul: false,
    timers: [],
  },
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
let loadingHash = false;
let dropAnims = [];
let seenDropCount = 0;
let seenContactCount = 0;
let seenCushionCount = 0;
const isAimReady = () => state.phase === 'aim' && !strokePending;
const isBotMode = () => state.mode === 'bot';
const isBvbMode = () => isBotMode() && state.bot.matchType === 'bvb';
const isBotTurn = () => isBotMode() && (isBvbMode() || state.bot.turn === 'bot');
const isPlayerReady = () => isAimReady() && !isBotTurn();

function botNameOf(who) {
  if (state.bot.matchType === 'bvb') {
    if (who === 'bot1' || who === 'player') return state.bot.bot1Name || 'Alpha';
    if (who === 'bot2' || who === 'bot') return state.bot.bot2Name || 'Beta';
    return who;
  }
  return who === 'player' ? 'Bạn' : 'Bot';
}

function botDiffOf(who) {
  if (state.bot.matchType === 'bvb') {
    return (who === 'bot1' || who === 'player') ? (state.bot.bot1Diff || 'hard') : (state.bot.bot2Diff || 'pro');
  }
  return state.bot.difficulty || 'medium';
}

function clearBotTimers() {
  for (const id of state.bot.timers) clearTimeout(id);
  state.bot.timers = [];
  state.bot.thinking = false;
}

function addBotTimer(fn, ms) {
  const id = setTimeout(() => {
    state.bot.timers = state.bot.timers.filter((t) => t !== id);
    fn();
  }, ms);
  state.bot.timers.push(id);
  return id;
}

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
function aimAtLowestBall() {
  const cue = ball(0);
  const tid = lowestObjectId();
  const tgt = tid ? ball(tid) : null;
  if (cue && tgt) {
    state.aimAngle = normAngle(Math.round(deg(Math.atan2(tgt.pos.y - cue.pos.y, tgt.pos.x - cue.pos.x)) * 100) / 100);
  }
}
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
    pottedIds: [...state.pottedIds],
  };
}
function restore(s) {
  setBalls(s.balls);
  normalizeBalls();
  state.targetId = s.targetId;
  state.pocket = s.pocket;
  state.pottedIds = Array.isArray(s.pottedIds) ? [...s.pottedIds] : [];
  syncPottedUi();
}

function syncPottedUi() {
  if (!panel || !panel.setPottedBalls) return;
  const visible = !state.lobbyOpen && (state.mode === 'bot' || state.mode === 'free');
  if (!visible) {
    panel.setPottedBalls(null, false);
    return;
  }
  let rackIds;
  if (state.mode === 'bot') {
    rackIds = state.bot.game === '8ball'
      ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
      : [1, 2, 3, 4, 5, 6, 7, 8, 9];
  } else {
    const idSet = new Set();
    for (const b of state.balls) if (b.id !== 0) idSet.add(b.id);
    for (const id of state.pottedIds) if (id !== 0) idSet.add(id);
    rackIds = [...idSet].sort((a, b) => a - b);
  }
  const deadIds = state.pottedIds.filter((id) => id !== 0);
  const scratch = state.pottedIds.includes(0);
  panel.setPottedBalls({ rackIds, deadIds, scratch }, true);
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
  const nextKey = physicsEquipmentKey(next);
  eq = next;
  if (nextKey === eqKey) {
    // Metadata or visual-only cue/table change (e.g. name, hardness, shaft): still redraw stick
    invalidate({ pred: false });
    return;
  }
  const oldGeo = geo;
  eqKey = nextKey;
  geo = buildTable(eq.table);
  renderer.setTable(geo, eq.table);
  if (v3) v3.setTable(geo, eq.table);
  if (mini) mini.setTable(geo, eq.table);
  panel.spinPad.setMiscueLimit(eq.cue.miscueLimit);
  if (!loadingHash && (oldGeo.W !== geo.W || oldGeo.H !== geo.H)) {
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
let aimUiDirty = false;
let lastPred = 0;
let rafId = 0;

function effOverlays() {
  const o = state.overlays;
  if (state.mode === 'bot') {
    if (isBotTurn()) {
      if (isBvbMode()) {
        const diff = botDiffOf(state.bot.turn);
        const aid = botAidFor(diff);
        return {
          aim: true,
          actual: true,
          ghost: aid.ghost,
          pocket: aid.pocket,
          tangent: aid.tangent,
          roll: false,
          predict: true,
        };
      }
      return { aim: false, actual: false, ghost: false, pocket: false, tangent: false, roll: false, predict: false };
    }
    const aid = botAidFor(state.bot.difficulty);
    return {
      aim: aid.aim,
      actual: false,
      ghost: aid.ghost,
      pocket: aid.pocket,
      tangent: aid.tangent,
      roll: false,
      predict: false,
    };
  }
  if (state.mode === 'thickness') {
    const v = state.revealed;
    return { aim: v, actual: false, ghost: v, pocket: v, tangent: v, roll: false, predict: false };
  }
  if (state.mode === 'position') return { ...o, predict: false };
  if (state.mode === 'squirt') return { ...o, predict: false, actual: o.actual && state.revealed };
  return o;
}

const baseElevation = () => (state.mode === 'free' ? state.elevation : DEFAULT_ELEVATION_DEG);
function currentAimDir() {
  if (state.aimMode === 'manual') {
    return { x: Math.cos(rad(state.aimAngle)), y: Math.sin(rad(state.aimAngle)) };
  }
  const cue = ball(0);
  const obj = ball(state.targetId);
  if (!cue || !obj) return { x: 1, y: 0 };
  const pocketIdx = state.pocket !== null ? state.pocket : bestPocket(cue, obj, state.balls, R, geo.POCKETS);
  const pk = geo.POCKETS[pocketIdx];
  return computeShot(cue.pos, obj.pos, pk ? pk.aim : obj.pos, R).aimDir;
}
function elevation(aimDirOverride = null) {
  const base = baseElevation();
  const cue = ball(0);
  if (!cue) return base;
  const dir = aimDirOverride || currentAimDir();
  return effectiveCueElevationDeg(base, cue.pos, dir, state.tip, geo, {
    pull: 50 + state.power * 200,
    balls: state.balls,
  });
}
const compAllowedMode = () => state.mode === 'free' || state.mode === 'position';
const compEnabled = () => state.compensate && compAllowedMode() && state.aimMode === 'auto';

const compCache = new Map();
let lastComp = null;
let lastSolveAt = 0;
let compStale = false;

/** Aim solver result for the current state: cached by state key, throttled while the state keeps changing. */
function getComp(cue, obj, pocketPoint, force, baseDir) {
  const elev = elevation(baseDir);
  const key = [
    eqKey,
    obj.id,
    pocketPoint.x.toFixed(1),
    pocketPoint.y.toFixed(1),
    state.power.toFixed(3),
    state.tip.x.toFixed(3),
    state.tip.y.toFixed(3),
    elev,
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
    { power: state.power, tip: state.tip, elevationDeg: elev },
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
const manualAllowed = () => state.mode === 'free' || state.mode === 'position' || state.mode === 'bot';

/** Distance along dir until the ball centre reaches a cushion. */
function rayWallT(o, d) {
  let t = Infinity;
  if (d.x > 1e-9) t = Math.min(t, (geo.W - R - o.x) / d.x);
  else if (d.x < -1e-9) t = Math.min(t, (R - o.x) / d.x);
  if (d.y > 1e-9) t = Math.min(t, (geo.H - R - o.y) / d.y);
  else if (d.y < -1e-9) t = Math.min(t, (R - o.y) / d.y);
  return Math.max(0, t);
}

/** Free aim: ray-cast the cue-ball path to the first ball it would hit. */
function computeManualInfo(cue) {
  const aimDir = { x: Math.cos(rad(state.aimAngle)), y: Math.sin(rad(state.aimAngle)) };
  const effElev = elevation(aimDir);
  const launch = computeLaunch(aimDir, state.power, state.tip, eq.cue, noMiscueRng, effElev);
  const curDiff = isBvbMode() ? botDiffOf(state.bot.turn) : state.bot.difficulty;
  const aid = state.mode === 'bot' ? botAidFor(curDiff) : null;
  const rayDir = aid ? aimDir : launch.dir;
  const wallT = rayWallT(cue.pos, rayDir);
  const base = {
    cue: cue.pos,
    manual: true,
    hit: false,
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
  let hit = firstHit(cue.pos, rayDir, state.balls, R, [0]);
  if (hit && hit.t > wallT) hit = null; // the cue ball reaches a cushion first
  if (aid && !aid.ghost) {
    const cap = aid.maxAimLen || 220;
    return {
      ...base, obj: null, objId: null, ghost: null, objDir: null, stunDir: null, rollDir: null,
      aimLen: Math.min(hit ? hit.t : wallT, cap), cutAngleDeg: null, fullness: null, fullnessLabel: '', distCue: null,
    };
  }
  base.hit = !!hit;
  if (!hit) {
    const cap = aid ? aid.maxAimLen || 4000 : 4000;
    return {
      ...base, obj: null, objId: null, ghost: null, objDir: null, stunDir: null, rollDir: null,
      aimLen: Math.min(wallT, cap), cutAngleDeg: null, fullness: null, fullnessLabel: '', distCue: null,
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
  if (comp.enabled) comp.result = getComp(cue, obj, pk.aim, force, shot.aimDir);
  // correction relative to the ghost-ball line (a stale result still applies as a small relative rotation)
  const baseAim = comp.result && comp.result.ok ? rotate(shot.aimDir, rad(comp.result.correctionDeg)) : shot.aimDir;
  const aimDir = rotate(baseAim, rad(state.aimOffset));
  const aimLen = dist(cue.pos, shot.ghost);
  // where the cue ball really leaves after squirt / miscue (miscue angle not randomised in previews)
  const launch = computeLaunch(aimDir, state.power, state.tip, eq.cue, noMiscueRng, elevation(aimDir));
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
  const maxTime = state.balls.length > 6 ? 3.2 : 4.2;
  prediction = simulate(
    state.balls,
    { aimDir: info.aimDir, power: state.power, tip: state.tip, elevationDeg: elevation(info.aimDir) },
    { recordPaths: true, pathEvery: 10, maxTime, table: eq.table, cue: eq.cue, rng: noMiscueRng },
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
    const evContacts = state.sim.events.contacts;
    while (seenContactCount < evContacts.length) {
      sound.ballHit(evContacts[seenContactCount++].speed ?? 1200);
    }
    const evCushions = state.sim.events.cushionHits;
    while (seenCushionCount < evCushions.length) {
      const ch = evCushions[seenCushionCount++];
      sound.cushionHit(ch.speed ?? 1000, ch.wall === 'jaw');
    }
    const evDrops = state.sim.events.drops;
    while (seenDropCount < evDrops.length) {
      const d = evDrops[seenDropCount++];
      dropAnims.push(createDropAnim(d));
      sound.pocketDrop(Math.hypot(d.vx || 0, d.vy || 0));
      if (!state.pottedIds.includes(d.id)) {
        state.pottedIds.push(d.id);
        syncPottedUi();
      }
    }
    for (let i = dropAnims.length - 1; i >= 0; i--) {
      if (!stepDropAnim(dropAnims[i], dt * timeScale)) dropAnims.splice(i, 1);
    }
    if ((!state.sim.isMoving() && dropAnims.length === 0) || state.sim.time > 25) finishShot();
  }
  if (infoDirty || compStale) {
    info = computeInfo();
    updateInfoPanel();
    updateButtons();
    if (aimUiDirty) {
      updateAimUi();
      aimUiDirty = false;
    }
    infoDirty = false;
  } else if (aimUiDirty) {
    updateAimUi();
    aimUiDirty = false;
  }
  if (predDirty && state.phase === 'aim') {
    const predGap = state.balls.length > 8 ? 75 : PRED_INTERVAL;
    if (now - lastPred >= predGap) {
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
  const curDiff = isBvbMode() ? botDiffOf(state.bot.turn) : state.bot.difficulty;
  const botAid = state.mode === 'bot' ? botAidFor(curDiff) : null;
  let sceneTargetId = info && info.manual ? info.objId : state.targetId;
  let sceneShowTarget = !shooting && state.mode !== 'thickness';
  if (state.mode === 'bot') {
    if (state.bot.game === '8ball') {
      const legal = eightBallTargetIds(state.balls, state.bot.groups[state.bot.turn]);
      if (legal.length === 1 && legal[0] === 8) {
        sceneTargetId = 8;
      } else {
        sceneTargetId = info && info.manual && legal.includes(info.objId) ? info.objId : null;
        sceneShowTarget = sceneShowTarget && sceneTargetId !== null;
      }
    } else {
      sceneTargetId = lowestObjectId();
    }
  }
  return {
    balls: shooting ? state.sim.balls : state.balls,
    drops: shooting ? dropAnims : null,
    targetId: sceneTargetId,
    showTarget: sceneShowTarget,
    simpleAim: botAid ? botAid.simpleAim : false,
    objLineLen: botAid && botAid.objLineLen ? botAid.objLineLen : 500,
    stick: stickOn
      ? { pos: info.cue, dir: info.aimDir, power: state.power, tip: state.tip, elevationDeg: elevation(info.aimDir), cue: eq ? eq.cue : null }
      : null,
    showPocketRing: !shooting && state.mode === 'thickness',
    overlays: shooting
      ? { aim: false, actual: false, ghost: false, pocket: false, tangent: false, roll: false, predict: false }
      : effOverlays(),
    info: shooting ? null : info,
    pocketExplicit: info ? info.pocketExplicit : false,
    prediction: shooting ? null : prediction,
    trail: view === '2d' && shooting ? Object.fromEntries(state.sim.balls.map((b) => [b.id, b.path])) : null,
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
  const can = !!info && isPlayerReady() && state.mode !== 'thickness';
  panel.setButtons({ shoot: can, reset: isPlayerReady() && state.mode !== 'bot' && !!state.preShot });
}

/* ------------------------------------------------------------------ shooting */

function startShot(allowBot = false) {
  if (!isAimReady() || !info) return;
  if (!allowBot && isBotTurn()) return;
  if (state.mode === 'thickness' && !state.answered) return;
  if (view === '3d' && v3 && (state.mode !== 'thickness' || state.revealed)) {
    // 3D: quick forward stroke of the cue, then the balls start moving
    strokePending = true;
    updateButtons();
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
  if (state.mode === 'thickness' && !state.answered) return;
  lastScratch = false;
  info = computeInfo(true); // fresh aim-solver result, never a throttled stale one
  state.preShot = snapshot();
  state.preShot.lowest = lowestObjectId();
  state.preShot.aimOffset = state.aimOffset;
  state.sim = createSim(state.balls, { recordPaths: true, table: eq.table, cue: eq.cue });
  const launch = state.sim.strike({ aimDir: info.aimDir, power: state.power, tip: state.tip, elevationDeg: elevation(info.aimDir) });
  sound.cueHit(state.power, !!(launch && launch.miscue));
  state.phase = 'shooting';
  lastT = 0;
  timeScale = 1;
  dropAnims = [];
  seenDropCount = 0;
  seenContactCount = 0;
  seenCushionCount = 0;
  seenContactCount = 0;
  seenCushionCount = 0;
  prediction = null;
  if (launch && launch.miscue) panel.toast('Trượt cơ (miscue)!', 'bad');
  updateButtons();
  schedule();
}

function finishShot() {
  const sim = state.sim;
  const ev = sim.events;
  const preBalls = state.preShot ? state.preShot.balls : state.balls;
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
    state.pottedIds = state.pottedIds.filter((id) => id !== 0);
  }
  state.sim = null;
  state.phase = 'aim';
  timeScale = 1;
  dropAnims = [];
  seenDropCount = 0;
  seenContactCount = 0;
  seenCushionCount = 0;
  if (!ball(state.targetId) || objPotted.includes(state.targetId)) {
    state.targetId = lowestObjectId();
    state.pocket = null;
  }

  const mode = state.mode;
  state.power = 0.3;
  if (mode !== 'squirt') {
    state.tip = { x: 0, y: 0 };
    panel.spinPad.set(state.tip, true);
  }
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
  } else if (mode === 'bot') {
    const isBvb = state.bot.matchType === 'bvb';
    const turnWas = state.bot.turn;
    const opp = isBvb
      ? (turnWas === 'bot1' ? 'bot2' : 'bot1')
      : (turnWas === 'player' ? 'bot' : 'player');
    const isEight = state.bot.game === '8ball';
    const wasOnBreak = state.bot.onBreak;
    const res = isEight
      ? evaluateEightBallTurn({
          ballsBefore: preBalls,
          simBalls: finalBalls,
          events: ev,
          turn: turnWas,
          groups: state.bot.groups,
          onBreak: wasOnBreak,
          geo,
        })
      : evaluateNineBallTurn({
          ballsBefore: preBalls,
          simBalls: finalBalls,
          events: ev,
          geo,
        });
    if (isEight) {
      if (res.respotEight && res.respotPos && !ball(8)) {
        state.balls.push(createBall(8, res.respotPos.x, res.respotPos.y));
        state.pottedIds = state.pottedIds.filter((id) => id !== 8);
      }
      state.bot.groups = res.nextGroups;
    } else if (res.respotNine && res.respotPos && !ball(9)) {
      state.balls.push(createBall(9, res.respotPos.x, res.respotPos.y));
      state.pottedIds = state.pottedIds.filter((id) => id !== 9);
    }
    state.bot.onBreak = false;
    state.pocket = null;

    const currentGroup = (who) => (isEight ? state.bot.groups[who] : null);
    const firstLegalFor = (who) => {
      if (!isEight) return lowestObjectId();
      const ids = eightBallTargetIds(state.balls, currentGroup(who));
      return ids.length ? ids[0] : null;
    };
    const groupTextFor = (who) => {
      if (!isEight) return `bi #${state.targetId}`;
      const ids = eightBallTargetIds(state.balls, currentGroup(who));
      if (ids.length === 1 && ids[0] === 8) return 'bi #8';
      const g = currentGroup(who);
      if (g === 'solids') return 'nhóm trơn (1–7)';
      if (g === 'stripes') return 'nhóm sọc (9–15)';
      return 'bàn mở (1–7 hoặc 9–15)';
    };
    const aimAtTargetFor = (who) => {
      const tid = firstLegalFor(who);
      state.targetId = tid;
      const cue = ball(0);
      const tgt = tid ? ball(tid) : null;
      if (cue && tgt) {
        state.aimAngle = normAngle(Math.round(deg(Math.atan2(tgt.pos.y - cue.pos.y, tgt.pos.x - cue.pos.x)) * 100) / 100);
      }
    };

    state.targetId = firstLegalFor(state.bot.turn);

    const delayScale = state.bot.speed === 2 ? 0.35 : 1;
    const nameWas = botNameOf(turnWas);
    const nameOpp = botNameOf(opp);

    if (res.winRack || res.loseRack) {
      const rackWinner = res.winRack ? turnWas : opp;
      const winnerName = botNameOf(rackWinner);
      if (rackWinner === 'player' || rackWinner === 'bot1') state.bot.scorePlayer += 1;
      else state.bot.scoreBot += 1;
      state.bot.turn = rackWinner;
      state.bot.breaker = rackWinner;
      state.bot.rack += 1;
      state.bot.ballInHand = false;
      state.bot.isFoul = false;
      const rackNo = state.bot.rack - 1;
      if (isBvb) {
        state.bot.statusText = res.loseRack
          ? `🏆 ${winnerName} thắng ván ${rackNo} (${nameWas} phạm lỗi bi 8)! Chuẩn bị ván mới...`
          : `🎉 ${winnerName} thắng ván ${rackNo}! Chuẩn bị ván mới...`;
        toast(state.bot.statusText, 'ok');
      } else {
        if (res.loseRack) {
          state.bot.statusText = turnWas === 'player'
            ? `🤖 Bạn thua ván ${rackNo} (${res.foulReason})! Chuẩn bị ván mới...`
            : `🎉 Bot phạm lỗi bi 8 (${res.foulReason}) — Bạn thắng ván ${rackNo}!`;
        } else {
          state.bot.statusText = rackWinner === 'player'
            ? `🎉 Bạn thắng ván ${rackNo}! Chuẩn bị ván mới...`
            : `🤖 Bot thắng ván ${rackNo}! Chuẩn bị ván mới...`;
        }
        toast(state.bot.statusText, rackWinner === 'player' ? 'ok' : 'bad');
      }
      syncControls();
      panel.setTurnLocked(true);
      addBotTimer(() => startBotRack(rackWinner), Math.round(1500 * delayScale));
    } else if (res.foul) {
      const next = opp;
      state.bot.turn = next;
      state.bot.ballInHand = true;
      state.bot.isFoul = true;
      state.aimMode = 'manual';
      state.aimOffset = 0;
      state.tip = { x: 0, y: 0 };
      panel.spinPad.set(state.tip, true);
      if (isBvb) {
        state.targetId = firstLegalFor(next);
        state.bot.statusText = `⚠️ ${nameWas} phạm lỗi (${res.foulReason})! Đến lượt ${nameOpp} (đặt bi).`;
        toast(`${nameWas} phạm lỗi: ${res.foulReason}`, 'bad');
      } else if (next === 'player') {
        aimAtTargetFor('player');
        state.bot.statusText = `Bot phạm lỗi (${res.foulReason}). Kéo bi cái đặt tùy ý!`;
        toast(state.bot.statusText, 'ok');
      } else {
        state.targetId = firstLegalFor('bot');
        state.bot.statusText = `Bạn phạm lỗi: ${res.foulReason}. Đến lượt Bot (đặt bi).`;
        toast(`Lỗi: ${res.foulReason}`, 'bad');
      }
      syncControls();
      if (isBvb || next === 'bot') scheduleBotTurn();
    } else if (res.keepTurn) {
      state.bot.ballInHand = false;
      state.bot.isFoul = false;
      state.aimMode = 'manual';
      state.aimOffset = 0;
      if (!isBvb && turnWas === 'player') aimAtTargetFor('player');
      else state.targetId = firstLegalFor(turnWas);
      const assignNote = isEight && res.assignedGroup
        ? ` (${nameWas} nhận ${res.assignedGroup === 'solids' ? 'bi trơn 1–7' : 'bi sọc 9–15'})`
        : '';
      state.bot.statusText = isBvb
        ? `🎯 ${nameWas} ăn bi${assignNote} và tiếp tục đánh ${groupTextFor(turnWas)}...`
        : turnWas === 'player'
          ? `Vào bi!${assignNote} Đánh tiếp ${groupTextFor('player')}.`
          : `Bot ăn bi${assignNote} và tiếp tục đánh ${groupTextFor('bot')}...`;
      toast(
        isBvb
          ? `🎯 ${nameWas} đánh vào lỗ!${assignNote}`
          : turnWas === 'player'
            ? `Vào lỗ!${assignNote} Tiếp tục lượt bạn.`
            : `Bot đánh vào lỗ!${assignNote}`,
        isBvb ? 'ok' : turnWas === 'player' ? 'ok' : '',
      );
      syncControls();
      if (isBvb || turnWas === 'bot') scheduleBotTurn();
    } else {
      const next = opp;
      state.bot.turn = next;
      state.bot.ballInHand = false;
      state.bot.isFoul = false;
      state.aimMode = 'manual';
      state.aimOffset = 0;
      if (!isBvb && next === 'player') aimAtTargetFor('player');
      else state.targetId = firstLegalFor(next);
      state.bot.statusText = isBvb
        ? `Lượt của ${nameOpp} — mục tiêu ${groupTextFor(next)}.`
        : next === 'player'
          ? `Lượt bạn — mục tiêu ${groupTextFor('player')}.`
          : `Đến lượt Bot (${groupTextFor('bot')})...`;
      toast(isBvb ? `Đến lượt ${nameOpp}...` : next === 'player' ? 'Đến lượt bạn!' : 'Đến lượt Bot...', '');
      syncControls();
      if (isBvb || next === 'bot') scheduleBotTurn();
    }
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
  if (mode !== 'bot') syncControls();
  syncPottedUi();
  panel.refreshTray((id) => !!ball(id));
  invalidate();
}

/* ------------------------------------------------------------------ table setup */

function rackEight() {
  const d = 2 * R + 0.3;
  const dx = (d * Math.sqrt(3)) / 2;
  const rows = [1, 2, 3, 4, 5];
  const spots = [];
  rows.forEach((n, k) => {
    for (let j = 0; j < n; j++) spots.push({ x: geo.FOOT_SPOT.x + k * dx, y: geo.FOOT_SPOT.y + (j - (n - 1) / 2) * d });
  });
  // spots: 0 apex (head of triangle), 4 center of row 3 (8-ball), 10 & 14 back corners (one solid, one stripe)
  const solids = [1, 2, 3, 4, 5, 6, 7].sort(() => Math.random() - 0.5);
  const stripes = [9, 10, 11, 12, 13, 14, 15].sort(() => Math.random() - 0.5);
  const apexSolid = Math.random() < 0.5;
  const cornerLeftSolid = Math.random() < 0.5;
  const apexId = apexSolid ? solids.pop() : stripes.pop();
  const c10Id = cornerLeftSolid ? solids.pop() : stripes.pop();
  const c14Id = cornerLeftSolid ? stripes.pop() : solids.pop();
  const restIds = [...solids, ...stripes].sort(() => Math.random() - 0.5);
  const list = [
    { id: apexId, ...spots[0] },
    { id: 8, ...spots[4] },
    { id: c10Id, ...spots[10] },
    { id: c14Id, ...spots[14] },
  ];
  let rIdx = 0;
  for (let i = 0; i < spots.length; i++) {
    if (i === 0 || i === 4 || i === 10 || i === 14) continue;
    list.push({ id: restIds[rIdx++], ...spots[i] });
  }
  list.push({ id: 0, x: geo.HEAD_SPOT.x - 100, y: geo.HEAD_SPOT.y });
  setBalls(list);
  state.targetId = apexId;
  state.pocket = null;
  state.preShot = null;
  state.pottedIds = [];
  syncPottedUi();
}

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
  state.pottedIds = [];
  syncPottedUi();
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
  state.pottedIds = [];
  syncPottedUi();
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
  state.pottedIds = [];
  syncPottedUi();
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
  state.pottedIds = [];
  syncPottedUi();
}

function syncBotUi() {
  const isEight = state.bot.game === '8ball';
  const isBvb = state.bot.matchType === 'bvb';
  const who = state.bot.turn;
  const currentGrp = isEight ? state.bot.groups[who] : null;
  const targetOrIds = isEight ? eightBallTargetIds(state.balls, currentGrp) : lowestBallId(state.balls);
  let targetLabel;
  if (isEight) {
    if (!targetOrIds.length) targetLabel = 'Hết bi';
    else if (targetOrIds.length === 1 && targetOrIds[0] === 8) targetLabel = 'Bi #8';
    else if (currentGrp === 'solids') targetLabel = 'Trơn 1–7';
    else if (currentGrp === 'stripes') targetLabel = 'Sọc 9–15';
    else targetLabel = 'Bàn mở';
  } else {
    targetLabel = targetOrIds ? `Bi #${targetOrIds}` : 'Bi #9';
  }
  panel.setBotHud({
    matchType: state.bot.matchType,
    bot1Name: state.bot.bot1Name,
    bot2Name: state.bot.bot2Name,
    bot1Diff: state.bot.bot1Diff,
    bot2Diff: state.bot.bot2Diff,
    paused: state.bot.paused,
    speed: state.bot.speed,
    scorePlayer: state.bot.scorePlayer,
    scoreBot: state.bot.scoreBot,
    turn: state.bot.turn,
    game: state.bot.game,
    difficulty: state.bot.difficulty,
    targetId: lowestBallId(state.balls),
    targetLabel,
    statusText: state.bot.statusText,
    isFoul: state.bot.isFoul,
    thinking: state.bot.thinking,
  });
  if (state.mode === 'bot') {
    panel.setTurnLocked(isBotTurn() || state.lobbyOpen);
  } else {
    panel.setTurnLocked(false);
  }
  updateButtons();
}

function startBotRack(breaker = state.bot.breaker) {
  clearBotTimers();
  if (state.bot.game === '8ball') rackEight();
  else rackNine();
  state.zone = null;
  state.drill = null;
  state.aimOffset = 0;
  state.aimMode = 'manual';
  aimAtLowestBall();
  state.power = (breaker === 'bot' || breaker === 'bot1' || breaker === 'bot2') ? 0.88 : 0.78;
  state.tip = { x: 0, y: 0 };
  panel.spinPad.set(state.tip, true);
  state.bot.breaker = breaker;
  state.bot.turn = breaker;
  state.bot.groups = { player: null, bot: null, bot1: null, bot2: null };
  state.bot.onBreak = true;
  state.bot.ballInHand = true;
  state.bot.isFoul = false;
  const gLabel = BOT_GAMES[state.bot.game]?.label || '9 Bi';
  if (state.bot.matchType === 'bvb') {
    state.bot.statusText = `Ván ${state.bot.rack} (${gLabel}): 🤖 ${botNameOf(breaker)} chuẩn bị phá bi...`;
  } else {
    state.bot.statusText = breaker === 'player'
      ? `Ván mới (${gLabel}): kéo bi cái sau vạch đầu bàn và phá bi!`
      : `Ván mới (${gLabel}): 🤖 Bot chuẩn bị phá bi...`;
  }
  syncControls();
  invalidate();
  if (breaker === 'bot' || state.bot.matchType === 'bvb') scheduleBotTurn();
}

function scheduleBotTurn() {
  clearBotTimers();
  if (state.mode !== 'bot' || state.phase !== 'aim') return;
  if (!isBotTurn()) return;
  if (state.bot.paused) return;

  state.bot.thinking = true;
  syncBotUi();
  invalidate({ pred: false });

  const delayScale = state.bot.speed === 2 ? 0.35 : 1;
  const currentShooter = state.bot.turn;
  const shooterName = botNameOf(currentShooter);
  const shooterDiff = botDiffOf(currentShooter);

  addBotTimer(() => {
    if (state.mode !== 'bot' || state.phase !== 'aim' || state.bot.turn !== currentShooter) return;
    const isEight = state.bot.game === '8ball';
    const botGroup = isEight ? state.bot.groups[currentShooter] : null;
    const targetOrIds = isEight
      ? eightBallTargetIds(state.balls, botGroup)
      : lowestBallId(state.balls);

    if (state.bot.ballInHand || state.bot.onBreak) {
      const cue = ball(0);
      const pos = placeCueBallForBot(state.balls, targetOrIds, geo, eq, state.bot.onBreak);
      if (cue && pos) {
        cue.pos = { x: pos.x, y: pos.y };
        state.bot.ballInHand = false;
        invalidate({ pred: false });
      }
    }

    addBotTimer(() => {
      if (state.mode !== 'bot' || state.phase !== 'aim' || state.bot.turn !== currentShooter) return;
      const shot = chooseBotShot(state.balls, geo, eq, shooterDiff, {
        onBreak: state.bot.onBreak,
        game: state.bot.game,
        group: botGroup,
      });
      state.aimMode = 'manual';
      state.aimAngle = normAngle(deg(Math.atan2(shot.aimDir.y, shot.aimDir.x)));
      state.power = shot.power;
      state.tip = { ...shot.tip };
      state.targetId = shot.targetId;
      state.pocket = shot.pocketIdx >= 0 ? shot.pocketIdx : null;
      state.bot.statusText = state.bot.onBreak
        ? `🤖 ${shooterName} đang ngắm phá bi...`
        : shot.kind === 'safe'
          ? `🤖 ${shooterName} tìm góc chạm bi #${shot.targetId}...`
          : `🤖 ${shooterName} đang ngắm bi #${shot.targetId}...`;
      panel.spinPad.set(state.tip, true);
      syncControls();
      invalidate({ pred: false });

      addBotTimer(() => {
        if (state.mode !== 'bot' || state.phase !== 'aim' || state.bot.turn !== currentShooter) return;
        state.bot.thinking = false;
        syncBotUi();
        startShot(true);
      }, Math.round(650 * delayScale));
    }, Math.round(550 * delayScale));
  }, Math.round(500 * delayScale));
}

function enterBotMode(difficulty, game) {
  if (!isAimReady()) return;
  clearBotTimers();
  state.bot.matchType = 'pve';
  if (difficulty && BOT_DIFFICULTIES[difficulty]) state.bot.difficulty = difficulty;
  if (game && BOT_GAMES[game]) state.bot.game = game;
  if (state.mode === 'free') state.freeBackup = snapshot();
  state.appMode = 'bot';
  state.mode = 'bot';
  state.lobbyOpen = false;
  panel.setLobbyOpen(false);
  panel.setAppMode('bot');
  panel.setActiveTab('bot');
  state.bot.scorePlayer = 0;
  state.bot.scoreBot = 0;
  state.bot.rack = 1;
  state.bot.breaker = 'player';
  startBotRack('player');
}

function enterBvbMode(opts = {}) {
  if (!isAimReady()) return;
  clearBotTimers();
  state.bot.matchType = 'bvb';
  if (opts.name1) state.bot.bot1Name = opts.name1.trim() || 'Alpha';
  if (opts.name2) state.bot.bot2Name = opts.name2.trim() || 'Beta';
  if (opts.diff1 && BOT_DIFFICULTIES[opts.diff1]) state.bot.bot1Diff = opts.diff1;
  if (opts.diff2 && BOT_DIFFICULTIES[opts.diff2]) state.bot.bot2Diff = opts.diff2;
  if (opts.game && BOT_GAMES[opts.game]) state.bot.game = opts.game;
  state.bot.paused = false;
  if (state.mode === 'free') state.freeBackup = snapshot();
  state.appMode = 'bvb';
  state.mode = 'bot';
  state.lobbyOpen = false;
  panel.setLobbyOpen(false);
  panel.setAppMode('bvb');
  panel.setActiveTab('bot');
  state.bot.scorePlayer = 0;
  state.bot.scoreBot = 0;
  state.bot.rack = 1;
  state.bot.breaker = 'bot1';
  startBotRack('bot1');
}

function enterPracticeMode(subMode = state.practiceMode, opts = {}) {
  if (!isAimReady()) return;
  clearBotTimers();
  state.appMode = 'practice';
  state.lobbyOpen = false;
  panel.setLobbyOpen(false);
  panel.setAppMode('practice');
  panel.setTurnLocked(false);
  const nextSub = subMode === 'bot' ? 'free' : subMode || 'free';
  state.practiceMode = nextSub;
  if (state.mode === nextSub && opts.keepBoard) {
    panel.setActiveTab(nextSub);
    syncControls();
    return;
  }
  setMode(nextSub, { forceReset: state.mode === 'bot' });
}

/* ------------------------------------------------------------------ modes + drills */

function setMode(mode, opts = {}) {
  if (!isAimReady()) return;
  if (mode === 'bot') {
    enterBotMode();
    return;
  }
  if (mode === state.mode && !opts.forceReset) return;
  clearBotTimers();
  if (state.mode === 'free') state.freeBackup = snapshot();
  state.appMode = 'practice';
  state.practiceMode = mode;
  panel.setAppMode('practice');
  panel.setTurnLocked(false);
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
  state.tip = { x: 0, y: 0 };
  panel.spinPad.set(state.tip, true);
  panel.resetThickness();
  syncControls();
}

function answerThickness(label) {
  if (state.mode !== 'thickness' || state.answered || !isAimReady()) return;
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
    if (state.mode !== 'thickness' || !isAimReady()) return;
    state.power = 0.28;
    state.tip = { x: 0, y: 0 };
    panel.spinPad.set(state.tip, true);
    syncControls();
    info = computeInfo();
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
    tipLocked: state.mode === 'squirt' || state.mode === 'thickness' || isBotTurn(),
  });
  updateAimUi();
  syncPottedUi();
  if (state.mode === 'bot') syncBotUi();
  else {
    panel.setTurnLocked(false);
    updateButtons();
  }
}

function updateAimUi() {
  const manual = state.aimMode === 'manual';
  panel.setAimMode(state.aimMode, manual ? fmtDeg(state.aimAngle) : `Δ ${fmtDeg(state.aimOffset)}`);
}

/** Switch to free aim, starting from the current auto aim direction so nothing jumps. */
function ensureManual() {
  if (state.aimMode === 'manual') return true;
  if (!isPlayerReady() || !manualAllowed()) return false;
  if (info && info.aimDir) state.aimAngle = normAngle(Math.round(deg(Math.atan2(info.aimDir.y, info.aimDir.x)) * 100) / 100);
  state.aimMode = 'manual';
  updateAimUi();
  return true;
}

function rotateAim(d) {
  if (v3) v3.userInput();
  if (!isPlayerReady() || !ensureManual()) return;
  state.aimAngle = normAngle(Math.round((state.aimAngle + d) * 100) / 100);
  aimUiDirty = true;
  invalidate();
}

function nudgeAim(d) {
  if (v3) v3.userInput();
  if (!isPlayerReady() || state.mode === 'thickness') return;
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
  if (!isPlayerReady() || state.mode === 'bot' || !state.preShot) return;
  restore(state.preShot);
  state.preShot = null;
  state.power = 0.3;
  if (state.mode !== 'squirt') {
    state.tip = { x: 0, y: 0 };
    panel.spinPad.set(state.tip, true);
  }
  syncControls();
  if (state.mode === 'thickness') panel.setNextThick(state.answered);
  panel.refreshTray((id) => !!ball(id));
  invalidate();
}

function randomLayout() {
  if (state.mode !== 'free' || !isAimReady()) return;
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
    if (!isPlayerReady() || !manualAllowed() || state.mode === 'bot') return;
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
    if (!isPlayerReady() || state.mode === 'squirt' || state.mode === 'thickness') return;
    state.tip = tip;
    invalidate();
  },
  onShoot: () => startShot(false),
  onReset: resetShot,
  onRandom: randomLayout,
  onRack: () => {
    if (state.mode !== 'free' || !isAimReady()) return;
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
  onAppMode: (app) => {
    if (app === 'bvb') enterBvbMode();
    else if (app === 'bot') enterBotMode();
    else enterPracticeMode(state.practiceMode);
  },
  onStartBot: (diff, game) => enterBotMode(diff, game),
  onStartBvb: (opts) => enterBvbMode(opts),
  onStartPractice: () => enterPracticeMode('free'),
  onBvbPause: () => {
    state.bot.paused = !state.bot.paused;
    if (state.bot.paused) {
      clearBotTimers();
      state.bot.statusText = 'Trận đấu đang tạm dừng (⏸). Nhấn Tiếp tục để chạy.';
    } else {
      state.bot.statusText = 'Tiếp tục trận đấu (▶)...';
      scheduleBotTurn();
    }
    syncBotUi();
  },
  onBvbSpeed: () => {
    state.bot.speed = state.bot.speed === 1 ? 2 : 1;
    panel.toast(state.bot.speed === 2 ? 'Tốc độ: 2x (Nhanh)' : 'Tốc độ: 1x (Bình thường)', 'ok');
    syncBotUi();
  },
  onBvbRename: ({ name1, name2 }) => {
    state.bot.bot1Name = name1 || 'Alpha';
    state.bot.bot2Name = name2 || 'Beta';
    syncBotUi();
    panel.toast(`Đã cập nhật tên: ${state.bot.bot1Name} vs ${state.bot.bot2Name}`, 'ok');
  },
  onBotDifficulty: (diff) => {
    if (!BOT_DIFFICULTIES[diff]) return;
    state.bot.difficulty = diff;
    syncBotUi();
    invalidate({ pred: false });
    const d = BOT_DIFFICULTIES[diff];
    panel.toast(`Bot ${d.label}: ${d.desc}`, 'ok');
  },
  onBotGame: (game) => {
    if (!BOT_GAMES[game] || !isAimReady()) {
      syncBotUi();
      return;
    }
    if (game === state.bot.game) return;
    if (state.bot.matchType === 'bvb') {
      enterBvbMode({
        name1: state.bot.bot1Name,
        name2: state.bot.bot2Name,
        diff1: state.bot.bot1Diff,
        diff2: state.bot.bot2Diff,
        game,
      });
    } else {
      enterBotMode(state.bot.difficulty, game);
    }
    panel.toast(`Đã chuyển sang luật ${BOT_GAMES[game].label}`, 'ok');
  },
  onNewMatch: () => {
    if (!isAimReady()) return;
    if (state.bot.matchType === 'bvb') {
      enterBvbMode({
        name1: state.bot.bot1Name,
        name2: state.bot.bot2Name,
        diff1: state.bot.bot1Diff,
        diff2: state.bot.bot2Diff,
        game: state.bot.game,
      });
      const gLabel = BOT_GAMES[state.bot.game]?.label || '9 Bi';
      panel.toast(`Bắt đầu trận ${gLabel} mới: ${state.bot.bot1Name} vs ${state.bot.bot2Name}`, 'ok');
    } else {
      enterBotMode(state.bot.difficulty, state.bot.game);
      const gLabel = BOT_GAMES[state.bot.game]?.label || '9 Bi';
      panel.toast(`Bắt đầu trận ${gLabel} mới với Bot`, 'ok');
    }
  },
  onThickPick: answerThickness,
  onNextThick: () => {
    if (!isAimReady()) return;
    newThicknessRound();
    invalidate();
  },
  onNextPos: () => {
    if (!isAimReady()) return;
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
    if (!isAimReady()) return;
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
      panel.resize();
      invalidate({ pred: false });
    });
  },
});

const settings = createSettings({
  canChange: isPlayerReady,
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
  canRotate: () => isPlayerReady() && manualAllowed(),
  onRotate: rotateAim,
  canDrag: (b) => isPlayerReady() && (state.mode === 'free' || (state.mode === 'bot' && b && b.id === 0 && (state.bot.ballInHand || state.bot.onBreak))),
  onMove: (b) => {
    if (state.mode === 'bot' && state.bot.onBreak && b && b.id === 0 && b.pos.x > geo.HEAD_X) {
      placeBall(b, { x: geo.HEAD_X, y: b.pos.y }, state.balls, geo);
    }
    invalidate();
  },
  onDragEnd: () => invalidate(),
  onTapBall: (b) => {
    if (state.mode !== 'free' || !isPlayerReady() || b.id === 0) return;
    if (state.targetId !== b.id) {
      state.targetId = b.id;
      state.pocket = null;
      invalidate();
    }
  },
  onTapPocket: (i) => {
    if (!isPlayerReady() || state.mode !== 'free') return;
    state.pocket = state.pocket === i ? null : i;
    invalidate();
  },
});

function toggleBall(id) {
  if (state.mode !== 'free' || !isAimReady()) return;
  const existing = ball(id);
  if (existing) {
    state.balls = state.balls.filter((b) => b.id !== id);
  } else {
    const spot = findFreeSpot({ x: geo.W * (0.45 + Math.random() * 0.4), y: geo.H * (0.25 + Math.random() * 0.5) }, 6);
    state.balls.push(createBall(id, spot.x, spot.y));
    state.pottedIds = state.pottedIds.filter((x) => x !== id);
  }
  syncPottedUi();
  ensureTarget();
  panel.refreshTray((i) => !!ball(i));
  invalidate();
}


/* ------------------------------------------------------------------ keyboard (PC) */

const canSelectTarget = () => state.mode === 'free' && isPlayerReady();
const canAimKeys = () => isPlayerReady() && state.mode !== 'thickness';
const canTipKeys = () => isPlayerReady() && (state.mode === 'free' || state.mode === 'position' || state.mode === 'bot');

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
    phase: () => (strokePending ? 'shooting' : state.phase),
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
    canTip: canTipKeys,
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
      if (!isPlayerReady() || !manualAllowed() || state.mode === 'bot') return null;
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
    shoot: () => startShot(false),
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

// Enter shoots on desktop (kept from earlier phases, respecting open modals and typing targets)
window.addEventListener('keydown', (e) => {
  if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
  const lobby = document.getElementById('lobby');
  if (lobby && !lobby.hidden) return;
  const sheet = document.getElementById('sheet');
  if (sheet && !sheet.hidden) return;
  if (keys && keys.isHelpOpen()) return;
  if (isTypingTarget(e.target)) return;
  if (e.target && /^(BUTTON|A|SUMMARY)$/.test(e.target.tagName)) return;
  if (e.key === 'Enter') startShot(false);
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
  clearBotTimers();
  state.lobbyOpen = false;
  panel.setLobbyOpen(false);
  state.appMode = 'practice';
  state.practiceMode = 'free';
  panel.setAppMode('practice');
  if (state.mode !== 'free') {
    state.mode = 'free';
    panel.setActiveTab('free');
    state.zone = null;
    state.drill = null;
    state.revealed = false;
  }
  loadingHash = true;
  try {
    settings.applyIds({ tb: d.tableId, cu: d.cueId });
  } finally {
    loadingHash = false;
  }
  applyShare(d);
  if (d.aimDeg !== null && d.aimDeg !== undefined) {
    state.aimMode = 'manual';
    state.aimAngle = d.aimDeg;
  } else {
    state.aimMode = 'auto';
  }
  syncControls();
  panel.refreshTray((id) => !!ball(id));
  invalidate();
  return true;
}
window.addEventListener('hashchange', () => {
  if (isAimReady()) loadFromHash();
});

// PWA (sw.js stays at the site root so its scope covers the whole app)
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  const hadSwController = !!navigator.serviceWorker.controller;
  let swReloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadSwController || swReloading) return;
    swReloading = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  });
}

/* ------------------------------------------------------------------ sound + 3D view */

const soundBtn = document.getElementById('btnSound');
const sound = createSoundEngine({
  initialEnabled: lsRead('bida9-sound') !== '0',
  onChange: (on) => {
    lsWrite('bida9-sound', on ? '1' : '0');
    syncSoundUi();
  },
});

function syncSoundUi() {
  if (!soundBtn) return;
  const on = sound.isEnabled();
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.textContent = on ? '🔊' : '🔇';
  soundBtn.title = on ? 'Tắt âm thanh (phím M)' : 'Bật âm thanh (phím M)';
}

if (soundBtn) {
  soundBtn.addEventListener('click', () => {
    const on = sound.toggle();
    panel.toast(on ? 'Đã bật âm thanh' : 'Đã tắt âm thanh');
  });
}
window.addEventListener('pointerdown', () => sound.unlock(), { passive: true });
window.addEventListener('keydown', (e) => {
  sound.unlock();
  if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(document.activeElement)) return;
  if (e.key === 'm' || e.key === 'M') {
    e.preventDefault();
    const on = sound.toggle();
    panel.toast(on ? 'Đã bật âm thanh' : 'Đã tắt âm thanh');
  }
});
syncSoundUi();

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
  if (!b || state.mode !== 'free' || !isPlayerReady() || b.id === 0) return;
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
            canRotate: () => isPlayerReady() && manualAllowed(),
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
        mini = createRenderer(miniCanvas, { maxDpr: 1.5 });
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
eqKey = physicsEquipmentKey(eq);
geo = buildTable(eq.table);
renderer.setTable(geo, eq.table);
panel.spinPad.setMiscueLimit(eq.cue.miscueLimit);
defaultLayout();
if (!loadFromHash()) {
  panel.setAppMode('practice');
  panel.refreshTray((id) => !!ball(id));
  state.lobbyOpen = true;
  panel.setLobbyOpen(true);
  syncPottedUi();
}
syncControls();
panel.updateStats(stats);
renderer.resize();
invalidate();
if (lsRead('bida9-view') === '3d') setView('3d');
