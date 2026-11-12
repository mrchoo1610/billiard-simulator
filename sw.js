// Cache-first service worker for the app shell. Bump CACHE_VERSION when files change.
const CACHE_VERSION = 'bida9-v8';
const SHELL = [
  './',
  'index.html',
  'assets/style.css',
  'assets/icon.svg',
  'assets/manifest.webmanifest',
  'src/app.js',
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
  'assets/vendor/three/three.module.min.js',
  'src/features/drills.js',
  'src/features/share.js',
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
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
