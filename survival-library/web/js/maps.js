/* Offline maps: built-in world outline + optional PMTiles regional maps
   (maps/regions/*.pmtiles) + scanned map images (maps/images/*). */
(function () {
  "use strict";
  var map = null, world = null, catalog = null;
  var WP_KEY = "sl.waypoints";

  function css(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function dms(v, pos, neg) {
    var s = v < 0 ? neg : pos; v = Math.abs(v);
    var d = Math.floor(v), mf = (v - d) * 60, m = Math.floor(mf), sec = ((mf - m) * 60).toFixed(1);
    return d + "°" + m + "′" + sec + "″" + s;
  }
  function fmtLL(ll) {
    return ll.lat.toFixed(5) + ", " + ll.lng.toFixed(5) + "<br><span class='muted'>" +
      dms(ll.lat, "N", "S") + " " + dms(ll.lng, "E", "W") + "</span>";
  }
  function fmtDist(m) { return m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(m < 10000 ? 2 : 1) + " km"; }
  function loadWps() { try { return JSON.parse(localStorage.getItem(WP_KEY)) || []; } catch (e) { return []; } }
  function saveWps(w) { try { localStorage.setItem(WP_KEY, JSON.stringify(w)); } catch (e) { /* storage unavailable */ } }
  function getJSON(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(url); return r.json(); }); }

  function render(main) {
    stop();
    main.innerHTML =
      '<div class="section-title"><h1>Maps</h1><span class="muted small">Tap the map for coordinates, to set your location, or to save a waypoint.</span></div>' +
      '<div class="map-tools">' +
      '<select id="baseSel" aria-label="Map layer"><option value="world">World overview (built in)</option></select>' +
      '<button class="btn small" id="measureBtn" type="button" aria-pressed="false">📏 Measure</button>' +
      '<button class="btn small" id="clearBtn" type="button">Clear line</button>' +
      '<button class="btn small" id="meBtn" type="button">My location</button>' +
      '<span class="coord-box small" id="measureOut"></span></div>' +
      '<div class="map-shell"><div id="map"></div></div>' +
      '<div class="grid" style="margin-top:14px">' +
      '<div class="card"><h3>Saved waypoints <span class="muted small">(this phone only)</span></h3><ul class="wp-list" id="wpList"></ul>' +
      '<div class="btn-row"><button class="btn small" id="gpxBtn" type="button">Download as GPX</button></div></div>' +
      '<div class="card"><h3>Map files on this device</h3><div id="imgList" class="small"></div></div>' +
      '<div class="card"><h3>Reading coordinates</h3><p>Latitude first (N/S), then longitude (E/W). 0.01° ≈ 1.1 km. Give both when calling for help by radio. ' +
      'See <a href="#/a/map-and-compass">Map &amp; Compass</a>.</p></div></div>';

    if (!window.L) { main.querySelector("#map").innerHTML = '<p class="msg" style="padding:20px">Map library failed to load.</p>'; return; }

    var loc = App.getLocation();
    map = L.map("map", { worldCopyJump: true, preferCanvas: true, minZoom: 1, attributionControl: true })
      .setView(loc ? [loc.lat, loc.lon] : [20, 0], loc ? 7 : 2);
    L.control.scale({ metric: true, imperial: true }).addTo(map);
    map.attributionControl.setPrefix(false);

    // graticule every 10 degrees
    var grat = [];
    for (var la = -80; la <= 80; la += 10) grat.push([[la, -540], [la, 540]]);
    for (var lo = -540; lo <= 540; lo += 10) grat.push([[-85, lo], [85, lo]]);
    var gratLayer = L.polyline(grat, { color: css("--muted", "#888"), weight: 0.5, opacity: 0.4, interactive: false }).addTo(map);

    var worldLayer = null, vectorLayer = null;
    function showWorld() {
      if (vectorLayer) { map.removeLayer(vectorLayer); vectorLayer = null; }
      if (worldLayer) { worldLayer.addTo(map); return; }
      var draw = function (gj) {
        worldLayer = L.geoJSON(gj, {
          style: { color: css("--muted", "#777"), weight: 0.8, fillColor: css("--map-land", "#e6dccb"), fillOpacity: 1 },
          onEachFeature: function (f, layer) { layer.on("click", function (e) { L.DomEvent.stopPropagation(e); onMapClick(e, f.properties.name); }); }
        }).addTo(map);
        gratLayer.bringToFront();
        map.attributionControl.addAttribution("Borders: Natural Earth");
      };
      if (world) draw(world); else getJSON("maps/world-countries.geojson").then(function (g) { world = g; if (map) draw(g); });
    }
    function showVector(url) {
      if (worldLayer) map.removeLayer(worldLayer);
      if (vectorLayer) map.removeLayer(vectorLayer);
      if (!window.protomapsL) { alert("Vector map renderer missing."); return; }
      var dark = document.documentElement.dataset.theme === "dark" || document.documentElement.dataset.theme === "red" ||
        (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
      vectorLayer = protomapsL.leafletLayer({ url: url, flavor: dark ? "dark" : "light", lang: "en",
        attribution: "© OpenStreetMap contributors, Protomaps" });
      vectorLayer.addTo(map);
    }

    var sel = main.querySelector("#baseSel");
    sel.onchange = function () { if (sel.value === "world") showWorld(); else showVector(sel.value); };

    getJSON("maps/catalog.json").catch(function () { return { pmtiles: [], images: [] }; }).then(function (c) {
      catalog = c;
      c.pmtiles.forEach(function (p) {
        var o = document.createElement("option"); o.value = p.url; o.textContent = p.name + " (detailed)"; sel.appendChild(o);
      });
      var il = main.querySelector("#imgList");
      var parts = [];
      if (c.pmtiles.length) parts.push("<p><b>" + c.pmtiles.length + " detailed region(s)</b> — choose from the layer menu above.</p>");
      if (c.images.length) parts.push("<p><b>Scanned / printed maps:</b></p><ul>" + c.images.map(function (i) {
        return '<li><a href="' + i.url + '" target="_blank" rel="noopener">' + Markdown.escape(i.name) + "</a> <span class='muted'>(" + App.fmtBytes(i.bytes) + ")</span></li>";
      }).join("") + "</ul>");
      if (!parts.length) parts.push("<p class='muted'>Only the built-in world overview (country borders, coarse coastlines) is loaded. The device operator can add detailed street/terrain maps for this area — see <code>device/README.md</code> (Adding maps).</p>");
      il.innerHTML = parts.join("");
      if (c.pmtiles.length) { sel.value = c.pmtiles[0].url; showVector(c.pmtiles[0].url); } else showWorld();
    });

    // location marker
    var meMarker = null;
    function drawMe() {
      var l = App.getLocation();
      if (meMarker) { map.removeLayer(meMarker); meMarker = null; }
      if (l) meMarker = L.circleMarker([l.lat, l.lon], { radius: 8, color: "#fff", weight: 2, fillColor: "#2a7de1", fillOpacity: 1 })
        .bindTooltip("My saved location").addTo(map);
    }
    drawMe();
    main.querySelector("#meBtn").onclick = function () {
      var l = App.getLocation();
      if (l) map.setView([l.lat, l.lon], Math.max(map.getZoom(), 9));
      else alert("No location saved yet. Tap the map where you are and choose “Set as my location”.");
    };

    // waypoints
    var wpLayer = L.layerGroup().addTo(map);
    function drawWps() {
      wpLayer.clearLayers();
      var wps = loadWps(), list = main.querySelector("#wpList");
      list.innerHTML = wps.length ? "" : "<li class='muted small'>None yet. Tap the map → “Save waypoint”.</li>";
      wps.forEach(function (w, i) {
        L.circleMarker([w.lat, w.lon], { radius: 7, color: "#fff", weight: 2, fillColor: css("--accent", "#c2532f"), fillOpacity: 1 })
          .bindTooltip(w.name).addTo(wpLayer);
        var li = document.createElement("li");
        li.innerHTML = "<span><b>" + Markdown.escape(w.name) + "</b><br><span class='small muted'>" + w.lat.toFixed(5) + ", " + w.lon.toFixed(5) + "</span></span>";
        var go = document.createElement("button"); go.className = "btn small"; go.textContent = "Show"; go.type = "button";
        go.onclick = function () { map.setView([w.lat, w.lon], Math.max(map.getZoom(), 12)); window.scrollTo(0, 0); };
        var del = document.createElement("button"); del.className = "btn small"; del.textContent = "Delete"; del.type = "button";
        del.onclick = function () { if (confirm("Delete waypoint “" + w.name + "”?")) { var a = loadWps(); a.splice(i, 1); saveWps(a); drawWps(); } };
        var box = document.createElement("span"); box.appendChild(go); box.appendChild(del); li.appendChild(box);
        list.appendChild(li);
      });
    }
    drawWps();
    main.querySelector("#gpxBtn").onclick = function () {
      var wps = loadWps();
      if (!wps.length) { alert("No waypoints to export."); return; }
      var x = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Survival Library" xmlns="http://www.topografix.com/GPX/1/1">\n' +
        wps.map(function (w) { return '  <wpt lat="' + w.lat + '" lon="' + w.lon + '"><name>' + Markdown.escape(w.name) + "</name></wpt>"; }).join("\n") + "\n</gpx>\n";
      App.download("waypoints.gpx", x, "application/gpx+xml");
    };

    // measuring
    var measuring = false, pts = [], line = L.polyline([], { color: css("--danger", "#b3261e"), weight: 3, dashArray: "6 6" }).addTo(map);
    var mBtn = main.querySelector("#measureBtn"), mOut = main.querySelector("#measureOut");
    function updMeasure() {
      line.setLatLngs(pts);
      var d = 0; for (var i = 1; i < pts.length; i++) d += map.distance(pts[i - 1], pts[i]);
      mOut.textContent = measuring ? (pts.length < 2 ? "Tap points along your route…" : "Distance: " + fmtDist(d) + " (" + (d / 1000 * 0.621371).toFixed(2) + " mi)") : (pts.length > 1 ? "Distance: " + fmtDist(d) : "");
    }
    mBtn.onclick = function () {
      measuring = !measuring; mBtn.setAttribute("aria-pressed", measuring);
      mBtn.classList.toggle("primary", measuring);
      if (measuring) pts = [];
      updMeasure();
    };
    main.querySelector("#clearBtn").onclick = function () { pts = []; updMeasure(); };

    function onMapClick(e, name) {
      if (measuring) { pts.push(e.latlng); updMeasure(); return; }
      var ll = e.latlng.wrap();
      var div = document.createElement("div");
      div.innerHTML = (name ? "<b>" + Markdown.escape(name) + "</b><br>" : "") + fmtLL(ll) + "<br>";
      var b1 = document.createElement("button"); b1.className = "btn small"; b1.type = "button"; b1.textContent = "Set as my location";
      b1.onclick = function () { App.setLocation({ lat: +ll.lat.toFixed(5), lon: +ll.lng.toFixed(5) }); drawMe(); map.closePopup(); };
      var b2 = document.createElement("button"); b2.className = "btn small"; b2.type = "button"; b2.textContent = "Save waypoint";
      b2.onclick = function () {
        var n = prompt("Waypoint name (e.g. Spring, Camp, Bridge out):", "Waypoint " + (loadWps().length + 1));
        if (!n) return;
        var a = loadWps(); a.push({ name: n.slice(0, 60), lat: +ll.lat.toFixed(6), lon: +ll.lng.toFixed(6), t: Date.now() }); saveWps(a);
        drawWps(); map.closePopup();
      };
      div.appendChild(b1); div.appendChild(b2);
      L.popup().setLatLng(e.latlng).setContent(div).openOn(map);
    }
    map.on("click", function (e) { onMapClick(e, null); });
  }

  function stop() { if (map) { map.remove(); map = null; } }

  window.Maps = { render: render, stop: stop };
})();
