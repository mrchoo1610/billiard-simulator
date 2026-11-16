// 2,000 Racks Training Camp & Comparative Evaluation Benchmark
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
  loadHeroProfile,
  saveHeroProfile,
  recordHeroProgress,
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

// Simulate 1 rack with learning enabled
function playTrainingRack(oppDiff, breaker = 'hero') {
  let balls = createNineBallRack(GEO);
  let turn = breaker;
  let onBreak = true;
  let ballInHand = false;
  let rackWinner = null;
  let shotCount = 0;
  let heroPotsInRack = 0;

  let maxShots = 60;
  while (!rackWinner && maxShots-- > 0) {
    shotCount++;
    const isHero = turn === 'hero';
    const targetId = lowestBallId(balls);

    if (targetId === null) {
      rackWinner = turn;
      break;
    }

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
    const diffChoice = isHero ? 'hero' : oppDiff;

    const shotChoice = chooseBotShot(balls, GEO, EQ, diffChoice, {
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

    const evalRes = evaluateNineBallTurn({
      ballsBefore,
      simBalls: simRes.balls,
      events: simRes.events,
      geo: GEO,
    });
    balls = simRes.balls;

    if (isHero) {
      recordHeroProgress('shot');
      if (evalRes.pottedObj.length > 0) {
        recordHeroProgress('pot', { count: evalRes.pottedObj.length });
        heroPotsInRack += evalRes.pottedObj.length;
      } else {
        recordHeroProgress('miss');
      }
      if (evalRes.foul) {
        recordHeroProgress('foul', { scratch: evalRes.cuePotted });
      }
      if (onBreak && evalRes.winRack) {
        recordHeroProgress('golden_break');
      }
    }

    onBreak = false;

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

  if (rackWinner === 'hero') {
    if (shotCount <= 9 && heroPotsInRack >= 4) {
      recordHeroProgress('run_out');
    }
    recordHeroProgress('rack_win');
  } else {
    recordHeroProgress('rack_lost');
  }

  return { winner: rackWinner, shots: shotCount };
}

// Benchmark 100 racks without further training mutation
function evaluateVsOpponent(heroProfile, oppKey, totalRacks = 100) {
  const oppDiff = BOT_DIFFICULTIES[oppKey];
  let heroWins = 0;
  let heroShots = 0;
  let heroPots = 0;
  let runOuts = 0;
  let goldenBreaks = 0;
  let breaker = 'hero';

  for (let r = 1; r <= totalRacks; r++) {
    let balls = createNineBallRack(GEO);
    let turn = breaker;
    let onBreak = true;
    let ballInHand = false;
    let rackWinner = null;
    let shotCount = 0;
    let rackHeroPots = 0;

    let maxShots = 60;
    while (!rackWinner && maxShots-- > 0) {
      shotCount++;
      const isHero = turn === 'hero';
      const targetId = lowestBallId(balls);
      if (targetId === null) {
        rackWinner = turn;
        break;
      }

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
      const currentConfig = isHero ? heroProfile : oppDiff;

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
          rackHeroPots += evalRes.pottedObj.length;
        }
        if (onBreak && evalRes.winRack) {
          goldenBreaks++;
        }
      }

      onBreak = false;

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

    if (rackWinner === 'hero') {
      heroWins++;
      if (shotCount <= 9 && rackHeroPots >= 4) runOuts++;
    }

    breaker = r % 2 === 0 ? 'hero' : 'opp';
  }

  const winRate = (heroWins / totalRacks) * 100;
  const potRate = heroShots > 0 ? (heroPots / heroShots) * 100 : 0;
  return {
    oppKey,
    oppLabel: oppDiff.label,
    totalRacks,
    heroWins,
    oppWins: totalRacks - heroWins,
    winRate,
    potRate,
    runOuts,
    goldenBreaks,
  };
}

// MAIN RUNNER
console.log('================================================================');
console.log('GIAI ĐOẠN 1: HUẤN LUYỆN CHUYÊN SÂU 2.000 HIỆP ĐẤU CHO BOT HERO');
console.log('================================================================');

const heroBefore = loadHeroProfile();
console.log(`Chỉ số ban đầu: Level ${heroBefore.level}, XP = ${Math.round(heroBefore.xp)}, Aim Jitter = ${heroBefore.aimJitterDeg.toFixed(3)}°, BreakPower = ${(heroBefore.breakPower * 100).toFixed(1)}%`);

const tTrainStart = performance.now();
const TOTAL_TRAIN_RACKS = 2000;
let trainWins = 0;

for (let r = 1; r <= TOTAL_TRAIN_RACKS; r++) {
  // Sparring partner distribution: 20% Medium, 30% Hard, 50% Pro
  const oppKey = r <= 400 ? 'medium' : r <= 1000 ? 'hard' : 'pro';
  const oppDiff = BOT_DIFFICULTIES[oppKey];
  const breaker = r % 2 === 0 ? 'hero' : 'opp';

  const res = playTrainingRack(oppDiff, breaker);
  if (res.winner === 'hero') trainWins++;

  if (r % 250 === 0) {
    const curHero = loadHeroProfile();
    console.log(`   [Huấn luyện ${r.toString().padStart(4)}/${TOTAL_TRAIN_RACKS}] Level: ${curHero.level} | XP: ${Math.round(curHero.xp).toLocaleString()} | Jitter: ${curHero.aimJitterDeg.toFixed(3)}° | Tỷ lệ thắng tập: ${((trainWins / r) * 100).toFixed(1)}%`);
  }
}

const trainDurationSec = (performance.now() - tTrainStart) / 1000;
const heroAfter = loadHeroProfile();

console.log('\n================================================================');
console.log('HOÀN TẤT HUẤN LUYỆN 2.000 HIỆP!');
console.log(`Thời gian huấn luyện: ${trainDurationSec.toFixed(1)}s`);
console.log(`Chỉ số mới: Level ${heroAfter.level} (tăng +${heroAfter.level - heroBefore.level}) | XP: ${Math.round(heroAfter.xp).toLocaleString()} (tăng +${Math.round(heroAfter.xp - heroBefore.xp).toLocaleString()})`);
console.log(`Sai số ngắm (Aim Jitter): ${heroBefore.aimJitterDeg.toFixed(3)}°  ==>  ${heroAfter.aimJitterDeg.toFixed(3)}° (Cực kỳ sắc nét!)`);
console.log(`Lực phá bi: ${(heroBefore.breakPower * 100).toFixed(1)}%  ==>  ${(heroAfter.breakPower * 100).toFixed(1)}%`);
console.log('================================================================\n');

console.log('================================================================');
console.log('GIAI ĐOẠN 2: THI ĐẤU KIỂM CHỨNG LẠI VỚI 4 CẤP ĐỘ BOT (100 HIỆP MỖI BOT)');
console.log('================================================================');

// Load previous benchmark for comparison
let prevBenchmark = null;
try {
  prevBenchmark = JSON.parse(readFileSync('scripts/benchmark-hero-result.json', 'utf-8'));
} catch (e) {}

const evalTargets = ['easy', 'medium', 'hard', 'pro'];
const evalResults = {};

for (const key of evalTargets) {
  console.log(`>>> Đang đấu 100 hiệp với Bot: ${BOT_DIFFICULTIES[key].label.toUpperCase()}...`);
  evalResults[key] = evaluateVsOpponent(heroAfter, key, 100);
  const r = evalResults[key];
  const prevRate = prevBenchmark?.results?.[key]?.winRate ?? null;
  const diffStr = prevRate !== null ? ` (So với trước: ${r.winRate >= prevRate ? '+' : ''}${(r.winRate - prevRate).toFixed(1)}%)` : '';
  console.log(`   => Kết quả: Hero ${r.heroWins} - ${r.oppWins} ${r.oppLabel} | Winrate: ${r.winRate.toFixed(1)}%${diffStr} | Ăn bi: ${r.potRate.toFixed(1)}% | Run-out: ${r.runOuts}`);
}

console.log('\n================================================================');
console.log('BẢNG SO SÁNH TỶ LỆ THẮNG TRƯỚC VÀ SAU KHI LUYỆN TẬP 2.000 HIỆP:');
console.log('----------------------------------------------------------------');
console.log('| Cấp độ đối thủ | Trước tập (0.060°) | Sau tập 2000 hiệp (' + heroAfter.aimJitterDeg.toFixed(3) + '°) | Chênh lệch |');
console.log('| :--- | :---: | :---: | :---: |');
for (const key of evalTargets) {
  const r = evalResults[key];
  const oldRate = prevBenchmark?.results?.[key]?.winRate ?? 0;
  const delta = r.winRate - oldRate;
  const deltaStr = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
  console.log(`| Bot ${r.oppLabel.padEnd(10)} | ${oldRate.toFixed(1).padStart(5)}%           | ${r.winRate.toFixed(1).padStart(5)}%                     | ${deltaStr.padStart(10)} |`);
}
console.log('================================================================');

const fullPayload = {
  heroBefore,
  heroAfter,
  trainDurationSec,
  prevBenchmark: prevBenchmark?.results || null,
  newBenchmark: evalResults,
};

writeFileSync('scripts/hero-train-2000-comparison.json', JSON.stringify(fullPayload, null, 2), 'utf-8');
console.log('Đã lưu kết quả so sánh chi tiết vào scripts/hero-train-2000-comparison.json');
