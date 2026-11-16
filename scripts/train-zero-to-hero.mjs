// Zero to Hero Training Engine & Money Game Simulation
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { R, buildTable } from '../src/core/table.js';
import { defaultTable, defaultCue } from '../src/core/equipment.js';
import { createBall, simulate, DEFAULT_ELEVATION_DEG } from '../src/core/physics.js';
import {
  BOT_DIFFICULTIES,
  chooseBotShot,
  placeCueBallForBot,
  evaluateNineBallTurn,
  lowestBallId,
} from '../src/features/bot.js';
import { dist, norm, sub, rotate, rad, clamp } from '../src/core/vec.js';

const TABLE = defaultTable();
const GEO = buildTable(TABLE);
const CUE = defaultCue();
const EQ = { table: TABLE, cue: CUE };

// 9-Ball rack generator using createBall
function createNineBallRack(geo) {
  const d = 2 * R + 0.3;
  const dx = (d * Math.sqrt(3)) / 2;
  const rows = [1, 2, 3, 2, 1];
  const spots = [];
  rows.forEach((n, k) => {
    for (let j = 0; j < n; j++) {
      spots.push({
        x: geo.FOOT_SPOT.x + k * dx,
        y: geo.FOOT_SPOT.y + (j - (n - 1) / 2) * d,
      });
    }
  });

  // spots layout: 0 apex (ball 1), 4 centre of 3-row (9-ball)
  const rest = [2, 3, 4, 5, 6, 7, 8].sort(() => Math.random() - 0.5);
  const list = [
    createBall(1, spots[0].x, spots[0].y),
    createBall(9, spots[4].x, spots[4].y),
  ];
  const free = [1, 2, 3, 5, 6, 7, 8];
  free.forEach((si, i) => list.push(createBall(rest[i], spots[si].x, spots[si].y)));
  list.push(createBall(0, geo.HEAD_SPOT.x - 100, geo.HEAD_SPOT.y));
  return list;
}

// Learner Bot definition
class LearnerBot {
  constructor(name = 'Zero') {
    this.name = name;
    this.xp = 0;
    this.totalShots = 0;
    this.pots = 0;
    this.misses = 0;
    this.fouls = 0;
    this.scratches = 0;
    this.runOuts = 0;
    this.goldenBreaks = 0;

    // Initial naive rookie parameters
    this.aimJitterDeg = 3.6; // High error variance
    this.safeJitterScale = 1.6;
    this.breakPower = 0.74;
    this.useSolveAim = false;
    this.useSpin = false;
    this.proSpin = false;
    this.checkScratch = false;
  }

  getTitle() {
    if (this.xp < 35) return 'Zero (Tân Binh Ngây Thơ)';
    if (this.xp < 80) return 'Học Viên Câu Lạc Bộ';
    if (this.xp < 160) return 'Cơ Thủ Phong Trào';
    if (this.xp < 270) return 'Sát Thủ Bán Chuyên';
    if (this.xp < 420) return 'Cao Thủ Hạng A';
    return 'Hero (Thần Cơ Đại Sư)';
  }

  // Experience & parameter adaptation
  gainExperience(type) {
    if (type === 'shot') this.xp += 1.0;
    else if (type === 'pot') this.xp += 2.5;
    else if (type === 'foul') this.xp += 1.2; // Learn hard from mistakes
    else if (type === 'rack_win') this.xp += 5.0;

    // Decay aim jitter from 3.6 deg down to 0.06 deg
    this.aimJitterDeg = Math.max(0.06, 0.06 + (3.6 - 0.06) * Math.exp(-this.xp / 140));
    this.safeJitterScale = Math.max(0.15, 0.15 + (1.6 - 0.15) * Math.exp(-this.xp / 150));
    this.breakPower = Math.min(0.93, 0.74 + (0.93 - 0.74) * (1 - Math.exp(-this.xp / 160)));

    if (this.xp >= 30) this.useSolveAim = true;
    if (this.xp >= 65) this.checkScratch = true;
    if (this.xp >= 130) this.useSpin = true;
    if (this.xp >= 280) this.proSpin = true;
  }

  getProfile() {
    return {
      id: 'learner',
      label: this.name,
      aimJitterDeg: this.aimJitterDeg,
      safeJitterScale: this.safeJitterScale,
      breakPower: this.breakPower,
      useSolveAim: this.useSolveAim,
      useSpin: this.useSpin,
      proSpin: this.proSpin,
      checkScratch: this.checkScratch,
    };
  }
}

