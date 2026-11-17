// 9-ball match rules and AI Bot solver/decision logic. Pure module (no DOM).
import { R } from '../core/table.js';
import { computeShot, isPathBlocked, effectiveCueElevationDeg } from '../core/geometry.js';
import { solveAim } from '../core/aim-solver.js';
import { simulate, DEFAULT_ELEVATION_DEG } from '../core/physics.js';
import { sub, scale, dot, dist, norm, rotate, rad, clamp } from '../core/vec.js';

export const BOT_DIFFICULTIES = {
  easy: {
    id: 'easy',
    label: 'Dễ',
    shortLabel: 'Dễ',
    desc: 'Tia ngắm cơ bản + bi ma · Bot ngắm lệch nhẹ',
    aimJitterDeg: 2.8,
    safeJitterScale: 1.35,
    breakPower: 0.84,
    useSolveAim: false,
    useSpin: false,
    proSpin: false,
    checkScratch: false,
    playerAid: { aim: true, ghost: true, pocket: true, tangent: false, objLineLen: 500, maxAimLen: 4000, simpleAim: false },
  },
  medium: {
    id: 'medium',
    label: 'Trung bình',
    shortLabel: 'TB',
    desc: 'Bi ma + tia bi ngắn · Bot bù squirt & né lỗi',
    aimJitterDeg: 1.15,
    safeJitterScale: 0.75,
    breakPower: 0.88,
    useSolveAim: true,
    useSpin: false,
    proSpin: false,
    checkScratch: true,
    playerAid: { aim: true, ghost: true, pocket: true, tangent: false, objLineLen: 170, maxAimLen: 4000, simpleAim: false },
  },
  hard: {
    id: 'hard',
    label: 'Khó',
    shortLabel: 'Khó',
    desc: 'Chỉ tia ngắm vừa · Bot ngắm chắc & điều bi',
    aimJitterDeg: 0.32,
    safeJitterScale: 0.4,
    breakPower: 0.9,
    useSolveAim: true,
    useSpin: true,
    proSpin: false,
    checkScratch: true,
    playerAid: { aim: true, ghost: false, pocket: false, tangent: false, objLineLen: 0, maxAimLen: 550, simpleAim: true },
  },
  pro: {
    id: 'pro',
    label: 'Cao thủ',
    shortLabel: 'Pro',
    desc: 'Tia gậy ngắn thực chiến · Bot chuẩn & điều bi sâu',
    aimJitterDeg: 0.08,
    safeJitterScale: 0.15,
    breakPower: 0.92,
    useSolveAim: true,
    useSpin: true,
    proSpin: true,
    checkScratch: true,
    playerAid: { aim: true, ghost: false, pocket: false, tangent: false, objLineLen: 0, maxAimLen: 200, simpleAim: true },
  },
  hero: {
    id: 'hero',
    label: 'Hero (Tự học)',
    shortLabel: 'Hero',
    desc: 'Tự động học hỏi & nâng cấp kỹ năng sau từng cú đánh · Tiến hóa không giới hạn · Kỹ năng Nhảy bi & Massé',
    aimJitterDeg: 0.06,
    safeJitterScale: 0.15,
    breakPower: 0.93,
    useSolveAim: true,
    useSpin: true,
    proSpin: true,
    checkScratch: true,
    canJump: true,
    canMasse: true,
    playerAid: { aim: true, ghost: false, pocket: false, tangent: false, objLineLen: 0, maxAimLen: 140, simpleAim: true },
  },
};

export const HERO_DEFAULT_PROFILE = {
  name: 'Hero',
  xp: 22000,
  level: 13,
  totalShots: 6929,
  pots: 4731,
  misses: 2706,
  fouls: 1286,
  scratches: 985,
  racksWon: 589,
  racksLost: 1833,
  runOuts: 65,
  goldenBreaks: 17,
  jumpShots: 0,
  masseShots: 0,
  canJump: true,
  canMasse: true,
  aimJitterDeg: 0.06,
  safeJitterScale: 0.15,
  breakPower: 0.93,
  useSolveAim: true,
  useSpin: true,
  proSpin: true,
  checkScratch: true,
};

let memoryHeroProfile = null;

export function loadHeroProfile() {
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem('bida9-hero-profile');
      if (raw) {
        const parsed = JSON.parse(raw);
        return { ...HERO_DEFAULT_PROFILE, ...parsed };
      }
    } catch (e) {
      // fallback
    }
  }
  return memoryHeroProfile ? { ...memoryHeroProfile } : { ...HERO_DEFAULT_PROFILE };
}

export function saveHeroProfile(profile) {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('bida9-hero-profile', JSON.stringify(profile));
    } catch (e) {}
  }
  memoryHeroProfile = { ...profile };
}

