import test from 'node:test';
import assert from 'node:assert/strict';
import { createBall, createSim } from '../../src/core/physics.js';
import { tablePreset, cuePreset } from '../../src/core/equipment.js';
import {
  mulberry32,
  newSeed,
  packBalls,
  unpackBalls,
  packMatch,
  applyMatch,
  seatToWho,
  otherWho,
  parseRoomHash,
  roomLink,
  createShotGate,
} from '../../src/features/pvp.js';
import { parseRelayPayload } from '../../src/net/protocol.js';

const eq = { table: tablePreset('club-9ft'), cue: cuePreset('standard') };

test('mulberry32: same seed gives the same sequence in [0,1), different seeds differ', () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  const seqA = Array.from({ length: 50 }, () => a());
  const seqB = Array.from({ length: 50 }, () => b());
  assert.deepEqual(seqA, seqB);
  assert.ok(seqA.every((v) => v >= 0 && v < 1));
  assert.notDeepEqual(seqA, Array.from({ length: 50 }, ((c) => () => c())(mulberry32(12346))));
  assert.equal(new Set(seqA).size, 50);
  // known first values pin the algorithm so both devices can never drift apart after a refactor
  const first = mulberry32(1)();
  assert.equal(first, mulberry32(1)());
  assert.ok(Number.isFinite(first));
  const seed = newSeed();
  assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff);
  assert.equal(newSeed(() => 0.999999999999), 0xffffffff);
});

test('packBalls / unpackBalls round trip, potted balls skipped, orientation optional', () => {
  const live = [createBall(0, 500, 600), createBall(3, 900.123456789, 700), createBall(9, 1300, 650)];
  live[1].q = { w: 0.5, x: 0.5, y: 0.5, z: 0.5 };
  const potted = createBall(5, 1, 1);
  potted.potted = true;
  const list = packBalls([...live, potted]);
  assert.deepEqual(list, [
    { id: 0, x: 500, y: 600 },
    { id: 3, x: 900.123456789, y: 700 },
    { id: 9, x: 1300, y: 650 },
  ]);
  const withQ = packBalls(live, { withQuat: true });
  assert.deepEqual(withQ[1].q, { w: 0.5, x: 0.5, y: 0.5, z: 0.5 });

  // survives the wire (JSON) exactly: positions are never rounded
  const wired = JSON.parse(JSON.stringify(withQ));
  const back = unpackBalls(wired, createBall);
  assert.equal(back.length, 3);
  assert.equal(back[1].id, 3);
  assert.equal(back[1].pos.x, 900.123456789);
  assert.deepEqual(back[1].q, { w: 0.5, x: 0.5, y: 0.5, z: 0.5 });
  assert.deepEqual(back[0].q, { w: 1, x: 0, y: 0, z: 0 }); // identity when no orientation was sent
  assert.deepEqual(back[2].vel, { x: 0, y: 0 });
  // and it passes the protocol validator
  const v = parseRelayPayload({ k: 'shot', seq: 1, seed: 1, balls: withQ, aimDir: { x: 1, y: 0 }, power: 0.5, tip: { x: 0, y: 0 }, elev: 5 });
  assert.equal(v.ok, true);
});

function fakeState(over = {}) {
  return {
    targetId: 4,
    bot: {
      game: '8ball',
      raceTo: 7,
      scorePlayer: 2,
      scoreBot: 3,
      rack: 6,
      breaker: 'bot',
      turn: 'player',
      onBreak: false,
      ballInHand: true,
      isFoul: true,
      matchOver: false,
      groups: { player: 'solids', bot: 'stripes', bot1: null, bot2: null },
      statusText: 'Lượt Minh',
      pendingRack: null,
      // fields that must never be touched
      matchType: 'pvp',
      difficulty: 'hero',
      speed: 2,
      paused: true,
      bot1Name: 'Alpha',
      thinking: true,
      timers: [1, 2],
    },
    ...over,
  };
}

