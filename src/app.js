// App state + wiring. DOM details live in ui/panel.js (controls) and ui/settings.js (equipment sheet).
import { R, buildTable } from './core/table.js';
import { computeShot, bestPocket, isPathBlocked, firstHit, effectiveCueElevationDeg } from './core/geometry.js';
import { createBall, createSim, simulate, computeLaunch, DEFAULT_ELEVATION_DEG } from './core/physics.js';
import { physicsEquipmentKey, tablePreset, cuePreset } from './core/equipment.js';
import { solveAim } from './core/aim-solver.js';
import { createRenderer, BALL_COLORS } from './ui/render.js';
import { createInput, placeBall } from './ui/input.js';
import { createPanel, tipText, fmtDeg } from './ui/panel.js';
import { createArcadeControls } from './ui/arcade-controls.js';
import { createMatchFx } from './ui/match-fx.js';
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
  loadHeroProfile,
  saveHeroProfile,
  recordHeroProgress,
} from './features/bot.js';
import { rotate, rad, deg, dist, clamp } from './core/vec.js';
import { CAMERA_MODES, CAMERA_MODE_LABEL, nextCameraMode } from './ui/view3d-math.js'; // pure; three.js itself is only fetched on first 3D open
import { createDropAnim, stepDropAnim } from './ui/drop-anim.js';
import { createSoundEngine } from './ui/sound.js';
import { createNetClient, loadSession, SESSION_KEY } from './net/client.js';
import { serverUrl } from './net/config.js';
import { ROOM_CODE_RE, sanitizeName } from './net/protocol.js';
import { isDevBuild } from './core/build.js';
import { createAnalytics, readMeasurementId } from './features/analytics.js';
import { mulberry32, newSeed, packBalls, unpackBalls, packMatch, applyMatch, seatToWho, otherWho, parseRoomHash, roomLink, createShotGate } from './features/pvp.js';

// develop-only UI (class .dev-only) stays hidden unless this is a develop build, see core/build.js
const DEV_BUILD = isDevBuild(location, (() => { try { return localStorage; } catch (e) { return null; } })());
document.body.dataset.build = DEV_BUILD ? 'dev' : 'release';
// usage analytics (GA4): release builds only, and only when a measurement id is set in index.html
const analytics = createAnalytics({ id: readMeasurementId(document), enabled: !DEV_BUILD });
let matchEndTracked = false;
const matchParams = () => ({
  mode: state.bot.matchType === 'pvp' ? 'pvp' : state.bot.matchType === 'bvb' ? 'bvb' : 'bot',
  game: state.bot.game,
  race_to: state.bot.raceTo || 0,
  ...(state.bot.matchType === 'pve' ? { difficulty: state.bot.difficulty } : {}),
});
function trackMatchStart() {
  matchEndTracked = false;
  analytics.track('match_start', matchParams());
}
/** winner: 'player' | 'bot' | 'bot1' | 'bot2'; reported once per match, from this device's point of view. */
function trackMatchEnd(winner, reason = 'race') {
  if (matchEndTracked) return;
  matchEndTracked = true;
  const type = state.bot.matchType;
  const p1Won = winner === 'player' || winner === 'bot1';
  const me = type === 'pvp' && state.pvp ? state.pvp.myWho : 'player';
  analytics.track('match_end', {
    ...matchParams(),
    reason,
    result: type === 'bvb' ? 'watched' : winner === me ? 'win' : 'lose',
    score_winner: p1Won ? state.bot.scorePlayer : state.bot.scoreBot,
    score_loser: p1Won ? state.bot.scoreBot : state.bot.scorePlayer,
    racks: Math.max(0, (state.bot.rack || 1) - 1),
  });
}