// Format VND currency
function formatVND(amount) {
  const sign = amount < 0 ? '-' : amount > 0 ? '+' : '';
  const abs = Math.abs(amount);
  return `${sign}${abs.toLocaleString('vi-VN')} đ`;
}

// Format seconds into H:M:S
function formatTime(totalSeconds) {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = Math.floor(totalSeconds % 60);
  const parts = [];
  if (hrs > 0) parts.push(`${hrs}h`);
  if (mins > 0 || hrs > 0) parts.push(`${mins}m`);
  parts.push(`${secs}s`);
  return parts.join(' ');
}

// Simulate one match
function playMatch(learner, opponentTier, matchNum, state) {
  const { name: oppName, diffId, raceTo, rackStake, matchStake } = opponentTier;
  const oppDiff = BOT_DIFFICULTIES[diffId];

  let scoreLearner = 0;
  let scoreOpp = 0;
  let rackNum = 0;
  let currentBreaker = Math.random() < 0.5 ? 'learner' : 'opp';
  const matchRacks = [];

  while (scoreLearner < raceTo && scoreOpp < raceTo) {
    rackNum++;
    let balls = createNineBallRack(GEO);
    let turn = currentBreaker;
    let onBreak = true;
    let ballInHand = false;
    let rackWinner = null;
    let shotCount = 0;
    let learnerPotsInRack = 0;

    // Safety limit per rack to prevent infinite loops if balls get stuck
    let maxRackShots = 60;

    while (!rackWinner && maxRackShots-- > 0) {
      shotCount++;
      const isLearner = turn === 'learner';
      const targetId = lowestBallId(balls);

      if (targetId === null) {
        rackWinner = turn;
        break;
      }

      // In-game time tracking for aiming
      let aimTimeSec = onBreak ? 5.5 : ballInHand ? 5.0 : isLearner ? (learner.useSolveAim ? 4.5 : 3.0) : 3.8;
      state.simInGameTimeSec += aimTimeSec;

      // Ball in hand placement
      if (ballInHand) {
        const place = placeCueBallForBot(balls, targetId, GEO, EQ, onBreak);
        let cueBall = balls.find((b) => b.id === 0);
        if (!cueBall) {
          cueBall = createBall(0, place.x, place.y);
          balls.push(cueBall);
        } else {
          cueBall.pos = { x: place.x, y: place.y };
          cueBall.potted = false;
          cueBall.v = { x: 0, y: 0 };
          cueBall.w = { x: 0, y: 0, z: 0 };
        }
        ballInHand = false;
      }

      const ballsBefore = balls.map((b) => ({ ...b, pos: { ...b.pos } }));

      // Choose shot
      const diffConfig = isLearner ? learner.getProfile() : oppDiff;
      const shotChoice = chooseBotShot(balls, GEO, EQ, diffConfig.id || diffConfig, {
        game: '9ball',
        onBreak,
      });

      // Physics simulation
      const simRes = simulate(
        balls,
        {
          aimDir: shotChoice.aimDir,
          power: shotChoice.power,
          tip: shotChoice.tip,
          elevationDeg: shotChoice.elevationDeg,
        },
        {
          table: TABLE,
          cue: CUE,
          rng: Math.random,
          orientation: false,
          recordPaths: false,
        },
      );

      // Add actual ball rolling time from physics engine
      state.simInGameTimeSec += (simRes.totalTime || 3.0);

      // Evaluate turn
      const evalRes = evaluateNineBallTurn({
        ballsBefore,
        simBalls: simRes.balls,
        events: simRes.events,
        geo: GEO,
      });
      balls = simRes.balls;

      if (isLearner) {
        learner.totalShots++;
        learner.gainExperience('shot');
        if (evalRes.pottedObj.length > 0) {
          learner.pots += evalRes.pottedObj.length;
          learnerPotsInRack += evalRes.pottedObj.length;
          learner.gainExperience('pot');
        } else {
          learner.misses++;
        }
        if (evalRes.foul) {
          learner.fouls++;
          if (evalRes.cuePotted) learner.scratches++;
          learner.gainExperience('foul');
        }
        if (onBreak && evalRes.winRack) {
          learner.goldenBreaks++;
        }
      }

      onBreak = false;

      // Respot 9-ball if potted on foul
      if (evalRes.respotNine && evalRes.respotPos) {
        let b9 = balls.find((b) => b.id === 9);
        if (!b9) {
          b9 = createBall(9, evalRes.respotPos.x, evalRes.respotPos.y);
          balls.push(b9);
        } else {
          b9.pos = { x: evalRes.respotPos.x, y: evalRes.respotPos.y };
          b9.potted = false;
        }
      }

      // Determine outcome
      if (evalRes.winRack) {
        rackWinner = turn;
        if (isLearner && shotCount <= 9 && learnerPotsInRack >= 4) {
          learner.runOuts++;
        }
      } else if (evalRes.foul) {
        turn = turn === 'learner' ? 'opp' : 'learner';
        ballInHand = true;
      } else if (evalRes.keepTurn) {
        // keep turn
      } else {
        // missed, change turn
        turn = turn === 'learner' ? 'opp' : 'learner';
      }
    }

    if (!rackWinner) rackWinner = 'opp';

    // Rack concluded
    if (rackWinner === 'learner') {
      scoreLearner++;
      state.bankroll += rackStake;
      state.totalWon += rackStake;
      state.racksWon++;
      learner.gainExperience('rack_win');
    } else {
      scoreOpp++;
      state.bankroll -= rackStake;
      state.totalLost += rackStake;
      state.racksLost++;
    }
    state.totalRacks++;

    if (state.bankroll < state.minBankroll) state.minBankroll = state.bankroll;
    if (state.bankroll > state.maxBankroll) state.maxBankroll = state.bankroll;

    // Winner breaks next rack
    currentBreaker = rackWinner;
    matchRacks.push({
      rackNum,
      winner: rackWinner,
      shots: shotCount,
      scoreL: scoreLearner,
      scoreO: scoreOpp,
      bankroll: state.bankroll,
    });
  }

  // Match concluded
  const learnerWonMatch = scoreLearner >= raceTo;
  if (learnerWonMatch) {
    state.bankroll += matchStake;
    state.totalWon += matchStake;
    state.matchesWon++;
  } else {
    state.bankroll -= matchStake;
    state.totalLost += matchStake;
    state.matchesLost++;
  }
  state.totalMatches++;

  if (state.bankroll < state.minBankroll) state.minBankroll = state.bankroll;
  if (state.bankroll > state.maxBankroll) state.maxBankroll = state.bankroll;

  return {
    matchNum,
    opponent: oppName,
    diffLabel: oppDiff.label,
    raceTo,
    scoreLearner,
    scoreOpp,
    won: learnerWonMatch,
    racks: matchRacks,
    bankrollAfter: state.bankroll,
    pnlAfter: state.bankroll - state.startingBankroll,
    learnerXp: learner.xp,
    learnerJitter: learner.aimJitterDeg,
    learnerTitle: learner.getTitle(),
    inGameTimeSec: state.simInGameTimeSec,
  };
}

