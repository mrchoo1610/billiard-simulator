import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { startServer } from '../../server/index.mjs';
import { createNetClient } from '../../src/net/client.js';

const wsUrl = (srv) => `ws://127.0.0.1:${srv.port}/ws`;

/** Raw test client with a queue of received JSON messages. */
function open(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    const queue = [];
    const waiters = [];
    ws.on('message', (d) => {
      const msg = JSON.parse(d.toString());
      const w = waiters.shift();
      if (w) w(msg);
      else queue.push(msg);
    });
    ws.on('error', reject);
    ws.on('open', () =>
      resolve({
        ws,
        send: (o) => ws.send(typeof o === 'string' ? o : JSON.stringify(o)),
        next: (ms = 2000) =>
          new Promise((res, rej) => {
            if (queue.length) return res(queue.shift());
            const timer = setTimeout(() => rej(new Error('timeout waiting for a message')), ms);
            waiters.push((m) => {
              clearTimeout(timer);
              res(m);
            });
            return undefined;
          }),
        pending: () => queue.length,
        close: () => ws.close(),
      }),
    );
  });
}

const get = (srv, path) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.port, path, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const aim = { k: 'aim', angle: 12, power: 0.5, tip: { x: 0, y: 0 }, elev: 5, cue: { x: 400, y: 500 } };

test('two clients: create, join, relay both ways, drop, peer-left, rejoin, peer-back, leave', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1' });
  const A = await open(wsUrl(srv));
  const B = await open(wsUrl(srv));
  try {
    A.send({ t: 'create', name: 'An', game: '8ball', raceTo: 3 });
    const created = await A.next();
    assert.equal(created.t, 'created');
    assert.equal(created.seat, 1);
    assert.match(created.code, /^[A-HJ-NP-Z2-9]{5}$/);
    assert.match(created.token, /^[0-9a-f]{32}$/);

    B.send({ t: 'join', code: created.code.toLowerCase(), name: 'Bình' });
    const joined = await B.next();
    assert.equal(joined.t, 'joined');
    assert.equal(joined.seat, 2);
    assert.equal(joined.hostName, 'An');
    assert.equal(joined.game, '8ball');
    assert.equal(joined.raceTo, 3);
    assert.deepEqual(await A.next(), { t: 'peer-joined', name: 'Bình' });

    // relay both ways
    A.send({ t: 'relay', p: aim });
    const got = await B.next();
    assert.equal(got.t, 'relay');
    assert.deepEqual(got.p, aim);
    B.send({ t: 'relay', p: { k: 'rematch', accept: true } });
    assert.deepEqual(await A.next(), { t: 'relay', p: { k: 'rematch', accept: true } });

    // an invalid payload is refused and never reaches the peer
    A.send({ t: 'relay', p: { k: 'aim', angle: 'x' } });
    assert.deepEqual(await A.next(), { t: 'error', code: 'bad-message' });

    // B's connection drops: A is told, B keeps the seat and comes back with the token
    B.ws.terminate();
    const left = await A.next();
    assert.equal(left.t, 'peer-left');
    assert.equal(left.graceMs, 60000);

    const B2 = await open(wsUrl(srv));
    B2.send({ t: 'rejoin', code: created.code, token: joined.token });
    const back = await B2.next();
    assert.equal(back.t, 'joined');
    assert.equal(back.seat, 2);
    assert.equal(back.token, joined.token);
    assert.equal(back.peerOnline, true);
    assert.deepEqual(await A.next(), { t: 'peer-back' });

    A.send({ t: 'relay', p: aim });
    assert.deepEqual((await B2.next()).p, aim);

    // wrong token is refused
    const C = await open(wsUrl(srv));
    C.send({ t: 'rejoin', code: created.code, token: 'f'.repeat(32) });
    assert.deepEqual(await C.next(), { t: 'error', code: 'bad-token' });
    C.send({ t: 'join', code: created.code, name: 'Third' });
    assert.deepEqual(await C.next(), { t: 'error', code: 'room-full' });
    C.close();

    // leaving closes the room for the other side
    A.send({ t: 'leave' });
    assert.deepEqual(await B2.next(), { t: 'room-closed', reason: 'left' });
    B2.close();
  } finally {
    A.close();
    await srv.close();
  }
});