const PRED_INTERVAL = 50; // ms between prediction recomputes while dragging
const PRED_MAX_TIME = 5; // seconds of predicted motion
const noMiscueRng = () => 0.5; // prediction never randomises the miscue angle
const SOLVE_INTERVAL = 90; // ms: minimum gap between aim-solver runs while the state keeps changing

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
  aimAid: lsRead('bida9-aim-aid') !== '0', // true = assistance lines, false = realistic view (no aid lines)
  overlays: { aim: true, actual: true, ghost: true, pocket: true, tangent: true, roll: true, predict: true },
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
  pvp: null, // online 1 vs 1 session (see the "1 vs 1 online" section), null outside online matches
  bot: {
    matchType: 'pve', // 'pve' | 'bvb' | 'pvp'
    bot1Name: 'Alpha',
    bot2Name: 'Beta',
    bot1Diff: 'hard',
    bot2Diff: 'pro',
    paused: false,
    speed: 1, // 1 | 2
    game: '9ball',
    difficulty: 'medium',
    raceTo: 5, // Race to win target racks (0 = Endless/Free)
    matchOver: false,
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
const canvas3d = document.getElementById('table3d');
const miniCanvas = document.getElementById('minimap');
const STROKE_MS = 120;
let desiredView = lsRead('bida9-view') === '2d' ? '2d' : '3d';
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
let seenOffTableCount = 0;
let seenContactCount = 0;
let seenCushionCount = 0;
const isAimReady = () => state.phase === 'aim' && !strokePending;
const isBotMode = () => state.mode === 'bot';
const isBvbMode = () => isBotMode() && state.bot.matchType === 'bvb';
const isPvpMode = () => isBotMode() && state.bot.matchType === 'pvp' && !!state.pvp;
/** Online match: it is my turn to aim/shoot (connected, in sync, not waiting for a new rack, match still running). */
const pvpMyTurn = () => {
  const pv = state.pvp;
  return isPvpMode() && state.bot.turn === pv.myWho && pv.connected && pv.synced && !pv.rackPending && !pv.ended && !state.bot.matchOver;
};
// "Bot turn" means "input is not mine": the AI's turn, or in an online match anything that is not my turn
const isBotTurn = () => isBotMode() && (isPvpMode() ? !pvpMyTurn() : isBvbMode() || state.bot.turn === 'bot');
const isPlayerReady = () => isAimReady() && !isBotTurn();
/** Which difficulty's aim aid is drawn: online matches use the medium aid for both players. */
const aidDiffKey = () => (isPvpMode() ? 'medium' : isBvbMode() ? botDiffOf(state.bot.turn) : state.bot.difficulty);

function botNameOf(who) {
  if (isPvpMode()) return state.pvp.names[who] || (who === 'player' ? 'Chủ phòng' : 'Khách');
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

function isHeroWho(who) {
  if (state.mode !== 'bot' || isPvpMode()) return false; // online players are never the Hero profile
  if (state.bot.matchType !== 'bvb') return who === 'bot' && state.bot.difficulty === 'hero'; // never the human player
  const diff = botDiffOf(who);
  if (diff === 'hero') return true;
  const name = (botNameOf(who) || '').toLowerCase();
  return name.includes('hero');
}

let matchFx = null;

function clearBotTimers() {
  for (const id of state.bot.timers) clearTimeout(id);
  state.bot.timers = [];
  state.bot.thinking = false;
  state.bot.feathering = false;
  state.bot.featherPower = null;
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
  const equipEl = document.getElementById('settingsEquipText');
  if (equipEl && next) {
    equipEl.textContent = `${next.table.name} · ${next.cue.name}`;
  }
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
  if (state.aimAid === false) {
    return { aim: false, actual: false, ghost: false, pocket: false, tangent: false, roll: false, predict: false };
  }
  const o = state.overlays;
  // 1. Chế độ bắn tập (Practice / Free mode): Full các option (tia ngắm, góc bi ra, dự đoán hướng bi)
  if (state.appMode === 'practice' && state.mode === 'free') {
    return {
      aim: !!o.aim,
      actual: !!o.actual,
      ghost: !!o.ghost,
      pocket: !!o.pocket,
      tangent: !!o.tangent,
      roll: !!o.roll,
      predict: !!o.predict,
    };
  }

  // 2. Chế độ Bắn với Bot, Hero, 1v1 Online PvP, BvB:
  // Theo yêu cầu của người dùng: Bỏ hoàn toàn tia ngắm ở chế độ bắn với Bot!
  // Chỉ có chế độ Bắn tập (Practice) mới có các tùy chọn tia ngắm hỗ trợ.
  if (state.mode === 'bot') {
    return { aim: false, actual: false, ghost: false, pocket: false, tangent: false, roll: false, predict: false };
  }
  if (state.mode === 'thickness') {
    const v = state.revealed;
    return { aim: v, actual: false, ghost: v, pocket: v, tangent: false, roll: false, predict: false };
  }
  if (state.mode === 'position' || state.mode === 'squirt') {
    return { ...o, actual: false, tangent: false, roll: false, predict: false };
  }
  return { aim: !!o.aim, actual: false, ghost: !!o.ghost, pocket: !!o.pocket, tangent: false, roll: false, predict: false };
}

/** Elevation drills (thickness / position / squirt) keep the default cue; otherwise the player raises the cue; the bot uses its own. */
const elevationLocked = () => state.mode === 'thickness' || state.mode === 'position' || state.mode === 'squirt';
const baseElevation = () => {
  if (elevationLocked()) return DEFAULT_ELEVATION_DEG;
  if (state.mode === 'bot' && state.botElevation != null) return state.botElevation;
  return state.elevation;
};
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
  const aid = state.mode === 'bot' ? botAidFor(aidDiffKey()) : null;
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
    // balls that flew off the table: no drop animation or pocket sound, but they are gone from the table
    const evOff = state.sim.events.offTable;
    while (seenOffTableCount < evOff.length) {
      const id = evOff[seenOffTableCount++];
      if (!state.pottedIds.includes(id)) {
        state.pottedIds.push(id);
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
  if (isPvpMode()) pvpTickAim(now);
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
  const botAid = state.mode === 'bot' ? botAidFor(aidDiffKey()) : null;
  let sceneTargetId = info && info.manual ? info.objId : state.targetId;
  let sceneShowTarget = state.aimAid !== false && !shooting && state.mode !== 'thickness';
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
    isBot: state.mode === 'bot' && (isBotTurn() || isBvbMode()),
    simpleAim: botAid ? botAid.simpleAim : false,
    objLineLen: botAid && botAid.objLineLen ? botAid.objLineLen : 500,
    stick: stickOn
      ? { pos: info.cue, dir: info.aimDir, power: (state.bot && state.bot.featherPower != null) ? state.bot.featherPower : state.power, tip: state.tip, elevationDeg: elevation(info.aimDir), cue: eq ? eq.cue : null }
      : null,
    showPocketRing: state.aimAid !== false && !shooting && state.mode === 'thickness',
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

/** remote: shot payload received from the opponent (online match); balls are already placed from it. */
function doShot(remote = null) {
  if (remote ? state.phase !== 'aim' : !info || state.phase !== 'aim') return;
  if (state.mode === 'thickness' && !state.answered) return;
  matchFx?.stopShotClock();
  lastScratch = false;
  if (!remote) info = computeInfo(true); // fresh aim-solver result, never a throttled stale one
  state.preShot = snapshot();
  state.preShot.lowest = lowestObjectId();
  state.preShot.aimOffset = state.aimOffset;
  let strikeParams;
  let simRng; // undefined = Math.random; online matches use the shot's shared seed so both devices miscue identically
  if (isPvpMode()) {
    ({ strikeParams, simRng } = pvpPrepareShot(remote));
  } else {
    strikeParams = { aimDir: info.aimDir, power: state.power, tip: state.tip, elevationDeg: elevation(info.aimDir) };
  }
  state.sim = createSim(state.balls, { recordPaths: true, table: eq.table, cue: eq.cue, rng: simRng });
  const launch = state.sim.strike(strikeParams);
  sound.cueHit(state.power, !!(launch && launch.miscue));
  if (state.power >= 0.45 && !launch?.miscue) {
    const stageEl = typeof document !== 'undefined' ? document.getElementById('stage') : null;
    if (stageEl) {
      stageEl.classList.remove('stage-shake');
      void stageEl.offsetWidth;
      stageEl.classList.add('stage-shake');
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(Math.round(25 + 35 * state.power));
      }
    } catch (_) {}
  }
  state.phase = 'shooting';
  lastT = 0;
  timeScale = 1;
  dropAnims = [];
  seenDropCount = 0;
  seenOffTableCount = 0;
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
  pvpLastToast = '';
  const toast = (msg, kind) => {
    // keep the miscue notice visible when the shot result would overwrite it
    const text = miscue && kind !== 'ok' ? `${msg} (trượt cơ)` : msg;
    pvpLastToast = text; // online: the shooter sends this text to the opponent with the sync
    panel.toast(text, kind);
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
  seenOffTableCount = 0;
  seenContactCount = 0;
  seenCushionCount = 0;
  if (!ball(state.targetId) || objPotted.includes(state.targetId)) {
    state.targetId = lowestObjectId();
    state.pocket = null;
  }

  if (isPvpMode()) {
    // Online: only the shooter applies the rules; the other device waits for the shooter's sync (see pvpRemoteShotDone)
    if (state.pvp.ended) {
      invalidate();
      return;
    }
    if (state.pvp.shotBy !== 'me') {
      pvpRemoteShotDone();
      invalidate();
      return;
    }
  }

  const mode = state.mode;
  state.power = 0.3;
  state.elevation = DEFAULT_ELEVATION_DEG;
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
    const isPvp = isPvpMode();
    const neutral = isBvb || isPvp; // texts that name both players instead of "Bạn"/"Bot"
    /** Does this device's player aim next for `who`? (vs the bot, or the opponent in an online match) */
    const aimsForMe = (who) => (isPvp ? who === state.pvp.myWho : !isBvb && who === 'player');
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

    const turnWasHero = isHeroWho(turnWas);
    if (turnWasHero) {
      recordHeroProgress('shot');
      if (state.botLastShotKind === 'jump') {
        recordHeroProgress('jump_shot');
        if (!res.foul) toast('🦘 Hero thực hiện thành công cú Nhảy bi qua vật cản!', 'ok');
      } else if (state.botLastShotKind === 'masse') {
        recordHeroProgress('masse_shot');
        if (!res.foul) toast('🌀 Hero thực hiện thành công cú Massé xoáy cong qua vật cản!', 'ok');
      }
      if (res.pottedObj && res.pottedObj.length > 0) {
        recordHeroProgress('pot', { count: res.pottedObj.length });
      } else {
        recordHeroProgress('miss');
      }
      if (res.foul) {
        recordHeroProgress('foul', { scratch: res.cuePotted });
      }
    }
    state.botLastShotKind = null;
    state.botElevation = null;

    if (res.winRack || res.loseRack) {
      const rackWinner = res.winRack ? turnWas : opp;
      const winnerName = botNameOf(rackWinner);
      if (isHeroWho(rackWinner)) {
        if (state.bot.onBreak) recordHeroProgress('golden_break');
        const prog = recordHeroProgress('rack_win');
        if (prog.leveledUp) {
          toast(`🌟 [HERO LÊN CẤP ${prog.newLevel}] Kỹ năng tăng tiến! Sai số ngắm giảm còn ${prog.aimJitter}°!`, 'ok');
        }
      }
      const rackLoser = res.winRack ? opp : turnWas;
      if (isHeroWho(rackLoser)) {
        recordHeroProgress('rack_lost');
      }
      if (rackWinner === 'player' || rackWinner === 'bot1') state.bot.scorePlayer += 1;
      else state.bot.scoreBot += 1;
      state.bot.turn = rackWinner;
      state.bot.breaker = rackWinner;
      state.bot.rack += 1;
      state.bot.ballInHand = false;
      state.bot.isFoul = false;
      const rackNo = state.bot.rack - 1;

      const raceTo = state.bot.raceTo || 0;
      const p1Score = state.bot.scorePlayer;
      const p2Score = state.bot.scoreBot;
      const matchWon = raceTo > 0 && ((rackWinner === 'player' || rackWinner === 'bot1') ? p1Score >= raceTo : p2Score >= raceTo);

      if (matchWon) {
        state.bot.matchOver = true;
        trackMatchEnd(rackWinner, 'race');
        sound.cheer?.();
        const p1Name = isPvp ? botNameOf('player') : isBvb ? state.bot.bot1Name : 'Bạn';
        const p2Name = isPvp ? botNameOf('bot') : isBvb ? state.bot.bot2Name : (state.bot.difficulty === 'hero' ? 'Hero' : 'Bot');
        if (isPvp) state.pvp.rematch = { me: false, peer: false };
        state.bot.statusText = `🏆 TRẬN ĐẤU KẾT THÚC: ${winnerName} chiến thắng chung cuộc (${p1Score} - ${p2Score}, Chạm ${raceTo})!`;
        toast(state.bot.statusText, 'ok');
        matchFx?.showCallout({
          kind: 'victory',
          title: 'VICTORY!',
          subtitle: `${winnerName} thắng chung cuộc (${p1Score} - ${p2Score})!`,
        });
        panel.setMatchWin(true, {
          title: `🏆 ${winnerName} Thắng Chung Cuộc!`,
          desc: `${winnerName} đã xuất sắc chạm mốc ${raceTo} ván thắng trước!`,
          name1: p1Name,
          name2: p2Name,
          score1: p1Score,
          score2: p2Score,
          pvp: isPvp,
        });
        syncControls();
        panel.setTurnLocked(true);
      } else {
        matchFx?.showCallout({
          kind: 'rack_win',
          title: 'THẮNG VÁN!',
          subtitle: `${winnerName} thắng ván ${rackNo}!`,
        });
        if (neutral) {
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
        state.bot.pendingRack = rackWinner; // survives a pause, which clears the timer
        // online: only the room host racks (random layout) and then syncs the guest
        if (!isPvp || state.pvp.seat === 1) addBotTimer(() => startBotRack(rackWinner), Math.round(1500 * delayScale));
      }
    } else if (res.foul) {
      matchFx?.showCallout({
        kind: res.cuePotted ? 'scratch' : 'foul',
        title: res.cuePotted ? 'SCRATCH!' : 'FOUL!',
        subtitle: res.foulReason || 'Phạm quy',
      });
      if (opp === 'player' && !isBvb) {
        setTimeout(() => {
          matchFx?.showCallout({ kind: 'ball_in_hand' });
        }, 1700);
      }
      const next = opp;
      state.bot.turn = next;
      state.bot.ballInHand = true;
      state.bot.isFoul = true;
      state.aimMode = 'manual';
      state.aimOffset = 0;
      state.tip = { x: 0, y: 0 };
      panel.spinPad.set(state.tip, true);
      if (neutral) {
        state.targetId = firstLegalFor(next);
        state.bot.statusText = `⚠️ ${nameWas} phạm lỗi (${res.foulReason})! Đến lượt ${nameOpp} (đặt bi).`;
        toast(`${nameWas} phạm lỗi: ${res.foulReason}`, 'bad');
        if (aimsForMe(next)) aimAtTargetFor(next);
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
      const isCombo = res.pottedObj && res.pottedObj.length > 1;
      matchFx?.showCallout({
        kind: isCombo ? 'combo' : 'pot',
        title: isCombo ? 'COMBO POT!' : 'NICE SHOT!',
        subtitle: `${nameWas} đánh bi vào lỗ`,
      });
      state.bot.ballInHand = false;
      state.bot.isFoul = false;
      state.aimMode = 'manual';
      state.aimOffset = 0;
      if (aimsForMe(turnWas)) aimAtTargetFor(turnWas);
      else state.targetId = firstLegalFor(turnWas);
      const assignNote = isEight && res.assignedGroup
        ? ` (${nameWas} nhận ${res.assignedGroup === 'solids' ? 'bi trơn 1–7' : 'bi sọc 9–15'})`
        : '';
      state.bot.statusText = neutral
        ? `🎯 ${nameWas} ăn bi${assignNote} và tiếp tục đánh ${groupTextFor(turnWas)}...`
        : turnWas === 'player'
          ? `Vào bi!${assignNote} Đánh tiếp ${groupTextFor('player')}.`
          : `Bot ăn bi${assignNote} và tiếp tục đánh ${groupTextFor('bot')}...`;
      toast(
        neutral
          ? `🎯 ${nameWas} đánh vào lỗ!${assignNote}`
          : turnWas === 'player'
            ? `Vào lỗ!${assignNote} Tiếp tục lượt bạn.`
            : `Bot đánh vào lỗ!${assignNote}`,
        neutral ? 'ok' : turnWas === 'player' ? 'ok' : '',
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
      if (aimsForMe(next)) aimAtTargetFor(next);
      else state.targetId = firstLegalFor(next);
      state.bot.statusText = neutral
        ? `Lượt của ${nameOpp} — mục tiêu ${groupTextFor(next)}.`
        : next === 'player'
          ? `Lượt bạn — mục tiêu ${groupTextFor('player')}.`
          : `Đến lượt Bot (${groupTextFor('bot')})...`;
      toast(neutral ? `Đến lượt ${nameOpp}...` : next === 'player' ? 'Đến lượt bạn!' : 'Đến lượt Bot...', '');
      syncControls();
      if (isBvb || next === 'bot') scheduleBotTurn();
    }
    if (!res.winRack && !res.loseRack && !state.bot.matchOver && state.mode === 'bot') {
      matchFx?.startShotClock(30, state.bot.turn);
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
  if (isPvpMode() && state.pvp.shotBy === 'me') {
    state.pvp.shotBy = null;
    pvpSendSync('result', pvpLastToast);
  }
  if (ev.offTable.length && mode !== 'bot') toast('Bi bay khỏi bàn!', 'bad');
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

function formatTipVietnamese(tip) {
  if (!tip) return 'Tâm bi (bi dừng)';
  const x = tip.x || 0;
  const y = tip.y || 0;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax < 0.05 && ay < 0.05) return 'Tâm bi (bi dừng)';

  const parts = [];
  if (ay >= 0.05) {
    const yPct = Math.round(ay * 100);
    parts.push(y > 0 ? `Cule +${yPct}%` : `Trô -${yPct}%`);
  }
  if (ax >= 0.05) {
    const xPct = Math.round(ax * 100);
    parts.push(x > 0 ? `Phê phải +${xPct}%` : `Phê trái -${xPct}%`);
  }
  return parts.join(' · ');
}

function drawSpecTip(tip, miscueLimit = 0.8) {
  const canvas = document.getElementById('specTipCanvas') || document.getElementById('tvTipCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = 36;
  if (canvas.width !== Math.round(size * dpr)) {
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const c = size / 2;
  const r = c - 2;
  const MAXR = 0.82;

  // Ball sphere gradient
  const g = ctx.createRadialGradient(c - r * 0.35, c - r * 0.35, r * 0.1, c, c, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.7, '#f0eee4');
  g.addColorStop(1, '#c2c1b4');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();

  // Subtle crosshairs
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(c - r, c);
  ctx.lineTo(c + r, c);
  ctx.moveTo(c, c - r);
  ctx.lineTo(c, c + r);
  ctx.stroke();

  // Miscue ring (dashed red)
  ctx.strokeStyle = 'rgba(211, 47, 47, 0.75)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 2]);
  ctx.beginPath();
  ctx.arc(c, c, r * MAXR * Math.min(1, miscueLimit), 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Red tip impact dot
  const t = tip || { x: 0, y: 0 };
  const tx = c + (t.x || 0) * r * MAXR;
  const ty = c - (t.y || 0) * r * MAXR;

  // Glow halo
  ctx.fillStyle = 'rgba(255, 59, 48, 0.38)';
  ctx.beginPath();
  ctx.arc(tx, ty, 5.5, 0, Math.PI * 2);
  ctx.fill();

  // Red tip point
  ctx.fillStyle = '#ff3333';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(tx, ty, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function updateTvPower(power) {
  const p = Math.max(0, Math.min(1, power || 0));
  const num = document.getElementById('specPowerNum') || document.getElementById('tvPowerNum');
  if (num) num.textContent = `${Math.round(p * 100)}%`;

  const tiles = document.querySelectorAll('#specPowerTiles .pw-tile, #tvPowerTiles .pw-tile');
  const total = tiles.length;
  if (!total) return;
  const activeCount = Math.round(p * total);
  for (let i = 0; i < total; i++) {
    tiles[i].classList.toggle('is-active', i < activeCount);
  }
}

function syncTvShotSpecs() {
  const curPower = (state.bot && state.bot.featherPower !== null && state.bot.featherPower !== undefined)
    ? state.bot.featherPower
    : state.power;
  updateTvPower(curPower);
  drawSpecTip(state.tip, eq?.cue?.miscueLimit ?? 0.8);
  const tipLabel = document.getElementById('specTipLabel') || document.getElementById('tvTipLabel');
  if (tipLabel) tipLabel.textContent = formatTipVietnamese(state.tip);
}

function updateTvBallsBar(game, balls, targetOrIds, isScratch) {
  const container = document.getElementById('tvBallsList');
  if (!container) return;
  const isEight = game === '8ball';
  const rackCount = isEight ? 15 : 9;
  const aliveSet = new Set(balls.map((b) => b.id));

  let aliveCount = 0;
  for (let id = 1; id <= rackCount; id++) {
    if (aliveSet.has(id)) aliveCount++;
  }

  const countEl = document.getElementById('tvBallsCount');
  if (countEl) countEl.textContent = `${aliveCount}/${rackCount}`;

  const targetSet = new Set(Array.isArray(targetOrIds) ? targetOrIds : (targetOrIds ? [targetOrIds] : []));

  container.replaceChildren();
  for (let id = 1; id <= rackCount; id++) {
    const isAlive = aliveSet.has(id);
    const isTarget = isAlive && targetSet.has(id);
    const col = BALL_COLORS[id] || '#888';

    const b = document.createElement('span');
    b.className = `tv-ball${isAlive ? ' is-alive' : ' is-potted'}${isTarget ? ' is-target' : ''}${id >= 10 ? ' is-two' : ''}`;
    if (isEight && id === 8) b.classList.add('is-eight-sep');

    b.style.background = id >= 9
      ? `linear-gradient(180deg, #f7f6ef 0 24%, ${col} 24% 76%, #f7f6ef 76%)`
      : col;
    b.title = isAlive
      ? (isTarget ? `Bi #${id} (Mục tiêu tiếp theo)` : `Bi #${id} (Trên bàn)`)
      : `Bi #${id} (Đã vào lỗ)`;

    const num = document.createElement('span');
    num.className = 'tv-ball-num';
    num.textContent = String(id);
    b.appendChild(num);

    container.appendChild(b);
  }

  const scratchEl = document.getElementById('tvScratchBadge');
  if (scratchEl) scratchEl.hidden = !isScratch;

  const barEl = document.getElementById('tvBallsBar');
  if (barEl && state.bot && state.bot.statusText) {
    barEl.title = state.bot.statusText;
  }
}

function initDraggableHud() {
  const el = document.getElementById('shotSpecHud');
  if (!el) return;
  const storageKey = 'bida9-shot-hud-pos';
  const saved = lsRead(storageKey);
  if (saved) {
    try {
      const pos = JSON.parse(saved);
      if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
        el.style.left = `${pos.left}px`;
        el.style.top = `${pos.top}px`;
      }
    } catch {}
  }

  let isDragging = false;
  let startX = 0, startY = 0, origLeft = 0, origTop = 0;

  el.addEventListener('pointerdown', (e) => {
    if (e.target && e.target.closest('button, a, input')) return;
    isDragging = true;
    el.classList.add('is-dragging');
    el.setPointerCapture(e.pointerId);
    startX = e.clientX;
    startY = e.clientY;
    const rect = el.getBoundingClientRect();
    const parentRect = el.offsetParent ? el.offsetParent.getBoundingClientRect() : { left: 0, top: 0 };
    origLeft = rect.left - parentRect.left;
    origTop = rect.top - parentRect.top;
    e.preventDefault();
  });

  el.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const stage = el.offsetParent || document.body;
    const maxLeft = Math.max(0, stage.clientWidth - el.offsetWidth - 8);
    const maxTop = Math.max(0, stage.clientHeight - el.offsetHeight - 8);
    const newLeft = Math.max(8, Math.min(maxLeft, origLeft + dx));
    const newTop = Math.max(8, Math.min(maxTop, origTop + dy));
    el.style.left = `${newLeft}px`;
    el.style.top = `${newTop}px`;
  });

  const stopDrag = (e) => {
    if (!isDragging) return;
    isDragging = false;
    el.classList.remove('is-dragging');
    try { el.releasePointerCapture(e.pointerId); } catch {}
    const curLeft = parseFloat(el.style.left);
    const curTop = parseFloat(el.style.top);
    if (!isNaN(curLeft) && !isNaN(curTop)) {
      lsWrite(storageKey, JSON.stringify({ left: curLeft, top: curTop }));
    }
  };

  el.addEventListener('pointerup', stopDrag);
  el.addEventListener('pointercancel', stopDrag);
}

function syncBotUi() {
  const isEight = state.bot.game === '8ball';
  const isBvb = state.bot.matchType === 'bvb';
  const isPvp = isPvpMode();
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

  if (isBvb) {
    document.body.dataset.bvb = 'true';
  } else {
    delete document.body.dataset.bvb;
  }

  panel.setBotHud({
    matchType: state.bot.matchType,
    bot1Name: isPvp ? botNameOf('player') : state.bot.bot1Name,
    bot2Name: isPvp ? botNameOf('bot') : state.bot.bot2Name,
    myWho: isPvp ? state.pvp.myWho : 'player',
    bot1Diff: state.bot.bot1Diff,
    bot2Diff: state.bot.bot2Diff,
    paused: state.bot.paused,
    speed: state.bot.speed,
    scorePlayer: state.bot.scorePlayer,
    scoreBot: state.bot.scoreBot,
    raceTo: state.bot.raceTo,
    turn: state.bot.turn,
    game: state.bot.game,
    difficulty: state.bot.difficulty,
    targetId: lowestBallId(state.balls),
    targetLabel,
    statusText: state.bot.statusText,
    isFoul: state.bot.isFoul,
    thinking: state.bot.thinking,
  });

  const tvBoard = document.getElementById('tvScoreboard');
  if (tvBoard) {
    const isBotMode = state.mode === 'bot' && !state.lobbyOpen;
    tvBoard.hidden = !isBotMode;
    if (isBotMode) {
      const gLabel = state.bot.game === '8ball' ? '8 BI' : '9 BI';
      const raceLabel = state.bot.raceTo > 0 ? `CHẠM ${state.bot.raceTo}` : 'TỰ DO';
      const tvGameBadge = document.getElementById('tvGameBadge');
      if (tvGameBadge) tvGameBadge.textContent = `${gLabel} · ${raceLabel}`;
      const tvRackBadge = document.getElementById('tvRackBadge');
      if (tvRackBadge) tvRackBadge.textContent = `VÁN ${state.bot.rack || 1}`;

      const name1 = isPvp ? botNameOf('player') : isBvb ? state.bot.bot1Name : 'BẠN';
      const name2 = isPvp ? botNameOf('bot') : isBvb ? state.bot.bot2Name : 'BOT';
      const diff1 = isPvp ? 'CHỦ PHÒNG' : isBvb
        ? (state.bot.bot1Diff === 'hero' ? 'HERO' : (BOT_DIFFICULTIES[state.bot.bot1Diff]?.shortLabel || 'TB').toUpperCase())
        : 'CƠ THỦ';
      const diff2 = isPvp ? 'KHÁCH' : isBvb
        ? (state.bot.bot2Diff === 'hero' ? 'HERO' : (BOT_DIFFICULTIES[state.bot.bot2Diff]?.shortLabel || 'PRO').toUpperCase())
        : (state.bot.difficulty === 'hero' ? 'HERO' : (BOT_DIFFICULTIES[state.bot.difficulty]?.shortLabel || 'TB').toUpperCase());

      const tvName1 = document.getElementById('tvName1');
      if (tvName1) tvName1.textContent = name1;
      const tvDiff1 = document.getElementById('tvDiff1');
      if (tvDiff1) tvDiff1.textContent = diff1;
      const tvScore1 = document.getElementById('tvScore1');
      if (tvScore1) tvScore1.textContent = String(state.bot.scorePlayer);

      const tvName2 = document.getElementById('tvName2');
      if (tvName2) tvName2.textContent = name2;
      const tvDiff2 = document.getElementById('tvDiff2');
      if (tvDiff2) tvDiff2.textContent = diff2;
      const tvScore2 = document.getElementById('tvScore2');
      if (tvScore2) tvScore2.textContent = String(state.bot.scoreBot);

      const tvTargetBadge = document.getElementById('tvTargetBadge');
      if (tvTargetBadge) tvTargetBadge.textContent = targetLabel;

      updateTvBallsBar(state.bot.game, state.balls, targetOrIds, state.bot.isFoul);

      const isShooter1 = who === 'player' || who === 'bot1';
      const tvP1 = document.getElementById('tvPlayer1');
      const tvP2 = document.getElementById('tvPlayer2');
      if (tvP1 && tvP2) {
        tvP1.classList.toggle('active-shooter', isShooter1);
        tvP2.classList.toggle('active-shooter', !isShooter1);
      }
      syncTvShotSpecs();
    }
  }

  const specHud = document.getElementById('shotSpecHud');
  if (specHud) {
    specHud.hidden = true;
  }

  if (state.mode === 'bot') {
    panel.setTurnLocked(isBotTurn() || state.lobbyOpen || state.bot.matchOver);
  } else {
    panel.setTurnLocked(false);
  }
  if (isPvp) pvpUpdateHud();
  updateButtons();
}

function startBotRack(breaker = state.bot.breaker) {
  clearBotTimers();
  matchEndTracked = false;
  state.bot.pendingRack = null;
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
  state.elevation = DEFAULT_ELEVATION_DEG;
  state.bot.groups = { player: null, bot: null, bot1: null, bot2: null };
  state.bot.onBreak = true;
  state.bot.ballInHand = true;
  state.bot.isFoul = false;
  const gLabel = BOT_GAMES[state.bot.game]?.label || '9 Bi';
  if (state.bot.matchType === 'bvb') {
    state.bot.statusText = `Ván ${state.bot.rack} (${gLabel}): 🤖 ${botNameOf(breaker)} chuẩn bị phá bi...`;
  } else if (isPvpMode()) {
    state.bot.statusText = `Ván ${state.bot.rack} (${gLabel}): ${botNameOf(breaker)} phá bi.`;
    state.pvp.rackPending = false;
    state.pvp.synced = true;
    state.bot.pendingRack = null;
  } else {
    state.bot.statusText = breaker === 'player'
      ? `Ván mới (${gLabel}): kéo bi cái sau vạch đầu bàn và phá bi!`
      : `Ván mới (${gLabel}): 🤖 Bot chuẩn bị phá bi...`;
  }
  syncControls();
  invalidate();
  if (isPvpMode() && state.pvp.seat === 1) pvpSendSync('rack'); // only the host racks; the guest receives the layout
  if (state.mode === 'bot' && !state.bot.matchOver) matchFx?.startShotClock(30, breaker);
  if (breaker === 'bot' || state.bot.matchType === 'bvb') scheduleBotTurn();
}

/** First legal target ball for `who` in the current bot/PvP game (9-ball: lowest ball; 8-ball: first of the group). */
function firstLegalFor(who) {
  if (state.bot.game !== '8ball') return lowestObjectId();
  const ids = eightBallTargetIds(state.balls, state.bot.groups[who]);
  return ids.length ? ids[0] : null;
}

/** Set the target to `who`'s first legal ball and point the aim at it. */
function aimAtTargetFor(who) {
  const tid = firstLegalFor(who);
  state.targetId = tid;
  const cue = ball(0);
  const tgt = tid ? ball(tid) : null;
  if (cue && tgt) {
    state.aimAngle = normAngle(Math.round(deg(Math.atan2(tgt.pos.y - cue.pos.y, tgt.pos.x - cue.pos.x)) * 100) / 100);
  }
}

function handleShotTimeout(who) {
  if (state.mode !== 'bot' || state.phase !== 'aim' || state.bot.matchOver) return;
  const shooter = who || state.bot.turn;
  const opp = state.bot.matchType === 'bvb'
    ? (shooter === 'bot1' ? 'bot2' : 'bot1')
    : (shooter === 'player' ? 'bot' : 'player');
  const nameWas = botNameOf(shooter);
  const nameOpp = botNameOf(opp);
  sound?.foulTone?.();
  matchFx?.showCallout({
    kind: 'timeout',
    title: 'HẾT GIỜ!',
    subtitle: `${nameWas} quá 30 giây — Quyền đặt bi cho ${nameOpp}!`,
    duration: 2500,
  });
  state.bot.turn = opp;
  state.bot.ballInHand = true;
  state.bot.isFoul = true;
  state.aimMode = 'manual';
  state.aimOffset = 0;
  state.tip = { x: 0, y: 0 };
  panel.spinPad?.set(state.tip, true);
  if (state.bot.matchType === 'bvb') {
    state.targetId = firstLegalFor(opp);
    state.bot.statusText = `⚠️ ${nameWas} hết giờ! Đến lượt ${nameOpp} (đặt bi).`;
    panel.toast(state.bot.statusText, 'bad');
  } else if (opp === 'player') {
    aimAtTargetFor('player');
    state.bot.statusText = `Bot hết giờ! Bạn được quyền đặt bi tùy ý.`;
    panel.toast(state.bot.statusText, 'ok');
  } else {
    state.targetId = firstLegalFor('bot');
    state.bot.statusText = `Bạn hết giờ (30s)! Đến lượt Bot (đặt bi).`;
    panel.toast(state.bot.statusText, 'bad');
  }
  syncControls();
  syncBotUi();
  invalidate();
  matchFx?.startShotClock(30, opp);
  if (state.bot.matchType === 'bvb' || opp === 'bot') scheduleBotTurn();
}

function scheduleBotTurn() {
  if (isPvpMode()) return; // no AI in online matches (and keep the pending rack timer)
  clearBotTimers();
  if (state.mode !== 'bot' || state.phase !== 'aim') return;
  if (!isBotTurn()) return;
  if (state.bot.paused || state.bot.matchOver) return;

  state.bot.thinking = true;
  state.bot.feathering = false;
  state.bot.featherPower = null;

  const speed = state.bot.speed || 1;
  const delayScale = speed === 4 ? 0.18 : speed === 2 ? 0.42 : 1.0;
  const currentShooter = state.bot.turn;
  const shooterName = botNameOf(currentShooter);
  const shooterDiff = botDiffOf(currentShooter);
  const isEight = state.bot.game === '8ball';
  const botGroup = isEight ? state.bot.groups[currentShooter] : null;

  // Giai đoạn 1: Quan sát & Nghĩ thế bi (1.6s at 1x)
  state.bot.statusText = `🤖 ${shooterName} đang quan sát thế bi...`;
  syncBotUi();
  invalidate({ pred: false });

  const obsDelay = Math.round(1600 * delayScale);
  addBotTimer(() => {
    if (state.mode !== 'bot' || state.phase !== 'aim' || state.bot.turn !== currentShooter) return;

    const targetOrIds = isEight
      ? eightBallTargetIds(state.balls, botGroup)
      : lowestBallId(state.balls);

    if (state.bot.ballInHand || state.bot.onBreak) {
      const cue = ball(0);
      const pos = placeCueBallForBot(state.balls, targetOrIds, geo, eq, state.bot.onBreak);
      if (cue && pos) {
        cue.pos = { x: pos.x, y: pos.y };
        state.bot.ballInHand = false;
        state.bot.statusText = `🤖 ${shooterName} đã đặt bi cái vào vị trí thuận lợi...`;
        syncBotUi();
        invalidate({ pred: false });
      }
    }

    // Giai đoạn 2: Vào thế cơ & ngắm hướng bi (1.5s at 1x)
    const stanceDelay = Math.round(1500 * delayScale);
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
      state.botElevation = shot.elevationDeg ?? DEFAULT_ELEVATION_DEG;
      state.botLastShotKind = shot.kind;

      const isHeroCurrent = isHeroWho(currentShooter);
      let statusExtra = '';
      if (isHeroCurrent) {
        const hero = loadHeroProfile();
        statusExtra = ` (Lvl ${hero.level || 13} · ${(hero.aimJitterDeg || 0.06).toFixed(2)}°)`;
      }

      state.bot.statusText = state.bot.onBreak
        ? `🤖 ${shooterName}${statusExtra} vào thế phá bi...`
        : shot.kind === 'jump'
          ? `🦘 ${shooterName}${statusExtra} vào thế NHẢY BI qua vật cản!`
          : shot.kind === 'masse'
            ? `🌀 ${shooterName}${statusExtra} vào thế MASSÉ xoáy cong qua vật cản!`
            : shot.kind === 'safe'
              ? `🛡️ ${shooterName}${statusExtra} ngắm giấu bi an toàn...`
              : `🎯 ${shooterName}${statusExtra} ngắm bi #${shot.targetId} vào lỗ...`;

      panel.spinPad.set(state.tip, true);
      syncTvShotSpecs();
      syncControls();
      invalidate({ pred: false });

      // Giai đoạn 3: Nhịp tĩnh & nhấp cơ lấy cảm giác (1.5s at 1x)
      const featherDelay = Math.round(1500 * delayScale);
      addBotTimer(() => {
        if (state.mode !== 'bot' || state.phase !== 'aim' || state.bot.turn !== currentShooter) return;

        state.bot.statusText = `🎱 ${shooterName} đang nhấp cơ lấy nhịp tĩnh...`;
        syncBotUi();

        const featherDur = Math.round(1400 * delayScale);
        if (featherDur > 200) {
          state.bot.feathering = true;
          const featherT0 = performance.now();
          function animFeather(now) {
            if (!state.bot.feathering || state.phase !== 'aim' || state.bot.turn !== currentShooter) return;
            const elapsed = now - featherT0;
            if (elapsed < featherDur) {
              const wave = Math.sin((elapsed / featherDur) * Math.PI * 4);
              state.bot.featherPower = Math.max(0.04, state.power * (0.65 + 0.35 * wave));
              updateTvPower(state.bot.featherPower);
              invalidate({ pred: false });
              requestAnimationFrame(animFeather);
            } else {
              state.bot.feathering = false;
              state.bot.featherPower = null;
              updateTvPower(state.power);
              invalidate({ pred: false });
            }
          }
          requestAnimationFrame(animFeather);
        }

        // Giai đoạn 4: Ra ngọn mượt mà (Strike)
        const strikeDelay = Math.round(featherDur + 350 * delayScale);
        addBotTimer(() => {
          if (state.mode !== 'bot' || state.phase !== 'aim' || state.bot.turn !== currentShooter) return;
          state.bot.feathering = false;
          state.bot.featherPower = null;
          state.bot.thinking = false;
          state.bot.statusText = `💥 ${shooterName} ra ngọn!`;
          syncBotUi();
          startShot(true);
        }, strikeDelay);
      }, featherDelay);
    }, stanceDelay);
  });
}

function enterBotMode(difficulty, game, raceTo) {
  leavePvpIfNeeded();
  if (!isAimReady()) return;
  clearBotTimers();
  delete document.body.dataset.bvb;
  state.bot.matchType = 'pve';
  if (difficulty && BOT_DIFFICULTIES[difficulty]) state.bot.difficulty = difficulty;
  if (game && BOT_GAMES[game]) state.bot.game = game;
  if (raceTo !== undefined) state.bot.raceTo = raceTo;
  state.bot.matchOver = false;
  panel.setMatchWin(false);
  if (state.mode === 'free') state.freeBackup = snapshot();
  state.appMode = state.bot.difficulty === 'hero' ? 'hero' : 'bot';
  state.mode = 'bot';
  state.lobbyOpen = false;
  panel.setLobbyOpen(false);
  panel.setAppMode(state.appMode);
  panel.setActiveTab('bot');
  state.bot.scorePlayer = 0;
  state.bot.scoreBot = 0;
  state.bot.rack = 1;
  state.bot.breaker = 'player';
  matchFx?.setAvatars('👤', state.bot.difficulty === 'hero' ? '🦸' : '🤖');
  startBotRack('player');
  trackMatchStart();
}

function enterBvbMode(opts = {}) {
  if (!DEV_BUILD) return; // Bot vs Bot is a develop-only feature
  leavePvpIfNeeded();
  if (!isAimReady()) return;
  clearBotTimers();
  document.body.dataset.bvb = 'true';
  state.bot.matchType = 'bvb';
  if (opts.name1) state.bot.bot1Name = opts.name1.trim() || 'Alpha';
  if (opts.name2) state.bot.bot2Name = opts.name2.trim() || 'Beta';
  if (opts.diff1 && BOT_DIFFICULTIES[opts.diff1]) state.bot.bot1Diff = opts.diff1;
  if (opts.diff2 && BOT_DIFFICULTIES[opts.diff2]) state.bot.bot2Diff = opts.diff2;
  if (opts.game && BOT_GAMES[opts.game]) state.bot.game = opts.game;
  if (opts.raceTo !== undefined) state.bot.raceTo = opts.raceTo;
  state.bot.matchOver = false;
  panel.setMatchWin(false);
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
  matchFx?.setAvatars('🤖', '👾');
  startBotRack('bot1');
  trackMatchStart();
}

function syncOverlayCheckboxes() {
  for (const cb of document.querySelectorAll('[data-ov]')) {
    const k = cb.dataset.ov;
    if (k in state.overlays) cb.checked = !!state.overlays[k];
  }
}

function enterPracticeMode(subMode = state.practiceMode, opts = {}) {
  leavePvpIfNeeded();
  if (!isAimReady()) return;
  clearBotTimers();
  matchFx?.stopShotClock();
  matchFx?.setAvatars('🎯', '🎱');
  delete document.body.dataset.bvb;
  state.appMode = 'practice';
  state.lobbyOpen = false;
  panel.setLobbyOpen(false);
  panel.setAppMode('practice');
  panel.setTurnLocked(false);
  state.overlays = {
    aim: true,
    actual: true,
    ghost: true,
    pocket: true,
    tangent: true,
    roll: true,
    predict: true,
  };
  syncOverlayCheckboxes();
  const nextSub = subMode === 'bot' ? 'free' : subMode || 'free';
  state.practiceMode = nextSub;
  if (state.mode === nextSub && opts.keepBoard) {
    panel.setActiveTab(nextSub);
    syncControls();
    return;
  }
  setMode(nextSub, { forceReset: state.mode === 'bot' });
}

/* ------------------------------------------------------------------ 1 vs 1 online */
// Shooter-authoritative: the player at the table sends `shot` (balls + parameters + seed), both devices run the same
// simulation, only the shooter applies the rules and then sends `sync` (full snapshot) which the other device applies
// once its own animation is over. The relay server never simulates anything.

const PVP_FIXED_TABLE = 'club-9ft';
const PVP_FIXED_CUE = 'standard';
const PVP_RACK_DELAY = 1500; // ms between a rack result and the next rack (host only)
const PVP_SYNC_SLOW_MS = 8000; // waiting longer than this for the shooter's sync shows "Đang đồng bộ…"
const PVP_ERRORS = {
  'no-room': 'Không có phòng với mã này.',
  'room-full': 'Phòng đã đủ 2 người.',
  'bad-token': 'Không vào lại được phòng (phiên đã hết hạn).',
  'bad-message': 'Yêu cầu không hợp lệ. Hãy kiểm tra tên và mã phòng.',
  'rate-limit': 'Thao tác quá nhanh, hãy thử lại sau giây lát.',
};

let pvpClient = null; // net client for the lobby phase and the match
let pvpPending = null; // runs once the socket is open (create / join / rejoin)
let pvpLobbyCtx = null; // { role: 'host' | 'guest', name, game, raceTo, code, token } until the match starts
let pvpResume = null; // saved session being resumed after a page reload
let pvpLastToast = ''; // last toast text of the shot being finished (sent to the opponent with the sync)
const pvpGate = createShotGate((sync) => pvpOnGateReady(sync));

const pvpSend = (p) => !!pvpClient && pvpClient.send({ t: 'relay', p });

function pvpMakeClient() {
  const c = createNetClient({
    url: serverUrl(),
    onMessage: (msg) => {
      if (c === pvpClient) pvpOnNet(msg);
    },
    onStatus: (st) => {
      if (c === pvpClient) pvpOnStatus(st);
    },
  });
  return c;
}

function leavePvpIfNeeded() {
  if (state.pvp) {
    pvpTeardown({ notify: true });
  } else if (pvpClient) {
    pvpDisconnect({ notify: true });
    panel.setPvpLobby({ phase: 'idle' });
  }
}

/** Close the socket and forget the session (the room is closed on the server when notify is true). */
function pvpDisconnect({ notify = true } = {}) {
  const c = pvpClient;
  pvpClient = null;
  pvpPending = null;
  pvpLobbyCtx = null;
  pvpResume = null;
  if (c) {
    if (notify && c.status === 'open') c.send({ t: 'leave' });
    c.setSession(null);
    c.close();
  }
  pvpGate.reset();
  const pv = state.pvp;
  if (pv) {
    clearTimeout(pv.syncTimer);
    clearTimeout(pv.aimTimer);
    clearInterval(pv.hudTimer);
  }
}

/** Leave the online match state (equipment, flags). Does not touch the screen layout: see pvpLeave. */
function pvpTeardown({ notify = true } = {}) {
  const hadMatch = !!state.pvp;
  pvpDisconnect({ notify });
  if (!hadMatch) return;
  clearBotTimers();
  state.pvp = null;
  state.bot.matchType = 'pve';
  state.bot.matchOver = false;
  state.bot.pendingRack = null;
  state.sim = null;
  state.phase = 'aim';
  strokePending = false;
  dropAnims = [];
  timeScale = 1;
  state.botElevation = null;
  panel.setMatchWin(false);
  panel.setPvpHud({ visible: false });
  loadingHash = true; // no "table resized" toast
  try {
    onEquipmentChange(settings.get());
  } finally {
    loadingHash = false;
  }
  settings.setChipOverride(null);
}

/** Back to the practice board and the lobby. */
function pvpLeave({ confirmFirst = false, notify = true, toastMsg = '' } = {}) {
  if (confirmFirst && state.pvp && !state.bot.matchOver && typeof window.confirm === 'function') {
    if (!window.confirm('Rời phòng? Trận đang chơi sẽ kết thúc.')) return;
  }
  pvpTeardown({ notify });
  enterPracticeMode('free');
  state.lobbyOpen = true;
  panel.setLobbyOpen(true);
  panel.setPvpLobby({ phase: 'idle' });
  if (toastMsg) panel.toast(toastMsg, 'warn');
}

function openPvpLobby() {
  if (state.pvp) {
    panel.toast('Bạn đang trong phòng online. Bấm "Rời phòng" để thoát.', 'warn');
    return;
  }
  state.lobbyOpen = true;
  panel.setLobbyOpen(true);
  panel.focusPvpLobby(null);
}

/* ---- lobby: create / join / cancel / copy link */

function pvpStartLobby(kind, opts) {
  if (pvpClient) pvpDisconnect({ notify: true });
  const name = sanitizeName(opts.name);
  if (kind === 'join' && !ROOM_CODE_RE.test(opts.code)) {
    panel.setPvpLobby({ phase: 'idle', error: 'Mã phòng gồm 5 ký tự (chữ và số).' });
    return;
  }
  pvpLobbyCtx = { role: kind === 'create' ? 'host' : 'guest', name, game: opts.game || '9ball', raceTo: opts.raceTo ?? 5, code: opts.code || '', token: '' };
  const msg = kind === 'create'
    ? { t: 'create', name, game: pvpLobbyCtx.game, raceTo: pvpLobbyCtx.raceTo }
    : { t: 'join', code: opts.code, name };
  pvpClient = pvpMakeClient();
  pvpPending = () => pvpClient.send(msg);
  panel.setPvpLobby({ phase: 'connecting' });
  pvpClient.connect();
}

function pvpCancelLobby() {
  pvpDisconnect({ notify: true });
  panel.setPvpLobby({ phase: 'idle' });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e2) {
      return false;
    }
  }
}

/** Copy just the room code (the opponent types it into "Vào phòng"). */
async function pvpCopyCode() {
  const code = pvpLobbyCtx && pvpLobbyCtx.code;
  if (!code) return;
  const ok = await copyText(code);
  panel.toast(ok ? `Đã sao chép mã phòng ${code}` : `Không sao chép được – mã phòng: ${code}`, ok ? 'ok' : 'warn');
}

async function pvpCopyLink() {
  const code = pvpLobbyCtx && pvpLobbyCtx.code;
  if (!code) return;
  const url = roomLink(location.origin === 'null' ? '' : location.origin, location.pathname, code);
  if (navigator.share) {
    try {
      await navigator.share({ title: 'MimePool 1 vs 1', text: `Vào phòng MimePool ${code}`, url });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  const ok = await copyText(url);
  panel.toast(ok ? 'Đã sao chép liên kết mời' : `Không sao chép được – mã phòng: ${code}`, ok ? 'ok' : 'warn');
}

/** Reload while in a room: sessionStorage still holds { code, token }, ask the server for the seat back. */
function pvpTryResume() {
  const sess = loadSession();
  if (!sess) return false;
  pvpResume = sess;
  pvpClient = pvpMakeClient();
  pvpPending = () => pvpClient.send({ t: 'rejoin', code: sess.code, token: sess.token });
  panel.setPvpLobby({ phase: 'connecting' });
  pvpClient.connect();
  return true;
}

/* ---- network events */

function pvpOnStatus(st) {
  if (st === 'open') {
    // after an automatic reconnect the client sends `rejoin` itself
    if (pvpPending && !pvpClient.rejoined) {
      const run = pvpPending;
      pvpPending = null;
      run();
    } else if (pvpClient.rejoined) {
      pvpPending = null;
    }
    return;
  }
  if (st === 'reconnecting') {
    if (state.pvp) {
      state.pvp.connected = false;
      pvpUpdateHud();
      syncControls();
    }
    return;
  }
  if (st === 'closed') {
    const inMatch = !!state.pvp;
    pvpDisconnect({ notify: false });
    if (inMatch) pvpLeave({ notify: false, toastMsg: 'Mất kết nối máy chủ – đã rời phòng' });
    else panel.setPvpLobby({ phase: 'idle', error: 'Không kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại.' });
  }
}

function pvpOnNet(msg) {
  const pv = state.pvp;
  switch (msg.t) {
    case 'created':
    case 'joined':
      pvpOnRoomReply(msg);
      break;
    case 'peer-joined':
      if (!pv && pvpLobbyCtx && pvpLobbyCtx.role === 'host') {
        const c = pvpLobbyCtx;
        enterPvpMatch({ seat: 1, code: c.code, token: c.token, hostName: c.name, guestName: msg.name, game: c.game, raceTo: c.raceTo, peerOnline: true });
      }
      break;
    case 'peer-left':
      if (!pv) break;
      pv.peerOnline = false;
      pv.peerOffUntil = Date.now() + (msg.graceMs || 60000);
      pvpStartHudTimer();
      pvpUpdateHud();
      break;
    case 'peer-back':
      if (!pv) break;
      pv.peerOnline = true;
      pv.peerOffUntil = 0;
      clearInterval(pv.hudTimer);
      pvpUpdateHud();
      pvpSendResyncIfIdle();
      break;
    case 'room-closed':
      if (pv) {
        pvpLeave({ notify: false, toastMsg: msg.reason === 'timeout' ? 'Phòng đã hết hạn (đối thủ mất kết nối quá lâu)' : 'Đối thủ đã rời phòng' });
      } else {
        pvpDisconnect({ notify: false });
        panel.setPvpLobby({ phase: 'idle', error: msg.reason === 'timeout' ? 'Phòng đã hết hạn.' : '' });
      }
      break;
    case 'error': {
      const text = PVP_ERRORS[msg.code] || 'Có lỗi kết nối.';
      if (msg.code === 'rate-limit' || (pv && msg.code === 'bad-message')) {
        panel.toast(text, 'warn');
      } else if (pv) {
        pvpLeave({ notify: false, toastMsg: text });
      } else {
        pvpDisconnect({ notify: false });
        panel.setPvpLobby({ phase: 'idle', error: text });
      }
      break;
    }
    case 'relay':
      if (pv) pvpHandle(msg.p);
      break;
    default:
      break;
  }
}

/** `created` (seat 1) / `joined` (seat 2): reply to create, join or rejoin. */
function pvpOnRoomReply(msg) {
  const { seat, code, token } = msg;
  if (state.pvp) {
    // the automatic rejoin after a network drop succeeded
    state.pvp.token = token;
    pvpSaveSession();
    pvpOnReconnected(msg.peerOnline !== false);
    return;
  }
  if (pvpResume) {
    const r = pvpResume;
    pvpResume = null;
    const game = msg.game || r.game || '9ball';
    const raceTo = msg.raceTo ?? r.raceTo ?? 5;
    if (seat === 1 && !r.guestName) {
      // reloaded while still waiting for an opponent: back to the waiting card
      pvpLobbyCtx = { role: 'host', name: r.hostName || 'Người chơi', game, raceTo, code, token };
      pvpSaveSessionRaw({ code, token, seat: 1, hostName: pvpLobbyCtx.name, guestName: null, game, raceTo });
      panel.setPvpLobby({ phase: 'waiting', code });
      return;
    }
    enterPvpMatch({
      seat,
      code,
      token,
      hostName: seat === 2 ? msg.hostName : r.hostName || 'Chủ phòng',
      guestName: r.guestName || 'Khách',
      game,
      raceTo,
      peerOnline: msg.peerOnline !== false,
      resumed: true,
    });
    return;
  }
  const ctx = pvpLobbyCtx;
  if (!ctx) return;
  if (msg.t === 'created') {
    ctx.code = code;
    ctx.token = token;
    pvpSaveSessionRaw({ code, token, seat: 1, hostName: ctx.name, guestName: null, game: ctx.game, raceTo: ctx.raceTo });
    panel.setPvpLobby({ phase: 'waiting', code });
    analytics.track('room_create', { game: ctx.game, race_to: ctx.raceTo });
  } else {
    analytics.track('room_join', { game: msg.game, race_to: msg.raceTo });
    enterPvpMatch({ seat: 2, code, token, hostName: msg.hostName, guestName: ctx.name, game: msg.game, raceTo: msg.raceTo, peerOnline: true });
  }
}

function pvpSaveSessionRaw(sess) {
  if (pvpClient) pvpClient.setSession(sess);
}
function pvpSaveSession() {
  const pv = state.pvp;
  if (!pv) return;
  pvpSaveSessionRaw({ code: pv.code, token: pv.token, seat: pv.seat, hostName: pv.names.player, guestName: pv.names.bot, game: state.bot.game, raceTo: state.bot.raceTo });
}

function pvpOnReconnected(peerOnline) {
  const pv = state.pvp;
  pv.connected = true;
  pv.peerOnline = peerOnline;
  if (peerOnline) clearInterval(pv.hudTimer);
  else {
    pv.peerOffUntil = pv.peerOffUntil || Date.now() + 60000;
    pvpStartHudTimer();
  }
  pvpUpdateHud();
  syncControls();
  panel.toast('Đã kết nối lại', 'ok');
  // a sync that could not be sent while offline goes out now
  if (pv.lastSync && !pv.lastSync.sent) pv.lastSync.sent = pvpSend(pv.lastSync.p);
}

/* ---- match start / hud */

function enterPvpMatch({ seat, code, token, hostName, guestName, game, raceTo, peerOnline = true, resumed = false }) {
  clearBotTimers();
  delete document.body.dataset.bvb;
  state.sim = null;
  state.phase = 'aim';
  strokePending = false;
  dropAnims = [];
  timeScale = 1;
  if (state.mode === 'free') state.freeBackup = snapshot();
  const myWho = seatToWho(seat);
  state.pvp = {
    seat,
    myWho,
    names: { player: hostName || 'Chủ phòng', bot: guestName || 'Khách' },
    code,
    token,
    connected: true,
    peerOnline,
    peerOffUntil: 0,
    seq: 0, // highest shot number seen (own or received)
    appliedResultSeq: -1,
    waitingSync: false,
    waitingSyncSlow: false,
    rematch: { me: false, peer: false },
    remoteShot: null, // { seq } while the opponent's shot is being animated / waiting for its sync
    queue: [], // payloads that arrived while busy with a remote shot
    lastSync: null, // { p, sent } last result/rack sync produced here (re-sent after a reconnect if not sent)
    synced: seat === 1 && !resumed, // false until the first snapshot of the match is in place
    rackPending: false,
    ended: null, // { loser } after a resignation
    shotBy: null, // 'me' | 'peer' for the shot in flight
    syncTimer: 0,
    aimTimer: 0,
    hudTimer: 0,
    lastAimKey: '',
    lastAimAt: 0,
  };
  pvpGate.reset();
  pvpLobbyCtx = null;
  pvpResume = null;
  state.bot.matchType = 'pvp';
  state.bot.game = game;
  state.bot.raceTo = raceTo;
  state.bot.matchOver = false;
  state.bot.paused = false;
  state.bot.scorePlayer = 0;
  state.bot.scoreBot = 0;
  state.bot.rack = 1;
  state.bot.breaker = 'player';
  state.bot.turn = 'player';
  state.bot.pendingRack = null;
  panel.setMatchWin(false);
  pvpSaveSession();
  pvpUseFixedEquipment();
  state.appMode = 'pvp';
  state.mode = 'bot';
  state.lobbyOpen = false;
  panel.setLobbyOpen(false);
  panel.setPvpLobby({ phase: 'idle' });
  panel.setAppMode('pvp');
  panel.setActiveTab('bot');
  matchFx?.setAvatars('👤', '👥');
  if (!peerOnline) {
    state.pvp.peerOffUntil = Date.now() + 60000;
    pvpStartHudTimer();
  }
  if (!resumed) trackMatchStart();
  if (seat === 1 && !resumed) {
    startBotRack('player'); // host breaks first and sends the layout
  } else {
    state.bot.statusText = resumed ? 'Đang đồng bộ lại trận đấu…' : 'Đang chờ chủ phòng xếp bi…';
    syncControls();
    invalidate();
  }
  pvpUpdateHud();
}

function pvpUseFixedEquipment() {
  const next = { table: tablePreset(PVP_FIXED_TABLE), cue: cuePreset(PVP_FIXED_CUE) };
  loadingHash = true; // no "table resized" toast
  try {
    onEquipmentChange(next);
  } finally {
    loadingHash = false;
  }
  settings.setChipOverride(`Bàn: ${next.table.name} · Gậy: ${next.cue.name} (cố định khi chơi online)`);
}

function pvpUpdateHud() {
  const pv = state.pvp;
  if (!pv) return;
  let text = 'Đã kết nối';
  let kind = 'ok';
  if (!pv.connected) {
    text = 'Đang kết nối lại…';
    kind = 'warn';
  } else if (!pv.peerOnline) {
    const secs = Math.max(0, Math.ceil((pv.peerOffUntil - Date.now()) / 1000));
    text = `Đối thủ mất kết nối – chờ ${secs}s`;
    kind = 'warn';
  } else if (!pv.synced || pv.waitingSyncSlow) {
    text = 'Đang đồng bộ…';
    kind = 'warn';
  }
  panel.setPvpHud({ visible: true, text, kind });
}

function pvpStartHudTimer() {
  const pv = state.pvp;
  if (!pv) return;
  clearInterval(pv.hudTimer);
  pv.hudTimer = setInterval(() => {
    if (!state.pvp || state.pvp.peerOnline) {
      clearInterval(pv.hudTimer);
      return;
    }
    pvpUpdateHud();
  }, 1000);
}

/* ---- sending */

/** reason: 'result' | 'rack' | 'resync'. Result and rack snapshots are remembered so a reconnect can re-send them. */
function pvpSendSync(reason, toastMsg = '') {
  const pv = state.pvp;
  if (!pv) return;
  const p = {
    k: 'sync',
    seq: pv.seq,
    reason,
    balls: packBalls(state.balls, { withQuat: true }),
    potted: [...state.pottedIds],
    match: packMatch(state),
  };
  if (toastMsg) p.toast = toastMsg;
  const sent = pvpSend(p);
  if (reason !== 'resync') pv.lastSync = { p, sent };
}

/** A peer came back: if our state is authoritative (not waiting for a shot result), send it. */
function pvpSendResyncIfIdle() {
  const pv = state.pvp;
  if (!pv || pv.remoteShot || !pv.synced) return;
  pvpSendSync('resync');
}

/** Called from doShot: returns the launch parameters and the rng; the local shooter also announces the shot. */
function pvpPrepareShot(remote) {
  const pv = state.pvp;
  if (remote) {
    pv.shotBy = 'peer';
    state.power = remote.power;
    state.tip = { ...remote.tip };
    panel.spinPad.set(state.tip, true);
    return {
      strikeParams: { aimDir: remote.aimDir, power: remote.power, tip: remote.tip, elevationDeg: remote.elev },
      simRng: mulberry32(remote.seed),
    };
  }
  pv.seq += 1;
  pv.shotBy = 'me';
  const seed = newSeed();
  const strikeParams = {
    aimDir: { x: info.aimDir.x, y: info.aimDir.y },
    power: state.power,
    tip: { x: state.tip.x, y: state.tip.y },
    elevationDeg: elevation(info.aimDir), // the effective elevation is sent as-is so the other device does not re-derive it
  };
  pvpSend({
    k: 'shot',
    seq: pv.seq,
    seed,
    balls: packBalls(state.balls, { withQuat: true }),
    aimDir: strikeParams.aimDir,
    power: strikeParams.power,
    tip: strikeParams.tip,
    elev: strikeParams.elevationDeg,
  });
  return { strikeParams, simRng: mulberry32(seed) };
}

/** Throttled (100 ms) cue/power/tip/cue-ball broadcast while it is my turn to aim. */
function pvpTickAim(now) {
  const pv = state.pvp;
  if (!pv || !pvpMyTurn() || state.phase !== 'aim' || strokePending) return;
  const cue = ball(0);
  if (!cue) return;
  const key = [
    state.aimAngle.toFixed(2),
    state.power.toFixed(3),
    state.tip.x.toFixed(3),
    state.tip.y.toFixed(3),
    Math.round(state.elevation),
    cue.pos.x.toFixed(1),
    cue.pos.y.toFixed(1),
  ].join('|');
  if (key === pv.lastAimKey) return;
  const wait = 100 - (now - pv.lastAimAt);
  if (wait > 0) {
    if (!pv.aimTimer) {
      pv.aimTimer = setTimeout(() => {
        pv.aimTimer = 0;
        if (state.pvp === pv) pvpTickAim(performance.now());
      }, wait + 5);
    }
    return;
  }
  pv.lastAimAt = now;
  pv.lastAimKey = key;
  pvpSend({
    k: 'aim',
    angle: state.aimAngle,
    power: state.power,
    tip: { x: state.tip.x, y: state.tip.y },
    elev: state.elevation,
    cue: { x: cue.pos.x, y: cue.pos.y },
  });
}

/* ---- receiving */

const pvpBusy = () => !!state.pvp && !!state.pvp.remoteShot;

function pvpHandle(p) {
  const pv = state.pvp;
  if (!pv) return;
  switch (p.k) {
    case 'aim': {
      if (pvpBusy() || state.phase !== 'aim' || pv.rackPending || !pv.synced || pv.ended || state.bot.turn === pv.myWho) return;
      state.aimMode = 'manual';
      state.aimAngle = normAngle(p.angle);
      state.power = p.power;
      state.tip = { x: p.tip.x, y: p.tip.y };
      state.botElevation = p.elev;
      const cue = ball(0);
      // keep the sender's exact position (a ball resting on a cushion can sit a hair past the clamp limit); only reject nonsense
      if (cue && p.cue.x >= 0 && p.cue.x <= geo.W && p.cue.y >= 0 && p.cue.y <= geo.H) cue.pos = { x: p.cue.x, y: p.cue.y };
      panel.spinPad.set(state.tip, true);
      syncControls();
      invalidate({ pred: false });
      break;
    }
    case 'shot': {
      if (pv.ended) return;
      if (pvpBusy() || state.phase !== 'aim') {
        pv.queue.push(p); // arrived while the previous remote shot is still being animated
        return;
      }
      pv.seq = Math.max(pv.seq, p.seq);
      pv.remoteShot = { seq: p.seq };
      state.balls = unpackBalls(p.balls, createBall);
      state.aimMode = 'manual';
      doShot(p);
      break;
    }
    case 'sync': {
      if (pv.ended && p.reason === 'result') return;
      const rs = pv.remoteShot;
      if (rs && (p.reason === 'result' ? p.seq === rs.seq : p.reason === 'resync' && p.seq >= rs.seq)) {
        // the result of the shot being animated here (a resync also settles it: the shooter's state is newer)
        pvpGate.syncArrived({ ...p, seq: rs.seq });
        return;
      }
      if (rs) {
        pv.queue.push(p);
        return;
      }
      if (p.seq < pv.seq) return; // stale
      if (p.reason === 'result') {
        if (p.seq <= pv.appliedResultSeq) return; // duplicate (re-sent after a reconnect)
        pv.appliedResultSeq = p.seq;
      }
      pvpApplySync(p);
      break;
    }
    case 'rematch': {
      pv.rematch.peer = p.accept;
      if (!p.accept) {
        pv.rematch.me = false;
        if (state.bot.matchOver) panel.setMatchWinWait('Đối thủ không muốn chơi lại.', false);
      } else if (state.bot.matchOver && !pv.rematch.me) {
        panel.toast('Đối thủ muốn chơi lại', 'ok');
        panel.setMatchWinWait('Đối thủ muốn chơi lại – bấm "Chơi lại" để đồng ý.', false);
      }
      pvpMaybeStartRematch();
      break;
    }
    case 'resign':
      if (!state.bot.matchOver) pvpEndByResign(otherWho(pv.myWho));
      break;
    default:
      break;
  }
}

function pvpDrainQueue() {
  const pv = state.pvp;
  if (!pv) return;
  const items = pv.queue.splice(0);
  for (const p of items) pvpHandle(p);
}

/** The animation of the opponent's shot finished on this device. */
function pvpRemoteShotDone() {
  const pv = state.pvp;
  const seq = pv.remoteShot ? pv.remoteShot.seq : pv.seq;
  if (pvpGate.animationDone(seq)) return; // the sync was already here: pvpOnGateReady applied it
  pv.waitingSync = true;
  pv.waitingSyncSlow = false;
  clearTimeout(pv.syncTimer);
  pv.syncTimer = setTimeout(() => {
    if (!state.pvp || !state.pvp.waitingSync) return;
    state.pvp.waitingSyncSlow = true;
    pvpUpdateHud();
    panel.toast('Đang đồng bộ…', 'warn');
  }, PVP_SYNC_SLOW_MS);
  syncControls();
}

function pvpOnGateReady(sync) {
  const pv = state.pvp;
  if (!pv) return;
  pv.waitingSync = false;
  pv.waitingSyncSlow = false;
  clearTimeout(pv.syncTimer);
  pv.remoteShot = null;
  pv.shotBy = null;
  if (sync.reason === 'result') pv.appliedResultSeq = Math.max(pv.appliedResultSeq, sync.seq);
  if (pv.ended) return;
  pvpApplySync(sync);
  pvpDrainQueue();
}

/** Put the shooter's snapshot in place: balls, potted list, match state. */
function pvpApplySync(sync) {
  const pv = state.pvp;
  if (!pv) return;
  pv.synced = true;
  pv.seq = Math.max(pv.seq, sync.seq);
  state.balls = unpackBalls(sync.balls, createBall);
  state.pottedIds = [...sync.potted];
  applyMatch(state, sync.match);
  pv.rackPending = sync.match.rackPending && !sync.match.matchOver;
  state.bot.pendingRack = pv.rackPending ? sync.match.breaker : null;
  if (sync.reason === 'rack' && !sync.match.matchOver) {
    pv.ended = null;
    matchEndTracked = false;
  }
  // reset anything left over from the previous shot
  state.sim = null;
  state.phase = 'aim';
  dropAnims = [];
  seenDropCount = 0;
  seenOffTableCount = 0;
  seenContactCount = 0;
  seenCushionCount = 0;
  timeScale = 1;
  state.preShot = null;
  state.pocket = null;
  state.aimOffset = 0;
  state.power = sync.reason === 'rack' ? 0.78 : 0.3;
  state.tip = { x: 0, y: 0 };
  panel.spinPad.set(state.tip, true);
  state.elevation = DEFAULT_ELEVATION_DEG;
  state.botElevation = null;
  state.botLastShotKind = null;
  state.aimMode = 'manual';
  pvpAimAtTarget();
  if (sync.toast) panel.toast(sync.toast, '');
  if (sync.match.matchOver) {
    pv.rematch = { me: false, peer: false };
    pvpShowMatchOver();
  } else {
    panel.setMatchWin(false);
    pv.rematch = { me: false, peer: false };
  }
  syncControls();
  invalidate();
  // host: the opponent won a rack, so the next layout is made here
  if (pv.seat === 1 && pv.rackPending) {
    clearBotTimers();
    const breaker = state.bot.breaker;
    addBotTimer(() => startBotRack(breaker), PVP_RACK_DELAY);
  }
}

/** Point the cue at the first legal target of whoever is on turn (only meaningful on my turn). */
function pvpAimAtTarget() {
  const who = state.bot.turn;
  let tid = state.targetId && ball(state.targetId) ? state.targetId : null;
  if (tid === null) {
    if (state.bot.game === '8ball') {
      const ids = eightBallTargetIds(state.balls, state.bot.groups[who]);
      tid = ids.length ? ids[0] : null;
    } else {
      tid = lowestObjectId();
    }
    state.targetId = tid;
  }
  const cue = ball(0);
  const tgt = tid ? ball(tid) : null;
  if (cue && tgt) {
    state.aimAngle = normAngle(Math.round(deg(Math.atan2(tgt.pos.y - cue.pos.y, tgt.pos.x - cue.pos.x)) * 100) / 100);
  }
}

/* ---- end of match: win modal, rematch, resignation */

function pvpShowMatchOver({ winner = null, desc = '' } = {}) {
  const pv = state.pvp;
  const b = state.bot;
  let w = winner;
  if (!w) w = b.raceTo > 0 ? (b.scorePlayer >= b.raceTo ? 'player' : 'bot') : b.scorePlayer >= b.scoreBot ? 'player' : 'bot';
  const winnerName = botNameOf(w);
  trackMatchEnd(w, pv && pv.ended ? 'resign' : 'race');
  panel.setMatchWin(true, {
    title: `🏆 ${winnerName} Thắng Chung Cuộc!`,
    desc: desc || `${winnerName} đã xuất sắc chạm mốc ${b.raceTo} ván thắng trước!`,
    name1: botNameOf('player'),
    name2: botNameOf('bot'),
    score1: b.scorePlayer,
    score2: b.scoreBot,
    pvp: true,
  });
  panel.setTurnLocked(true);
  if (pv.rematch.me) panel.setMatchWinWait('Đang chờ đối thủ đồng ý…', true);
  else if (pv.rematch.peer) panel.setMatchWinWait('Đối thủ muốn chơi lại – bấm "Chơi lại" để đồng ý.', false);
}

function pvpRematch() {
  const pv = state.pvp;
  if (!pv || !state.bot.matchOver) return;
  pv.rematch.me = true;
  pvpSend({ k: 'rematch', accept: true });
  panel.setMatchWinWait(pv.rematch.peer ? 'Đang bắt đầu trận mới…' : 'Đang chờ đối thủ đồng ý…', true);
  pvpMaybeStartRematch();
}

/** Host only: both players agreed, reset the score and rack the first game. */
function pvpMaybeStartRematch() {
  const pv = state.pvp;
  if (!pv || pv.seat !== 1 || !state.bot.matchOver || !(pv.rematch.me && pv.rematch.peer)) return;
  pv.rematch = { me: false, peer: false };
  pv.ended = null;
  state.bot.scorePlayer = 0;
  state.bot.scoreBot = 0;
  state.bot.rack = 1;
  state.bot.matchOver = false;
  state.bot.breaker = 'player';
  panel.setMatchWin(false);
  startBotRack('player'); // sends the new layout (reason 'rack')
}

function pvpResign() {
  const pv = state.pvp;
  if (!pv || state.bot.matchOver || pv.ended) return;
  if (typeof window.confirm === 'function' && !window.confirm('Xin thua trận này?')) return;
  pvpSend({ k: 'resign' });
  pvpEndByResign(pv.myWho);
}

function pvpEndByResign(loser) {
  const pv = state.pvp;
  if (!pv) return;
  clearBotTimers();
  pv.ended = { loser };
  pv.rackPending = false;
  pv.rematch = { me: false, peer: false };
  state.bot.pendingRack = null;
  state.bot.matchOver = true;
  const winner = otherWho(loser);
  state.bot.statusText = `🏳️ ${botNameOf(loser)} đã xin thua. ${botNameOf(winner)} thắng trận!`;
  pvpShowMatchOver({ winner, desc: `${botNameOf(loser)} đã xin thua.` });
  syncControls();
  invalidate();
}

/* ------------------------------------------------------------------ modes + drills */

function setMode(mode, opts = {}) {
  if (!isAimReady()) return;
  if (mode === 'bot') {
    enterBotMode();
    return;
  }
  if (mode === state.mode && !opts.forceReset) return;
  analytics.track('practice_start', { drill: mode });
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

let arcadeControls = null;

function syncControls() {
  if (arcadeControls) {
    arcadeControls.setPower(state.power);
    arcadeControls.setTip(state.tip);
  }
  panel.syncControls({
    power: state.power,
    aimOffset: state.aimOffset,
    tip: state.tip,
    elevation: elevation(),
    comp: state.compensate && compAllowedMode(),
    elevationLocked: elevationLocked(),
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
  syncTvShotSpecs();
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
    arcadeControls?.setPower(p);
    syncTvShotSpecs();
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
    arcadeControls?.setTip(tip);
    syncTvShotSpecs();
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
    if (app === 'pvp') {
      openPvpLobby();
      return;
    }
    if (state.pvp) {
      if (!state.bot.matchOver && typeof window.confirm === 'function' && !window.confirm('Rời phòng online? Trận đang chơi sẽ kết thúc.')) return;
      leavePvpIfNeeded();
    }
    if (app === 'bvb') enterBvbMode();
    else if (app === 'hero') enterBotMode('hero');
    else if (app === 'bot') enterBotMode();
    else enterPracticeMode(state.practiceMode);
  },
  onPvpCreate: (o) => pvpStartLobby('create', o),
  onPvpJoin: (o) => pvpStartLobby('join', o),
  onPvpCancel: pvpCancelLobby,
  onPvpCopy: pvpCopyLink,
  onPvpCopyCode: pvpCopyCode,
  onPvpResign: pvpResign,
  onPvpRematch: pvpRematch,
  onPvpLeave: (o) => pvpLeave({ confirmFirst: !!(o && o.confirm) }),
  onStartBot: (diff, game, raceTo) => enterBotMode(diff, game, raceTo),
  onStartBvb: (opts) => enterBvbMode(opts),
  onStartPractice: () => enterPracticeMode('free'),
  onBotRace: (raceTo) => {
    state.bot.raceTo = raceTo;
    syncBotUi();
    panel.toast(raceTo > 0 ? `Mục tiêu trận đấu: Chạm ${raceTo} ván thắng` : 'Chế độ Tự do (không giới hạn số ván)', 'ok');
  },
  onKeepPlaying: () => {
    state.bot.matchOver = false;
    state.bot.raceTo = 0;
    panel.setMatchWin(false);
    syncBotUi();
    panel.toast('Tiếp tục trận đấu ở chế độ Tự do', 'ok');
    startBotRack(state.bot.turn);
  },
  onBvbPause: () => {
    state.bot.paused = !state.bot.paused;
    if (state.bot.paused) {
      clearBotTimers();
      matchFx?.pauseShotClock();
      state.bot.statusText = 'Trận đấu đang tạm dừng (⏸). Nhấn Tiếp tục để chạy.';
    } else {
      matchFx?.resumeShotClock();
      state.bot.statusText = 'Tiếp tục trận đấu (▶)...';
      if (state.bot.pendingRack && !state.bot.matchOver) startBotRack(state.bot.pendingRack);
      else scheduleBotTurn();
    }
    syncBotUi();
  },
  onBvbSpeed: () => {
    state.bot.speed = state.bot.speed === 1 ? 2 : state.bot.speed === 2 ? 4 : 1;
    const speedLabel = state.bot.speed === 4 ? '4x (Siêu tốc)' : state.bot.speed === 2 ? '2x (Nhanh)' : '1x (Thực tế)';
    panel.toast(`Tốc độ Bot: ${speedLabel}`, 'ok');
    syncBotUi();
  },
  onCycleCam: () => {
    if (view !== '3d') {
      setView('3d');
    } else {
      const next = nextCameraMode(camMode);
      setCamMode(next);
      panel.toast(`🎥 Góc quay: ${CAMERA_MODE_LABEL[next] || next}`, 'ok');
    }
  },
  onToggleAimAid: () => {
    toggleAimAid();
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
        raceTo: state.bot.raceTo,
      });
      const gLabel = BOT_GAMES[state.bot.game]?.label || '9 Bi';
      const raceLabel = state.bot.raceTo > 0 ? ` (Chạm ${state.bot.raceTo})` : '';
      panel.toast(`Bắt đầu trận ${gLabel} mới: ${state.bot.bot1Name} vs ${state.bot.bot2Name}${raceLabel}`, 'ok');
    } else {
      enterBotMode(state.bot.difficulty, state.bot.game, state.bot.raceTo);
      const gLabel = BOT_GAMES[state.bot.game]?.label || '9 Bi';
      const oppLabel = state.bot.difficulty === 'hero' ? 'Hero' : 'Bot';
      const raceLabel = state.bot.raceTo > 0 ? ` (Chạm ${state.bot.raceTo})` : '';
      panel.toast(`Bắt đầu trận ${gLabel} mới với ${oppLabel}${raceLabel}`, 'ok');
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
      arcadeControls?.resize();
      invalidate({ pred: false });
    });
  },
});

function openSettingsModal() {
  const modal = document.getElementById('gameSettingsModal');
  if (!modal) return;
  modal.hidden = false;
  const equipEl = document.getElementById('settingsEquipText');
  if (equipEl && eq) {
    equipEl.textContent = `${eq.table.name} · ${eq.cue.name}`;
  }
  syncAimAidUi?.();
  syncSoundUi?.();
  syncViewUi?.();
}

function closeSettingsModal() {
  const modal = document.getElementById('gameSettingsModal');
  if (modal) modal.hidden = true;
}

arcadeControls = createArcadeControls({
  onPower: (p) => {
    state.power = p;
    sound?.cueDragTone?.(p);
    panel.syncControls({ power: p });
    syncTvShotSpecs();
    invalidate();
  },
  onShoot: () => startShot(false),
  onNudge: nudgeAim,
  onTip: (tip) => {
    if (!isPlayerReady() || state.mode === 'squirt' || state.mode === 'thickness') return;
    state.tip = tip;
    panel.spinPad?.set(tip, true);
    syncTvShotSpecs();
    invalidate();
  },
  onOpenSettings: openSettingsModal,
});

const origSetTurnLocked = panel.setTurnLocked;
panel.setTurnLocked = (locked) => {
  origSetTurnLocked(locked);
  arcadeControls?.setLocked(locked);
};

const origSetAppMode = panel.setAppMode;
panel.setAppMode = (appMode) => {
  origSetAppMode(appMode);
  arcadeControls?.setAppMode(appMode);
  syncAimAidUi();
};

const settings = createSettings({
  canChange: () => isPlayerReady() && !isPvpMode(),
  blockedMsg: () => (isPvpMode() ? 'Thiết bị cố định khi chơi online' : 'Đợi bi dừng rồi hãy đổi thiết bị'),
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
    elevation: () => ((state.mode === 'free' || (state.mode === 'bot' && !isBotTurn())) && state.phase === 'aim' ? state.elevation : null),
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
    toggleAimAid: () => toggleAimAid(),
    toggleSide: () => toggleSidePanel(),
    camHeight: (d) => (v3 ? v3.camHeight(d) : null),
    camDist: (d) => (v3 ? v3.camDist(d) : null),
    hud: () => ({
      visible: state.mode !== 'thickness' && state.mode !== 'bot',
      power: state.power,
      aimDeg: info && info.aimDir ? normAngle(deg(Math.atan2(info.aimDir.y, info.aimDir.x))) : null,
      aimMode: state.aimMode,
      tip: state.tip,
      miscue: eq.cue.miscueLimit,
      elevation: elevation(),
      elevEditable: !elevationLocked(),
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
    arcadeControls?.resize();
    invalidate({ pred: false });
  }).observe(document.getElementById('stage'));
}
window.addEventListener('resize', () => {
  resizeViews();
  arcadeControls?.resize();
  invalidate({ pred: false });
});

// share link in the hash
function loadFromHash() {
  const room = parseRoomHash(location.hash);
  if (room) {
    // invite link: open the lobby with the room code filled in
    if (!state.pvp) {
      state.lobbyOpen = true;
      panel.setLobbyOpen(true);
      panel.focusPvpLobby(room);
    }
    return true;
  }
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
  if (isAimReady() && !isPvpMode()) loadFromHash();
});

// PWA (sw.js stays at the site root so its scope covers the whole app)
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  const hadSwController = !!navigator.serviceWorker.controller;
  let swReloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadSwController || swReloading) return;
    // Match state lives only in memory: never reload in the middle of a match or a shot.
    // The new version is picked up on the next visit (the worker is network-first).
    if (state.phase !== 'aim' || strokePending || (isBotMode() && !state.lobbyOpen && !state.bot.matchOver)) {
      panel.toast('Đã có bản cập nhật — sẽ áp dụng ở lần mở app tiếp theo', 'ok');
      return;
    }
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
matchFx = createMatchFx({ sound, onTimeout: handleShotTimeout });

function syncSoundUi() {
  const on = sound.isEnabled();
  if (soundBtn) {
    soundBtn.setAttribute('aria-pressed', String(on));
    soundBtn.textContent = on ? '🔊' : '🔇';
    soundBtn.title = on ? 'Tắt âm thanh (phím M)' : 'Bật âm thanh (phím M)';
  }
  const soundSettingsBtn = document.getElementById('btnSettingsSound');
  if (soundSettingsBtn) {
    soundSettingsBtn.setAttribute('aria-pressed', String(on));
    soundSettingsBtn.textContent = on ? '🔊 Đang bật' : '🔇 Đã tắt';
    soundSettingsBtn.className = `btn small ${on ? 'primary' : ''}`;
  }
}

function toggleTvCompact() {
  const sb = document.getElementById('tvScoreboard');
  const btn = document.getElementById('btnToggleTvCompact');
  if (sb) {
    const isComp = sb.classList.toggle('is-compact');
    if (btn) btn.textContent = isComp ? '▲' : '▼';
    if (btn) btn.title = isComp ? 'Mở rộng bảng điểm (phím T)' : 'Thu gọn bảng điểm (phím T)';
  }
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
    return;
  }
  if (e.key === 't' || e.key === 'T') {
    e.preventDefault();
    toggleTvCompact();
    return;
  }
  if (e.key === 'Escape') {
    const sModal = document.getElementById('gameSettingsModal');
    if (sModal && !sModal.hidden) {
      closeSettingsModal();
      return;
    }
  }
  if (e.key === 'o' || e.key === 'O') {
    e.preventDefault();
    const sModal = document.getElementById('gameSettingsModal');
    if (sModal && !sModal.hidden) closeSettingsModal();
    else openSettingsModal();
    return;
  }
});
syncSoundUi();

const viewBtns = [...document.querySelectorAll('[data-view]')];
const camBtns = [...document.querySelectorAll('[data-cam]')];
const qualBtns = [...document.querySelectorAll('[data-q3d]')];
const opts3d = document.getElementById('v3opts');
const load3d = document.getElementById('v3load');

function syncAimAidUi() {
  const isPractice = state.appMode === 'practice';
  const on = isPractice && state.aimAid !== false;
  const btnView = document.getElementById('btnViewAimAid');
  if (btnView) {
    btnView.hidden = !isPractice;
    btnView.setAttribute('aria-pressed', String(on));
    btnView.textContent = on ? '🎯 Tia ngắm' : '👁️ Thực tế';
    btnView.title = on
      ? 'Đang bật tia ngắm hỗ trợ (phím L để tắt sang Góc nhìn thực tế)'
      : 'Đang ở góc nhìn thực tế - không tia ngắm (phím L để bật lại tia ngắm)';
    btnView.classList.toggle('realistic-mode', !on);
  }
  const btnBvbAim = document.getElementById('btnBvbAimAid');
  if (btnBvbAim) {
    btnBvbAim.hidden = true;
  }
  const lobbyBvbAim = document.getElementById('lobbyBvbAimAid');
  if (lobbyBvbAim) {
    const parent = lobbyBvbAim.closest('.lobby-aim-aid-toggle');
    if (parent) parent.hidden = true;
  }
  const lobbyBotAim = document.getElementById('lobbyBotAimAid');
  if (lobbyBotAim) {
    const parent = lobbyBotAim.closest('.lobby-aim-aid-toggle');
    if (parent) parent.hidden = true;
  }
  const btnSettingsAim = document.getElementById('btnSettingsAimAid');
  const settingsAimSec = document.getElementById('settingsAimAidSec');
  if (settingsAimSec) settingsAimSec.hidden = !isPractice;
  if (btnSettingsAim) {
    btnSettingsAim.setAttribute('aria-pressed', String(on));
    btnSettingsAim.textContent = on ? '🎯 Đang Bật' : '👁️ Đang Tắt (Thực tế)';
    btnSettingsAim.className = `btn small ${on ? 'primary' : ''}`;
  }
}

function toggleAimAid() {
  if (state.appMode !== 'practice') return false;
  state.aimAid = state.aimAid === false ? true : false;
  lsWrite('bida9-aim-aid', state.aimAid ? '1' : '0');
  predDirty = true;
  infoDirty = true;
  syncAimAidUi();
  panel.toast(state.aimAid ? '🎯 Đã bật tia ngắm hỗ trợ' : '👁️ Chế độ thực tế (Đã tắt tia ngắm)', 'ok');
  invalidate();
  return state.aimAid;
}

function toggleSidePanel() {
  const sideEl = document.querySelector('.side');
  const backdrop = document.getElementById('sideDrawerBackdrop');
  const isOpen = !sideEl?.classList.contains('is-open');
  sideEl?.classList.toggle('is-open', isOpen);
  backdrop?.classList.toggle('is-open', isOpen);
  const btn = document.getElementById('btnToggleSide');
  if (btn) {
    const isPractice = state.appMode === 'practice';
    btn.textContent = isOpen ? '✕ Đóng' : (isPractice ? '🧪 Bảng Lab' : '⚙️ Menu');
    btn.setAttribute('aria-pressed', String(isOpen));
    btn.title = isOpen
      ? 'Đóng bảng điều khiển bên phải (phím B)'
      : 'Mở bảng điều khiển bên phải (phím B)';
  }
  resizeViews();
  panel.resize();
  arcadeControls?.resize();
  invalidate({ pred: false });
  panel.toast(isOpen ? '📊 Đã mở bảng điều khiển & thông số' : '📺 Đã đóng bảng điều khiển (Toàn màn hình)', 'ok');
  return isOpen;
}

function syncViewUi() {
  const curView = v3 ? view : desiredView;
  for (const b of viewBtns) b.setAttribute('aria-pressed', String(b.dataset.view === curView));
  for (const b of camBtns) b.setAttribute('aria-pressed', String(b.dataset.cam === camMode));
  const q = v3 ? v3.getQuality() : quality3d || 'high';
  for (const b of qualBtns) b.setAttribute('aria-pressed', String(b.dataset.q3d === q));
  const btnBvbCam = document.getElementById('btnBvbCam');
  if (btnBvbCam) {
    const lbl = CAMERA_MODE_LABEL[camMode] || 'Tự động';
    btnBvbCam.textContent = `🎥 Camera: ${lbl}`;
    btnBvbCam.title = `Góc quay 3D hiện tại: ${lbl}. Bấm để chuyển (Tự động / Quay TV / Theo bi / Cố định)`;
  }
  const btnToggleSide = document.getElementById('btnToggleSide');
  if (btnToggleSide) {
    const sideEl = document.querySelector('.side');
    const isOpen = sideEl?.classList.contains('is-open');
    const isPractice = state.appMode === 'practice';
    btnToggleSide.textContent = isOpen ? '✕ Đóng' : (isPractice ? '🧪 Bảng Lab' : '⚙️ Menu');
    btnToggleSide.setAttribute('aria-pressed', String(isOpen));
  }
  syncAimAidUi();
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
  desiredView = next;
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
      desiredView = '2d';
      lsWrite('bida9-view', '2d');
      syncViewUi();
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
  if (opts3d) opts3d.hidden = !is3;
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
document.getElementById('btnViewAimAid')?.addEventListener('click', toggleAimAid);
document.getElementById('btnToggleSide')?.addEventListener('click', toggleSidePanel);
miniCanvas.addEventListener('click', () => setView('2d'));

document.getElementById('btnToggleTvCompact')?.addEventListener('click', toggleTvCompact);
document.getElementById('btnTopSettings')?.addEventListener('click', openSettingsModal);
document.getElementById('btnOpenLobby')?.addEventListener('click', () => panel.setLobbyOpen(true));
document.getElementById('btnCloseSettings')?.addEventListener('click', closeSettingsModal);
document.getElementById('settingsBackdrop')?.addEventListener('click', closeSettingsModal);
document.getElementById('btnOpenEquipSheet')?.addEventListener('click', () => {
  closeSettingsModal();
  document.getElementById('equipChip')?.click();
});
document.getElementById('btnSettingsAimAid')?.addEventListener('click', toggleAimAid);
document.getElementById('btnSettingsSound')?.addEventListener('click', () => {
  const on = sound.toggle();
  panel.toast(on ? 'Đã bật âm thanh' : 'Đã tắt âm thanh');
});
document.getElementById('btnSettingsOpenLab')?.addEventListener('click', () => {
  closeSettingsModal();
  toggleSidePanel();
});
document.getElementById('btnSettingsOpenLobby')?.addEventListener('click', () => {
  closeSettingsModal();
  panel.setLobbyOpen(true);
});

syncViewUi();

/* ------------------------------------------------------------------ start */

eq = settings.get();
eqKey = physicsEquipmentKey(eq);
geo = buildTable(eq.table);
renderer.setTable(geo, eq.table);
panel.spinPad.setMiscueLimit(eq.cue.miscueLimit);
defaultLayout();
let roomFromHash = parseRoomHash(location.hash);
if (roomFromHash) {
  const saved = loadSession();
  if (saved && saved.code === roomFromHash) {
    // reload of a tab that joined through this invite link: resume the match instead of asking to join again
    roomFromHash = null;
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {
      /* ignore */
    }
  } else {
    try {
      sessionStorage.removeItem(SESSION_KEY); // an invite link to another room replaces any older session of this tab
    } catch (e) {
      /* ignore */
    }
  }
}
const resumingRoom = !roomFromHash && pvpTryResume();
if (roomFromHash || resumingRoom || !loadFromHash()) {
  panel.setAppMode('practice');
  panel.refreshTray((id) => !!ball(id));
  state.lobbyOpen = true;
  panel.setLobbyOpen(true);
  if (roomFromHash) panel.focusPvpLobby(roomFromHash);
  syncPottedUi();
}
syncControls();
panel.updateStats(stats);
renderer.resize();
initDraggableHud();
invalidate();
if (desiredView === '3d') setView('3d');
