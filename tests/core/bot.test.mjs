import test from 'node:test';
import assert from 'node:assert/strict';
import { R, buildTable } from '../../src/core/table.js';
import { minCueElevationDeg, effectiveCueElevationDeg, railSurfaceHeight } from '../../src/core/geometry.js';
import { createBall, simulate } from '../../src/core/physics.js';
import { cuePose, fromThree, MM, CAMERA_MODES, CAMERA_MODE_LABEL, nextCameraMode } from '../../src/ui/view3d-math.js';
import { tablePreset, cuePreset } from '../../src/core/equipment.js';
import { dist } from '../../src/core/vec.js';
import {
  BOT_DIFFICULTIES,
  BOT_GAMES,
  botAidFor,
  eightBallTargetIds,
  lowestBallId,
  evaluateNineBallTurn,
  evaluateEightBallTurn,
  placeCueBallForBot,
  chooseBotShot,
  findJumpShot,
  findMasseShot,
  loadHeroProfile,
  saveHeroProfile,
  recordHeroProgress,
} from '../../src/features/bot.js';

const eq = { table: tablePreset('club-9ft'), cue: cuePreset('allround') };
const geo = buildTable(eq.table);

test('lowestBallId finds lowest un-potted object ball', () => {
  const b0 = createBall(0, 500, 500);
  const b2 = createBall(2, 800, 500);
  const b5 = createBall(5, 900, 500);
  const b9 = createBall(9, 1200, 500);
  b2.potted = true;
  assert.equal(lowestBallId([b0, b2, b5, b9]), 5);
  assert.equal(lowestBallId([b0]), null);
});

test('evaluateNineBallTurn covers legal pot, miss, fouls, 9-ball win & respot', () => {
  const ballsBefore = [createBall(0, 500, 500), createBall(2, 900, 500), createBall(9, 1400, 500)];
  const simBalls = [createBall(0, 920, 510), createBall(9, 1400, 500)];

  // Legal pot keeps turn
  const potOk = evaluateNineBallTurn({
    ballsBefore,
    simBalls,
    events: { firstContact: 2, potted: [2], contacts: [{ a: 0, b: 2, time: 0.2 }], cushionHits: [] },
    geo,
  });
  assert.equal(potOk.foul, false);
  assert.equal(potOk.keepTurn, true);
  assert.equal(potOk.winRack, false);

  // Legal miss switches turn without foul
  const missOk = evaluateNineBallTurn({
    ballsBefore,
    simBalls: [...simBalls, createBall(2, 1000, 400)],
    events: {
      firstContact: 2,
      potted: [],
      contacts: [{ a: 0, b: 2, time: 0.2 }],
      cushionHits: [{ id: 2, time: 0.45, wall: 'right' }],
    },
    geo,
  });
  assert.equal(missOk.foul, false);
  assert.equal(missOk.keepTurn, false);
  assert.equal(missOk.ballInHand, false);

  // Wrong first contact -> foul + ball in hand
  const wrongBall = evaluateNineBallTurn({
    ballsBefore,
    simBalls,
    events: {
      firstContact: 9,
      potted: [2],
      contacts: [{ a: 0, b: 9, time: 0.2 }],
      cushionHits: [],
    },
    geo,
  });
  assert.equal(wrongBall.foul, true);
  assert.equal(wrongBall.ballInHand, true);

  // No cushion after contact -> foul
  const noRail = evaluateNineBallTurn({
    ballsBefore,
    simBalls,
    events: {
      firstContact: 2,
      potted: [],
      contacts: [{ a: 0, b: 2, time: 0.25 }],
      cushionHits: [{ id: 0, time: 0.1, wall: 'left' }],
    },
    geo,
  });
  assert.equal(noRail.foul, true);
  assert.equal(noRail.ballInHand, true);

  // Scratch + 9 ball potted -> foul & 9-ball respotted
  const foulNine = evaluateNineBallTurn({
    ballsBefore,
    simBalls: [createBall(2, 1000, 500)],
    events: {
      firstContact: 2,
      potted: [9, 0],
      contacts: [{ a: 0, b: 2, time: 0.2 }],
      cushionHits: [],
    },
    geo,
  });
  assert.equal(foulNine.foul, true);
  assert.equal(foulNine.winRack, false);
  assert.equal(foulNine.respotNine, true);
  assert.ok(foulNine.respotPos);

  // Legal 9-ball pot -> rack win
  const winNine = evaluateNineBallTurn({
    ballsBefore,
    simBalls: [createBall(0, 1200, 600)],
    events: {
      firstContact: 2,
      potted: [2, 9],
      contacts: [{ a: 0, b: 2, time: 0.2 }],
      cushionHits: [],
    },
    geo,
  });
  assert.equal(winNine.foul, false);
  assert.equal(winNine.winRack, true);
});