test('garbage input gets an error reply and never crashes the server', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1' });
  const A = await open(wsUrl(srv));
  try {
    for (const raw of ['not json', '[]', '{"t":"nope"}', '{"t":"join","code":"AB"}', '{"t":"create","game":"x","raceTo":1}']) {
      A.send(raw);
      const r = await A.next();
      assert.equal(r.t, 'error', raw);
    }
    // relay without being in a room
    A.send({ t: 'relay', p: { k: 'resign' } });
    assert.deepEqual(await A.next(), { t: 'error', code: 'no-room' });
    // binary frames are refused
    A.ws.send(Buffer.from([1, 2, 3]));
    assert.deepEqual(await A.next(), { t: 'error', code: 'bad-message' });
    // the connection is still usable afterwards
    A.send({ t: 'create', name: 'x', game: '9ball', raceTo: 1 });
    assert.equal((await A.next()).t, 'created');
  } finally {
    A.close();
    await srv.close();
  }
});

test('frames over 16 KB close the connection', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1' });
  const A = await open(wsUrl(srv));
  try {
    const closed = new Promise((res) => A.ws.on('close', res));
    A.send(JSON.stringify({ t: 'create', name: 'x'.repeat(20000), game: '9ball', raceTo: 5 }));
    await closed;
  } finally {
    await srv.close();
  }
});

test('rate limit: messages over the per-second budget are dropped with one error', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', ratePerSec: 5 });
  const A = await open(wsUrl(srv));
  try {
    for (let i = 0; i < 20; i++) A.send({ t: 'leave' });
    const m = await A.next();
    assert.deepEqual(m, { t: 'error', code: 'rate-limit' });
    await pause(50);
    assert.equal(A.pending(), 0); // only one error, the rest are silently dropped
  } finally {
    A.close();
    await srv.close();
  }
});

test('Origin allow-list for /ws', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', allowedOrigins: ['https://bida.example'] });
  try {
    const ok = await open(wsUrl(srv), { Origin: 'https://bida.example' });
    ok.close();
    const none = await open(wsUrl(srv)); // non-browser clients send no Origin
    none.close();
    await assert.rejects(open(wsUrl(srv), { Origin: 'https://evil.example' }));
    await assert.rejects(open(`ws://127.0.0.1:${srv.port}/other`));
  } finally {
    await srv.close();
  }
});

test('static files: allow-list, health check and traversal protection', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1' });
  try {
    const index = await get(srv, '/index.html');
    assert.equal(index.status, 200);
    assert.match(index.type, /text\/html/);
    assert.match(index.body, /<title>/);
    assert.equal((await get(srv, '/')).status, 200);
    assert.equal((await get(srv, '/healthz')).body, 'ok');

    const js = await get(srv, '/src/net/protocol.js');
    assert.equal(js.status, 200);
    assert.match(js.type, /text\/javascript/);
    assert.match((await get(srv, '/assets/style.css')).type, /text\/css/);
    assert.equal((await get(srv, '/sw.js')).status, 200);
    assert.match((await get(srv, '/assets/manifest.webmanifest')).type, /manifest\+json/);
    assert.match((await get(srv, '/assets/icon.svg')).type, /image\/svg\+xml/);

    for (const path of [
      '/server/index.mjs',
      '/server/rooms.mjs',
      '/package.json',
      '/package-lock.json',
      '/PLAN.md',
      '/README.md',
      '/tests/server/integration.test.mjs',
      '/docs/plan-v1-practice-sim.md',
      '/scripts/physics-audit.mjs',
      '/.env',
      '/.git/config',
      '/src/.hidden',
      '/node_modules/ws/package.json',
      '/assets/../package.json',
      '/%2e%2e/package.json',
      '/assets/%2e%2e/package.json',
      '/assets%2f..%2fpackage.json',
      '/src/..%5cpackage.json',
      '/src/missing.js',
    ]) {
      assert.equal((await get(srv, path)).status, 404, path);
    }
  } finally {
    await srv.close();
  }
});