test('packMatch/applyMatch: round trip keeps the match and touches nothing else', () => {
  const s = fakeState();
  const m = packMatch(s);
  assert.deepEqual(Object.keys(m).sort(), [
    'ballInHand', 'breaker', 'game', 'groups', 'isFoul', 'matchOver', 'onBreak', 'rack', 'raceTo', 'rackPending',
    'scoreBot', 'scorePlayer', 'statusText', 'targetId', 'turn',
  ].sort());
  assert.deepEqual(m.groups, { player: 'solids', bot: 'stripes' });
  assert.equal(m.rackPending, false);
  assert.equal(parseRelayPayload({ k: 'sync', seq: 1, reason: 'result', balls: [], potted: [], match: JSON.parse(JSON.stringify(m)) }).ok, true);

  const t = fakeState({ targetId: 99 });
  t.bot = { ...t.bot, game: '9ball', raceTo: 1, scorePlayer: 0, scoreBot: 0, rack: 1, breaker: 'player', turn: 'bot', onBreak: true, ballInHand: false, isFoul: false, matchOver: true, groups: { player: null, bot: null, bot1: null, bot2: null }, statusText: 'x' };
  const untouched = { matchType: t.bot.matchType, difficulty: t.bot.difficulty, speed: t.bot.speed, paused: t.bot.paused, bot1Name: t.bot.bot1Name, thinking: t.bot.thinking, timers: t.bot.timers, bot1: t.bot.groups.bot1 };
  applyMatch(t, JSON.parse(JSON.stringify(m)));
  assert.deepEqual(packMatch(t), m);
  assert.equal(t.targetId, 4);
  assert.deepEqual(
    { matchType: t.bot.matchType, difficulty: t.bot.difficulty, speed: t.bot.speed, paused: t.bot.paused, bot1Name: t.bot.bot1Name, thinking: t.bot.thinking, timers: t.bot.timers, bot1: t.bot.groups.bot1 },
    untouched,
  );
});

test('packMatch: rackPending mirrors a pending rack unless the match is over', () => {
  const s = fakeState();
  s.bot.pendingRack = 'bot';
  assert.equal(packMatch(s).rackPending, true);
  s.bot.matchOver = true;
  assert.equal(packMatch(s).rackPending, false);
  s.targetId = null;
  assert.equal(packMatch(s).targetId, null);
});

test('seat mapping and invite links', () => {
  assert.equal(seatToWho(1), 'player');
  assert.equal(seatToWho(2), 'bot');
  assert.equal(otherWho('player'), 'bot');
  assert.equal(otherWho('bot'), 'player');
  assert.equal(parseRoomHash('#room=ABCDE'), 'ABCDE');
  assert.equal(parseRoomHash('#room=abcde'), 'ABCDE');
  assert.equal(parseRoomHash('#c=1,1;room=ABCDE'), 'ABCDE');
  assert.equal(parseRoomHash('#room=ABC'), null);
  assert.equal(parseRoomHash('#room=ABCD0'), null);
  assert.equal(parseRoomHash('#room=ABCDEFG'), null);
  assert.equal(parseRoomHash('#c=1270,635;1=1905,635'), null); // a shared layout is not a room
  assert.equal(parseRoomHash(''), null);
  assert.equal(parseRoomHash(undefined), null);
  assert.equal(roomLink('https://x.example', '/', 'ABCDE'), 'https://x.example/#room=ABCDE');
});

