/* Compass page: phone sensor compass when the browser allows it, and a
   sun compass that needs only the clock and an approximate location. */
(function () {
  "use strict";
  var timer = null, handler = null, evName = null, sensorHeading = null, state = {};
  var CARD = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

  function cardinal(d) { return CARD[Math.round(((d % 360) + 360) % 360 / 22.5) % 16]; }
  function fmtTime(d) { return d ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"; }
  function fmtMin(m) { m = ((m % 1440) + 1440) % 1440; var h = Math.floor(m / 60), mm = Math.floor(m % 60); return (h < 10 ? "0" : "") + h + ":" + (mm < 10 ? "0" : "") + mm; }

  function dialSVG() {
    var t = [];
    for (var a = 0; a < 360; a += 5) {
      var long = a % 30 === 0, mid = a % 10 === 0;
      var r1 = 88, r2 = long ? 76 : mid ? 80 : 84;
      t.push('<line x1="0" y1="-' + r1 + '" x2="0" y2="-' + r2 + '" transform="rotate(' + a + ')" stroke="currentColor" stroke-width="' + (long ? 1.6 : 0.8) + '"/>');
      if (long && a % 90 !== 0) t.push('<text transform="rotate(' + a + ') translate(0,-63)" text-anchor="middle" font-size="8" fill="currentColor">' + a + "</text>");
    }
    var cards = [["N", 0, "var(--danger)"], ["E", 90, "currentColor"], ["S", 180, "currentColor"], ["W", 270, "currentColor"]].map(function (c) {
      return '<text transform="rotate(' + c[1] + ') translate(0,-58)" text-anchor="middle" font-size="16" font-weight="800" fill="' + c[2] + '">' + c[0] + "</text>";
    }).join("");
    return '<svg viewBox="-100 -100 200 200" role="img" aria-label="Compass dial" style="color:var(--fg)">' +
      '<circle r="96" fill="var(--surface)" stroke="var(--border)" stroke-width="2"/>' +
      '<g id="rose">' + t.join("") + cards +
      '<path d="M0,-44 L7,0 L0,6 L-7,0Z" fill="var(--danger)"/><path d="M0,44 L7,0 L0,-6 L-7,0Z" fill="var(--muted)"/>' +
      "</g>" +
      '<g id="sunMark"><circle cy="-80" r="9" fill="#f5b301" stroke="var(--fg)" stroke-width="1"/>' +
      '<g stroke="#f5b301" stroke-width="2">' + [0, 45, 90, 135, 180, 225, 270, 315].map(function (a) {
        return '<line x1="0" y1="-92" x2="0" y2="-96" transform="rotate(' + a + ' 0 -80) "/>';
      }).join("") + "</g></g>" +
      '<path d="M0,-99 L-7,-87 L7,-87Z" fill="var(--accent)"/>' +
      '<circle r="4" fill="var(--fg)"/></svg>';
  }

  function render(main) {
    stop();
    var loc = App.getLocation();
    var secure = window.isSecureContext;
    var httpsUrl = "https://" + location.host + location.pathname + "#/compass";
    main.innerHTML =
      '<h1>Compass</h1>' +
      '<div class="compass-wrap">' +
      '<div class="card"><div class="dial-box">' + dialSVG() + '</div>' +
      '<p class="readout" id="hdg">—<small id="hdgSub">Set your location to use the sun compass</small></p>' +
      '<div class="btn-row" style="justify-content:center"><button class="btn primary" id="sensorBtn" type="button">Use phone compass sensor</button></div>' +
      '<p class="small muted" id="sensorMsg" style="text-align:center"></p></div>' +
      '<div>' +
      '<div class="card"><h2 style="margin-top:0">Sun compass — no sensors needed</h2>' +
      '<p class="small">Hold the phone flat and turn your body until the <b>sun symbol</b> sits at the <b>arrow at the top</b> of the dial, pointing at the real sun. The dial then shows true directions. Uses this phone\'s clock — check it is right.</p>' +
      '<div class="field-row"><div class="field"><label for="lat">Latitude (+N / −S)</label><input id="lat" type="number" step="0.01" min="-90" max="90" inputmode="decimal" value="' + (loc ? loc.lat : "") + '"></div>' +
      '<div class="field"><label for="lon">Longitude (+E / −W)</label><input id="lon" type="number" step="0.01" min="-180" max="180" inputmode="decimal" value="' + (loc ? loc.lon : "") + '"></div></div>' +
      '<div class="btn-row"><button class="btn" id="saveLoc" type="button">Save location</button>' +
      '<button class="btn" id="gpsBtn" type="button">Use GPS</button><a class="btn" href="#/maps">Pick on map</a></div>' +
      '<p class="small muted">Within ~50 km is plenty. No idea? Your country\'s capital is close enough to start.</p>' +
      '<table class="sun-table" id="sunTable"></table></div>' +
      '<div class="card" style="margin-top:12px"><h2 style="margin-top:0">Other ways to find north</h2>' +
      '<ul class="small"><li><a href="#/a/navigation-sun-stars">Shadow-stick, watch method, North Star, Southern Cross</a></li>' +
      '<li><a href="#/a/improvised-compass">Make a needle compass</a> · <a href="#/prints/float_compass">print a floating compass</a></li>' +
      '<li><a href="#/prints/sundial_sun_compass">Print a sundial / sun compass</a> for your latitude</li>' +
      '<li><a href="#/a/map-and-compass">Using a map and compass, declination</a></li></ul></div>' +
      '</div></div>';

    var latEl = main.querySelector("#lat"), lonEl = main.querySelector("#lon");
    function readLoc() {
      var la = parseFloat(latEl.value), lo = parseFloat(lonEl.value);
      if (isFinite(la) && isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) return { lat: la, lon: lo };
      return null;
    }
    main.querySelector("#saveLoc").onclick = function () {
      var l = readLoc();
      if (l) { App.setLocation(l); update(); } else alert("Enter latitude (−90 to 90) and longitude (−180 to 180).");
    };
    latEl.onchange = lonEl.onchange = function () { var l = readLoc(); if (l) { App.setLocation(l); update(); } };
    main.querySelector("#gpsBtn").onclick = function () {
      if (!navigator.geolocation || !secure) {
        alert("This browser only allows GPS over a secure (https) connection." + (secure ? "" : "\nTry: " + httpsUrl) + "\nYou can type a rough location or pick it on the map instead.");
        return;
      }
      navigator.geolocation.getCurrentPosition(function (p) {
        latEl.value = p.coords.latitude.toFixed(4); lonEl.value = p.coords.longitude.toFixed(4);
        App.setLocation({ lat: p.coords.latitude, lon: p.coords.longitude }); update();
      }, function (e) { alert("Could not get a GPS fix: " + e.message); }, { enableHighAccuracy: true, timeout: 30000 });
    };

    var msg = main.querySelector("#sensorMsg"), btn = main.querySelector("#sensorBtn");
    if (!secure) {
      msg.innerHTML = 'Phone browsers only give compass sensors to secure pages. If this device offers it, open <a href="' + httpsUrl + '">' + Markdown.escape(httpsUrl) + '</a> and accept the certificate warning. The sun compass works right here.';
    }
    btn.onclick = function () { startSensor(msg); };

    state.main = main;
    update();
    timer = setInterval(update, 1000);
  }

  function startSensor(msg) {
    function onAbs(e) {
      var h = null;
      if (typeof e.webkitCompassHeading === "number") h = e.webkitCompassHeading;
      else if (e.alpha != null && (e.absolute || evName === "deviceorientationabsolute")) h = 360 - e.alpha;
      if (h == null) return;
      var so = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
      sensorHeading = ((h + so) % 360 + 360) % 360;
      update();
    }
    function attach() {
      if (handler) window.removeEventListener(evName, handler);
      evName = ("ondeviceorientationabsolute" in window) ? "deviceorientationabsolute" : "deviceorientation";
      handler = onAbs;
      window.addEventListener(evName, handler);
      msg.textContent = "Listening to the compass sensor… move the phone in a figure-8 to calibrate. Keep it flat and away from metal.";
      setTimeout(function () { if (sensorHeading == null) msg.textContent = "No compass reading from this browser/phone. Use the sun compass instead."; }, 4000);
    }
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") {
      DeviceOrientationEvent.requestPermission().then(function (r) {
        if (r === "granted") attach(); else msg.textContent = "Permission refused. Use the sun compass instead.";
      }).catch(function () { msg.textContent = "This browser needs a secure (https) page for the compass sensor. Use the sun compass instead."; });
    } else if (window.DeviceOrientationEvent) attach();
    else msg.textContent = "This browser has no compass sensor support. Use the sun compass instead.";
  }

  function update() {
    var main = state.main;
    if (!main || !document.body.contains(main)) return;
    var loc = App.getLocation(), now = new Date();
    var rose = main.querySelector("#rose"), sunMark = main.querySelector("#sunMark");
    var hdg = main.querySelector("#hdg"), table = main.querySelector("#sunTable");
    var pos = loc ? Sun.position(now, loc.lat, loc.lon) : null;
    var heading = null, sub = "";
    if (sensorHeading != null) {
      heading = sensorHeading; sub = "phone sensor · magnetic";
    } else if (pos && pos.elevation > 0) {
      heading = pos.azimuth; sub = "sun compass · point ▲ at the sun";
    } else if (pos) {
      sub = "Sun is below the horizon — use the stars (see links)";
    }
    if (heading != null) {
      rose.setAttribute("transform", "rotate(" + (-heading) + ")");
      hdg.firstChild.nodeValue = Math.round(heading) + "° " + cardinal(heading);
    } else {
      rose.removeAttribute("transform");
      hdg.firstChild.nodeValue = "—";
    }
    main.querySelector("#hdgSub").textContent = sub || "Set your location to use the sun compass";
    if (pos && pos.elevation > -1 && heading != null) {
      sunMark.style.display = "";
      sunMark.setAttribute("transform", "rotate(" + (pos.azimuth - heading) + ")");
    } else sunMark.style.display = "none";

    if (!loc) { table.innerHTML = ""; return; }
    var t = Sun.times(now, loc.lat, loc.lon);
    var left = t.sunset && now < t.sunset && now > t.sunrise ? Math.round((t.sunset - now) / 60000) : null;
    var rows = [
      ["Sun direction (true)", Math.round(pos.azimuth) + "° " + cardinal(pos.azimuth)],
      ["Sun height above horizon", pos.elevation.toFixed(0) + "°"],
      ["Shadows point toward", Math.round((pos.azimuth + 180) % 360) + "° " + cardinal(pos.azimuth + 180)],
      ["Local solar time (for sundials)", fmtMin(pos.solarTimeMin)],
      ["Solar noon (sun due " + (loc.lat >= pos.decl ? "south" : "north") + ")", fmtTime(t.noon)],
      ["Sunrise", t.polar === "day" ? "sun stays up" : t.polar === "night" ? "sun stays down" : fmtTime(t.sunrise)],
      ["Sunset", t.polar ? "—" : fmtTime(t.sunset)],
      ["Daylight left", left != null ? Math.floor(left / 60) + " h " + (left % 60) + " min" : "—"]
    ];
    table.innerHTML = rows.map(function (r) { return "<tr><td>" + r[0] + "</td><td>" + r[1] + "</td></tr>"; }).join("");
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (handler) window.removeEventListener(evName, handler);
    handler = null; sensorHeading = null; state = {};
  }

  window.Compass = { render: render, stop: stop };
})();
