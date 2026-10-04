/* Minimal dependency-free WebGL STL viewer.
   StlViewer.create(containerEl) -> { load(url), destroy() }
   Drag to orbit, wheel / pinch to zoom, double-tap to reset. */
(function () {
  "use strict";

  function parseSTL(buf) {
    var dv = new DataView(buf);
    var isBinary = false;
    if (buf.byteLength >= 84) {
      var n = dv.getUint32(80, true);
      if (84 + n * 50 === buf.byteLength) isBinary = true;
    }
    var pos, nrm, count;
    if (isBinary) {
      count = dv.getUint32(80, true);
      pos = new Float32Array(count * 9);
      nrm = new Float32Array(count * 9);
      for (var i = 0; i < count; i++) {
        var o = 84 + i * 50;
        for (var v = 0; v < 3; v++) {
          for (var c = 0; c < 3; c++) pos[i * 9 + v * 3 + c] = dv.getFloat32(o + 12 + v * 12 + c * 4, true);
        }
      }
    } else {
      var text = new TextDecoder().decode(new Uint8Array(buf));
      var re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g, m, arr = [];
      while ((m = re.exec(text))) arr.push(+m[1], +m[2], +m[3]);
      pos = new Float32Array(arr);
      count = arr.length / 9;
      nrm = new Float32Array(arr.length);
    }
    // recompute flat normals (some exporters write zeros)
    for (var t = 0; t < count; t++) {
      var b = t * 9;
      var ux = pos[b + 3] - pos[b], uy = pos[b + 4] - pos[b + 1], uz = pos[b + 5] - pos[b + 2];
      var vx = pos[b + 6] - pos[b], vy = pos[b + 7] - pos[b + 1], vz = pos[b + 8] - pos[b + 2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      var l = Math.hypot(nx, ny, nz) || 1;
      for (var k = 0; k < 3; k++) { nrm[b + k * 3] = nx / l; nrm[b + k * 3 + 1] = ny / l; nrm[b + k * 3 + 2] = nz / l; }
    }
    var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (var p = 0; p < pos.length; p += 3) {
      for (var d = 0; d < 3; d++) { if (pos[p + d] < min[d]) min[d] = pos[p + d]; if (pos[p + d] > max[d]) max[d] = pos[p + d]; }
    }
    return { pos: pos, nrm: nrm, count: count, min: min, max: max };
  }

  // --- tiny mat4 helpers (column-major) ---
  function persp(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function mul(a, b) {
    var o = new Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }
  function lookAt(eye, ctr, up) {
    var z = norm(sub(eye, ctr)), x = norm(cross(up, z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

  var VS = "attribute vec3 p; attribute vec3 n; uniform mat4 mvp; varying vec3 vn;" +
    "void main(){ vn = n; gl_Position = mvp * vec4(p,1.0); }";
  var FS = "precision mediump float; varying vec3 vn; uniform vec3 col; uniform vec3 l1; uniform vec3 l2; uniform float flat_;" +
    "void main(){ vec3 N = normalize(vn); float d = max(dot(N,l1),0.0)*0.75 + max(dot(N,l2),0.0)*0.35 + 0.22;" +
    " gl_FragColor = vec4(mix(col*d, col, flat_), 1.0); }";

  function cssColor(el, name, fallback) {
    var v = getComputedStyle(el).getPropertyValue(name).trim();
    var m = /^#([0-9a-f]{6})$/i.exec(v);
    if (!m) return fallback;
    var n = parseInt(m[1], 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  function create(container) {
    container.innerHTML = '<canvas aria-label="3D model preview"></canvas><div class="hud"></div><div class="msg">Loading model…</div>';
    var canvas = container.querySelector("canvas"), hud = container.querySelector(".hud"), msg = container.querySelector(".msg");
    var gl = canvas.getContext("webgl", { antialias: true }) || canvas.getContext("experimental-webgl");
    if (!gl) { msg.textContent = "3D preview not supported on this browser — you can still download the file."; return { load: function () {}, destroy: function () {} }; }

    function compile(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    var aP = gl.getAttribLocation(prog, "p"), aN = gl.getAttribLocation(prog, "n");
    var uMVP = gl.getUniformLocation(prog, "mvp"), uCol = gl.getUniformLocation(prog, "col");
    var uL1 = gl.getUniformLocation(prog, "l1"), uL2 = gl.getUniformLocation(prog, "l2"), uFlat = gl.getUniformLocation(prog, "flat_");
    var bufP = gl.createBuffer(), bufN = gl.createBuffer(), gridP = gl.createBuffer(), gridN = gl.createBuffer();
    var model = null, gridCount = 0;
    var yaw = -0.6, pitch = 0.55, dist = 1, radius = 1, center = [0, 0, 0], destroyed = false, raf = 0;

    function draw() {
      raf = 0;
      if (destroyed) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      var bg = cssColor(container, "--surface-2", [0.93, 0.91, 0.86]);
      gl.clearColor(bg[0], bg[1], bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!model) return;
      gl.enable(gl.DEPTH_TEST);
      var eye = [center[0] + dist * Math.cos(pitch) * Math.cos(yaw), center[1] + dist * Math.cos(pitch) * Math.sin(yaw), center[2] + dist * Math.sin(pitch)];
      var mvp = mul(persp(0.7, w / h, dist / 50, dist * 10), lookAt(eye, center, [0, 0, 1]));
      gl.uniformMatrix4fv(uMVP, false, new Float32Array(mvp));
      var vdir = norm(sub(eye, center));
      gl.uniform3fv(uL1, norm([vdir[0] + 0.3, vdir[1] - 0.2, vdir[2] + 0.6]));
      gl.uniform3fv(uL2, norm([-vdir[0], -vdir[1], 0.4]));
      // build plate grid
      gl.uniform1f(uFlat, 1);
      gl.uniform3fv(uCol, cssColor(container, "--border", [0.8, 0.78, 0.72]));
      gl.bindBuffer(gl.ARRAY_BUFFER, gridP); gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(aP);
      gl.bindBuffer(gl.ARRAY_BUFFER, gridN); gl.vertexAttribPointer(aN, 3, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(aN);
      gl.drawArrays(gl.LINES, 0, gridCount);
      // model
      gl.uniform1f(uFlat, 0);
      gl.uniform3fv(uCol, cssColor(container, "--accent", [0.76, 0.33, 0.18]));
      gl.bindBuffer(gl.ARRAY_BUFFER, bufP); gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufN); gl.vertexAttribPointer(aN, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, model.count * 3);
    }
    function redraw() { if (!raf) raf = requestAnimationFrame(draw); }

    function setModel(m) {
      model = m;
      gl.bindBuffer(gl.ARRAY_BUFFER, bufP); gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufN); gl.bufferData(gl.ARRAY_BUFFER, m.nrm, gl.STATIC_DRAW);
      center = [(m.min[0] + m.max[0]) / 2, (m.min[1] + m.max[1]) / 2, (m.min[2] + m.max[2]) / 2];
      radius = Math.hypot(m.max[0] - m.min[0], m.max[1] - m.min[1], m.max[2] - m.min[2]) / 2 || 1;
      dist = radius * 3.2;
      // 10 mm grid on the build plate (z = min z)
      var g = [], step = 10, z = m.min[2] - 0.01;
      var x0 = Math.floor((m.min[0] - 20) / step) * step, x1 = Math.ceil((m.max[0] + 20) / step) * step;
      var y0 = Math.floor((m.min[1] - 20) / step) * step, y1 = Math.ceil((m.max[1] + 20) / step) * step;
      for (var x = x0; x <= x1; x += step) g.push(x, y0, z, x, y1, z);
      for (var y = y0; y <= y1; y += step) g.push(x0, y, z, x1, y, z);
      gridCount = g.length / 3;
      gl.bindBuffer(gl.ARRAY_BUFFER, gridP); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, gridN); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.length), gl.STATIC_DRAW);
      var dx = m.max[0] - m.min[0], dy = m.max[1] - m.min[1], dz = m.max[2] - m.min[2];
      hud.textContent = dx.toFixed(0) + " × " + dy.toFixed(0) + " × " + dz.toFixed(0) + " mm · grid 10 mm · drag to rotate";
      msg.style.display = "none";
      redraw();
    }

    // interaction
    var pointers = {}, lastPinch = 0, lastTap = 0;
    canvas.addEventListener("pointerdown", function (e) {
      canvas.setPointerCapture(e.pointerId);
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var now = Date.now();
      if (now - lastTap < 300 && model) { yaw = -0.6; pitch = 0.55; dist = radius * 3.2; redraw(); }
      lastTap = now;
    });
    canvas.addEventListener("pointermove", function (e) {
      var p = pointers[e.pointerId];
      if (!p) return;
      var ids = Object.keys(pointers);
      if (ids.length === 1) {
        yaw -= (e.clientX - p.x) * 0.01;
        pitch = Math.max(-1.5, Math.min(1.5, pitch + (e.clientY - p.y) * 0.01));
      }
      p.x = e.clientX; p.y = e.clientY;
      if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastPinch) dist = Math.max(radius * 0.8, Math.min(radius * 12, dist * lastPinch / d));
        lastPinch = d;
      }
      redraw();
    });
    function up(e) { delete pointers[e.pointerId]; lastPinch = 0; }
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", function (e) {
      e.preventDefault();
      dist = Math.max(radius * 0.8, Math.min(radius * 12, dist * (e.deltaY > 0 ? 1.1 : 0.9)));
      redraw();
    }, { passive: false });
    var ro = window.ResizeObserver ? new ResizeObserver(redraw) : null;
    if (ro) ro.observe(container); else window.addEventListener("resize", redraw);

    return {
      load: function (url) {
        msg.style.display = ""; msg.textContent = "Loading model…";
        return fetch(url).then(function (r) {
          if (!r.ok) throw new Error(r.status);
          return r.arrayBuffer();
        }).then(function (buf) {
          if (!destroyed) setModel(parseSTL(buf));
        }).catch(function () {
          msg.style.display = ""; msg.textContent = "Could not load the model file.";
        });
      },
      redraw: redraw,
      destroy: function () { destroyed = true; if (ro) ro.disconnect(); }
    };
  }

  window.StlViewer = { create: create, parse: parseSTL };
})();