export function recordHeroProgress(event, details = {}, currentProfile = null) {
  const p = currentProfile ? { ...currentProfile } : loadHeroProfile();
  const oldLevel = p.level || Math.floor(Math.sqrt((p.xp || 0) / 120)) + 1;

  if (event === 'shot') {
    p.totalShots = (p.totalShots || 0) + 1;
    p.xp = (p.xp || 0) + 1.0;
  } else if (event === 'pot') {
    const cnt = details.count || 1;
    p.pots = (p.pots || 0) + cnt;
    p.xp = (p.xp || 0) + 2.5 * cnt;
  } else if (event === 'miss') {
    p.misses = (p.misses || 0) + 1;
  } else if (event === 'foul') {
    p.fouls = (p.fouls || 0) + 1;
    if (details.scratch) p.scratches = (p.scratches || 0) + 1;
    p.xp = (p.xp || 0) + 1.5;
  } else if (event === 'rack_win') {
    p.racksWon = (p.racksWon || 0) + 1;
    p.xp = (p.xp || 0) + 6.0;
  } else if (event === 'rack_lost') {
    p.racksLost = (p.racksLost || 0) + 1;
    p.xp = (p.xp || 0) + 2.0;
  } else if (event === 'run_out') {
    p.runOuts = (p.runOuts || 0) + 1;
    p.xp = (p.xp || 0) + 12.0;
  } else if (event === 'golden_break') {
    p.goldenBreaks = (p.goldenBreaks || 0) + 1;
    p.xp = (p.xp || 0) + 10.0;
  } else if (event === 'jump_shot') {
    p.jumpShots = (p.jumpShots || 0) + 1;
    p.xp = (p.xp || 0) + 4.0;
  } else if (event === 'masse_shot') {
    p.masseShots = (p.masseShots || 0) + 1;
    p.xp = (p.xp || 0) + 5.0;
  }

  const xpDelta = Math.max(0, p.xp - 22000);
  p.aimJitterDeg = Math.max(0.015, Math.round((0.015 + (0.06 - 0.015) * Math.exp(-xpDelta / 8000)) * 1000) / 1000);
  p.safeJitterScale = Math.max(0.06, Math.round((0.06 + (0.15 - 0.06) * Math.exp(-xpDelta / 8000)) * 1000) / 1000);
  p.breakPower = Math.min(0.96, Math.round((0.93 + (0.96 - 0.93) * (1 - Math.exp(-xpDelta / 8000))) * 1000) / 1000);
  p.useSolveAim = true;
  p.useSpin = true;
  p.proSpin = true;
  p.checkScratch = true;

  const newLevel = Math.floor(Math.sqrt(p.xp / 120)) + 1;
  p.level = newLevel;

  saveHeroProfile(p);

  return {
    profile: p,
    leveledUp: newLevel > oldLevel,
    oldLevel,
    newLevel,
    aimJitter: p.aimJitterDeg,
  };
}

export const BOT_GAMES = {
  '9ball': { id: '9ball', label: '9 Bi', rackSize: 9 },
  '8ball': { id: '8ball', label: '8 Bi', rackSize: 15 },
};

export function botAidFor(difficulty) {
  return (BOT_DIFFICULTIES[difficulty] || BOT_DIFFICULTIES.medium).playerAid;
}

export function ballGroup(id) {
  if (id >= 1 && id <= 7) return 'solids';
  if (id >= 9 && id <= 15) return 'stripes';
  if (id === 8) return '8ball';
  return null;
}

/**
 * Legal target ball IDs in 8-ball for `group` ('solids' | 'stripes' | null for open table).
 */
export function eightBallTargetIds(balls, group = null) {
  const active = balls.filter((b) => b.id > 0 && !b.potted);
  if (group === 'solids') {
    const solids = active.filter((b) => b.id >= 1 && b.id <= 7).map((b) => b.id);
    if (solids.length) return solids;
    return active.some((b) => b.id === 8) ? [8] : [];
  }
  if (group === 'stripes') {
    const stripes = active.filter((b) => b.id >= 9 && b.id <= 15).map((b) => b.id);
    if (stripes.length) return stripes;
    return active.some((b) => b.id === 8) ? [8] : [];
  }
  const open = active.filter((b) => b.id !== 8).map((b) => b.id);
  if (open.length) return open;
  return active.some((b) => b.id === 8) ? [8] : [];
}

export function lowestBallId(balls) {
  let minId = Infinity;
  for (const b of balls) {
    if (b.id > 0 && !b.potted && b.id < minId) minId = b.id;
  }
  return minId === Infinity ? null : minId;
}

function isOverlap(p, balls, ignoreIds = [], minGap = 2 * R + 1.5) {
  for (const b of balls) {
    if (b.potted || ignoreIds.includes(b.id)) continue;
    if (dist(p, b.pos) < minGap) return true;
  }
  return false;
}

/**
 * Find the nearest free spot to `point` on the table (or along/around foot spot).
 */
export function findFreeSpotNear(point, balls, geo, opts = {}) {
  const ignoreIds = opts.ignoreIds || [];
  const minX = opts.minX ?? R + 2;
  const maxX = opts.maxX ?? geo.W - R - 2;
  const minY = opts.minY ?? R + 2;
  const maxY = opts.maxY ?? geo.H - R - 2;
  const clampSpot = (p) => ({
    x: clamp(p.x, minX, maxX),
    y: clamp(p.y, minY, maxY),
  });

  const base = clampSpot(point);
  if (!isOverlap(base, balls, ignoreIds)) return base;

  // WPA respot prefers stepping straight backward toward the foot rail first
  for (let step = 8; step <= geo.W / 3; step += 8) {
    const p = clampSpot({ x: base.x + step, y: base.y });
    if (!isOverlap(p, balls, ignoreIds)) return p;
  }

  for (let r = R * 0.6; r <= Math.max(geo.W, geo.H); r += R * 0.55) {
    const steps = 16;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const p = clampSpot({ x: base.x + Math.cos(a) * r, y: base.y + Math.sin(a) * r });
      if (!isOverlap(p, balls, ignoreIds)) return p;
    }
  }
  return base;
}

