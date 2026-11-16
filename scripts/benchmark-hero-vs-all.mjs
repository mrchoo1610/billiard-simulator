// Benchmark: Hero Bot vs All 4 Bot Difficulties (100 Racks Each)
import { performance } from 'node:perf_hooks';
import { writeFileSync, readFileSync } from 'node:fs';
import { R, buildTable } from '../src/core/table.js';
import { defaultTable, defaultCue } from '../src/core/equipment.js';
import { createBall, simulate } from '../src/core/physics.js';
import {
  BOT_DIFFICULTIES,
  chooseBotShot,
  placeCueBallForBot,
  evaluateNineBallTurn,
  lowestBallId,
} from '../src/features/bot.js';

const TABLE = defaultTable();
const GEO = buildTable(TABLE);
const CUE = defaultCue();
const EQ = { table: TABLE, cue: CUE };

// 9-Ball rack generator
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

// Load Hero Bot Profile from previous training or default to trained Hero values
let heroProfile = {
  id: 'hero',
  name: 'Hero (Thần Cơ)',
  label: 'Hero',
  aimJitterDeg: 0.06,
  safeJitterScale: 0.15,
  breakPower: 0.93,
  useSolveAim: true,
  useSpin: true,
  proSpin: true,
  checkScratch: true,
};

try {
  const prevData = JSON.parse(readFileSync('scripts/zero-to-hero-result.json', 'utf-8'));
  if (prevData?.learner) {
    heroProfile = {
      ...heroProfile,
      aimJitterDeg: prevData.learner.aimJitterDeg || 0.06,
      safeJitterScale: prevData.learner.safeJitterScale || 0.15,
      breakPower: prevData.learner.breakPower || 0.93,
      useSolveAim: prevData.learner.useSolveAim ?? true,
      useSpin: prevData.learner.useSpin ?? true,
      proSpin: prevData.learner.proSpin ?? true,
      checkScratch: prevData.learner.checkScratch ?? true,
    };
  }
} catch (e) {
  // Use default heroProfile
}

// Simulate 1 rack between Hero and Opponent
function playRack(heroConfig, oppDiff, breaker = 'hero') {
  let balls = createNineBallRack(GEO);
  let turn = breaker;
  let onBreak = true;
  let ballInHand = false;
  let rackWinner = null;
  let shotCount = 0;
  let heroPots = 0;
  let heroShots = 0;
  let heroMisses = 0;
  let heroFouls = 0;
  let heroScratches = 0;
  let goldenBreak = false;
  let inGameTimeSec = 0;

  let maxShots = 60;
  while (!rackWinner && maxShots-- > 0) {
    shotCount++;
    const isHero = turn === 'hero';
    const targetId = lowestBallId(balls);

    if (targetId === null) {
      rackWinner = turn;
      break;
    }

    // Aiming time
    const aimTime = onBreak ? 5.5 : ballInHand ? 5.0 : isHero ? 4.5 : 3.8;
    inGameTimeSec += aimTime;

    // Ball-in-hand placement
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
    const currentConfig = isHero ? heroConfig : oppDiff;

    const shotChoice = chooseBotShot(balls, GEO, EQ, currentConfig.id || currentConfig, {
      game: '9ball',
      onBreak,
    });

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

    inGameTimeSec += simRes.totalTime || 3.0;

    const evalRes = evaluateNineBallTurn({
      ballsBefore,
      simBalls: simRes.balls,
      events: simRes.events,
      geo: GEO,
    });
    balls = simRes.balls;

    if (isHero) {
      heroShots++;
      if (evalRes.pottedObj.length > 0) {
        heroPots += evalRes.pottedObj.length;
      } else {
        heroMisses++;
      }
      if (evalRes.foul) {
        heroFouls++;
        if (evalRes.cuePotted) heroScratches++;
      }
      if (onBreak && evalRes.winRack) {
        goldenBreak = true;
      }
    }

    onBreak = false;

    // Respot 9-ball on foul
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

    if (evalRes.winRack) {
      rackWinner = turn;
    } else if (evalRes.foul) {
      turn = turn === 'hero' ? 'opp' : 'hero';
      ballInHand = true;
    } else if (evalRes.keepTurn) {
      // keep turn
    } else {
      turn = turn === 'hero' ? 'opp' : 'hero';
    }
  }

  if (!rackWinner) rackWinner = 'opp';

  const isRunOut = rackWinner === 'hero' && shotCount <= 9 && heroPots >= 4;

  return {
    winner: rackWinner,
    shots: shotCount,
    heroPots,
    heroShots,
    heroMisses,
    heroFouls,
    heroScratches,
    isRunOut,
    goldenBreak,
    inGameTimeSec,
  };
}