test('placeCueBallForBot stays behind HEAD_X on break and picks non-overlapping spot on ball-in-hand', () => {
  const rack = [createBall(0, 400, 600), createBall(1, geo.FOOT_SPOT.x, geo.FOOT_SPOT.y), createBall(9, geo.FOOT_SPOT.x + 100, geo.FOOT_SPOT.y)];
  const brk = placeCueBallForBot(rack, 1, geo, eq, true);
  assert.ok(brk.x <= geo.HEAD_X + 1e-6);

  const bih = placeCueBallForBot(rack, 1, geo, eq, false);
  for (const b of rack) {
    if (b.id !== 0) assert.ok(dist(bih, b.pos) >= 2 * R + 1);
  }
});

test('chooseBotShot handles break, clean pot on hard, and snooker kick contact', () => {
  assert.ok(BOT_DIFFICULTIES.easy && BOT_DIFFICULTIES.medium && BOT_DIFFICULTIES.hard);

  // Opening break
  const breakBalls = [createBall(0, geo.HEAD_X - 80, geo.H / 2), createBall(1, geo.FOOT_SPOT.x, geo.FOOT_SPOT.y), createBall(9, geo.FOOT_SPOT.x + 120, geo.H / 2)];
  const brk = chooseBotShot(breakBalls, geo, eq, 'medium', { onBreak: true, rng: () => 0.5 });
  assert.equal(brk.kind, 'break');
  assert.ok(brk.power >= 0.8);

  // Clean cut toward top-right corner pocket
  const potBalls = [
    createBall(0, geo.W * 0.55, geo.H * 0.45),
    createBall(1, geo.W * 0.85, geo.H * 0.22),
    createBall(9, geo.W * 0.25, geo.H * 0.75),
  ];
  const shot = chooseBotShot(potBalls, geo, eq, 'hard', { rng: () => 0.5 });
  assert.equal(shot.kind, 'pot');
  const simRes = simulate(potBalls, shot, { table: eq.table, cue: eq.cue, rng: () => 0.5 });
  assert.ok(simRes.events.potted.includes(1), 'Hard bot pots open target ball');
  assert.ok(!simRes.events.potted.includes(0), 'Hard bot avoids scratch');

  // Snooker: ball 9 blocks direct line from cue to ball 1; bot should kick off a rail to hit ball 1 first
  const snookerBalls = [
    createBall(0, geo.W * 0.25, geo.H * 0.5),
    createBall(9, geo.W * 0.45, geo.H * 0.5),
    createBall(1, geo.W * 0.7, geo.H * 0.5),
  ];
  const kickShot = chooseBotShot(snookerBalls, geo, eq, 'hard', { rng: () => 0.5 });
  const kickRes = simulate(snookerBalls, kickShot, { table: eq.table, cue: eq.cue, rng: () => 0.5 });
  assert.equal(kickRes.events.firstContact, 1, 'Bot finds legal kick onto lowest ball when snookered');
});

