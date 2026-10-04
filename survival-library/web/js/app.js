/* Survival Library - app shell: data loading, routing, library, search, 3D prints, sharing. */
(function () {
  "use strict";
  var main = document.getElementById("main");
  var lib = null, prints = null, viewer = null;
  var CAT_ORDER = ["Start Here", "First Aid", "Water", "Fire", "Shelter & Warmth", "Food", "Navigation",
    "Signals & Comms", "Knots & Cordage", "Sanitation", "Tools & Fabrication", "Transport", "Power & Light", "Hazards", "Community"];
  var CAT_ICON = { "Start Here": "★", "First Aid": "✚", "Water": "💧", "Fire": "🔥", "Shelter & Warmth": "⛺", "Food": "🌾",
    "Navigation": "🧭", "Signals & Comms": "📻", "Knots & Cordage": "🪢", "Sanitation": "🧼", "Tools & Fabrication": "🛠",
    "Transport": "🚲", "Power & Light": "🔋", "Hazards": "⚠", "Community": "🤝" };
  var esc = function (s) { return Markdown.escape(String(s == null ? "" : s)); };

  // ---------------------------------------------------------------- utilities
  function store(k, v) {
    try {
      if (v === undefined) return JSON.parse(localStorage.getItem(k));
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { return null; }
  }
  var App = window.App = {
    getLocation: function () { var l = store("sl.location"); return l && isFinite(l.lat) && isFinite(l.lon) ? l : null; },
    setLocation: function (l) { store("sl.location", l); },
    fmtBytes: function (b) { return b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB"; },
    download: function (name, text, type) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: type || "text/plain" }));
      a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },
    submitSearch: function (e) {
      e.preventDefault();
      var q = document.getElementById("q").value.trim();
      location.hash = "#/search/" + encodeURIComponent(q);
      return false;
    }
  };

  // ---------------------------------------------------------------- theme
  var THEMES = ["auto", "light", "dark", "red"], THEME_LABEL = { auto: "◐", light: "☀", dark: "☾", red: "🔴" };
  function applyTheme(t) {
    if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    var b = document.getElementById("themeBtn");
    b.textContent = THEME_LABEL[t];
    b.title = "Display: " + (t === "red" ? "red night mode (keeps night vision)" : t) + " — tap to change";
  }
  var theme = store("sl.theme") || "auto";
  applyTheme(theme);
  document.getElementById("themeBtn").onclick = function () {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    store("sl.theme", theme); applyTheme(theme);
    if (viewer) viewer.redraw();
  };

  // ---------------------------------------------------------------- data
  function getJSON(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }); }
  var ready = Promise.all([getJSON("content/library.json"), getJSON("prints/catalog.json")]).then(function (r) {
    lib = r[0].articles; prints = r[1];
    lib.forEach(function (a) { a._norm = norm(a.title); a._text = (a.title + " " + a.summary + " " + a.body).toLowerCase(); });
    prints.forEach(function (p) { p._norm = norm(p.title); });
  });

  function norm(s) { return s.toLowerCase().replace(/&/g, " and ").replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
  function byId(id) { for (var i = 0; i < lib.length; i++) if (lib[i].id === id) return lib[i]; return null; }
  function cats() {
    var seen = {}, out = [];
    lib.forEach(function (a) { if (!seen[a.category]) { seen[a.category] = []; out.push(a.category); } seen[a.category].push(a); });
    out.sort(function (a, b) {
      var ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    return out.map(function (c) { return { name: c, articles: seen[c] }; });
  }

  // ---------------------------------------------------------------- pages
  function pageHome() {
    var urgent = lib.filter(function (a) { return a.priority; });
    main.innerHTML =
      '<section class="hero"><h1>Survival Library</h1><p>Practical knowledge for when the grid is down. Everything here is stored on this device and works with no internet. Read it, save a copy to your phone, and share it.</p></section>' +
      '<div class="emergency">' + urgent.map(function (a) {
        return '<a href="#/a/' + a.id + '"><strong>' + esc(a.title) + "</strong><span>" + esc(a.summary) + "</span></a>";
      }).join("") + "</div>" +
      '<div class="quick">' +
      '<a class="card" href="#/compass"><span class="ico">🧭</span>Compass</a>' +
      '<a class="card" href="#/maps"><span class="ico">🗺</span>Maps</a>' +
      '<a class="card" href="#/prints"><span class="ico">⚙</span>3D Prints</a>' +
      '<a class="card" href="#/toolkit"><span class="ico">🔦</span>Signal &amp; Tools</a>' +
      '<a class="card" href="#/share"><span class="ico">⬇</span>Save a copy</a></div>' +
      '<h2>Library</h2><div class="grid">' + cats().map(function (c) {
        return '<a class="card" href="#/library/' + encodeURIComponent(c.name) + '"><h3>' + (CAT_ICON[c.name] || "•") + " " + esc(c.name) +
          "</h3><p>" + c.articles.map(function (a) { return esc(a.title); }).join(" · ") + "</p></a>";
      }).join("") + "</div>";
  }

  function pageLibrary(cat) {
    var cs = cats();
    if (cat) cs = cs.filter(function (c) { return c.name === cat; });
    main.innerHTML = '<h1>' + (cat ? esc(cat) : "Library") + "</h1>" +
      (cat ? '<p><a href="#/library">← All topics</a></p>' : '<p class="muted">' + lib.length + " guides. Use the search box to find anything.</p>") +
      cs.map(function (c) {
        return '<section class="cat-block">' + (cat ? "" : "<h2>" + (CAT_ICON[c.name] || "") + " " + esc(c.name) + "</h2>") +
          '<ul class="toc-list">' + c.articles.map(function (a) {
            return '<li><a href="#/a/' + a.id + '"><b>' + esc(a.title) + "</b><span>" + esc(a.summary) + "</span></a></li>";
          }).join("") + "</ul></section>";
      }).join("");
  }

  // link *Article Title* and **Print Title** mentions to their pages
  function crossLink(root, self) {
    root.querySelectorAll("em, strong").forEach(function (el) {
      if (el.closest("a,h2,h3,h4,th")) return;
      var t = norm(el.textContent);
      if (t.length < 4) return;
      var hit = null;
      if (el.tagName === "EM") {
        if (/^(toolkit|compass|maps?|3d prints)( page)?$/.test(t)) hit = "#/" + (t.indexOf("3d") === 0 ? "prints" : t.replace(/ page$/, "").replace(/^map$/, "maps"));
        for (var i = 0; !hit && i < lib.length; i++) {
          var a = lib[i];
          if (a.id !== self && (a._norm === t || a._norm.indexOf(t) === 0 || (t.length > 8 && a._norm.indexOf(t) >= 0))) hit = "#/a/" + a.id;
        }
      }
      var ts = t.replace(/s$/, "");
      for (var j = 0; !hit && j < prints.length; j++) {
        var p = prints[j];
        if (p._norm.indexOf(ts) === 0 || (ts.length > 9 && p._norm.indexOf(ts) >= 0)) hit = "#/prints/" + p.id;
      }
      if (hit) {
        var link = document.createElement("a");
        link.href = hit; link.className = "xref";
        el.parentNode.replaceChild(link, el); link.appendChild(el);
      }
    });
  }

  function pageArticle(id) {
    var a = byId(id);
    if (!a) return notFound();
    var sib = lib.filter(function (x) { return x.category === a.category; }), i = sib.indexOf(a);
    main.innerHTML = '<article class="article"><p class="crumbs"><a href="#/library">Library</a> › <a href="#/library/' + encodeURIComponent(a.category) + '">' + esc(a.category) + "</a></p>" +
      "<h1>" + esc(a.title) + "</h1>" + Markdown.render(a.body) +
      '<nav class="article-nav">' +
      (i > 0 ? '<a class="btn" href="#/a/' + sib[i - 1].id + '">← ' + esc(sib[i - 1].title) + "</a>" : "<span></span>") +
      (i < sib.length - 1 ? '<a class="btn" href="#/a/' + sib[i + 1].id + '">' + esc(sib[i + 1].title) + " →</a>" : "") +
      '</nav><div class="btn-row"><button class="btn small" type="button" onclick="window.print()">Print this page</button></div></article>';
    crossLink(main.querySelector("article"), a.id);
    // remember checklist ticks on this phone
    main.querySelectorAll("ul.check input").forEach(function (cb, n) {
      var key = "sl.check." + a.id + "." + n;
      cb.checked = !!store(key);
      cb.onchange = function () { store(key, cb.checked); };
    });
  }

  function pageSearch(q) {
    document.getElementById("q").value = q;
    var terms = q.toLowerCase().split(/\s+/).filter(function (t) { return t.length > 1; });
    if (!terms.length) { main.innerHTML = "<h1>Search</h1><p class='muted'>Type a word above, e.g. <i>bleach</i>, <i>splint</i>, <i>bowline</i>, <i>gear</i>.</p>"; return; }
    var res = lib.map(function (a) {
      var score = 0;
      terms.forEach(function (t) {
        if (a.title.toLowerCase().indexOf(t) >= 0) score += 20;
        if (a.summary.toLowerCase().indexOf(t) >= 0) score += 6;
        var n = a._text.split(t).length - 1;
        score += n ? 2 + Math.min(n, 15) : -40;
      });
      return { a: a, score: score };
    }).filter(function (r) { return r.score > 0; }).sort(function (x, y) { return y.score - x.score; });
    var pres = prints.filter(function (p) {
      var txt = (p.title + " " + p.summary + " " + p.use + " " + p.category).toLowerCase();
      return terms.every(function (t) { return txt.indexOf(t) >= 0; });
    });
    var re = new RegExp("(" + terms.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("|") + ")", "gi");
    function snippet(a) {
      var body = a.body.replace(/[#*|>`_]/g, " ").replace(/\s+/g, " "), lb = body.toLowerCase(), at = -1;
      for (var i = 0; i < terms.length && at < 0; i++) at = lb.indexOf(terms[i]);
      var s = body.slice(Math.max(0, at - 70), Math.max(0, at - 70) + 220);
      return (at > 70 ? "…" : "") + esc(s).replace(re, "<mark>$1</mark>") + "…";
    }
    main.innerHTML = "<h1>Search: " + esc(q) + "</h1>" +
      (res.length ? res.slice(0, 40).map(function (r) {
        return '<div class="result"><a href="#/a/' + r.a.id + '">' + esc(r.a.title) + '</a> <span class="pill">' + esc(r.a.category) + "</span><p>" + snippet(r.a) + "</p></div>";
      }).join("") : "<p>No guides found. Try a simpler word.</p>") +
      (pres.length ? "<h2>3D prints</h2>" + pres.map(function (p) {
        return '<div class="result"><a href="#/prints/' + p.id + '">' + esc(p.title) + "</a><p>" + esc(p.summary) + "</p></div>";
      }).join("") : "");
  }

  var printFilter = "All";
  function pagePrints() {
    var pc = ["All"];
    prints.forEach(function (p) { if (pc.indexOf(p.category) < 0) pc.push(p.category); });
    var list = prints.filter(function (p) { return printFilter === "All" || p.category === printFilter; });
    var nfiles = prints.reduce(function (n, p) { return n + p.files.length; }, 0);
    main.innerHTML = '<div class="section-title"><h1>3D Prints</h1><span class="muted small">' + prints.length + " designs · " + nfiles + " ready-to-print STL files</span></div>" +
      '<p class="muted">Tools and parts to rebuild with. Every design has an editable OpenSCAD source file. Printed plastic is not steel — read each design\'s notes on material and load. ' +
      '<a href="#/a/3d-printing-austerity">Printing when supplies are short</a></p>' +
      '<div class="filters">' + pc.map(function (c) {
        return '<button type="button" class="' + (c === printFilter ? "on" : "") + '" data-c="' + esc(c) + '">' + esc(c) + "</button>";
      }).join("") + "</div>" +
      '<div class="grid">' + list.map(function (p) {
        return '<a class="card print-card" href="#/prints/' + p.id + '"><h3>' + esc(p.title) + "</h3><p>" + esc(p.summary) + "</p>" +
          '<div class="meta"><span class="pill">' + esc(p.category) + "</span>" + (p.files.length > 1 ? '<span class="pill">' + p.files.length + " versions</span>" : "") + "</div></a>";
      }).join("") + "</div>";
    main.querySelectorAll(".filters button").forEach(function (b) {
      b.onclick = function () { printFilter = b.getAttribute("data-c"); pagePrints(); };
    });
  }

  function pagePrint(id) {
    var p = prints.filter(function (x) { return x.id === id; })[0];
    if (!p) return notFound();
    main.innerHTML = '<p class="small"><a href="#/prints">← All 3D prints</a></p><h1>' + esc(p.title) + "</h1>" +
      '<div class="print-detail"><div><div class="viewer" id="viewer"></div>' +
      (p.files.length > 1 ? '<div class="field" style="margin-top:10px"><label for="variant">Version</label><select id="variant">' +
        p.files.map(function (f, i) { return '<option value="' + i + '">' + esc(f.name) + "</option>"; }).join("") + "</select></div>" : "") +
      '<div class="btn-row"><a class="btn primary" id="dl" download>Download STL</a><a class="btn" href="' + p.source + '" download>Download OpenSCAD source</a></div>' +
      '<p class="small muted" id="dlsize"></p></div>' +
      '<div class="card"><dl class="specs"><dt>What it is</dt><dd>' + esc(p.summary) + "</dd>" +
      "<dt>How to use it</dt><dd>" + esc(p.use) + "</dd>" +
      "<dt>Material</dt><dd>" + esc(p.material) + "</dd>" +
      "<dt>Print settings</dt><dd>" + esc(p.print) + "</dd>" +
      '<dt>Customise</dt><dd>Open the .scad file in OpenSCAD (free), change the numbers at the top, press F6 to render and F7 to export a new STL.</dd></dl></div></div>';
    viewer = StlViewer.create(main.querySelector("#viewer"));
    function pick(i) {
      var f = p.files[i];
      var dl = main.querySelector("#dl");
      dl.href = f.stl; dl.setAttribute("download", f.stl.split("/").pop());
      main.querySelector("#dlsize").textContent = f.stl.split("/").pop() + " · " + App.fmtBytes(f.bytes || 0);
      viewer.load(f.stl);
    }
    var sel = main.querySelector("#variant");
    if (sel) sel.onchange = function () { pick(+sel.value); };
    pick(0);
  }

  function pageShare() {
    var host = location.host || "this device";
    main.innerHTML = "<h1>Take It With You</h1>" +
      '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">' +
      '<div class="card"><h3>1. Save the guides to your phone</h3><p>One file with every article. Opens in any browser with no network — keep it in your Files/Downloads.</p>' +
      '<div class="btn-row"><a class="btn primary" href="survival-library-offline.html" download>Download offline copy</a></div>' +
      '<p class="small muted">Then share it onwards by Bluetooth, messaging apps, USB stick or email when networks return.</p></div>' +
      '<div class="card"><h3>2. Tell people nearby</h3><p>Connect to this WiFi and open:</p><p class="big-result" style="word-break:break-all">http://' + esc(host) + "/</p>" +
      '<p class="small muted">Any web address typed while connected should also lead here. Write the network name and this address on a sign near the device.</p></div>' +
      '<div class="card"><h3>3. Start another library hotspot</h3><p>The complete library — articles, 3D files, maps viewer and setup scripts — as one zip. Copy it to a Raspberry Pi, old laptop or Android phone to make a new node.</p>' +
      '<div class="btn-row"><a class="btn" href="survival-library-node.zip" download>Download whole library (zip)</a></div>' +
      '<p class="small muted">Setup steps are in <code>README.md</code> and <code>device/README.md</code> inside the zip.</p></div>' +
      '<div class="card"><h3>4. All 3D files</h3><p>Open each design under <a href="#/prints">3D Prints</a> to download its STL and editable source, or take the whole zip above.</p></div>' +
      "</div>";
  }

  function notFound() { main.innerHTML = '<h1>Not found</h1><p><a href="#/">Go to the home page</a></p>'; }

  // ---------------------------------------------------------------- router
  function route() {
    if (viewer) { viewer.destroy(); viewer = null; }
    if (window.Compass) Compass.stop();
    if (window.Maps) Maps.stop();
    if (window.Toolkit) Toolkit.stop();
    var h = location.hash.replace(/^#\/?/, ""), parts = h.split("/"), tab = parts[0] || "home";
    var map = { a: "library", search: "", library: "library" };
    var activeTab = map[tab] !== undefined ? map[tab] : tab;
    document.querySelectorAll(".tabs a").forEach(function (a) { a.classList.toggle("active", a.getAttribute("data-tab") === activeTab); });
    if (tab !== "search") document.getElementById("q").value = "";
    var arg = parts.slice(1).join("/");
    try { arg = decodeURIComponent(arg); } catch (e) { /* keep raw */ }
    switch (tab) {
      case "home": pageHome(); break;
      case "library": pageLibrary(arg); break;
      case "a": pageArticle(arg); break;
      case "search": pageSearch(arg); break;
      case "prints": if (arg) pagePrint(arg); else pagePrints(); break;
      case "compass": Compass.render(main); break;
      case "maps": Maps.render(main); break;
      case "toolkit": Toolkit.render(main); break;
      case "share": pageShare(); break;
      default: notFound();
    }
    var title = main.querySelector("h1");
    document.title = (title && tab !== "home" ? title.textContent + " · " : "") + "Survival Library";
    window.scrollTo(0, 0);
  }

  ready.then(function () {
    window.addEventListener("hashchange", route);
    route();
  }).catch(function (e) {
    main.innerHTML = '<div class="notice danger"><b>Could not load the library data.</b><br>' + esc(e.message) +
      "<br>If you opened this file directly from disk, use the single-file offline copy instead, or run <code>python3 device/serve.py</code>.</div>";
  });

  // offline caching on secure origins (https) so phones keep a copy
  if ("serviceWorker" in navigator && window.isSecureContext && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(function () { /* optional */ });
  }
})();