// Run the full Zero to Hero Money Game Campaign
export function runZeroToHeroCampaign() {
  const cpuStart = performance.now();
  const learner = new LearnerBot('Zero');

  const state = {
    startingBankroll: 5000000, // 5M VND starting bankroll
    bankroll: 5000000,
    minBankroll: 5000000,
    maxBankroll: 5000000,
    totalWon: 0,
    totalLost: 0,
    totalMatches: 0,
    matchesWon: 0,
    matchesLost: 0,
    totalRacks: 0,
    racksWon: 0,
    racksLost: 0,
    simInGameTimeSec: 0,
  };

  const tiers = [
    {
      tierNum: 1,
      tierName: 'Tier 1: Tân Binh Làng Bida',
      name: 'Hải Gà Con',
      diffId: 'easy',
      raceTo: 3,
      rackStake: 100000,
      matchStake: 500000,
      requiredWins: 2,
    },
    {
      tierNum: 2,
      tierName: 'Tier 2: Cơ Thủ Quán Nét',
      name: 'Tuấn Sới Bida',
      diffId: 'medium',
      raceTo: 5,
      rackStake: 300000,
      matchStake: 1500000,
      requiredWins: 2,
    },
    {
      tierNum: 3,
      tierName: 'Tier 3: Sát Thủ Bán Chuyên',
      name: 'Long Độc Cô',
      diffId: 'hard',
      raceTo: 7,
      rackStake: 800000,
      matchStake: 4000000,
      requiredWins: 2,
    },
    {
      tierNum: 4,
      tierName: 'Tier 4: Đỉnh Cao Thần Cơ (Hero Stage)',
      name: 'Đức Thần Cơ (Trùm Cuối)',
      diffId: 'pro',
      raceTo: 9,
      rackStake: 2000000,
      matchStake: 10000000,
      requiredWins: 1, // Championship Grand Final match
    },
  ];

  const matchLogs = [];
  const tierSummaries = [];

  for (const tier of tiers) {
    let tierWins = 0;
    let tierMatches = 0;
    const tierBankrollStart = state.bankroll;
    const tierTimeStart = state.simInGameTimeSec;

    while (tierWins < tier.requiredWins) {
      tierMatches++;
      const matchIndex = matchLogs.length + 1;
      const res = playMatch(learner, tier, matchIndex, state);
      matchLogs.push({ ...res, tier: tier.tierNum, tierName: tier.tierName });

      if (res.won) {
        tierWins++;
      }
    }

    tierSummaries.push({
      tier: tier.tierNum,
      tierName: tier.tierName,
      opponent: tier.name,
      diff: tier.diffId,
      matchesPlayed: tierMatches,
      matchesWon: tierWins,
      pnl: state.bankroll - tierBankrollStart,
      timeSec: state.simInGameTimeSec - tierTimeStart,
      endTitle: learner.getTitle(),
      endJitter: learner.aimJitterDeg.toFixed(2),
    });
  }

  const cpuDurationMs = performance.now() - cpuStart;

  return {
    learner,
    state,
    tiers: tierSummaries,
    matches: matchLogs,
    cpuDurationMs,
  };
}