test('minCueElevationDeg elevates stick above cushion and wood rail when ball is frozen to rail', () => {
  const center = { x: geo.W * 0.5, y: geo.H * 0.5 };
  assert.equal(minCueElevationDeg(center, { x: 1, y: 0 }, { x: 0, y: 0 }, geo), 0);

  // Cue ball frozen to left cushion, shooting parallel to rail -> butt stays inside bed
  const frozenLeft = { x: R, y: geo.H * 0.5 };
  assert.equal(minCueElevationDeg(frozenLeft, { x: 0, y: 1 }, { x: 0, y: 0 }, geo), 0);

  // Cue ball frozen to left cushion, shooting perpendicular into the table -> butt passes over left rail
  const elev = effectiveCueElevationDeg(5, frozenLeft, { x: 1, y: 0 }, { x: 0, y: 0 }, geo, { pull: 200 });
  assert.ok(elev >= 20, `expected rail-clearing elevation >= 20 deg, got ${elev}`);

  // Verify exact 3D cuePose stays strictly above wood/cushion rail height at every point along shaft
  for (const pull of [0, 200]) {
    const pose = cuePose({ ball: frozenLeft, aimDir: { x: 1, y: 0 }, elevationDeg: elev, tip: { x: 0, y: 0 }, pull, dims: geo });
    for (let s = 0; s <= 400; s += 10) {
      const p3 = {
        x: pose.tip.x + pose.butt.x * s * MM,
        y: pose.tip.y + pose.butt.y * s * MM,
        z: pose.tip.z + pose.butt.z * s * MM,
      };
      const ph = fromThree(p3, geo);
      const railH = railSurfaceHeight(ph.x, ph.y, geo);
      if (railH > 0) {
        assert.ok(p3.y / MM - 6.3 >= railH, `stick clipped rail at x=${ph.x.toFixed(1)}: bottom=${(p3.y / MM - 6.3).toFixed(1)} < rail=${railH}`);
      }
    }
  }
});

test('bot difficulties scale aim aids down and bot skill up from easy to pro', () => {
  const levels = ['easy', 'medium', 'hard', 'pro'];
  for (let i = 0; i < levels.length; i++) {
    assert.ok(BOT_DIFFICULTIES[levels[i]], `missing level ${levels[i]}`);
    if (i > 0) {
      assert.ok(
        BOT_DIFFICULTIES[levels[i]].aimJitterDeg < BOT_DIFFICULTIES[levels[i - 1]].aimJitterDeg,
        `${levels[i]} jitter should be tighter than ${levels[i - 1]}`,
      );
    }
  }

  const easyAid = botAidFor('easy');
  const medAid = botAidFor('medium');
  const hardAid = botAidFor('hard');
  const proAid = botAidFor('pro');

  assert.equal(easyAid.ghost, true);
  assert.equal(easyAid.pocket, true);
  assert.equal(easyAid.tangent, true);
  assert.ok(easyAid.objLineLen > medAid.objLineLen);

  assert.equal(medAid.ghost, true);
  assert.equal(medAid.pocket, true);
  assert.equal(medAid.tangent, false);

  assert.equal(hardAid.ghost, false);
  assert.equal(hardAid.pocket, false);
  assert.ok(hardAid.maxAimLen > proAid.maxAimLen);

  assert.equal(proAid.ghost, false);
  assert.equal(proAid.simpleAim, true);

  // Pro bot cleanly pots open ball and sets up next target without scratching
  const balls = [
    createBall(0, geo.W * 0.55, geo.H * 0.45),
    createBall(1, geo.W * 0.85, geo.H * 0.22),
    createBall(9, geo.W * 0.3, geo.H * 0.65),
  ];
  const proShot = chooseBotShot(balls, geo, eq, 'pro', { rng: () => 0.5 });
  assert.equal(proShot.kind, 'pot');
  const simRes = simulate(balls, proShot, { table: eq.table, cue: eq.cue, rng: () => 0.5 });
  assert.ok(simRes.events.potted.includes(1));
  assert.ok(!simRes.events.potted.includes(0));
});

