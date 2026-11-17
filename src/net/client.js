// Browser WebSocket wrapper: connect, send, auto-reconnect with rejoin, status events.
import { MSG, parseServerMessage } from './protocol.js';

export const SESSION_KEY = 'bida9-room';
export const RECONNECT_DELAYS = [1000, 2000, 4000, 8000]; // then 8000 until the deadline
export const RECONNECT_TOTAL_MS = 60000;

export function loadSession(storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null) {
  try {
    const raw = storage && storage.getItem(SESSION_KEY);
    const o = raw ? JSON.parse(raw) : null;
    return o && typeof o.code === 'string' && typeof o.token === 'string' ? o : null;
  } catch (e) {
    return null;
  }
}

/**
 * opts: { url, onMessage(msg), onStatus(status), WebSocketImpl, storage, delays, totalMs }
 * status: 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'
 * The session ({ code, token, ...extra }) is kept in sessionStorage; while one is set, an unexpected drop reconnects
 * (1s, 2s, 4s, 8s... up to 60s in total) and sends `rejoin` as soon as the socket is open again.
 */
export function createNetClient({
  url,
  onMessage = () => {},
  onStatus = () => {},
  WebSocketImpl = typeof WebSocket !== 'undefined' ? WebSocket : null,
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  delays = RECONNECT_DELAYS,
  totalMs = RECONNECT_TOTAL_MS,
} = {}) {
  let ws = null;
  let status = 'idle';
  let session = loadSession(storage);
  let wantOpen = false; // false after close(): never reconnect
  let attempt = 0;
  let dropAt = 0;
  let timer = 0;
  let isReconnect = false;
  let lastRejoin = false;

  const setStatus = (s) => {
    if (status === s) return;
    status = s;
    onStatus(s);
  };

  function writeSession() {
    try {
      if (!storage) return;
      if (session) storage.setItem(SESSION_KEY, JSON.stringify(session));
      else storage.removeItem(SESSION_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  function open() {
    if (!WebSocketImpl) {
      setStatus('closed');
      return;
    }
    let sock;
    try {
      sock = new WebSocketImpl(url);
    } catch (e) {
      handleDrop();
      return;
    }
    ws = sock;
    sock.addEventListener('open', () => {
      if (ws !== sock) return;
      attempt = 0;
      const wasReconnect = isReconnect;
      isReconnect = false;
      lastRejoin = wasReconnect && !!session;
      setStatus('open');
      if (wasReconnect && session) sock.send(JSON.stringify({ t: MSG.REJOIN, code: session.code, token: session.token }));
    });
    sock.addEventListener('message', (ev) => {
      if (ws !== sock) return;
      const r = parseServerMessage(typeof ev.data === 'string' ? ev.data : String(ev.data));
      if (r.ok) onMessage(r.msg);
    });
    sock.addEventListener('error', () => {});
    sock.addEventListener('close', () => {
      if (ws !== sock) return;
      ws = null;
      handleDrop();
    });
  }

  function handleDrop() {
    if (!wantOpen) {
      setStatus('closed');
      return;
    }
    if (!session) {
      wantOpen = false;
      setStatus('closed');
      return;
    }
    if (!isReconnect) {
      isReconnect = true;
      dropAt = Date.now();
      attempt = 0;
    }
    if (Date.now() - dropAt >= totalMs) {
      wantOpen = false;
      isReconnect = false;
      setStatus('closed');
      return;
    }
    setStatus('reconnecting');
    const delay = delays[Math.min(attempt, delays.length - 1)];
    attempt += 1;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (wantOpen) open();
    }, delay);
  }

  return {
    connect() {
      if (ws || status === 'connecting') return;
      wantOpen = true;
      isReconnect = false; // a fresh connect() is never a rejoin; the app sends the first rejoin itself via send()
      setStatus('connecting');
      open();
    },
    send(obj) {
      if (!ws || ws.readyState !== 1) return false;
      try {
        ws.send(JSON.stringify(obj));
        return true;
      } catch (e) {
        return false;
      }
    },
    close() {
      wantOpen = false;
      isReconnect = false;
      clearTimeout(timer);
      const s = ws;
      ws = null;
      if (s) {
        try {
          s.close();
        } catch (e) {
          /* ignore */
        }
      }
      setStatus('closed');
    },
    /** Set/clear the room session ({ code, token, ... }); persisted for the reconnect and for a page reload. */
    setSession(next) {
      session = next || null;
      writeSession();
    },
    getSession: () => session,
    /** True when the last 'open' status was an automatic reconnect: the client itself sends `rejoin` right after it. */
    get rejoined() {
      return lastRejoin;
    },
    get status() {
      return status;
    },
  };
}