// Run simulation and generate logs
const report = runZeroToHeroCampaign();

console.log('================================================================');
console.log('CHIẾN DỊCH ĐÀO TẠO BOT: ZERO TO HERO - MONEY GAME CAMPAIGN');
console.log('================================================================');
console.log(`Bot: ${report.learner.name} -> Đạt danh hiệu: ${report.learner.getTitle()}`);
console.log(`Vốn ban đầu: ${formatVND(report.state.startingBankroll)}`);
console.log(`Số dư cuối cùng: ${formatVND(report.state.bankroll)}`);
console.log(`Lợi nhuận ròng (Net PnL): ${formatVND(report.state.bankroll - report.state.startingBankroll)}`);
console.log(`Đỉnh lỗ sâu nhất (Min Bankroll): ${formatVND(report.state.minBankroll)} (Học phí mất nhiều nhất: ${formatVND(report.state.startingBankroll - report.state.minBankroll)})`);
console.log(`Đỉnh vốn cao nhất (Max Bankroll): ${formatVND(report.state.maxBankroll)}`);
console.log(`Tổng thời gian thi đấu bida thực tế: ${formatTime(report.state.simInGameTimeSec)} (${Math.round(report.state.simInGameTimeSec)} giây)`);
console.log(`Thời gian mô phỏng CPU: ${(report.cpuDurationMs / 1000).toFixed(2)}s`);
console.log(`Tổng trận: ${report.state.totalMatches} (Thắng: ${report.state.matchesWon} - Thua: ${report.state.matchesLost})`);
console.log(`Tổng ván (Racks): ${report.state.totalRacks} (Thắng: ${report.state.racksWon} - Thua: ${report.state.racksLost})`);
console.log(`Tổng cú đánh (Shots): ${report.learner.totalShots} (Ăn bi: ${report.learner.pots}, Trượt: ${report.learner.misses}, Lỗi: ${report.learner.fouls})`);
console.log(`Tỷ lệ ăn bi: ${((report.learner.pots / report.learner.totalShots) * 100).toFixed(1)}%`);
console.log(`Run-out dọn bàn: ${report.learner.runOuts} | Golden Break: ${report.learner.goldenBreaks}`);
console.log('----------------------------------------------------------------');
console.log('DANH SÁCH CÁC TRẬN ĐẤU (MATCH LOGS):');
for (const m of report.matches) {
  const resultStr = m.won ? '🏆 THẮNG' : '❌ THUA';
  console.log(`Trận #${m.matchNum} [${m.tierName}] vs ${m.opponent} (${m.diffLabel}): ${resultStr} (${m.scoreLearner} - ${m.scoreOpp}) | Số dư: ${formatVND(m.bankrollAfter)} (${formatVND(m.pnlAfter)}) | Jitter: ${m.learnerJitter.toFixed(2)}°`);
}
console.log('================================================================');

// Save JSON artifact
writeFileSync('scripts/zero-to-hero-result.json', JSON.stringify(report, null, 2), 'utf-8');
console.log('Saved result to scripts/zero-to-hero-result.json');