// Benchmark 100 racks vs one opponent difficulty
function benchmarkVsOpponent(oppKey, totalRacks = 100) {
  const oppDiff = BOT_DIFFICULTIES[oppKey];
  console.log(`\n>>> ĐANG BẮT ĐẦU ĐẤU 100 HIỆP VỚI BOT: ${oppDiff.label.toUpperCase()} (${oppKey})...`);
  const t0 = performance.now();

  let heroWins = 0;
  let oppWins = 0;
  let totalHeroShots = 0;
  let totalHeroPots = 0;
  let totalHeroMisses = 0;
  let totalHeroFouls = 0;
  let totalHeroScratches = 0;
  let totalRunOuts = 0;
  let totalGoldenBreaks = 0;
  let totalInGameTimeSec = 0;
  let breaker = 'hero';

  for (let r = 1; r <= totalRacks; r++) {
    const res = playRack(heroProfile, oppDiff, breaker);
    if (res.winner === 'hero') {
      heroWins++;
    } else {
      oppWins++;
    }

    totalHeroShots += res.heroShots;
    totalHeroPots += res.heroPots;
    totalHeroMisses += res.heroMisses;
    totalHeroFouls += res.heroFouls;
    totalHeroScratches += res.heroScratches;
    if (res.isRunOut) totalRunOuts++;
    if (res.goldenBreak) totalGoldenBreaks++;
    totalInGameTimeSec += res.inGameTimeSec;

    // Alternate breaker or winner breaks (let's alternate breaker for pure fairness)
    breaker = r % 2 === 0 ? 'hero' : 'opp';

    if (r % 25 === 0) {
      console.log(`   [Hiệp ${r}/${totalRacks}] Tỷ số hiện tại: Hero ${heroWins} - ${oppWins} ${oppDiff.label} (Winrate: ${((heroWins / r) * 100).toFixed(1)}%)`);
    }
  }

  const durationMs = performance.now() - t0;
  const winRate = (heroWins / totalRacks) * 100;
  const potRate = totalHeroShots > 0 ? (totalHeroPots / totalHeroShots) * 100 : 0;

  console.log(`=> KẾT QUẢ VS BOT ${oppDiff.label.toUpperCase()}: Hero ${heroWins} - ${oppWins} ${oppDiff.label} | Tỷ lệ thắng: ${winRate.toFixed(1)}% | Ăn bi: ${potRate.toFixed(1)}%`);

  return {
    oppKey,
    oppLabel: oppDiff.label,
    oppJitter: oppDiff.aimJitterDeg,
    totalRacks,
    heroWins,
    oppWins,
    winRate,
    heroShots: totalHeroShots,
    heroPots: totalHeroPots,
    heroMisses: totalHeroMisses,
    heroFouls: totalHeroFouls,
    heroScratches: totalHeroScratches,
    potRate,
    runOuts: totalRunOuts,
    goldenBreaks: totalGoldenBreaks,
    inGameTimeSec: totalInGameTimeSec,
    cpuDurationMs: durationMs,
  };
}

// Run all 4 benchmarks
console.log('================================================================');
console.log('BENCHMARK TOÀN DIỆN: HERO BOT VS 4 CẤP ĐỘ BOT (100 HIỆP MỖI BOT)');
console.log('================================================================');
console.log(`Cấu hình Bot Hero: Jitter = ${heroProfile.aimJitterDeg}°, BreakPower = ${heroProfile.breakPower * 100}%, Spin = Có, ProSpin = Có`);

const overallStart = performance.now();
const results = {};
const targets = ['easy', 'medium', 'hard', 'pro'];

for (const key of targets) {
  results[key] = benchmarkVsOpponent(key, 100);
}

const totalCpuTimeMs = performance.now() - overallStart;

console.log('\n================================================================');
console.log('TỔNG HỢP KẾT QUẢ 400 HIỆP ĐẤU:');
console.log('----------------------------------------------------------------');
for (const key of targets) {
  const r = results[key];
  console.log(`VS BOT ${r.oppLabel.padEnd(10)}: Thắng ${r.heroWins.toString().padStart(2)}/100 (${r.winRate.toFixed(1)}%) | Ăn bi: ${r.potRate.toFixed(1)}% | Run-out: ${r.runOuts} | Golden Break: ${r.goldenBreaks}`);
}
console.log(`Tổng thời gian tính toán CPU: ${(totalCpuTimeMs / 1000).toFixed(2)}s`);
console.log('================================================================');

writeFileSync('scripts/benchmark-hero-result.json', JSON.stringify({ hero: heroProfile, results, totalCpuTimeMs }, null, 2), 'utf-8');
console.log('Đã lưu kết quả chi tiết vào scripts/benchmark-hero-result.json');
