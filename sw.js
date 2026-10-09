// Offline support for the Gas Trainer.
//
// dines09.github.io hosts several apps and CacheStorage is shared per ORIGIN,
// not per app. So this worker only ever touches caches whose name starts with
// PREFIX. Deleting "every cache except mine" wipes the other installed apps'
// offline copies (they then say "still installing, open with a connection").
const PREFIX = 'gas-trainer-';
const CACHE = PREFIX + 'v9';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/audio.js', 'js/device.js', 'js/gasworld.js', 'js/gx8000.js', 'js/gx9000.js',
  'js/meter-base.js', 'js/rx8000.js', 'js/seg.js', 'js/tasks.js', 'js/tubes.js', 'js/util.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png', 'icons/maskable-512.png',
];
const NET_TIMEOUT = 3500; // slow ship internet: fall back to the offline copy

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    const results = await Promise.allSettled(SHELL.map(async u => {
      const res = await fetch(u, { cache: 'reload' });
      if (!res.ok) throw new Error(u);
      await c.put(u, res);
    }));
    // A half-built cache must not replace a working one.
    if (results.some(r => r.status === 'rejected')) {
      await caches.delete(CACHE);
      throw new Error('precache incomplete, keeping the previous version');
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    // Only our own older versions. Never another app's cache.
    await Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Put back any shell file that went missing (another app or the browser may
// have cleared our cache), so the app keeps working offline.
async function heal() {
  const c = await caches.open(CACHE);
  await Promise.all(SHELL.map(async u => {
    if (await c.match(u)) return;
    try {
      const res = await fetch(u, { cache: 'reload' });
      if (res.ok) await c.put(u, res);
    } catch { /* offline: try again next time */ }
  }));
}

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

// App files: network first (newest version when online) with a short timeout,
// then the offline copy. Google Fonts: cache first.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !isFont) return;
  const isPage = req.mode === 'navigate';

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (isFont) {
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      } catch {
        return Response.error();
      }
    }
    const offline = async () =>
      (await cache.match(req, { ignoreSearch: true })) ||
      (isPage ? (await cache.match('index.html')) || (await cache.match('./')) : undefined);
    const net = fetch(req, { cache: 'no-cache' }).then(res => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    });
    try {
      return await Promise.race([net, timeout(NET_TIMEOUT)]);
    } catch {
      const hit = await offline();
      if (hit) return hit;
      try { return await net; } catch { return Response.error(); } // nothing cached: wait for the network
    }
  })());

  if (isPage) e.waitUntil(heal());
});
