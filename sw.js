/* =============================================================================
   sw.js — service worker for offline + installable PWA.

   • App shell (html/css/js/icons): precached on install, stale-while-revalidate.
   • Three.js from unpkg (CDN): cache-first runtime cache, so after the first
     online load the app keeps working with no connection.
   Bump CACHE_VERSION to force clients onto new assets.
   ============================================================================= */
const CACHE_VERSION = 'v2';
const SHELL = `grd-shell-${CACHE_VERSION}`;
const CDN = `grd-cdn-${CACHE_VERSION}`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/state.js',
  './js/glassTypes.js',
  './js/features.js',
  './js/hardware.js',
  './js/geometry.js',
  './js/pricing.js',
  './js/scene3d.js',
  './js/planView.js',
  './js/ui.js',
  './js/exporter.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => Promise.allSettled(SHELL_ASSETS.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => ![SHELL, CDN].includes(k)).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

const isCDN = (u) => u.hostname === 'unpkg.com' || u.hostname.endsWith('jsdelivr.net');
// During local dev never serve from cache, so edits always show on reload.
const DEV = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

self.addEventListener('fetch', (e) => {
  if (DEV) return; // fall through to the network
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))));
    return;
  }
  if (isCDN(url)) { e.respondWith(cacheFirst(req, CDN)); return; }
  if (url.origin === self.location.origin) { e.respondWith(staleWhileRevalidate(req, SHELL)); return; }
  e.respondWith(fetch(req).catch(() => caches.match(req)));
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  } catch (e) { return hit || Response.error(); }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const net = fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}
