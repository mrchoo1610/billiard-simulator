import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomManager } from '../../server/rooms.mjs';
import { ROOM_CODE_RE } from '../../src/net/protocol.js';

function setup(over = {}) {
  const clock = { t: 1_000_000 };
  let n = 0;
  const mgr = createRoomManager({
    now: () => clock.t,
    rng: () => ((n++ * 7) % 32) / 32,
    graceMs: 60000,
    idleMs: 30 * 60000,
    newToken: (() => {
      let k = 0;
      return () => `tok${String(k++).padStart(29, '0')}`;
    })(),
    ...over,
  });
  return { mgr, clock };
}

const opts = { name: 'An', game: '9ball', raceTo: 5 };

test('create: returns a valid code, token and seat 1', () => {
  const { mgr } = setup();
  const r = mgr.create('c1', opts);
  assert.equal(r.ok, true);
  assert.match(r.code, ROOM_CODE_RE);
  assert.equal(r.seat, 1);
  assert.equal(typeof r.token, 'string');
  assert.equal(mgr.size(), 1);
  assert.deepEqual(mgr.roomOf('c1'), { code: r.code, game: '9ball', raceTo: 5, hostName: 'An', guestName: null, seat: 1 });
  assert.equal(mgr.peerOf('c1'), null);
});

test('create: a connection that is already in a room cannot create another', () => {
  const { mgr } = setup();
  mgr.create('c1', opts);
  assert.equal(mgr.create('c1', opts).ok, false);
  assert.equal(mgr.size(), 1);
});

test('codes of simultaneous rooms are unique even with a repeating rng', () => {
  const { mgr } = setup({ rng: () => 0.5 });
  const a = mgr.create('c1', opts);
  assert.equal(a.ok, true);
  // the rng always yields the same code: a second room cannot be created
  const b = mgr.create('c2', opts);
  assert.equal(b.ok, false);
  assert.equal(mgr.size(), 1);
});

test('join: guest gets seat 2, the room is then full, wrong code is refused', () => {
  const { mgr } = setup();
  const { code } = mgr.create('c1', opts);
  const j = mgr.join('c2', { code, name: 'Bình' });
  assert.equal(j.ok, true);
  assert.equal(j.seat, 2);
  assert.equal(j.hostConnId, 'c1');
  assert.deepEqual({ game: j.room.game, raceTo: j.room.raceTo, hostName: j.room.hostName }, { game: '9ball', raceTo: 5, hostName: 'An' });
  assert.equal(mgr.peerOf('c1'), 'c2');
  assert.equal(mgr.peerOf('c2'), 'c1');

  assert.deepEqual(mgr.join('c3', { code, name: 'Cường' }), { ok: false, error: 'room-full' });
  assert.deepEqual(mgr.join('c4', { code: 'ZZZZZ', name: 'Dũng' }), { ok: false, error: 'no-room' });
  assert.equal(mgr.join('c2', { code, name: 'again' }).ok, false); // already inside
});

test('disconnect keeps the seat; rejoin within the grace period restores it', () => {
  const { mgr, clock } = setup();
  const { code, token } = mgr.create('c1', opts);
  const j = mgr.join('c2', { code, name: 'Bình' });
  const d = mgr.disconnect('c2');
  assert.equal(d.seat, 2);
  assert.equal(d.peerConnId, 'c1');
  assert.equal(mgr.peerOf('c1'), null); // peer is offline
  clock.t += 59_000;
  assert.deepEqual(mgr.sweep(), []);
  const r = mgr.rejoin('c9', { code, token: j.token });
  assert.equal(r.ok, true);
  assert.equal(r.seat, 2);
  assert.equal(r.peerConnId, 'c1');
  assert.equal(r.replacedConnId, null);
  assert.equal(mgr.peerOf('c1'), 'c9');
  assert.equal(mgr.peerOf('c9'), 'c1');
  clock.t += 120_000; // back online: no expiry any more
  assert.deepEqual(mgr.sweep(), []);
  // the host can also drop and come back
  mgr.disconnect('c1');
  assert.equal(mgr.rejoin('c10', { code, token }).seat, 1);
});