/**
 * Evaluate a completed 9-ball turn purely from initial balls, ending simBalls, and events.
 */
export function evaluateNineBallTurn({ ballsBefore, simBalls, events, geo }) {
  const lowestId = lowestBallId(ballsBefore);
  const potted = events?.potted || [];
  const cuePotted = potted.includes(0);
  const pottedObj = potted.filter((id) => id !== 0);
  const ninePotted = potted.includes(9);
  const firstContact = events?.firstContact ?? null;

  const firstContactEv = (events?.contacts || []).find((c) => c.a === 0 || c.b === 0);
  const firstTime = firstContactEv ? firstContactEv.time : 0;
  const hasCushionAfter = (events?.cushionHits || []).some((ch) => ch.time >= firstTime - 1e-6);

  const offTable = events?.offTable || [];
  let foulReason = '';
  if (cuePotted && !offTable.includes(0)) {
    foulReason = 'Bi cái rơi lỗ (Scratch)';
  } else if (offTable.length) {
    foulReason = 'Bi bay khỏi bàn';
  } else if (firstContact === null) {
    foulReason = 'Không chạm bi mục tiêu';
  } else if (lowestId !== null && firstContact !== lowestId) {
    foulReason = `Chạm sai bi (phải đánh bi ${lowestId})`;
  } else if (pottedObj.length === 0 && !hasCushionAfter) {
    foulReason = 'Không chạm băng sau khi chạm bi';
  }

  const foul = Boolean(foulReason);
  const winRack = !foul && ninePotted;
  const respotNine = foul && ninePotted;
  const respotPos = respotNine
    ? findFreeSpotNear(geo.FOOT_SPOT, simBalls, geo, { ignoreIds: [0, 9] })
    : null;
  const keepTurn = !foul && pottedObj.length > 0 && !ninePotted;

  return {
    foul,
    foulReason,
    winRack,
    respotNine,
    respotPos,
    keepTurn,
    ballInHand: foul && !winRack,
    lowestId,
    pottedObj,
    cuePotted,
    ninePotted,
    offTable,
  };
}

/**
 * Evaluate a completed 8-ball turn (open table until a legal non-break pot claims solids or stripes).
 */
export function evaluateEightBallTurn({ ballsBefore, simBalls, events, turn, groups, onBreak = false, geo }) {
  const shooterGroup = groups?.[turn] || null;
  const legalBefore = eightBallTargetIds(ballsBefore, shooterGroup);
  const onEight = !onBreak && legalBefore.length === 1 && legalBefore[0] === 8;

  const potted = events?.potted || [];
  const cuePotted = potted.includes(0);
  const eightPotted = potted.includes(8);
  const pottedObj = potted.filter((id) => id !== 0);
  const firstContact = events?.firstContact ?? null;

  const firstContactEv = (events?.contacts || []).find((c) => c.a === 0 || c.b === 0);
  const firstTime = firstContactEv ? firstContactEv.time : 0;
  const hasCushionAfter = (events?.cushionHits || []).some((ch) => ch.time >= firstTime - 1e-6);

  const offTable = events?.offTable || [];
  let foulReason = '';
  if (cuePotted && !offTable.includes(0)) {
    foulReason = 'Bi cái rơi lỗ (Scratch)';
  } else if (offTable.length) {
    foulReason = 'Bi bay khỏi bàn';
  } else if (firstContact === null) {
    foulReason = 'Không chạm bi mục tiêu';
  } else if (!onBreak && shooterGroup === null && firstContact === 8) {
    foulReason = 'Bàn đang mở, chưa được đánh bi 8 trước';
  } else if (!onBreak && shooterGroup !== null && !legalBefore.includes(firstContact)) {
    const label = shooterGroup === 'solids' ? 'bi trơn 1–7' : shooterGroup === 'stripes' ? 'bi sọc 9–15' : 'bi 8';
    foulReason = `Chạm sai nhóm bi (phải đánh ${label})`;
  } else if (!onBreak && pottedObj.length === 0 && !hasCushionAfter) {
    foulReason = 'Không chạm băng sau khi chạm bi';
  }

  const foul = Boolean(foulReason);
  const isBvb = turn === 'bot1' || turn === 'bot2';
  const opp = isBvb ? (turn === 'bot1' ? 'bot2' : 'bot1') : (turn === 'player' ? 'bot' : 'player');
  const nextGroups = isBvb
    ? { bot1: groups?.bot1 || null, bot2: groups?.bot2 || null }
    : { player: groups?.player || null, bot: groups?.bot || null };

  let winRack = false;
  let loseRack = false;
  let respotEight = false;
  let respotPos = null;

  if (onBreak) {
    if (eightPotted) {
      if (foul) {
        respotEight = true;
        respotPos = findFreeSpotNear(geo.FOOT_SPOT, simBalls, geo, { ignoreIds: [0, 8] });
      } else {
        winRack = true;
      }
    }
  } else {
    if (eightPotted) {
      if (onEight && !foul) {
        winRack = true;
      } else {
        loseRack = true;
        if (!foulReason) foulReason = 'Bi 8 rơi lỗ sớm — thua ván';
      }
    } else if (!foul && shooterGroup === null) {
      const solidsIn = pottedObj.some((id) => id >= 1 && id <= 7);
      const stripesIn = pottedObj.some((id) => id >= 9 && id <= 15);
      if (solidsIn && !stripesIn) {
        nextGroups[turn] = 'solids';
        nextGroups[opp] = 'stripes';
      } else if (stripesIn && !solidsIn) {
        nextGroups[turn] = 'stripes';
        nextGroups[opp] = 'solids';
      } else if (solidsIn && stripesIn) {
        const g = ballGroup(firstContact);
        if (g === 'solids' || g === 'stripes') {
          nextGroups[turn] = g;
          nextGroups[opp] = g === 'solids' ? 'stripes' : 'solids';
        }
      }
    }
  }

  const myNextGroup = nextGroups[turn];
  const keepTurn = !foul && !winRack && !loseRack && (
    onBreak
      ? pottedObj.some((id) => id !== 8)
      : myNextGroup
        ? pottedObj.some((id) => ballGroup(id) === myNextGroup)
        : pottedObj.some((id) => id !== 8)
  );

  return {
    foul,
    foulReason,
    winRack,
    loseRack,
    respotEight,
    respotPos,
    keepTurn,
    ballInHand: foul && !winRack && !loseRack,
    nextGroups,
    assignedGroup: !onBreak && !foul && !eightPotted && shooterGroup === null && nextGroups[turn] ? nextGroups[turn] : null,
    pottedObj,
    cuePotted,
    eightPotted,
    offTable,
  };
}