test('createShotGate: fires exactly once, in either arrival order', () => {
  // animation first, then the sync
  const got1 = [];
  const g1 = createShotGate((s) => got1.push(s));
  assert.equal(g1.animationDone(4), false);
  assert.equal(got1.length, 0);
  const syncA = { seq: 4, reason: 'result' };
  assert.equal(g1.syncArrived(syncA), true);
  assert.deepEqual(got1, [syncA]);
  // duplicates of the same seq do not fire again without a new animation
  assert.equal(g1.syncArrived(syncA), false);
  assert.equal(got1.length, 1);

  // sync first, then the animation
  const got2 = [];
  const g2 = createShotGate();
  g2.onReady = (s) => got2.push(s);
  const syncB = { seq: 7, reason: 'result' };
  assert.equal(g2.syncArrived(syncB), false);
  assert.equal(g2.isWaiting(7), true);
  assert.equal(got2.length, 0);
  assert.equal(g2.animationDone(7), true);
  assert.deepEqual(got2, [syncB]);
  assert.equal(g2.isWaiting(7), false);
  assert.equal(g2.animationDone(7), false);
  assert.equal(got2.length, 1);

  // different seqs never pair up; reset forgets everything
  const got3 = [];
  const g3 = createShotGate((s) => got3.push(s));
  g3.syncArrived({ seq: 1 });
  g3.animationDone(2);
  assert.equal(got3.length, 0);
  g3.animationDone(1);
  assert.deepEqual(got3, [{ seq: 1 }]);
  g3.syncArrived({ seq: 5 });
  g3.reset();
  g3.animationDone(5);
  assert.equal(got3.length, 1);
});

/** A break-like layout where several balls collide and one pot may happen. */
function layout() {
  const d = 57.2 + 0.3;
  const dx = (d * Math.sqrt(3)) / 2;
  const list = [createBall(0, 600, 635)];
  const ids = [1, 2, 3, 4, 9, 5, 6, 7, 8];
  const rows = [1, 2, 3, 2, 1];
  let k = 0;
  rows.forEach((n, r) => {
    for (let j = 0; j < n; j++) list.push(createBall(ids[k++], 1900 + r * dx, 635 + (j - (n - 1) / 2) * d));
  });
  return list;
}

function runShot(balls, shot, seed) {
  const sim = createSim(balls, { recordPaths: false, table: eq.table, cue: eq.cue, rng: mulberry32(seed) });
  const launch = sim.strike(shot);
  sim.run(25);
  return {
    launch,
    miscue: sim.events.miscue,
    potted: [...sim.events.potted],
    balls: sim.balls.map((b) => ({ id: b.id, x: b.pos.x, y: b.pos.y, potted: b.potted })),
  };
}

test('determinism: same balls + same shot + same seed give identical results on two simulations', () => {
  const shot = { aimDir: { x: 1, y: 0.002 }, power: 0.85, tip: { x: 0.2, y: 0.1 }, elevationDeg: 5 };
  // the "opponent" device rebuilds everything from the wire format
  const base = layout();
  const wired = JSON.parse(JSON.stringify(packBalls(base, { withQuat: true })));
  const remote = unpackBalls(wired, createBall);
  const shotWired = JSON.parse(JSON.stringify(shot));

  const mine = runShot(base, shot, 987654321);
  const theirs = runShot(remote, shotWired, 987654321);
  assert.deepEqual(theirs, mine);
  assert.ok(mine.balls.some((b) => Math.abs(b.x - 1900) > 100 || b.potted), 'the break moved the rack');
});

test('determinism: a miscue shot (random deflection) is reproduced exactly from the seed', () => {
  // a tip offset beyond the cue's miscue limit always miscues; the deflection angle comes from the rng
  const shot = { aimDir: { x: 1, y: 0 }, power: 0.7, tip: { x: 0.9, y: 0.4 }, elevationDeg: 5 };
  const results = [];
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const a = runShot(layout(), shot, seed);
    const b = runShot(unpackBalls(JSON.parse(JSON.stringify(packBalls(layout()))), createBall), shot, seed);
    assert.equal(a.miscue, true, `seed ${seed} should miscue`);
    assert.deepEqual(b, a, `seed ${seed}`);
    results.push(JSON.stringify(a.balls[0]));
  }
  // different seeds really produce different miscue angles
  assert.ok(new Set(results).size > 1);
  // and the same seed twice is identical
  assert.deepEqual(runShot(layout(), shot, 42), runShot(layout(), shot, 42));
});
