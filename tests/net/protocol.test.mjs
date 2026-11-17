import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MSG,
  MAX_BYTES,
  ROOM_CODE_RE,
  ROOM_CODE_ALPHABET,
  sanitizeName,
  parseClientMessage,
  parseRelayPayload,
  parseServerMessage,
  makeRoomCode,
} from '../../src/net/protocol.js';

const match = (over = {}) => ({
  game: '9ball',
  raceTo: 5,
  scorePlayer: 1,
  scoreBot: 0,
  rack: 2,
  breaker: 'player',
  turn: 'bot',
  onBreak: false,
  ballInHand: true,
  isFoul: true,
  matchOver: false,
  groups: { player: null, bot: null },
  statusText: 'Lượt Khách',
  targetId: 3,
  ...over,
});
const balls = (n = 3) => Array.from({ length: n }, (_, i) => ({ id: i, x: 100 + i * 60, y: 200 }));
const shot = (over = {}) => ({
  k: 'shot',
  seq: 4,
  seed: 123456,
  balls: balls(),
  aimDir: { x: 1, y: 0 },
  power: 0.5,
  tip: { x: 0, y: 0.1 },
  elev: 5,
  ...over,
});
const sync = (over = {}) => ({ k: 'sync', seq: 4, reason: 'result', balls: balls(), potted: [2], match: match(), toast: 'Vào lỗ!', ...over });
const wire = (o) => JSON.stringify(o);

test('room code: alphabet has no I, O, 0, 1 and codes validate', () => {
  assert.equal(ROOM_CODE_ALPHABET.length, 32);
  for (const bad of ['I', 'O', '0', '1']) assert.ok(!ROOM_CODE_ALPHABET.includes(bad));
  let i = 0;
  const code = makeRoomCode(() => (i++ % 32) / 32);
  assert.match(code, ROOM_CODE_RE);
  assert.equal(code, 'ABCDE');
  for (let n = 0; n < 200; n++) assert.match(makeRoomCode(), ROOM_CODE_RE);
  assert.match(makeRoomCode(() => 0.999999999), ROOM_CODE_RE);
  assert.ok(!ROOM_CODE_RE.test('ABCD')); // too short
  assert.ok(!ROOM_CODE_RE.test('ABCDEF')); // too long
  assert.ok(!ROOM_CODE_RE.test('ABCD0')); // forbidden character
  assert.ok(!ROOM_CODE_RE.test('abcde')); // lower case is normalised before the test
});

test('sanitizeName: trims, caps at 15, strips control characters, falls back', () => {
  assert.equal(sanitizeName('  Minh  '), 'Minh');
  assert.equal(sanitizeName('A'.repeat(40)), 'A'.repeat(15));
  assert.equal(sanitizeName(`Mi${String.fromCharCode(0)}nh${String.fromCharCode(7, 10)}`), 'Minh');
  assert.equal(sanitizeName(`Lan${String.fromCharCode(0x2028)}Anh`), 'LanAnh');
  assert.equal(sanitizeName('   '), 'Người chơi');
  assert.equal(sanitizeName(''), 'Người chơi');
  assert.equal(sanitizeName(null), 'Người chơi');
  assert.equal(sanitizeName(42), 'Người chơi');
  assert.equal(sanitizeName('Nguyễn Văn Tuấn Anh Quân'), 'Nguyễn Văn Tuấn');
});

test('parseClientMessage: valid messages of every type', () => {
  let r = parseClientMessage(wire({ t: 'create', name: ' An ', game: '8ball', raceTo: 7 }));
  assert.deepEqual(r, { ok: true, msg: { t: 'create', name: 'An', game: '8ball', raceTo: 7 } });
  r = parseClientMessage(wire({ t: 'create', name: '', game: '9ball', raceTo: 0 }));
  assert.equal(r.ok, true);
  assert.equal(r.msg.name, 'Người chơi');
  r = parseClientMessage(wire({ t: 'join', code: 'abcde', name: 'Bình' }));
  assert.deepEqual(r, { ok: true, msg: { t: 'join', code: 'ABCDE', name: 'Bình' } });
  const token = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  r = parseClientMessage(wire({ t: 'rejoin', code: 'ABCDE', token }));
  assert.deepEqual(r, { ok: true, msg: { t: 'rejoin', code: 'ABCDE', token } });
  r = parseClientMessage(wire({ t: 'relay', p: { k: 'resign' } }));
  assert.deepEqual(r, { ok: true, msg: { t: 'relay', p: { k: 'resign' } } });
  r = parseClientMessage(wire({ t: 'leave' }));
  assert.deepEqual(r, { ok: true, msg: { t: 'leave' } });
});

