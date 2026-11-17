// Wire protocol for 1 vs 1 online. Pure module (no DOM, no sockets): shared by the browser client and the Node relay server.
// Every parse function returns { ok: true, msg } or { ok: false, error } and never throws.

export const MAX_BYTES = 16 * 1024;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
export const ROOM_CODE_RE = /^[A-HJ-NP-Z2-9]{5}$/;
export const NAME_MAX = 15;
export const DEFAULT_NAME = 'Người chơi';
export const GAMES = ['9ball', '8ball'];
export const RACE_OPTIONS = [0, 1, 3, 5, 7, 9, 11];
export const MAX_BALLS = 16;
export const MAX_TEXT = 200;

export const MSG = {
  // client -> server
  CREATE: 'create',
  JOIN: 'join',
  REJOIN: 'rejoin',
  RELAY: 'relay',
  LEAVE: 'leave',
  // server -> client
  CREATED: 'created',
  JOINED: 'joined',
  PEER_JOINED: 'peer-joined',
  PEER_LEFT: 'peer-left',
  PEER_BACK: 'peer-back',
  ROOM_CLOSED: 'room-closed',
  ERROR: 'error',
};

export const ERR = {
  BAD_MESSAGE: 'bad-message',
  NO_ROOM: 'no-room',
  ROOM_FULL: 'room-full',
  BAD_TOKEN: 'bad-token',
  RATE_LIMIT: 'rate-limit',
};

const SYNC_REASONS = ['result', 'rack', 'resync'];
const GROUPS = [null, 'solids', 'stripes'];
const TOKEN_RE = /^[0-9a-f]{16,64}$/;

const bad = (error = ERR.BAD_MESSAGE) => ({ ok: false, error });
const good = (msg) => ({ ok: true, msg });
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v, min = -Infinity, max = Infinity) => Number.isInteger(v) && v >= min && v <= max;

const isControlChar = (ch) => {
  const c = ch.codePointAt(0);
  return c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029;
};

/** Trim, drop control characters, cap at 15 chars; empty becomes "Người chơi". */
export function sanitizeName(s) {
  let out = typeof s === 'string' ? s : '';
  out = Array.from(out).filter((ch) => !isControlChar(ch)).join('').trim();
  out = Array.from(out).slice(0, NAME_MAX).join('').trim();
  return out || DEFAULT_NAME;
}

/** rng() -> [0,1). */
export function makeRoomCode(rng = Math.random) {
  let code = '';
  for (let i = 0; i < 5; i++) code += ROOM_CODE_ALPHABET[Math.min(ROOM_CODE_ALPHABET.length - 1, Math.floor(rng() * ROOM_CODE_ALPHABET.length))];
  return code;
}

const normCode = (c) => (typeof c === 'string' ? c.trim().toUpperCase() : '');

function xy(v) {
  if (!isObj(v) || !isNum(v.x) || !isNum(v.y)) return null;
  return { x: v.x, y: v.y };
}

function cleanText(v) {
  if (typeof v !== 'string') return null;
  return Array.from(v).map((ch) => (isControlChar(ch) ? ' ' : ch)).join('').slice(0, MAX_TEXT);
}

function cleanBalls(list, allowQuat) {
  if (!Array.isArray(list) || list.length > MAX_BALLS) return null;
  const out = [];
  const seen = new Set();
  for (const b of list) {
    if (!isObj(b) || !isInt(b.id, 0, 15) || !isNum(b.x) || !isNum(b.y) || seen.has(b.id)) return null;
    seen.add(b.id);
    const nb = { id: b.id, x: b.x, y: b.y };
    if (allowQuat && b.q !== undefined) {
      const q = b.q;
      if (!isObj(q) || !isNum(q.w) || !isNum(q.x) || !isNum(q.y) || !isNum(q.z)) return null;
      nb.q = { w: q.w, x: q.x, y: q.y, z: q.z };
    }
    out.push(nb);
  }
  return out;
}

/** Validate + normalise the `match` object (subset of state.bot + targetId). Returns null when invalid. */
export function cleanMatch(m) {
  if (!isObj(m)) return null;
  if (!GAMES.includes(m.game) || !RACE_OPTIONS.includes(m.raceTo)) return null;
  if (!isInt(m.scorePlayer, 0, 99) || !isInt(m.scoreBot, 0, 99) || !isInt(m.rack, 1, 999)) return null;
  if (!['player', 'bot'].includes(m.breaker) || !['player', 'bot'].includes(m.turn)) return null;
  for (const k of ['onBreak', 'ballInHand', 'isFoul', 'matchOver']) if (typeof m[k] !== 'boolean') return null;
  if (!isObj(m.groups) || !GROUPS.includes(m.groups.player ?? null) || !GROUPS.includes(m.groups.bot ?? null)) return null;
  const statusText = cleanText(m.statusText ?? '');
  if (statusText === null) return null;
  let targetId = null;
  if (m.targetId !== null && m.targetId !== undefined) {
    if (!isInt(m.targetId, 0, 15)) return null;
    targetId = m.targetId;
  }
  if (m.rackPending !== undefined && typeof m.rackPending !== 'boolean') return null;
  return {
    game: m.game,
    raceTo: m.raceTo,
    scorePlayer: m.scorePlayer,
    scoreBot: m.scoreBot,
    rack: m.rack,
    breaker: m.breaker,
    turn: m.turn,
    onBreak: m.onBreak,
    ballInHand: m.ballInHand,
    isFoul: m.isFoul,
    matchOver: m.matchOver,
    groups: { player: m.groups.player ?? null, bot: m.groups.bot ?? null },
    statusText,
    targetId,
    rackPending: !!m.rackPending,
  };
}

