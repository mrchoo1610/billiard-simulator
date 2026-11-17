// Pure helpers for 1 vs 1 online (no DOM, no sockets): seeded rng, ball/match snapshots, seat mapping, shot gate.
import { ROOM_CODE_RE } from '../net/protocol.js';

/** Small deterministic PRNG (same seed -> same sequence on both devices). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random 32-bit seed for a shot. */
export const newSeed = (rng = Math.random) => Math.floor(rng() * 4294967296) >>> 0;

/** balls: [{ id, pos: {x,y}, q? }] (live balls) -> [{ id, x, y, q? }]. Potted balls are skipped. */
export function packBalls(balls, { withQuat = false } = {}) {
  const out = [];
  for (const b of balls) {
    if (b.potted) continue;
    const o = { id: b.id, x: b.pos.x, y: b.pos.y };
    if (withQuat && b.q) o.q = { w: b.q.w, x: b.q.x, y: b.q.y, z: b.q.z };
    out.push(o);
  }
  return out;
}

/** list: [{ id, x, y, q? }] -> balls made by createBall(id, x, y) (orientation restored when present). */
export function unpackBalls(list, createBall) {
  return list.map((p) => {
    const b = createBall(p.id, p.x, p.y);
    if (p.q) b.q = { w: p.q.w, x: p.q.x, y: p.q.y, z: p.q.z };
    return b;
  });
}

/** Only these fields of state.bot (plus state.targetId) travel between the two devices. */
export function packMatch(state) {
  const b = state.bot;
  return {
    game: b.game,
    raceTo: b.raceTo,
    scorePlayer: b.scorePlayer,
    scoreBot: b.scoreBot,
    rack: b.rack,
    breaker: b.breaker,
    turn: b.turn,
    onBreak: !!b.onBreak,
    ballInHand: !!b.ballInHand,
    isFoul: !!b.isFoul,
    matchOver: !!b.matchOver,
    groups: { player: b.groups ? b.groups.player ?? null : null, bot: b.groups ? b.groups.bot ?? null : null },
    statusText: b.statusText || '',
    targetId: state.targetId ?? null,
    rackPending: b.pendingRack != null && !b.matchOver,
  };
}

/** Inverse of packMatch. Touches only the fields above (and clears pendingRack: the host re-creates its own timer). */
export function applyMatch(state, m) {
  const b = state.bot;
  b.game = m.game;
  b.raceTo = m.raceTo;
  b.scorePlayer = m.scorePlayer;
  b.scoreBot = m.scoreBot;
  b.rack = m.rack;
  b.breaker = m.breaker;
  b.turn = m.turn;
  b.onBreak = m.onBreak;
  b.ballInHand = m.ballInHand;
  b.isFoul = m.isFoul;
  b.matchOver = m.matchOver;
  b.groups = { ...(b.groups || {}), player: m.groups.player ?? null, bot: m.groups.bot ?? null };
  b.statusText = m.statusText;
  state.targetId = m.targetId;
  return state;
}

/** Seat 1 (room creator) plays as 'player', seat 2 (guest) as 'bot': the keys already used by groups and scores. */
export const seatToWho = (seat) => (seat === 1 ? 'player' : 'bot');
export const otherWho = (who) => (who === 'player' ? 'bot' : 'player');

/** Reads `room=ABCDE` from a location hash; null when absent or malformed. */
export function parseRoomHash(hash) {
  const m = /(?:^#|[#&;])room=([A-Za-z0-9]+)/.exec(hash || '');
  if (!m) return null;
  const code = m[1].toUpperCase();
  return ROOM_CODE_RE.test(code) ? code : null;
}

export const roomLink = (origin, pathname, code) => `${origin}${pathname}#room=${code}`;

/**
 * Pairs "my animation of the remote shot finished" with "the shooter's sync for that seq arrived".
 * onReady(sync) fires exactly once per seq, in whichever order the two events come.
 */
export function createShotGate(onReady = () => {}) {
  const gate = {
    onReady,
    done: new Set(),
    pending: new Map(),
    animationDone(seq) {
      if (this.pending.has(seq)) {
        const sync = this.pending.get(seq);
        this.pending.delete(seq);
        this.done.delete(seq);
        this.onReady(sync);
        return true;
      }
      this.done.add(seq);
      return false;
    },
    syncArrived(sync) {
      const seq = sync.seq;
      if (this.done.has(seq)) {
        this.done.delete(seq);
        this.pending.delete(seq);
        this.onReady(sync);
        return true;
      }
      this.pending.set(seq, sync);
      return false;
    },
    /** True while a sync for this seq is held back waiting for the animation. */
    isWaiting(seq) {
      return this.pending.has(seq);
    },
    reset() {
      this.done.clear();
      this.pending.clear();
    },
  };
  return gate;
}