test('rejoin: wrong token, unknown room, and taking over a still-registered connection', () => {
  const { mgr } = setup();
  const { code, token } = mgr.create('c1', opts);
  mgr.join('c2', { code, name: 'B' });
  assert.deepEqual(mgr.rejoin('c3', { code, token: 'nope' }), { ok: false, error: 'bad-token' });
  assert.deepEqual(mgr.rejoin('c3', { code: 'ZZZZZ', token }), { ok: false, error: 'no-room' });
  // a half-open old socket of seat 1 is replaced
  const r = mgr.rejoin('c3', { code, token });
  assert.equal(r.ok, true);
  assert.equal(r.replacedConnId, 'c1');
  assert.equal(mgr.peerOf('c2'), 'c3');
  assert.equal(mgr.peerOf('c1'), null);
});

test('sweep: a seat offline longer than graceMs closes the room and reports who to tell', () => {
  const { mgr, clock } = setup();
  const { code } = mgr.create('c1', opts);
  mgr.join('c2', { code, name: 'B' });
  mgr.disconnect('c2');
  clock.t += 60_001;
  const swept = mgr.sweep();
  assert.deepEqual(swept, [{ code, reason: 'timeout', connIds: ['c1'] }]);
  assert.equal(mgr.size(), 0);
  assert.equal(mgr.peerOf('c1'), null);
  assert.equal(mgr.roomOf('c1'), null);
  assert.deepEqual(mgr.join('c3', { code, name: 'X' }), { ok: false, error: 'no-room' });
});

test('sweep: idle rooms expire, activity keeps them alive', () => {
  const { mgr, clock } = setup({ idleMs: 10 * 60000 });
  const a = mgr.create('a1', opts);
  const b = mgr.create('b1', { ...opts, name: 'Other' });
  assert.notEqual(a.code, b.code);
  clock.t += 9 * 60000;
  mgr.touch('a1');
  clock.t += 2 * 60000;
  const swept = mgr.sweep();
  assert.equal(swept.length, 1);
  assert.equal(swept[0].code, b.code);
  assert.deepEqual(swept[0].connIds, ['b1']);
  assert.equal(mgr.has(a.code), true);
});

test('leave: closes the room for both and names the peer to notify', () => {
  const { mgr } = setup();
  const { code, token } = mgr.create('c1', opts);
  mgr.join('c2', { code, name: 'B' });
  const l = mgr.leave('c2');
  assert.equal(l.peerConnId, 'c1');
  assert.equal(mgr.size(), 0);
  assert.equal(mgr.peerOf('c1'), null);
  assert.equal(mgr.rejoin('c3', { code, token }).error, 'no-room');
  assert.equal(mgr.leave('c1'), null);
  assert.equal(mgr.leave('nobody'), null);
});

test('leave while the peer is offline returns no connection to notify', () => {
  const { mgr } = setup();
  const { code } = mgr.create('c1', opts);
  mgr.join('c2', { code, name: 'B' });
  mgr.disconnect('c1');
  const l = mgr.leave('c2');
  assert.equal(l.peerConnId, null);
  assert.equal(mgr.size(), 0);
});

test('disconnect of an unknown connection is a no-op', () => {
  const { mgr } = setup();
  assert.equal(mgr.disconnect('ghost'), null);
  assert.equal(mgr.peerOf('ghost'), null);
});

test('real random tokens are 32 hex characters and unique', () => {
  const mgr = createRoomManager();
  const a = mgr.create('c1', opts);
  const j = mgr.join('c2', { code: a.code, name: 'B' });
  assert.match(a.token, /^[0-9a-f]{32}$/);
  assert.match(j.token, /^[0-9a-f]{32}$/);
  assert.notEqual(a.token, j.token);
});
