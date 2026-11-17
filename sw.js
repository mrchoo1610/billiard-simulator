// Network-first service worker for fresh app updates with offline cache fallback.
const CACHE_VERSION = 'bida9-v52';
const SHELL = [
  './',
  'index.html',
  'assets/style.css',
  'assets/icon.svg',
  'assets/manifest.webmanifest',
  'src/app.js',
  'src/core/build.js',
  'src/features/analytics.js',
  'src/core/vec.js',
  'src/core/equipment.js',
  'src/core/table.js',
  'src/core/geometry.js',
  'src/core/physics.js',
  'src/core/aim-solver.js',
  'src/ui/render.js',
  'src/ui/input.js',
  'src/ui/panel.js',
  'src/ui/settings.js',
  'src/ui/keyboard.js',
  'src/ui/render3d.js',
  'src/ui/view3d-math.js',
  'src/ui/drop-anim.js',
  'src/ui/sound.js',
  'assets/vendor/three/three.module.min.js',
  'src/features/drills.js',
  'src/features/share.js',
  'src/features/bot.js',
  'src/features/pvp.js',
  'src/net/protocol.js',
  'src/net/client.js',
  'src/net/config.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const path = new URL(req.url).pathname;
  if (path === '/ws' || path === '/healthz') return; // relay server endpoints are never cached
  const h = self.location.hostname;
  const isLocal = h === 'localhost' || h === '127.0.0.1' || h.startsWith('192.168.') || h.startsWith('10.') || h.startsWith('172.') || h.endsWith('.local');
  if (isLocal) {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true })),
    );
    return;
  }
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })),
  );
});