test('net client: reconnects after a drop and rejoins with the saved token', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1' });
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const sockets = [];
  class Recording extends WebSocket {
    constructor(url) {
      super(url);
      sockets.push(this);
    }
  }
  const messages = [];
  const statuses = [];
  const waitFor = async (pred, ms = 3000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const hit = messages.find(pred);
      if (hit) return hit;
      await pause(10);
    }
    throw new Error('timeout');
  };
  const client = createNetClient({
    url: wsUrl(srv),
    WebSocketImpl: Recording,
    storage,
    delays: [30, 30],
    totalMs: 5000,
    onMessage: (m) => messages.push(m),
    onStatus: (s) => statuses.push(s),
  });
  const B = await open(wsUrl(srv));
  try {
    client.connect();
    for (let i = 0; i < 100 && client.status !== 'open'; i++) await pause(10);
    assert.equal(client.status, 'open');
    assert.equal(client.send({ t: 'create', name: 'Host', game: '9ball', raceTo: 5 }), true);
    const created = await waitFor((m) => m.t === 'created');
    client.setSession({ code: created.code, token: created.token, seat: 1 });
    assert.ok(store.has('bida9-room'));

    B.send({ t: 'join', code: created.code, name: 'Guest' });
    assert.equal((await B.next()).t, 'joined');
    await waitFor((m) => m.t === 'peer-joined');

    // network drop
    sockets[0].terminate();
    assert.equal((await B.next()).t, 'peer-left');
    await waitFor(() => statuses.includes('reconnecting'));
    // the client rejoins by itself
    const back = await waitFor((m) => m.t === 'created' && messages.indexOf(m) > messages.findIndex((x) => x.t === 'created'));
    assert.equal(back.token, created.token);
    assert.equal(client.rejoined, true);
    assert.equal((await B.next()).t, 'peer-back');
    assert.equal(client.status, 'open');

    // intentional close: no reconnect, session kept by the app (cleared here)
    client.setSession(null);
    client.close();
    assert.equal(client.status, 'closed');
    assert.equal(store.has('bida9-room'), false);
    assert.equal((await B.next()).t, 'peer-left');
  } finally {
    client.close();
    B.close();
    await srv.close();
  }
});

test('net client: gives up when the server stays unreachable for the whole window', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1' });
  const url = wsUrl(srv);
  const store = new Map([['bida9-room', JSON.stringify({ code: 'ABCDE', token: 'a'.repeat(32) })]]);
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  await srv.close(); // nothing is listening on that port any more
  const statuses = [];
  const client = createNetClient({ url, storage, delays: [20], totalMs: 150, onStatus: (s) => statuses.push(s) });
  client.connect();
  for (let i = 0; i < 100 && client.status !== 'closed'; i++) await pause(20);
  assert.equal(client.status, 'closed');
  assert.ok(statuses.includes('reconnecting'));
});

test('analytics id from the environment is injected into index.html, and only a valid one', async () => {
  const get = async (opts) => {
    const srv = await startServer({ port: 0, host: '127.0.0.1', ...opts });
    try {
      const res = await fetch(`http://127.0.0.1:${srv.port}/`);
      return { html: await res.text(), len: Number(res.headers.get('content-length')) };
    } finally {
      await srv.close();
    }
  };
  const off = await get({ analyticsId: '' });
  assert.match(off.html, /<meta name="ga-measurement-id" content="">/);
  const on = await get({ analyticsId: 'G-TEST12345' });
  assert.match(on.html, /<meta name="ga-measurement-id" content="G-TEST12345">/);
  assert.equal(on.len, Buffer.byteLength(on.html));
  const bad = await get({ analyticsId: 'G-x"><script>alert(1)</script>' });
  assert.match(bad.html, /<meta name="ga-measurement-id" content="">/);
  assert.doesNotMatch(bad.html, /alert\(1\)/);
});
