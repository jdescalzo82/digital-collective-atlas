/* Every Seat service worker: fast starts on Quest, updates still land.
   Page + manifest: network first, cache fallback. Icons and the three.js module: cache first. */
const CACHE = 'everyseat-v1';
const PRECACHE = ['./', './manifest.webmanifest', 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const sameApp = url.origin === location.origin && url.pathname.startsWith(new URL('./', location).pathname);
  const isPage = e.request.mode === 'navigate' || url.pathname.endsWith('manifest.webmanifest');
  const isStatic = url.hostname === 'cdn.jsdelivr.net' || url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com') || (sameApp && url.pathname.includes('/icons/'));
  if (isPage) {
    e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put('./', cp)); return r; })
      .catch(() => caches.match('./')));
  } else if (isStatic) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; })));
  }
});
