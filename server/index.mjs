// HTTP static server + WebSocket relay (/ws) for 1 vs 1 online. The only dependency is `ws`.
// Run: `npm start` (env: PORT, ALLOWED_ORIGINS, HOST, GA_MEASUREMENT_ID). The server only relays messages; it never simulates the game.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { createRoomManager } from './rooms.mjs';
import { MAX_BYTES, MSG, ERR, parseClientMessage } from '../src/net/protocol.js';
import { isAnalyticsId } from '../src/features/analytics.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/** Map a URL pathname to a file under root, or null when it is not on the allow-list. */
export function resolveStaticPath(pathname, root = ROOT) {
  let p;
  try {
    p = decodeURIComponent(pathname);
  } catch (e) {
    return null;
  }
  if (p.includes('\0') || p.includes('\\')) return null;
  if (p === '/' || p === '') p = '/index.html';
  const segs = p.split('/').filter((s) => s !== '');
  if (!segs.length) return null;
  if (segs.some((s) => s === '..' || s === '.' || s.startsWith('.'))) return null;
  const rel = segs.join('/');
  const allowed = rel === 'index.html' || rel === 'sw.js' || rel.startsWith('assets/') || rel.startsWith('src/');
  if (!allowed) return null;
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep)) return null;
  return full;
}

const ANALYTICS_META = '<meta name="ga-measurement-id" content="">';

/** index.html with the analytics id from the environment filled in (the repository keeps it empty). */
export function injectAnalyticsId(html, id) {
  return isAnalyticsId(id) ? html.replace(ANALYTICS_META, `<meta name="ga-measurement-id" content="${id}">`) : html;
}

function serveStatic(req, res, { analyticsId = '' } = {}) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('ok');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    res.end();
    return;
  }
  const file = resolveStaticPath(url.pathname);
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    if (analyticsId && path.basename(file) === 'index.html' && path.dirname(file) === ROOT) {
      fs.readFile(file, 'utf8', (e2, html) => {
        if (e2) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('Not found');
          return;
        }
        const body = Buffer.from(injectAnalyticsId(html, analyticsId), 'utf8');
        res.writeHead(200, { 'content-type': type, 'content-length': body.length, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
        res.end(req.method === 'HEAD' ? undefined : body);
      });
      return;
    }
    res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
}

