/* Service worker (only active when the library is served over https).
   Caches everything a phone has viewed, plus the core app, so it keeps working after leaving the hotspot. */
var CACHE = "survival-library-v1";
var CORE = ["./", "index.html", "css/style.css", "js/app.js", "js/markdown.js", "js/stl-viewer.js", "js/sun.js",
  "js/compass.js", "js/maps.js", "js/toolkit.js", "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css",
  "vendor/protomaps-leaflet.js", "content/library.json", "prints/catalog.json", "maps/catalog.json",
  "maps/world-countries.geojson", "survival-library-offline.html"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  if (req.headers.get("range") || /\.(pmtiles|zip)$/.test(req.url)) return; // big files: network only
  // network first (library may be updated on the device), cache as fallback
  e.respondWith(fetch(req).then(function (res) {
    if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () { return caches.match(req).then(function (r) { return r || caches.match("index.html"); }); }));
});