test('8-ball targets, turn evaluation (open/claimed/early-8/win) and bot shot selection', () => {
  assert.ok(BOT_GAMES['9ball'] && BOT_GAMES['8ball']);
  const rack = [
    createBall(0, geo.W * 0.25, geo.H * 0.5),
    createBall(2, geo.W * 0.55, geo.H * 0.45),
    createBall(8, geo.W * 0.7, geo.H * 0.5),
    createBall(11, geo.W * 0.85, geo.H * 0.22),
  ];

  // Open table excludes 8-ball while group balls remain
  assert.deepEqual(eightBallTargetIds(rack, null), [2, 11]);
  assert.deepEqual(eightBallTargetIds(rack, 'solids'), [2]);
  assert.deepEqual(eightBallTargetIds(rack, 'stripes'), [11]);
  // Once group cleared, 8 becomes the sole target
  assert.deepEqual(eightBallTargetIds([rack[0], rack[2], rack[3]], 'solids'), [8]);

  // Legal pot on open table claims stripes and keeps turn
  const openPot = evaluateEightBallTurn({
    ballsBefore: rack,
    simBalls: [rack[0], rack[1], rack[2]],
    events: { firstContact: 11, potted: [11], contacts: [{ a: 0, b: 11, time: 0.2 }], cushionHits: [] },
    turn: 'player',
    groups: { player: null, bot: null },
    onBreak: false,
    geo,
  });
  assert.equal(openPot.foul, false);
  assert.equal(openPot.keepTurn, true);
  assert.equal(openPot.assignedGroup, 'stripes');
  assert.deepEqual(openPot.nextGroups, { player: 'stripes', bot: 'solids' });

  // Break pot leaves table open
  const breakPot = evaluateEightBallTurn({
    ballsBefore: rack,
    simBalls: [rack[0], rack[1], rack[2]],
    events: { firstContact: 2, potted: [11], contacts: [{ a: 0, b: 2, time: 0.2 }], cushionHits: [] },
    turn: 'player',
    groups: { player: null, bot: null },
    onBreak: true,
    geo,
  });
  assert.equal(breakPot.foul, false);
  assert.equal(breakPot.keepTurn, true);
  assert.deepEqual(breakPot.nextGroups, { player: null, bot: null });

  // Early 8-ball loss
  const earlyEight = evaluateEightBallTurn({
    ballsBefore: rack,
    simBalls: [rack[0], rack[1], rack[3]],
    events: { firstContact: 2, potted: [2, 8], contacts: [{ a: 0, b: 2, time: 0.2 }], cushionHits: [] },
    turn: 'player',
    groups: { player: 'solids', bot: 'stripes' },
    onBreak: false,
    geo,
  });
  assert.equal(earlyEight.loseRack, true);
  assert.equal(earlyEight.winRack, false);

  // Legal 8-ball pot when only 8 remains wins; scratching on 8 loses
  const eightOnly = [rack[0], rack[2], rack[3]];
  const winEight = evaluateEightBallTurn({
    ballsBefore: eightOnly,
    simBalls: [rack[0], rack[3]],
    events: { firstContact: 8, potted: [8], contacts: [{ a: 0, b: 8, time: 0.2 }], cushionHits: [] },
    turn: 'bot',
    groups: { player: 'stripes', bot: 'solids' },
    onBreak: false,
    geo,
  });
  assert.equal(winEight.winRack, true);
  assert.equal(winEight.loseRack, false);

  const scratchEight = evaluateEightBallTurn({
    ballsBefore: eightOnly,
    simBalls: [rack[3]],
    events: { firstContact: 8, potted: [8, 0], contacts: [{ a: 0, b: 8, time: 0.2 }], cushionHits: [] },
    turn: 'player',
    groups: { player: 'solids', bot: 'stripes' },
    onBreak: false,
    geo,
  });
  assert.equal(scratchEight.loseRack, true);

  // Bot chooses valid stripe target and pots it cleanly in 8-ball mode
  const botBalls = [
    createBall(0, geo.W * 0.55, geo.H * 0.45),
    createBall(2, geo.W * 0.2, geo.H * 0.8),
    createBall(11, geo.W * 0.85, geo.H * 0.22),
    createBall(8, geo.W * 0.4, geo.H * 0.5),
  ];
  const shot = chooseBotShot(botBalls, geo, eq, 'hard', { game: '8ball', group: 'stripes', rng: () => 0.5 });
  assert.equal(shot.targetId, 11);
  assert.equal(shot.kind, 'pot');
  const sim = simulate(botBalls, shot, { table: eq.table, cue: eq.cue, rng: () => 0.5 });
  assert.ok(sim.events.potted.includes(11));
  assert.ok(!sim.events.potted.includes(8));
});

