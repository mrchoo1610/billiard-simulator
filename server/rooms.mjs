// Pure room bookkeeping for the relay server (no sockets, no timers): connections are opaque ids.
import { randomBytes } from 'node:crypto';
import { ERR, makeRoomCode } from '../src/net/protocol.js';

const defaultToken = () => randomBytes(16).toString('hex');

/**
 * opts: { now(): ms, rng(): [0,1), graceMs, idleMs, newToken(): string }
 * A room has two seats. Seat 1 = creator (host), seat 2 = guest.
 */
export function createRoomManager({ now = Date.now, rng = Math.random, graceMs = 60000, idleMs = 30 * 60000, newToken = defaultToken } = {}) {
  const rooms = new Map(); // code -> room
  const conns = new Map(); // connId -> { code, seat }

  const publicRoom = (room) => ({
    code: room.code,
    game: room.game,
    raceTo: room.raceTo,
    hostName: room.seats[0].name,
    guestName: room.seats[1] ? room.seats[1].name : null,
  });

  const connOf = (room, seat) => (room.seats[seat - 1] ? room.seats[seat - 1].connId : null);

  function uniqueCode() {
    for (let i = 0; i < 200; i++) {
      const code = makeRoomCode(rng);
      if (!rooms.has(code)) return code;
    }
    return null;
  }

  function create(connId, { name, game, raceTo }) {
    if (conns.has(connId)) return { ok: false, error: ERR.BAD_MESSAGE };
    const code = uniqueCode();
    if (!code) return { ok: false, error: ERR.RATE_LIMIT };
    const token = newToken();
    const t = now();
    const room = {
      code,
      game,
      raceTo,
      seats: [{ connId, name, token, offlineSince: null }, null],
      lastActive: t,
    };
    rooms.set(code, room);
    conns.set(connId, { code, seat: 1 });
    return { ok: true, code, token, seat: 1, room: publicRoom(room) };
  }

  function join(connId, { code, name }) {
    if (conns.has(connId)) return { ok: false, error: ERR.BAD_MESSAGE };
    const room = rooms.get(code);
    if (!room) return { ok: false, error: ERR.NO_ROOM };
    if (room.seats[1]) return { ok: false, error: ERR.ROOM_FULL };
    const token = newToken();
    room.seats[1] = { connId, name, token, offlineSince: null };
    room.lastActive = now();
    conns.set(connId, { code, seat: 2 });
    return { ok: true, token, seat: 2, room: publicRoom(room), hostConnId: connOf(room, 1) };
  }

  /** Reclaim a seat after a network drop. A still-registered old connection of that seat is returned as replacedConnId. */
  function rejoin(connId, { code, token }) {
    if (conns.has(connId)) return { ok: false, error: ERR.BAD_MESSAGE };
    const room = rooms.get(code);
    if (!room) return { ok: false, error: ERR.NO_ROOM };
    const idx = room.seats.findIndex((s) => s && s.token === token);
    if (idx < 0) return { ok: false, error: ERR.BAD_TOKEN };
    const seat = room.seats[idx];
    const replacedConnId = seat.connId;
    if (replacedConnId) conns.delete(replacedConnId);
    seat.connId = connId;
    seat.offlineSince = null;
    room.lastActive = now();
    conns.set(connId, { code, seat: idx + 1 });
    const peerSeat = idx === 0 ? 2 : 1;
    return { ok: true, seat: idx + 1, token, room: publicRoom(room), peerConnId: connOf(room, peerSeat), replacedConnId };
  }

  /** The socket closed: keep the seat for graceMs. */
  function disconnect(connId) {
    const c = conns.get(connId);
    if (!c) return null;
    conns.delete(connId);
    const room = rooms.get(c.code);
    if (!room) return null;
    const seat = room.seats[c.seat - 1];
    if (seat && seat.connId === connId) {
      seat.connId = null;
      seat.offlineSince = now();
    }
    const peerSeat = c.seat === 1 ? 2 : 1;
    return { room: publicRoom(room), seat: c.seat, peerConnId: connOf(room, peerSeat) };
  }

  /** Close the room on purpose; returns the peer connection (if online) to notify. */
  function leave(connId) {
    const c = conns.get(connId);
    if (!c) return null;
    const room = rooms.get(c.code);
    conns.delete(connId);
    if (!room) return null;
    const peerSeat = c.seat === 1 ? 2 : 1;
    const peerConnId = connOf(room, peerSeat);
    if (peerConnId) conns.delete(peerConnId);
    rooms.delete(room.code);
    return { room: publicRoom(room), peerConnId };
  }

  function peerOf(connId) {
    const c = conns.get(connId);
    if (!c) return null;
    const room = rooms.get(c.code);
    if (!room) return null;
    return connOf(room, c.seat === 1 ? 2 : 1) || null;
  }

  function touch(connId) {
    const c = conns.get(connId);
    const room = c && rooms.get(c.code);
    if (room) room.lastActive = now();
  }

  /** Remove rooms that were offline longer than graceMs or idle longer than idleMs. Returns [{ code, reason, connIds }]. */
  function sweep() {
    const t = now();
    const out = [];
    for (const room of [...rooms.values()]) {
      const offlineTooLong = room.seats.some((s) => s && s.offlineSince !== null && t - s.offlineSince > graceMs);
      const idle = t - room.lastActive > idleMs;
      if (!offlineTooLong && !idle) continue;
      const connIds = room.seats.filter((s) => s && s.connId).map((s) => s.connId);
      for (const id of connIds) conns.delete(id);
      rooms.delete(room.code);
      out.push({ code: room.code, reason: 'timeout', connIds });
    }
    return out;
  }

  return {
    create,
    join,
    rejoin,
    disconnect,
    leave,
    peerOf,
    touch,
    sweep,
    graceMs,
    size: () => rooms.size,
    has: (code) => rooms.has(code),
    roomOf: (connId) => {
      const c = conns.get(connId);
      const room = c && rooms.get(c.code);
      return room ? { ...publicRoom(room), seat: c.seat } : null;
    },
  };
}
