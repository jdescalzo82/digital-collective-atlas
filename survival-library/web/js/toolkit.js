/* Toolkit: Morse signaller & SOS flasher, flashlight, bleach calculator,
   CPR metronome, pace counter. All offline, no sensors needed. */
(function () {
  "use strict";
  var MORSE = {
    A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....", I: "..", J: ".---",
    K: "-.-", L: ".-..", M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-",
    U: "..-", V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--..",
    "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-", "5": ".....", "6": "-....",
    "7": "--...", "8": "---..", "9": "----.", ".": ".-.-.-", ",": "--..--", "?": "..--..", "/": "-..-.",
    "-": "-....-", "@": ".--.-.", "=": "-...-"
  };
  var actx = null, timers = [], oscs = [], cprTimer = null;

  function audio() {
    if (!actx) { var C = window.AudioContext || window.webkitAudioContext; if (C) actx = new C(); }
    if (actx && actx.state === "suspended") actx.resume();
    return actx;
  }
  function tone(start, dur, freq, vol) {
    var a = audio(); if (!a) return;
    var o = a.createOscillator(), g = a.createGain();
    o.frequency.value = freq || 700; o.type = "sine";
    var t0 = a.currentTime + start;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol || 0.4, t0 + 0.005);
    g.gain.setValueAtTime(vol || 0.4, t0 + dur - 0.005);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    oscs.push(o);
    o.onended = function () { var i = oscs.indexOf(o); if (i >= 0) oscs.splice(i, 1); };
  }

  function encode(text) {
    return text.toUpperCase().split(/\s+/).filter(Boolean).map(function (w) {
      return w.split("").map(function (c) { return MORSE[c] || ""; }).filter(Boolean).join(" ");
    }).join(" / ");
  }
  // -> list of [on(bool), units]
  function timeline(text, sos) {
    var seq = [];
    if (sos) { "...---...".split("").forEach(function (s, i) { if (i) seq.push([false, 1]); seq.push([true, s === "." ? 1 : 3]); }); return seq; }
    var words = text.toUpperCase().split(/\s+/).filter(Boolean);
    words.forEach(function (w, wi) {
      if (wi) seq.push([false, 7]);
      w.split("").filter(function (c) { return MORSE[c]; }).forEach(function (c, ci) {
        if (ci) seq.push([false, 3]);
        MORSE[c].split("").forEach(function (s, si) { if (si) seq.push([false, 1]); seq.push([true, s === "." ? 1 : 3]); });
      });
    });
    return seq;
  }

  function stopSignal() {
    timers.forEach(clearTimeout); timers = [];
    oscs.forEach(function (o) { try { o.stop(); } catch (e) { /* already stopped */ } }); oscs = [];
    var ov = document.getElementById("flashOv");
    if (ov) { ov.classList.remove("on", "lit"); }
  }

  function play(seq, unit, useLight, useSound, loop) {
    stopSignal();
    var ov = document.getElementById("flashOv");
    if (useLight) ov.classList.add("on");
    var t = 0;
    seq.forEach(function (s) {
      if (s[0]) {
        (function (start, dur) {
          timers.push(setTimeout(function () { if (useLight) ov.classList.add("lit"); }, start));
          timers.push(setTimeout(function () { if (useLight) ov.classList.remove("lit"); }, start + dur));
          if (useSound) tone(start / 1000, dur / 1000, 700, 0.5);
        })(t, s[1] * unit);
      }
      t += s[1] * unit;
    });
    timers.push(setTimeout(function () {
      if (loop) play(seq, unit, useLight, useSound, loop); else stopSignal();
    }, t + 7 * unit));
  }

  function stopCpr() { if (cprTimer) clearInterval(cprTimer); cprTimer = null; }

  function render(main) {
    stop();
    main.innerHTML =
      '<h1>Toolkit</h1>' +
      '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">' +

      '<section class="card tool"><h2>Signal: Morse & SOS</h2>' +
      '<div class="btn-row"><button class="btn danger" id="sosLight" type="button">SOS flash (screen)</button><button class="btn" id="sosSound" type="button">SOS beep</button></div>' +
      '<div class="field"><label for="mtext">Message</label><input type="text" id="mtext" value="HELP" autocomplete="off"></div>' +
      '<div class="morse-out" id="mout"></div>' +
      '<div class="field-row" style="margin-top:8px"><div class="field"><label for="munit">Speed</label><select id="munit"><option value="400">Slow (light, far away)</option><option value="250" selected>Normal</option><option value="120">Fast (sound)</option></select></div></div>' +
      '<div class="btn-row"><button class="btn" id="mLight" type="button">Flash it</button><button class="btn" id="mSound" type="button">Beep it</button><button class="btn" id="mStop" type="button">Stop</button></div>' +
      '<p class="small muted">Turn screen brightness to maximum. At night a phone screen can be seen for several km. Tap the screen to stop flashing. <a href="#/a/morse-code">Morse chart</a> · <a href="#/a/signaling">Signalling</a></p></section>' +

      '<section class="card tool"><h2>Flashlight</h2><p class="small">Full-screen white light. Tap to turn off. Uses battery quickly.</p>' +
      '<div class="btn-row"><button class="btn" id="torch" type="button">Turn on screen light</button></div></section>' +

      '<section class="card tool"><h2>Water: bleach dose</h2>' +
      '<div class="field-row"><div class="field"><label for="bvol">Water volume</label><input type="number" id="bvol" value="20" min="0" step="any" inputmode="decimal"></div>' +
      '<div class="field"><label for="bunit">Unit</label><select id="bunit"><option value="1">litres</option><option value="3.785">US gallons</option><option value="4.546">UK gallons</option></select></div></div>' +
      '<div class="field-row"><div class="field"><label for="bpct">Bleach strength (% sodium hypochlorite)</label><input type="number" id="bpct" value="6" min="0.5" max="15" step="0.25" inputmode="decimal"></div>' +
      '<div class="field"><label><input type="checkbox" id="bcloudy"> Water is cloudy or very cold</label></div></div>' +
      '<p class="big-result" id="bres"></p><p class="small" id="bres2"></p>' +
      '<p class="small muted">Unscented plain bleach only. Stir, wait 30 minutes. It should smell slightly of chlorine — if not, repeat the dose and wait 15 more minutes. Boiling is more reliable. <a href="#/a/water-disinfection">Making Water Safe</a></p></section>' +

      '<section class="card tool"><h2>CPR metronome</h2><p class="small">110 compressions per minute. Push hard (5–6 cm) and fast in the centre of the chest; let it fully rise.</p>' +
      '<div style="display:flex;align-items:center;gap:16px"><div class="metronome-dot" id="cprDot"></div><div><div class="big-result" id="cprCount">0</div><div class="small muted" id="cprHint">compressions</div></div></div>' +
      '<div class="field"><label><input type="checkbox" id="cprBreaths"> Prompt 2 rescue breaths after every 30</label></div>' +
      '<div class="btn-row"><button class="btn danger" id="cprGo" type="button">Start</button><button class="btn" id="cprStop" type="button">Stop</button></div>' +
      '<p class="small muted"><a href="#/a/first-aid-priorities">CPR instructions</a></p></section>' +

      '<section class="card tool"><h2>Pace counter</h2><p class="small">Count double-steps (each time the left foot lands). Measure your own count over 100 m.</p>' +
      '<div class="field-row"><div class="field"><label for="ppc">Your paces per 100 m</label><input type="number" id="ppc" value="65" min="20" max="150" inputmode="numeric"></div>' +
      '<div class="field"><label for="pdist">Distance to walk (m)</label><input type="number" id="pdist" value="1000" min="0" inputmode="numeric"></div></div>' +
      '<p class="big-result" id="pres"></p>' +
      '<div class="field"><label for="pcount">…or paces walked</label><input type="number" id="pcount" placeholder="e.g. 340" min="0" inputmode="numeric"></div>' +
      '<p class="big-result" id="pres2"></p>' +
      '<p class="small muted">Add 10–30% to the pace count uphill, in mud or snow, at night or with a heavy load.</p></section>' +

      '<section class="card tool"><h2>Thunderstorm distance</h2>' +
      '<div class="field"><label for="tsec">Seconds from flash to thunder</label><input type="number" id="tsec" value="" min="0" inputmode="numeric"></div>' +
      '<p class="big-result" id="tres"></p><p class="small muted">Under 30 seconds: you are within striking range — get to shelter.</p></section>' +

      '</div>' +
      '<div class="flash-overlay" id="flashOv" role="button" tabindex="0" aria-label="Tap to stop"><span class="pill">Tap anywhere to stop</span></div>';

    var $ = function (id) { return main.querySelector("#" + id); };

    // morse
    var mtext = $("mtext"), mout = $("mout");
    function updMorse() { mout.textContent = encode(mtext.value) || "—"; }
    mtext.oninput = updMorse; updMorse();
    function unit() { return parseInt($("munit").value, 10); }
    $("sosLight").onclick = function () { play(timeline("", true), 300, true, false, true); };
    $("sosSound").onclick = function () { play(timeline("", true), 150, false, true, true); };
    $("mLight").onclick = function () { play(timeline(mtext.value), unit(), true, false, false); };
    $("mSound").onclick = function () { play(timeline(mtext.value), unit(), false, true, false); };
    $("mStop").onclick = stopSignal;
    var ov = $("flashOv");
    ov.onclick = stopSignal;
    $("torch").onclick = function () { stopSignal(); ov.classList.add("on", "lit"); };

    // bleach
    function updBleach() {
      var L = parseFloat($("bvol").value) * parseFloat($("bunit").value), pct = parseFloat($("bpct").value);
      if (!(L > 0) || !(pct > 0)) { $("bres").textContent = "—"; $("bres2").textContent = ""; return; }
      var dose = 6.3 * ($("bcloudy").checked ? 2 : 1);              // mg/L free chlorine (EPA: 8 drops 6% per gallon)
      var ml = dose * L / (pct * 10);                                 // 1% = 10 mg/ml
      var drops = ml / 0.05;
      $("bres").textContent = drops < 200 ? Math.round(drops) + " drops" : ml.toFixed(1) + " ml";
      $("bres2").textContent = "= " + ml.toFixed(2) + " ml ≈ " + (ml / 4.93).toFixed(2) + " teaspoons for " + L.toFixed(1) + " litres";
    }
    ["bvol", "bunit", "bpct", "bcloudy"].forEach(function (id) { $(id).oninput = $(id).onchange = updBleach; });
    updBleach();

    // CPR
    var count = 0;
    $("cprGo").onclick = function () {
      stopCpr(); count = 0; audio();
      var dot = $("cprDot"), cnt = $("cprCount"), hint = $("cprHint"), pausing = 0;
      cprTimer = setInterval(function () {
        if (!document.body.contains(dot)) { stopCpr(); return; }
        if (pausing > 0) { pausing--; if (!pausing) hint.textContent = "compressions"; return; }
        count++;
        var inCycle = ((count - 1) % 30) + 1;
        cnt.textContent = $("cprBreaths").checked ? inCycle : count;
        dot.classList.add("beat"); setTimeout(function () { dot.classList.remove("beat"); }, 120);
        tone(0, 0.06, inCycle === 30 ? 1200 : 880, 0.5);
        if ($("cprBreaths").checked && inCycle === 30) { pausing = 9; hint.textContent = "Give 2 breaths now"; tone(0.2, 0.4, 500, 0.5); }
      }, 60000 / 110);
    };
    $("cprStop").onclick = stopCpr;

    // pace
    function updPace() {
      var ppc = parseFloat($("ppc").value), d = parseFloat($("pdist").value), c = parseFloat($("pcount").value);
      $("pres").textContent = ppc > 0 && d >= 0 ? Math.round(d / 100 * ppc) + " paces" : "—";
      $("pres2").textContent = ppc > 0 && c >= 0 ? "≈ " + Math.round(c / ppc * 100) + " m walked" : "";
    }
    ["ppc", "pdist", "pcount"].forEach(function (id) { $(id).oninput = updPace; });
    updPace();

    // thunder
    $("tsec").oninput = function () {
      var s = parseFloat(this.value);
      $("tres").textContent = s >= 0 ? (s / 3).toFixed(1) + " km  /  " + (s / 5).toFixed(1) + " mi" : "";
    };
  }

  function stop() { stopSignal(); stopCpr(); }

  window.Toolkit = { render: render, stop: stop, encode: encode };
})();