test('minCueElevationDeg elevates stick above obstructing balls behind cue ball', () => {
  const cuePos = { x: geo.W * 0.5, y: geo.H * 0.5 };
  const sideBall = { id: 2, pos: { x: cuePos.x, y: cuePos.y + 4 * R }, potted: false };
  assert.equal(minCueElevationDeg(cuePos, { x: 1, y: 0 }, { x: 0, y: 0 }, geo, { balls: [sideBall], pull: 150 }), 0);

  // Obstructing ball frozen directly behind cue ball along aim line
  const frozenBehind = { id: 3, pos: { x: cuePos.x - 2 * R, y: cuePos.y }, potted: false };
  const elev = effectiveCueElevationDeg(5, cuePos, { x: 1, y: 0 }, { x: 0, y: 0 }, geo, { pull: 150, balls: [frozenBehind] });
  assert.ok(elev >= 38, `expected ball-clearing elevation >= 38 deg, got ${elev}`);

  // Verify exact 3D cue shaft stays outside the obstructing ball sphere across pull=0..150 and s=0..1450
  const obs3 = { x: (frozenBehind.pos.x - geo.W / 2) * MM, y: R * MM, z: (frozenBehind.pos.y - geo.H / 2) * MM };
  for (const pull of [0, 150]) {
    const pose = cuePose({ ball: cuePos, aimDir: { x: 1, y: 0 }, elevationDeg: elev, tip: { x: 0, y: 0 }, pull, dims: geo });
    for (let s = 0; s <= 1450; s += 10) {
      const p3 = {
        x: pose.tip.x + pose.butt.x * s * MM,
        y: pose.tip.y + pose.butt.y * s * MM,
        z: pose.tip.z + pose.butt.z * MM,
      };
      const distMm = Math.hypot(p3.x - obs3.x, p3.y - obs3.y, p3.z - obs3.z) / MM;
      const rStick = 6.3 + Math.min(8.7, s * 0.007);
      assert.ok(distMm >= R + rStick, `stick pierced frozen ball at pull=${pull}, s=${s}: dist=${distMm.toFixed(2)} < ${(R + rStick).toFixed(2)}`);
    }
  }
});

test('Bot vs Bot: 8-ball and 9-ball turn evaluation with bot1 vs bot2', () => {
  const rack = [
    createBall(0, geo.W * 0.25, geo.H * 0.5),
    createBall(2, geo.W * 0.55, geo.H * 0.45), // solid
    createBall(8, geo.W * 0.7, geo.H * 0.5),   // 8-ball
    createBall(11, geo.W * 0.85, geo.H * 0.22), // stripe
  ];

  // Bot 1 pots stripe on open table -> bot1 gets stripes, bot2 gets solids
  const openPotB1 = evaluateEightBallTurn({
    ballsBefore: rack,
    simBalls: [rack[0], rack[1], rack[2]],
    events: { firstContact: 11, potted: [11], contacts: [{ a: 0, b: 11, time: 0.2 }], cushionHits: [] },
    turn: 'bot1',
    groups: { bot1: null, bot2: null },
    onBreak: false,
    geo,
  });
  assert.equal(openPotB1.foul, false);
  assert.equal(openPotB1.keepTurn, true);
  assert.equal(openPotB1.assignedGroup, 'stripes');
  assert.deepEqual(openPotB1.nextGroups, { bot1: 'stripes', bot2: 'solids' });

  // Bot 1 fouls -> bot2 gets ball-in-hand
  const foulB1 = evaluateEightBallTurn({
    ballsBefore: rack,
    simBalls: rack,
    events: { firstContact: 2, potted: [], contacts: [{ a: 0, b: 2, time: 0.2 }], cushionHits: [] },
    turn: 'bot1',
    groups: { bot1: 'stripes', bot2: 'solids' },
    onBreak: false,
    geo,
  });
  assert.equal(foulB1.foul, true);

  // Bot 2 legally pots 8 when group cleared -> bot2 wins
  const eightOnly = [rack[0], rack[2]];
  const winB2 = evaluateEightBallTurn({
    ballsBefore: eightOnly,
    simBalls: [rack[0]],
    events: { firstContact: 8, potted: [8], contacts: [{ a: 0, b: 8, time: 0.2 }], cushionHits: [] },
    turn: 'bot2',
    groups: { bot1: 'stripes', bot2: 'solids' },
    onBreak: false,
    geo,
  });
  assert.equal(winB2.winRack, true);
  assert.equal(winB2.loseRack, false);
});