/**
 * Score geometric clear-pot candidates from a given cue position.
 */
function scorePocketCandidates(cuePos, balls, target, geo) {
  const targetId = target.id;
  const out = [];
  for (let i = 0; i < geo.POCKETS.length; i++) {
    const pocket = geo.POCKETS[i];
    const aimPt = pocket.aim || pocket;
    const shot = computeShot(cuePos, target.pos, aimPt, R);
    if (!shot.possible || shot.cutAngleDeg > 76) continue;

    // Require object ball trajectory into pocket jaw mouth (respecting minCos)
    const entryCos = -(shot.objDir.x * pocket.axis.x + shot.objDir.y * pocket.axis.y);
    if (entryCos < (pocket.minCos ?? 0.2)) continue;

    if (isPathBlocked(cuePos, shot.ghost, balls, R, [0, targetId]) !== null) continue;
    if (isPathBlocked(target.pos, aimPt, balls, R, [0, targetId]) !== null) continue;
    if (isOverlap(shot.ghost, balls, [0, targetId], 2 * R + 1)) continue;

    const dCue = dist(cuePos, shot.ghost);
    const dObj = dist(target.pos, aimPt);
    const cutScore = Math.cos(rad(shot.cutAngleDeg));
    const entryScore = clamp((entryCos - 0.15) / 0.85, 0, 1);
    const distScore = clamp(1 - (dCue + dObj) / (geo.W * 1.55), 0.12, 1);
    const score = cutScore * 0.55 + distScore * 0.3 + entryScore * 0.15;

    out.push({
      pocketIdx: i,
      pocket,
      aimPt,
      shot,
      dCue,
      dObj,
      score,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/**
 * Choose an optimal cue ball placement when Bot has ball-in-hand (or onBreak behind HEAD_X).
 * `targetOrIds` may be a single target id (9-ball) or an array of legal target ids (8-ball).
 */
export function placeCueBallForBot(balls, targetOrIds, geo, eq, onBreak = false) {
  if (onBreak) {
    return findFreeSpotNear({ x: geo.HEAD_X - 2, y: geo.H / 2 + 12 }, balls, geo, {
      ignoreIds: [0],
      minX: R + 4,
      maxX: geo.HEAD_X,
    });
  }

  const idList = Array.isArray(targetOrIds) ? targetOrIds : [targetOrIds];
  const targets = idList.map((id) => balls.find((b) => b.id === id && !b.potted)).filter(Boolean);
  if (!targets.length) {
    return findFreeSpotNear(geo.HEAD_SPOT, balls, geo, { ignoreIds: [0] });
  }

  const candidates = [];
  // Primary candidates: lines behind ghost balls toward open pockets (cap targets to keep search snappy)
  for (const tgt of targets.slice(0, 4)) {
    for (const pocket of geo.POCKETS) {
      const aimPt = pocket.aim || pocket;
      const shot = computeShot(geo.HEAD_SPOT, tgt.pos, aimPt, R);
      for (const d of [180, 280, 420]) {
        candidates.push({
          x: shot.ghost.x - shot.objDir.x * d,
          y: shot.ghost.y - shot.objDir.y * d,
        });
      }
    }
  }
  // Fallback grid across table
  for (let gx = 1; gx <= 5; gx++) {
    for (let gy = 1; gy <= 3; gy++) {
      candidates.push({ x: (geo.W * gx) / 6, y: (geo.H * gy) / 4 });
    }
  }

  let bestPos = null;
  let bestVal = -Infinity;
  for (const raw of candidates) {
    const p = {
      x: clamp(raw.x, R + 6, geo.W - R - 6),
      y: clamp(raw.y, R + 6, geo.H - R - 6),
    };
    if (isOverlap(p, balls, [0], 2 * R + 3)) continue;

    let bestForP = -1;
    for (const tgt of targets) {
      const shots = scorePocketCandidates(p, balls, tgt, geo);
      const val = shots.length
        ? shots[0].score + 1
        : isPathBlocked(p, tgt.pos, balls, R, [0, tgt.id]) === null
          ? 0.25 - dist(p, tgt.pos) / (geo.W * 4)
          : -1;
      if (val > bestForP) bestForP = val;
    }
    if (bestForP > bestVal) {
      bestVal = bestForP;
      bestPos = p;
    }
  }

  return bestPos || findFreeSpotNear(geo.HEAD_SPOT, balls, geo, { ignoreIds: [0] });
}

function findNextTarget(balls, currentId, game = '9ball', group = null) {
  if (game === '8ball') {
    if (currentId === 8) return null;
    const ids = eightBallTargetIds(balls, group).filter((id) => id !== currentId && id !== 8);
    if (ids.length) return balls.find((b) => b.id === ids[0]) || null;
    return balls.find((b) => b.id === 8 && !b.potted) || null;
  }
  let minId = Infinity;
  for (const b of balls) {
    if (b.id > currentId && !b.potted && b.id < minId) minId = b.id;
  }
  return minId === Infinity ? null : balls.find((b) => b.id === minId) || null;
}

/**
 * Evaluate final resting state quickly to score scratch/early-8 safety + next-ball leave.
 */
function probeOutcome(balls, aimDir, power, tip, elevationDeg, targetId, nextTarget, geo, eq, avoidEight = false) {
  const res = simulate(
    balls,
    { aimDir, power, tip, elevationDeg },
    { table: eq.table, cue: eq.cue, rng: () => 0.5, orientation: false, recordPaths: false },
  );
  const cuePotted = res.events.potted.includes(0) || res.events.offTable.length > 0;
  const objPotted = res.events.potted.includes(targetId);
  const earlyEight = avoidEight && res.events.potted.includes(8);
  let posScore = 0;
  if (nextTarget) {
    const cueAfter = res.balls.find((b) => b.id === 0);
    const nextAfter = res.balls.find((b) => b.id === nextTarget.id);
    if (cueAfter && !cueAfter.potted && nextAfter && !nextAfter.potted) {
      const nextPockets = scorePocketCandidates(cueAfter.pos, res.balls, nextAfter, geo);
      posScore = nextPockets.length ? nextPockets[0].score : 0;
    }
  }
  return { cuePotted, objPotted, earlyEight, posScore, firstContact: res.events.firstContact };
}

/**
 * Find a legal contact (direct thin edge or 1-rail kick) when snookered.
 * Uses analytic 1-rail mirror reflections + edge sweeps with full cushion simulation
 * (since `Sim.runToContact` stops on the first cushion hit).
 */
function findKickOrSafeShot(balls, cue, target, eq, geo) {
  const baseAng = Math.atan2(target.pos.y - cue.pos.y, target.pos.x - cue.pos.x);
  const rng0 = () => 0.5;
  const candidateAngles = [];

  // 1. Analytic 1-rail mirror points + small offsets (avoids side pocket mouths & accounts for throw/spin)
  const mirrors = [
    { x: target.pos.x, y: 2 * R - target.pos.y },
    { x: target.pos.x, y: 2 * (geo.H - R) - target.pos.y },
    { x: 2 * R - target.pos.x, y: target.pos.y },
    { x: 2 * (geo.W - R) - target.pos.x, y: target.pos.y },
  ];
  for (const m of mirrors) {
    const a = Math.atan2(m.y - cue.pos.y, m.x - cue.pos.x);
    for (const off of [0, -1.2, 1.2, -2.5, 2.5, -4, 4]) candidateAngles.push(a + rad(off));
  }

  // 2. Direct / thin grazing angles around blockers
  for (const off of [-22, -16, -11, -7, -4, 4, 7, 11, 16, 22]) {
    candidateAngles.push(baseAng + rad(off));
  }

  let best = null;
  let bestScore = -Infinity;

  const evalAngle = (a) => {
    const dir = { x: Math.cos(a), y: Math.sin(a) };
    const elev = effectiveCueElevationDeg(DEFAULT_ELEVATION_DEG, cue.pos, dir, { x: 0, y: 0 }, geo, { pull: 170, balls });
    const res = simulate(
      balls,
      { aimDir: dir, power: 0.62, tip: { x: 0, y: 0 }, elevationDeg: elev },
      { table: eq.table, cue: eq.cue, rng: rng0, orientation: false, recordPaths: false, maxTime: 3.5 },
    );
    if (res.events.firstContact !== target.id) return false;
    const cuePotted = res.events.potted.includes(0) || res.events.offTable.length > 0;
    const firstEv = (res.events.contacts || []).find((c) => c.a === 0 || c.b === 0);
    const t0 = firstEv ? firstEv.time : 0;
    const cushionOk =
      res.events.potted.some((id) => id !== 0) ||
      res.events.cushionHits.some((ch) => ch.time >= t0 - 1e-6);

    let sc = 0;
    if (cuePotted) sc -= 10;
    if (!cushionOk) sc -= 4;
    if (res.events.potted.includes(target.id)) sc += 3;
    const cueEnd = res.balls.find((b) => b.id === 0);
    const tgtEnd = res.balls.find((b) => b.id === target.id);
    if (cueEnd && tgtEnd && !cueEnd.potted && !tgtEnd.potted) {
      sc += Math.min(dist(cueEnd.pos, tgtEnd.pos) / geo.W, 1) * 0.5;
    }
    if (sc > bestScore) {
      bestScore = sc;
      best = dir;
    }
    return sc > -1;
  };

  for (const a of candidateAngles) {
    if (evalAngle(a) && bestScore >= 0) break;
  }

  // Fallback fine 3-degree sweep if all targeted mirror/edge shots missed
  if (!best) {
    for (let i = 0; i < 120; i++) {
      const a = baseAng + (i / 120) * Math.PI * 2;
      if (evalAngle(a)) break;
    }
  }

  return best || norm(sub(target.pos, cue.pos));
}

/**
 * A trick shot is accepted only when the cue ball reaches the legal target directly: first contact is the target,
 * no cue-ball cushion before it, the blocker is not in any contact before it, no scratch, nothing leaves the table.
 */
function reachesTargetDirectly(res, targetId, blockerId) {
  const ev = res.events;
  if (ev.firstContact !== targetId) return false;
  if (ev.potted.includes(0) || ev.offTable.length) return false;
  const first = ev.contacts.find((c) => c.a === 0 || c.b === 0);
  if (!first || (first.a !== targetId && first.b !== targetId)) return false;
  const t0 = first.time;
  if (ev.cushionHits.some((ch) => ch.id === 0 && ch.time < t0 - 1e-9)) return false;
  if (ev.contacts.some((c) => c.time <= t0 + 1e-9 && (c.a === blockerId || c.b === blockerId))) return false;
  return true;
}

const pocketIdxOf = (res, targetId) => {
  const d = res.events.drops.find((x) => x.id === targetId);
  return d ? d.pocketId : -1;
};

/**
 * Find a jumping stroke over an obstacle ball to hit a legal target.
 * Used by Hero bot when direct trajectory is blocked. Uses the real launch model (steep cue, firm stroke).
 */
export function findJumpShot(balls, cue, legalTargets, eq, geo) {
  const rng0 = () => 0.5;
  let best = null;
  let bestScore = -Infinity;

  for (const tgt of legalTargets) {
    const blockerId = isPathBlocked(cue.pos, tgt.pos, balls, R, [0, tgt.id]);
    if (blockerId === null) continue;
    const blocker = balls.find((b) => b.id === blockerId);
    if (!blocker) continue;

    const dBlocker = dist(cue.pos, blocker.pos);
    const dTarget = dist(cue.pos, tgt.pos);
    if (dBlocker < 80 || dBlocker >= dTarget - 2 * R) continue;

    const candidateDirs = [norm(sub(tgt.pos, cue.pos))];
    if (geo?.POCKETS) {
      for (const pocket of geo.POCKETS) {
        const aimPt = pocket.aim || pocket;
        const shot = computeShot(cue.pos, tgt.pos, aimPt, R);
        if (shot.possible && shot.cutAngleDeg <= 60) {
          candidateDirs.push(shot.aimDir);
        }
      }
    }

    const allDirs = [];
    for (const dir of candidateDirs) {
      allDirs.push(dir);
      allDirs.push(rotate(dir, rad(-1.2)));
      allDirs.push(rotate(dir, rad(1.2)));
    }

    const elevations = [40, 46, 52, 58];
    const powers = [0.3, 0.36, 0.42, 0.5];
    const tip = { x: 0, y: 0.1 };

    for (const dir of allDirs) {
      for (const elev of elevations) {
        for (const power of powers) {
          const res = simulate(
            balls,
            { aimDir: dir, power, tip, elevationDeg: elev },
            { table: eq.table, cue: eq.cue, rng: rng0, orientation: false, recordPaths: false, maxTime: 4 },
          );
          if (!reachesTargetDirectly(res, tgt.id, blockerId)) continue;
          const potted = res.events.potted.includes(tgt.id);
          let sc = 6;
          if (potted) sc += 20;
          sc -= res.events.cushionHits.length * 0.2;
          if (sc > bestScore) {
            bestScore = sc;
            best = {
              targetId: tgt.id,
              pocketIdx: pocketIdxOf(res, tgt.id),
              aimDir: dir,
              power,
              tip,
              elevationDeg: elev,
              kind: 'jump',
              potted,
            };
            if (potted) return best;
          }
        }
      }
    }
  }

  return best;
}

/**
 * Find a curved massé stroke bending around an obstacle ball to hit a legal target.
 * Steep cue (60-72 deg), soft stroke, side english: the ball stays on the cloth and curves back after passing the blocker.
 */
export function findMasseShot(balls, cue, legalTargets, eq, geo) {
  const rng0 = () => 0.5;
  let best = null;
  let bestScore = -Infinity;
  const MAX_SIMS = 400;

  for (const tgt of legalTargets) {
    const blockerId = isPathBlocked(cue.pos, tgt.pos, balls, R, [0, tgt.id]);
    if (blockerId === null) continue;

    const baseAng = Math.atan2(tgt.pos.y - cue.pos.y, tgt.pos.x - cue.pos.x);
    const offsets = [];
    for (let o = 8; o <= 60; o += 4) offsets.push(o);
    const elevations = [60, 66, 72];
    const powers = [0.12, 0.16, 0.2, 0.26, 0.32];
    const tys = [-0.15, 0, 0.15];
    let sims = 0;

    // side = +1: aim to the right of the line (+angle on the y-down screen), english on the left brings it back
    for (const off of offsets) {
      for (const side of [1, -1]) {
        const ang = baseAng + rad(side * off);
        const dir = { x: Math.cos(ang), y: Math.sin(ang) };
        for (const power of powers) {
          for (const elev of elevations) {
            for (const ty of tys) {
              if (sims >= MAX_SIMS) break;
              sims++;
              const tip = { x: -side * 0.42, y: ty };
              const res = simulate(
                balls,
                { aimDir: dir, power, tip, elevationDeg: elev },
                { table: eq.table, cue: eq.cue, rng: rng0, orientation: false, recordPaths: false, maxTime: 4 },
              );
              if (!reachesTargetDirectly(res, tgt.id, blockerId)) continue;
              const potted = res.events.potted.includes(tgt.id);
              let sc = 5;
              if (potted) sc += 20;
              sc -= res.events.cushionHits.length * 0.2;
              if (sc > bestScore) {
                bestScore = sc;
                best = {
                  targetId: tgt.id,
                  pocketIdx: pocketIdxOf(res, tgt.id),
                  aimDir: dir,
                  power,
                  tip,
                  elevationDeg: elev,
                  kind: 'masse',
                  potted,
                };
                if (potted) return best;
              }
            }
          }
        }
      }
    }
  }

  return best;
}

/**
 * Choose the Bot's shot for 9-ball or 8-ball (`opts.game = '9ball' | '8ball'`, `opts.group`).
 */
export function chooseBotShot(balls, geo, eq, difficulty = 'medium', opts = {}) {
  let diff;
  if (typeof difficulty === 'object' && difficulty !== null) {
    diff = difficulty;
  } else if (difficulty === 'hero') {
    const hero = loadHeroProfile();
    diff = {
      ...BOT_DIFFICULTIES.hero,
      aimJitterDeg: hero.aimJitterDeg ?? 0.015,
      safeJitterScale: hero.safeJitterScale ?? 0.06,
      breakPower: hero.breakPower ?? 0.96,
      canJump: hero.canJump ?? true,
      canMasse: hero.canMasse ?? true,
    };
  } else {
    diff = BOT_DIFFICULTIES[difficulty] || BOT_DIFFICULTIES.medium;
  }
  const game = opts.game === '8ball' ? '8ball' : '9ball';
  const group = game === '8ball' ? (opts.group ?? null) : null;
  const rng = opts.rng || Math.random;
  const cue = balls.find((b) => b.id === 0 && !b.potted);

  const legalIds = game === '8ball'
    ? eightBallTargetIds(balls, group)
    : (() => {
        const lid = lowestBallId(balls);
        return lid !== null ? [lid] : [];
      })();
  const legalTargets = legalIds.map((id) => balls.find((b) => b.id === id && !b.potted)).filter(Boolean);

  if (!cue || !legalTargets.length) {
    return {
      targetId: legalIds[0] ?? 1,
      pocketIdx: -1,
      aimDir: { x: 1, y: 0 },
      power: 0.5,
      tip: { x: 0, y: 0 },
      elevationDeg: DEFAULT_ELEVATION_DEG,
      kind: 'fallback',
    };
  }

  // Opening break shot: drive into the front apex ball
  if (opts.onBreak) {
    const apex = balls.find((b) => b.id === 1 && !b.potted) || legalTargets[0];
    const jitter = (rng() - 0.5) * 2 * Math.min(diff.aimJitterDeg, 0.8);
    const aimDir = rotate(norm(sub(apex.pos, cue.pos)), rad(jitter));
    return {
      targetId: apex.id,
      pocketIdx: -1,
      aimDir,
      power: clamp((diff.breakPower ?? 0.88) + (rng() - 0.5) * 0.06, 0.78, 0.96),
      tip: { x: 0, y: 0.14 },
      elevationDeg: DEFAULT_ELEVATION_DEG,
      kind: 'break',
    };
  }

  const candidates = [];
  for (const tgt of legalTargets) {
    for (const c of scorePocketCandidates(cue.pos, balls, tgt, geo)) {
      candidates.push({ ...c, targetId: tgt.id });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const avoidEight = game === '8ball' && !(legalIds.length === 1 && legalIds[0] === 8);

  if (candidates.length) {
    const topCands = candidates.slice(0, diff.proSpin ? 2 : 3);
    const tipsToTry = diff.proSpin
      ? [
          { x: 0, y: 0 },
          { x: 0, y: 0.34 },
          { x: 0, y: -0.34 },
          { x: -0.22, y: 0.2 },
          { x: 0.22, y: 0.2 },
        ]
      : diff.useSpin
        ? [{ x: 0, y: 0 }, { x: 0, y: 0.28 }, { x: 0, y: -0.28 }]
        : [{ x: 0, y: 0 }];
    let chosen = null;

    for (const cand of topCands) {
      const candTargetId = cand.targetId;
      const nextTarget = findNextTarget(balls, candTargetId, game, group);
      const basePower = clamp(0.32 + (cand.dCue + cand.dObj) / 2600 + (1 - Math.cos(rad(cand.shot.cutAngleDeg))) * 0.16, 0.28, 0.84);
      const powersToTry = diff.proSpin && nextTarget ? [basePower, clamp(basePower * 0.78, 0.28, 0.78)] : [basePower];

      let bestTip = tipsToTry[0];
      let bestPower = basePower;
      let bestAim = cand.shot.aimDir;
      let bestUtility = -Infinity;

      for (const power of powersToTry) {
        for (const tip of tipsToTry) {
          let solvedDir = cand.shot.aimDir;
          let elev = effectiveCueElevationDeg(DEFAULT_ELEVATION_DEG, cue.pos, solvedDir, tip, geo, { pull: 50 + power * 200, balls });
          if (diff.useSolveAim) {
            const solved = solveAim(
              balls,
              candTargetId,
              cand.aimPt,
              { power, tip, elevationDeg: elev },
              eq.table,
              eq.cue,
            );
            if (solved.ok) {
              solvedDir = solved.aimDir;
              elev = effectiveCueElevationDeg(DEFAULT_ELEVATION_DEG, cue.pos, solvedDir, tip, geo, { pull: 50 + power * 200, balls });
            }
          }

          let utility = cand.score;
          if (diff.checkScratch) {
            const out = probeOutcome(balls, solvedDir, power, tip, elev, candTargetId, nextTarget, geo, eq, avoidEight);
            if (out.earlyEight) utility -= 20;
            if (out.cuePotted) utility -= 5;
            if (!out.objPotted && out.firstContact !== candTargetId) utility -= 2;
            if (out.objPotted) utility += 0.6;
            if (diff.useSpin) utility += out.posScore * (diff.proSpin ? 0.65 : 0.45);
          }

          if (utility > bestUtility) {
            bestUtility = utility;
            bestTip = tip;
            bestPower = power;
            bestAim = solvedDir;
          }
        }
      }

      if (!chosen || bestUtility > chosen.utility) {
        chosen = { cand, power: bestPower, tip: bestTip, aimDir: bestAim, utility: bestUtility };
      }
      if (!diff.useSpin && chosen.utility > 0.5) break;
    }

    const jitterDeg = (rng() - 0.5) * 2 * diff.aimJitterDeg;
    const finalAim = rotate(chosen.aimDir, rad(jitterDeg));
    return {
      targetId: chosen.cand.targetId,
      pocketIdx: chosen.cand.pocketIdx,
      aimDir: finalAim,
      power: chosen.power,
      tip: chosen.tip,
      elevationDeg: effectiveCueElevationDeg(DEFAULT_ELEVATION_DEG, cue.pos, finalAim, chosen.tip, geo, { pull: 50 + chosen.power * 200, balls }),
      kind: 'pot',
    };
  }

  // When snookered / no direct clean pocket:
  // If Hero bot (canJump / canMasse), attempt trick shots to jump or curve around blockers!
  if (diff.canJump || diff.canMasse) {
    let trickShot = null;
    if (diff.canJump) {
      trickShot = findJumpShot(balls, cue, legalTargets, eq, geo);
    }
    if ((!trickShot || !trickShot.potted) && diff.canMasse) {
      const masse = findMasseShot(balls, cue, legalTargets, eq, geo);
      if (masse && (!trickShot || masse.potted)) trickShot = masse;
    }
    if (trickShot) {
      const jitterDeg = (rng() - 0.5) * 2 * diff.aimJitterDeg * 0.4;
      const finalAim = rotate(trickShot.aimDir, rad(jitterDeg));
      return {
        targetId: trickShot.targetId,
        pocketIdx: trickShot.pocketIdx ?? -1,
        aimDir: finalAim,
        power: trickShot.power,
        tip: trickShot.tip,
        elevationDeg: trickShot.elevationDeg,
        kind: trickShot.kind,
      };
    }
  }

  // No clean direct pocket: play kick / bank / safety contact against best reachable legal ball
  let safeTarget = legalTargets[0];
  let bestSafeDist = Infinity;
  for (const tgt of legalTargets) {
    const clear = isPathBlocked(cue.pos, tgt.pos, balls, R, [0, tgt.id]) === null;
    const d = dist(cue.pos, tgt.pos) - (clear ? 600 : 0);
    if (d < bestSafeDist) {
      bestSafeDist = d;
      safeTarget = tgt;
    }
  }
  const safeDir = findKickOrSafeShot(balls, cue, safeTarget, eq, geo);
  const safeJitter = (rng() - 0.5) * 2 * diff.aimJitterDeg * (diff.safeJitterScale ?? 0.6);
  const finalSafeDir = rotate(safeDir, rad(safeJitter));
  return {
    targetId: safeTarget.id,
    pocketIdx: -1,
    aimDir: finalSafeDir,
    power: 0.62,
    tip: { x: 0, y: 0 },
    elevationDeg: effectiveCueElevationDeg(DEFAULT_ELEVATION_DEG, cue.pos, finalSafeDir, { x: 0, y: 0 }, geo, { pull: 170, balls }),
    kind: 'safe',
  };
}
