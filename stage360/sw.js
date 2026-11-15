/* Every Seat service worker: fast starts on Quest, updates still land.
   Pages + manifests: network first, cache fallback (each page cached under its own URL).
   Icons and the three.js module: cache first. The API (api/) is never cached. */
const CACHE = 'everyseat-v2';
const PRECACHE = ['./', './manifest.webmanifest', './link.js', 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const base = new URL('./', location).pathname;
  const sameApp = url.origin === location.origin && url.pathname.startsWith(base);
  if (sameApp && url.pathname.startsWith(base + 'api/')) return;      // live data: always network
  const isPage = sameApp && (e.request.mode === 'navigate' || url.pathname.endsWith('.webmanifest') || url.pathname.endsWith('link.js'));
  const isStatic = url.hostname === 'cdn.jsdelivr.net' || url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com') || (sameApp && url.pathname.includes('/icons/'));
  if (isPage) {
    // Cache by path (no query string) so ?seat=… links still work offline.
    const key = url.origin + url.pathname;
    e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(key, cp)); } return r; })
      .catch(() => caches.match(key).then(hit => hit || caches.match('./'))));
  } else if (isStatic) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return r; })));
  }
});