export function parseOrigins(s) {
  return String(s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * opts: { port, host, allowedOrigins: string[], graceMs, idleMs, pingMs, sweepMs, ratePerSec, analyticsId }
 * Resolves to { port, close(), rooms } once listening (port 0 = pick a free port).
 */
export function startServer({
  port = Number(process.env.PORT) || 28787,
  host = process.env.HOST || '0.0.0.0',
  allowedOrigins = parseOrigins(process.env.ALLOWED_ORIGINS),
  graceMs = 60000,
  idleMs = 30 * 60000,
  pingMs = 25000,
  sweepMs = 10000,
  ratePerSec = 40,
  analyticsId = String(process.env.GA_MEASUREMENT_ID || '').trim(),
} = {}) {
  const rooms = createRoomManager({ graceMs, idleMs });
  const sockets = new Map(); // connId -> ws
  let nextId = 1;

  const server = http.createServer((req, res) => serveStatic(req, res, { analyticsId }));
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BYTES });

  const sendTo = (connId, obj) => {
    const ws = sockets.get(connId);
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  };
  const sendWs = (ws, obj) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  };

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const origin = req.headers.origin;
    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (allowedOrigins.length && origin && !allowedOrigins.includes(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    const connId = `c${nextId++}`;
    sockets.set(connId, ws);
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    ws.on('error', () => {});

    let windowStart = Date.now();
    let windowCount = 0;

    ws.on('message', (data, isBinary) => {
      const t = Date.now();
      if (t - windowStart >= 1000) {
        windowStart = t;
        windowCount = 0;
      }
      if (++windowCount > ratePerSec) {
        if (windowCount === ratePerSec + 1) sendWs(ws, { t: MSG.ERROR, code: ERR.RATE_LIMIT });
        return;
      }
      if (isBinary) {
        sendWs(ws, { t: MSG.ERROR, code: ERR.BAD_MESSAGE });
        return;
      }
      const parsed = parseClientMessage(data.toString('utf8'));
      if (!parsed.ok) {
        sendWs(ws, { t: MSG.ERROR, code: parsed.error });
        return;
      }
      handle(connId, ws, parsed.msg);
    });

    ws.on('close', () => {
      if (sockets.get(connId) === ws) sockets.delete(connId);
      const r = rooms.disconnect(connId);
      if (r && r.peerConnId) sendTo(r.peerConnId, { t: MSG.PEER_LEFT, graceMs });
    });
  });

  function handle(connId, ws, msg) {
    switch (msg.t) {
      case MSG.CREATE: {
        const r = rooms.create(connId, msg);
        if (!r.ok) return sendWs(ws, { t: MSG.ERROR, code: r.error });
        return sendWs(ws, { t: MSG.CREATED, code: r.code, token: r.token, seat: 1 });
      }
      case MSG.JOIN: {
        const r = rooms.join(connId, msg);
        if (!r.ok) return sendWs(ws, { t: MSG.ERROR, code: r.error });
        sendWs(ws, { t: MSG.JOINED, code: r.room.code, token: r.token, seat: 2, hostName: r.room.hostName, game: r.room.game, raceTo: r.room.raceTo });
        if (r.hostConnId) sendTo(r.hostConnId, { t: MSG.PEER_JOINED, name: msg.name });
        return undefined;
      }
      case MSG.REJOIN: {
        const r = rooms.rejoin(connId, msg);
        if (!r.ok) return sendWs(ws, { t: MSG.ERROR, code: r.error });
        if (r.replacedConnId) {
          const old = sockets.get(r.replacedConnId);
          sockets.delete(r.replacedConnId);
          if (old) old.terminate();
        }
        const peerOnline = !!r.peerConnId;
        if (r.seat === 1) sendWs(ws, { t: MSG.CREATED, code: r.room.code, token: r.token, seat: 1, peerOnline });
        else sendWs(ws, { t: MSG.JOINED, code: r.room.code, token: r.token, seat: 2, hostName: r.room.hostName, game: r.room.game, raceTo: r.room.raceTo, peerOnline });
        if (r.peerConnId) sendTo(r.peerConnId, { t: MSG.PEER_BACK });
        return undefined;
      }
      case MSG.RELAY: {
        const peer = rooms.peerOf(connId);
        if (!peer) {
          if (!rooms.roomOf(connId)) sendWs(ws, { t: MSG.ERROR, code: ERR.NO_ROOM });
          return undefined;
        }
        rooms.touch(connId);
        return sendTo(peer, { t: MSG.RELAY, p: msg.p });
      }
      case MSG.LEAVE: {
        const r = rooms.leave(connId);
        if (r && r.peerConnId) sendTo(r.peerConnId, { t: MSG.ROOM_CLOSED, reason: 'left' });
        return undefined;
      }
      default:
        return undefined;
    }
  }

  const pingTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch (e) {
        /* ignore */
      }
    }
  }, pingMs);
  const sweepTimer = setInterval(() => {
    for (const r of rooms.sweep()) {
      for (const id of r.connIds) sendTo(id, { t: MSG.ROOM_CLOSED, reason: r.reason });
    }
  }, sweepMs);
  pingTimer.unref();
  sweepTimer.unref();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const actualPort = server.address().port;
      resolve({
        port: actualPort,
        rooms,
        close() {
          clearInterval(pingTimer);
          clearInterval(sweepTimer);
          return new Promise((done) => {
            for (const ws of wss.clients) ws.terminate();
            wss.close(() => {
              server.close(() => done());
              server.closeAllConnections?.();
            });
          });
        },
      });
    });
  });
}

const isEntry = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isEntry) {
  startServer().then(({ port }) => {
    console.log(`MimePool server: http://localhost:${port}  (WebSocket: /ws, health: /healthz)`);
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