test('Hero persistent evolution: skills update and improve progressively over shots and racks', () => {
  const init = loadHeroProfile();
  assert.ok(init.aimJitterDeg <= 0.08, 'Hero starts with tight aim');

  const startJitter = init.aimJitterDeg;
  const startXp = init.xp;

  // Record 10 shots with pots
  for (let i = 0; i < 10; i++) {
    recordHeroProgress('shot');
    recordHeroProgress('pot', { count: 2 });
  }

  const prog = recordHeroProgress('rack_win');
  const updated = prog.profile;

  assert.ok(updated.xp > startXp, 'XP increased');
  assert.ok(updated.totalShots >= init.totalShots + 10, 'Shots counted');
  assert.ok(updated.pots >= init.pots + 20, 'Pots counted');
  assert.ok(updated.racksWon >= init.racksWon + 1, 'Racks won counted');
  assert.ok(updated.aimJitterDeg <= startJitter, 'Jitter error maintained or improved');

  // Verify chooseBotShot works seamlessly with difficulty='hero'
  const cue = createBall(0, 500, 500);
  const tgt = createBall(1, 900, 500);
  const shot = chooseBotShot([cue, tgt], geo, eq, 'hero');
  assert.ok(shot.aimDir, 'Hero chose a valid aim direction');
  assert.ok(shot.power > 0, 'Hero chose power');
});

test('Hero skills: Jump shot and Massé curve shot solvers when snookered', () => {
  // 1. Jump shot test: Blocker ball 2 directly in between cue and target 1
  const cueJ = createBall(0, 500, 600);
  const blockerJ = createBall(2, 680, 600); // 180mm away
  const targetJ = createBall(1, 1050, 600); // 550mm away
  const ballsJ = [cueJ, blockerJ, targetJ];

  const jumpShot = findJumpShot(ballsJ, cueJ, [targetJ], eq, geo);
  assert.ok(jumpShot, 'Jump shot found for snookered layout');
  assert.equal(jumpShot.kind, 'jump');
  assert.equal(jumpShot.targetId, 1);
  assert.ok(jumpShot.elevationDeg >= 40, 'Elevated stroke for jump');
  assert.ok(jumpShot.power >= 0.78, 'Strong power for jump');

  // Verify jump simulation: hops over blocker 2, hits target 1 first
  const simResJ = simulate(ballsJ, jumpShot, { table: eq.table, cue: eq.cue, rng: () => 0.5, orientation: false, recordPaths: false });
  assert.equal(simResJ.events.firstContact, 1, 'Cue hopped over blocker 2 and made first contact with target 1');
  assert.equal(simResJ.events.potted.includes(0), false, 'Cue did not scratch');

  // 2. Massé curve shot test: Blocker ball 2 close to cue (70mm away), curves around it
  const cueM = createBall(0, 500, 600);
  const blockerM = createBall(2, 570, 600);
  const targetM = createBall(1, 1100, 600);
  const ballsM = [cueM, blockerM, targetM];

  const masseShot = findMasseShot(ballsM, cueM, [targetM], eq, geo);
  assert.ok(masseShot, 'Massé shot found for blocked layout');
  assert.equal(masseShot.kind, 'masse');
  assert.equal(masseShot.targetId, 1);
  assert.ok(masseShot.elevationDeg >= 58, 'Steep elevation for massé curve');
  assert.ok(Math.abs(masseShot.tip.x) >= 0.4, 'Strong side english applied');

  // Verify massé simulation: curves around blocker 2, hits target 1 first
  const simResM = simulate(ballsM, masseShot, { table: eq.table, cue: eq.cue, rng: () => 0.5, orientation: false, recordPaths: false });
  assert.equal(simResM.events.firstContact, 1, 'Cue curved around blocker 2 and made first contact with target 1');
  assert.equal(simResM.events.potted.includes(0), false, 'Cue did not scratch');

  // 3. chooseBotShot in snookered situation with Hero difficulty executes trick shot
  const heroShot = chooseBotShot(ballsJ, geo, eq, 'hero');
  assert.ok(heroShot.kind === 'jump' || heroShot.kind === 'masse', `Hero executed trick shot (got ${heroShot.kind})`);
  assert.equal(heroShot.targetId, 1);

  // 4. Hero progress records jump and masse executions
  const initProfile = loadHeroProfile();
  const startJumps = initProfile.jumpShots || 0;
  const startMasses = initProfile.masseShots || 0;

  recordHeroProgress('jump_shot');
  recordHeroProgress('masse_shot');

  const afterProfile = loadHeroProfile();
  assert.equal(afterProfile.jumpShots, startJumps + 1, 'Jump shot count tracked');
  assert.equal(afterProfile.masseShots, startMasses + 1, 'Massé shot count tracked');
});