/** Validate the payload `p` of a relay message (both server and receiving client use this). */
export function parseRelayPayload(p) {
  if (!isObj(p) || typeof p.k !== 'string') return bad();
  switch (p.k) {
    case 'aim': {
      const tip = xy(p.tip);
      const cue = xy(p.cue);
      if (!isNum(p.angle) || !isNum(p.power) || p.power < 0 || p.power > 1 || !tip || !cue || !isNum(p.elev)) return bad();
      return good({ k: 'aim', angle: p.angle, power: p.power, tip, elev: p.elev, cue });
    }
    case 'shot': {
      const aimDir = xy(p.aimDir);
      const tip = xy(p.tip);
      const balls = cleanBalls(p.balls, true);
      if (!isInt(p.seq, 0, 1e9) || !isInt(p.seed, 0, 0xffffffff) || !balls || !aimDir || !tip) return bad();
      if (!isNum(p.power) || p.power < 0 || p.power > 1 || !isNum(p.elev)) return bad();
      if (!balls.some((b) => b.id === 0)) return bad();
      return good({ k: 'shot', seq: p.seq, seed: p.seed, balls, aimDir, power: p.power, tip, elev: p.elev });
    }
    case 'sync': {
      const balls = cleanBalls(p.balls, true);
      const match = cleanMatch(p.match);
      if (!isInt(p.seq, 0, 1e9) || !SYNC_REASONS.includes(p.reason) || !balls || !match) return bad();
      if (!Array.isArray(p.potted) || p.potted.length > MAX_BALLS || !p.potted.every((id) => isInt(id, 0, 15))) return bad();
      const msg = { k: 'sync', seq: p.seq, reason: p.reason, balls, potted: [...p.potted], match };
      if (p.toast !== undefined && p.toast !== null) {
        const t = cleanText(p.toast);
        if (t === null) return bad();
        msg.toast = t;
      }
      return good(msg);
    }
    case 'rematch':
      if (typeof p.accept !== 'boolean') return bad();
      return good({ k: 'rematch', accept: p.accept });
    case 'resign':
      return good({ k: 'resign' });
    default:
      return bad();
  }
}

function byteLength(raw) {
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(raw, 'utf8');
  return new TextEncoder().encode(raw).length;
}

/** raw: JSON text frame sent by a client. */
export function parseClientMessage(raw) {
  if (typeof raw !== 'string') return bad();
  if (raw.length > MAX_BYTES || byteLength(raw) > MAX_BYTES) return bad();
  let o;
  try {
    o = JSON.parse(raw);
  } catch (e) {
    return bad();
  }
  if (!isObj(o) || typeof o.t !== 'string') return bad();
  switch (o.t) {
    case MSG.CREATE: {
      if (!GAMES.includes(o.game) || !RACE_OPTIONS.includes(o.raceTo)) return bad();
      return good({ t: MSG.CREATE, name: sanitizeName(o.name), game: o.game, raceTo: o.raceTo });
    }
    case MSG.JOIN: {
      const code = normCode(o.code);
      if (!ROOM_CODE_RE.test(code)) return bad(ERR.NO_ROOM);
      return good({ t: MSG.JOIN, code, name: sanitizeName(o.name) });
    }
    case MSG.REJOIN: {
      const code = normCode(o.code);
      if (!ROOM_CODE_RE.test(code)) return bad(ERR.NO_ROOM);
      if (typeof o.token !== 'string' || !TOKEN_RE.test(o.token)) return bad(ERR.BAD_TOKEN);
      return good({ t: MSG.REJOIN, code, token: o.token });
    }
    case MSG.RELAY: {
      const r = parseRelayPayload(o.p);
      if (!r.ok) return r;
      return good({ t: MSG.RELAY, p: r.msg });
    }
    case MSG.LEAVE:
      return good({ t: MSG.LEAVE });
    default:
      return bad();
  }
}

/** Parse a server -> client frame in the browser (loose: only the shape the client relies on). */
export function parseServerMessage(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_BYTES * 2) return bad();
  let o;
  try {
    o = JSON.parse(raw);
  } catch (e) {
    return bad();
  }
  if (!isObj(o) || typeof o.t !== 'string') return bad();
  switch (o.t) {
    case MSG.CREATED:
      if (!ROOM_CODE_RE.test(o.code) || typeof o.token !== 'string' || o.seat !== 1) return bad();
      return good({ t: o.t, code: o.code, token: o.token, seat: 1, peerOnline: o.peerOnline === undefined ? undefined : !!o.peerOnline });
    case MSG.JOINED:
      if (!ROOM_CODE_RE.test(o.code) || typeof o.token !== 'string' || o.seat !== 2) return bad();
      if (!GAMES.includes(o.game) || !RACE_OPTIONS.includes(o.raceTo)) return bad();
      return good({ t: o.t, code: o.code, token: o.token, seat: 2, hostName: sanitizeName(o.hostName), game: o.game, raceTo: o.raceTo, peerOnline: o.peerOnline === undefined ? undefined : !!o.peerOnline });
    case MSG.PEER_JOINED:
      return good({ t: o.t, name: sanitizeName(o.name) });
    case MSG.PEER_LEFT:
      return good({ t: o.t, graceMs: isNum(o.graceMs) ? o.graceMs : 60000 });
    case MSG.PEER_BACK:
      return good({ t: o.t });
    case MSG.ROOM_CLOSED:
      return good({ t: o.t, reason: o.reason === 'timeout' ? 'timeout' : 'left' });
    case MSG.ERROR:
      return good({ t: o.t, code: typeof o.code === 'string' ? o.code : ERR.BAD_MESSAGE });
    case MSG.RELAY: {
      const r = parseRelayPayload(o.p);
      if (!r.ok) return r;
      return good({ t: MSG.RELAY, p: r.msg });
    }
    default:
      return bad();
  }
}