test('parseClientMessage: rejects garbage without throwing', () => {
  const bad = [
    '',
    'not json',
    '[]',
    '42',
    'null',
    wire({}),
    wire({ t: 5 }),
    wire({ t: 'nope' }),
    wire({ t: 'create', game: '10ball', raceTo: 5 }),
    wire({ t: 'create', game: '9ball', raceTo: 4 }),
    wire({ t: 'create', game: '9ball' }),
    wire({ t: 'join', code: 'ABC', name: 'x' }),
    wire({ t: 'join', code: 'ABCD0', name: 'x' }),
    wire({ t: 'join', name: 'x' }),
    wire({ t: 'rejoin', code: 'ABCDE', token: 'zz' }),
    wire({ t: 'rejoin', code: 'ABCDE' }),
    wire({ t: 'relay' }),
    wire({ t: 'relay', p: { k: 'dance' } }),
  ];
  for (const raw of bad) {
    const r = parseClientMessage(raw);
    assert.equal(r.ok, false, raw);
    assert.equal(typeof r.error, 'string');
  }
  assert.equal(parseClientMessage(undefined).ok, false);
  assert.equal(parseClientMessage(Buffer.from('{"t":"leave"}')).ok, false); // only text frames are accepted
  assert.equal(parseClientMessage(wire({ t: 'join', code: 'ABC', name: 'x' })).error, 'no-room');
});

test('parseClientMessage: size limit', () => {
  const big = wire({ t: 'create', name: 'x'.repeat(MAX_BYTES), game: '9ball', raceTo: 5 });
  assert.ok(big.length > MAX_BYTES);
  assert.equal(parseClientMessage(big).ok, false);
  // multi-byte text counts bytes, not characters
  const wide = wire({ t: 'create', name: 'ế'.repeat(6000), game: '9ball', raceTo: 5 });
  assert.ok(wide.length < MAX_BYTES && Buffer.byteLength(wide) > MAX_BYTES);
  assert.equal(parseClientMessage(wide).ok, false);
  const ok = wire({ t: 'create', name: 'x'.repeat(500), game: '9ball', raceTo: 5 });
  assert.equal(parseClientMessage(ok).ok, true);
});

test('relay payload: aim', () => {
  const good = { k: 'aim', angle: -33.5, power: 0.4, tip: { x: 0.1, y: -0.2 }, elev: 5, cue: { x: 500, y: 600 }, extra: 'dropped' };
  const r = parseRelayPayload(good);
  assert.equal(r.ok, true);
  assert.deepEqual(r.msg, { k: 'aim', angle: -33.5, power: 0.4, tip: { x: 0.1, y: -0.2 }, elev: 5, cue: { x: 500, y: 600 } });
  assert.equal(parseRelayPayload({ ...good, power: 1.5 }).ok, false);
  assert.equal(parseRelayPayload({ ...good, power: -0.1 }).ok, false);
  assert.equal(parseRelayPayload({ ...good, angle: Infinity }).ok, false);
  assert.equal(parseRelayPayload({ ...good, angle: NaN }).ok, false);
  assert.equal(parseRelayPayload({ ...good, angle: '10' }).ok, false);
  assert.equal(parseRelayPayload({ ...good, tip: { x: 1 } }).ok, false);
  assert.equal(parseRelayPayload({ ...good, cue: null }).ok, false);
  assert.equal(parseRelayPayload({ ...good, elev: undefined }).ok, false);
});

test('relay payload: shot', () => {
  const r = parseRelayPayload(shot());
  assert.equal(r.ok, true);
  assert.equal(r.msg.seq, 4);
  assert.equal(r.msg.balls.length, 3);
  // optional orientation travels with the balls
  const q = { w: 1, x: 0, y: 0, z: 0 };
  const withQ = parseRelayPayload(shot({ balls: [{ id: 0, x: 1, y: 2, q }, { id: 1, x: 3, y: 4 }] }));
  assert.equal(withQ.ok, true);
  assert.deepEqual(withQ.msg.balls[0].q, q);
  assert.equal(parseRelayPayload(shot({ balls: [{ id: 0, x: 1, y: 2, q: { w: 1 } }] })).ok, false);
  assert.equal(parseRelayPayload(shot({ seq: -1 })).ok, false);
  assert.equal(parseRelayPayload(shot({ seq: 1.5 })).ok, false);
  assert.equal(parseRelayPayload(shot({ seed: -3 })).ok, false);
  assert.equal(parseRelayPayload(shot({ seed: 2 ** 32 })).ok, false);
  assert.equal(parseRelayPayload(shot({ seed: 2 ** 32 - 1 })).ok, true);
  assert.equal(parseRelayPayload(shot({ power: 2 })).ok, false);
  assert.equal(parseRelayPayload(shot({ aimDir: { x: NaN, y: 0 } })).ok, false);
  assert.equal(parseRelayPayload(shot({ balls: [{ id: 1, x: 1, y: 2 }] })).ok, false); // no cue ball
  assert.equal(parseRelayPayload(shot({ balls: [{ id: 0, x: 1, y: 2 }, { id: 0, x: 3, y: 4 }] })).ok, false); // duplicate id
  assert.equal(parseRelayPayload(shot({ balls: [{ id: 16, x: 1, y: 2 }] })).ok, false);
  assert.equal(parseRelayPayload(shot({ balls: [{ id: 0, x: Infinity, y: 2 }] })).ok, false);
  assert.equal(parseRelayPayload(shot({ balls: balls(17).map((b, i) => ({ ...b, id: i % 16 })) })).ok, false); // more than 16 balls
  assert.equal(parseRelayPayload(shot({ balls: 'x' })).ok, false);
});