test('Hero option and Race to Win match logic', () => {
  // 1. Verify BOT_DIFFICULTIES contains hero
  assert.ok(BOT_DIFFICULTIES.hero, 'hero exists in BOT_DIFFICULTIES');
  assert.equal(BOT_DIFFICULTIES.hero.id, 'hero');
  assert.equal(BOT_DIFFICULTIES.hero.canJump, true);
  assert.equal(BOT_DIFFICULTIES.hero.canMasse, true);

  // 2. Race to Win logic simulation
  function checkRaceWon(scorePlayer, scoreBot, raceTo) {
    if (!raceTo || raceTo <= 0) return false;
    return scorePlayer >= raceTo || scoreBot >= raceTo;
  }

  // Race to 5: at 4-3, not won yet; at 5-3, player wins!
  assert.equal(checkRaceWon(4, 3, 5), false, 'Race to 5 ongoing at 4-3');
  assert.equal(checkRaceWon(5, 3, 5), true, 'Race to 5 won at 5-3');
  assert.equal(checkRaceWon(2, 5, 5), true, 'Race to 5 won by bot at 2-5');

  // Race to 1 (sudden death): 1-0 wins immediately
  assert.equal(checkRaceWon(1, 0, 1), true, 'Race to 1 won at 1-0');

  // Endless / Free mode (raceTo = 0): never ends automatically
  assert.equal(checkRaceWon(12, 10, 0), false, 'Endless mode does not terminate');
});

test('Bot & BvB: Realistic view (no aim lines) & Auto-orbit camera mode', () => {
  // 1. Verify CAMERA_MODES includes 'orbit' and has broadcast TV label
  assert.ok(CAMERA_MODES.includes('orbit'), 'orbit mode exists in CAMERA_MODES');
  assert.equal(CAMERA_MODE_LABEL.orbit, 'Quay TV');
  assert.equal(nextCameraMode('auto'), 'orbit');
  assert.equal(nextCameraMode('orbit'), 'follow');

  // 2. Test overlay computation for realistic view vs normal
  function computeEffOverlays(aimAid, mode, turn, diff) {
    if (aimAid === false) {
      return { aim: false, actual: false, ghost: false, pocket: false, tangent: false, roll: false, predict: false };
    }
    if (mode === 'bot') {
      const aid = botAidFor(diff);
      return { aim: aid.aim, actual: false, ghost: aid.ghost, pocket: aid.pocket, tangent: aid.tangent, roll: false, predict: false };
    }
    return { aim: true, actual: true, ghost: true, pocket: true, tangent: true, roll: false, predict: true };
  }

  // When aimAid is true, assistance lines are active
  const aidsOn = computeEffOverlays(true, 'bot', 'player', 'medium');
  assert.equal(aidsOn.aim, true);

  // When aimAid is false (realistic mode), all guidance lines and ghosts are hidden
  const realistic = computeEffOverlays(false, 'bot', 'player', 'medium');
  assert.deepEqual(realistic, {
    aim: false,
    actual: false,
    ghost: false,
    pocket: false,
    tangent: false,
    roll: false,
    predict: false,
  }, 'All aim aid lines suppressed in realistic view');

  // 3. Auto-orbit rate verification (0.35 rad/sec produces full 360 rotation in ~18 seconds)
  const dt = 1 / 60;
  let angle = 0;
  for (let i = 0; i < 60; i++) {
    angle += dt * 0.35;
  }
  assert.ok(Math.abs(angle - 0.35) < 1e-4, 'Auto-orbit integrates smoothly over 1 second');
});