test('relay payload: sync and match', () => {
  const r = parseRelayPayload(sync());
  assert.equal(r.ok, true);
  assert.equal(r.msg.reason, 'result');
  assert.equal(r.msg.toast, 'Vào lỗ!');
  assert.equal(r.msg.match.rackPending, false);
  assert.deepEqual(r.msg.potted, [2]);
  assert.equal(parseRelayPayload(sync({ toast: undefined })).msg.toast, undefined);
  for (const reason of ['result', 'rack', 'resync']) assert.equal(parseRelayPayload(sync({ reason })).ok, true);
  assert.equal(parseRelayPayload(sync({ reason: 'later' })).ok, false);
  assert.equal(parseRelayPayload(sync({ potted: [99] })).ok, false);
  assert.equal(parseRelayPayload(sync({ potted: 'x' })).ok, false);
  assert.equal(parseRelayPayload(sync({ balls: [] })).ok, true); // an empty table is still a valid snapshot
  assert.equal(parseRelayPayload(sync({ match: null })).ok, false);
  assert.equal(parseRelayPayload(sync({ match: match({ scorePlayer: Infinity }) })).ok, false);
  assert.equal(parseRelayPayload(sync({ match: match({ scoreBot: -1 }) })).ok, false);
  assert.equal(parseRelayPayload(sync({ match: match({ turn: 'bot1' }) })).ok, false);
  assert.equal(parseRelayPayload(sync({ match: match({ game: '6ball' }) })).ok, false);
  assert.equal(parseRelayPayload(sync({ match: match({ raceTo: 2 }) })).ok, false);
  assert.equal(parseRelayPayload(sync({ match: match({ ballInHand: 'yes' }) })).ok, false);
  assert.equal(parseRelayPayload(sync({ match: match({ groups: { player: 'diamonds', bot: null } }) })).ok, false);
  assert.equal(parseRelayPayload(sync({ match: match({ targetId: 99 }) })).ok, false);
  assert.equal(parseRelayPayload(sync({ match: match({ targetId: null }) })).ok, true);
  assert.equal(parseRelayPayload(sync({ match: match({ rackPending: true }) })).msg.match.rackPending, true);
  assert.equal(parseRelayPayload(sync({ match: match({ groups: { player: 'solids', bot: 'stripes' } }) })).ok, true);
  const long = parseRelayPayload(sync({ match: match({ statusText: 'x'.repeat(5000) }) }));
  assert.equal(long.ok, true);
  assert.equal(long.msg.match.statusText.length, 200);
});

test('relay payload: rematch, resign, unknown', () => {
  assert.deepEqual(parseRelayPayload({ k: 'rematch', accept: true }), { ok: true, msg: { k: 'rematch', accept: true } });
  assert.equal(parseRelayPayload({ k: 'rematch', accept: 'yes' }).ok, false);
  assert.equal(parseRelayPayload({ k: 'rematch' }).ok, false);
  assert.deepEqual(parseRelayPayload({ k: 'resign', junk: 1 }), { ok: true, msg: { k: 'resign' } });
  for (const p of [null, undefined, 5, 'x', [], {}, { k: 7 }, { k: 'shoot' }]) assert.equal(parseRelayPayload(p).ok, false);
});

test('parseServerMessage: server frames', () => {
  const token = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  assert.equal(parseServerMessage(wire({ t: 'created', code: 'ABCDE', token, seat: 1 })).ok, true);
  const j = parseServerMessage(wire({ t: 'joined', code: 'ABCDE', token, seat: 2, hostName: 'An', game: '8ball', raceTo: 3, peerOnline: false }));
  assert.equal(j.ok, true);
  assert.equal(j.msg.peerOnline, false);
  assert.equal(parseServerMessage(wire({ t: 'peer-joined', name: ' B ' })).msg.name, 'B');
  assert.equal(parseServerMessage(wire({ t: 'peer-left', graceMs: 60000 })).msg.graceMs, 60000);
  assert.equal(parseServerMessage(wire({ t: 'peer-back' })).ok, true);
  assert.equal(parseServerMessage(wire({ t: 'room-closed', reason: 'timeout' })).msg.reason, 'timeout');
  assert.equal(parseServerMessage(wire({ t: 'room-closed' })).msg.reason, 'left');
  assert.equal(parseServerMessage(wire({ t: 'error', code: 'room-full' })).msg.code, 'room-full');
  assert.equal(parseServerMessage(wire({ t: 'relay', p: { k: 'resign' } })).ok, true);
  assert.equal(parseServerMessage(wire({ t: 'relay', p: { k: 'bogus' } })).ok, false);
  assert.equal(parseServerMessage('{').ok, false);
  assert.equal(parseServerMessage(wire({ t: 'created', code: 'bad', token, seat: 1 })).ok, false);
  assert.equal(MSG.RELAY, 'relay');
});
