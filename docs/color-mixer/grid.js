// Grid tool: put a grid on a reference image and work out the matching grid
// for the artist's canvas, including how to handle a different shape.

import { $, toast, initShell } from './shell.js';
import { loadImageInto } from './image.js';

const KEY = 'pigment-lens:grid';
const FIELDS = ['cw', 'ch', 'unit', 'mode', 'size', 'across', 'rows', 'cols', 'fit', 'line', 'diag', 'labels'];
const G = { full: null, view: null, offset: 0.5 }; // offset: crop position 0..1 along the free axis

// ---------- settings ----------
function readForm() {
  const v = (id) => $('#' + id);
  return {
    W: Math.max(0.1, parseFloat(v('cw').value) || 0),
    H: Math.max(0.1, parseFloat(v('ch').value) || 0),
    unit: v('unit').value,
    mode: v('mode').value,
    size: Math.max(0.05, parseFloat(v('size').value) || 1),
    across: Math.min(60, Math.max(1, parseInt(v('across').value, 10) || 1)),
    rows: Math.min(60, Math.max(1, parseInt(v('rows').value, 10) || 1)),
    cols: Math.min(60, Math.max(1, parseInt(v('cols').value, 10) || 1)),
    fit: v('fit').value,
    line: v('line').value,
    diag: v('diag').checked,
    labels: v('labels').checked,
  };
}
function saveForm() {
  const o = {};
  for (const id of FIELDS) { const el = $('#' + id); o[id] = el.type === 'checkbox' ? el.checked : el.value; }
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* ignore */ }
}
function loadForm() {
  let o = {};
  try { o = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* ignore */ }
  for (const id of FIELDS) {
    if (o[id] === undefined) continue;
    const el = $('#' + id);
    if (el.type === 'checkbox') el.checked = o[id]; else el.value = o[id];
  }
}
function showModeFields() {
  const m = $('#mode').value;
  $('#f-size').hidden = m !== 'size';
  $('#f-across').hidden = m !== 'across';
  $('#f-rows').hidden = m !== 'rc';
  $('#f-cols').hidden = m !== 'rc';
}

// ---------- math ----------
// Everything is worked out in canvas units, then scaled to image pixels.
export function layout(f, iw, ih, offset = 0.5) {
  const imgA = iw / ih, canA = f.W / f.H;
  let region, area; // region: part of the image used (px); area: where it sits on the canvas (units)
  if (f.fit === 'crop' || Math.abs(imgA - canA) < 0.005) {
    if (imgA > canA) { const rw = ih * canA; region = { x: (iw - rw) * offset, y: 0, w: rw, h: ih }; }
    else { const rh = iw / canA; region = { x: 0, y: (ih - rh) * offset, w: iw, h: rh }; }
    area = { x: 0, y: 0, w: f.W, h: f.H };
  } else {
    region = { x: 0, y: 0, w: iw, h: ih };
    if (imgA > canA) { const h = f.W / imgA; area = { x: 0, y: (f.H - h) / 2, w: f.W, h }; }
    else { const w = f.H * imgA; area = { x: (f.W - w) / 2, y: 0, w, h: f.H }; }
  }
  let cw, chh;
  if (f.mode === 'rc') { cw = area.w / f.cols; chh = area.h / f.rows; }
  else { cw = chh = f.mode === 'across' ? area.w / f.across : Math.min(f.size, area.w, area.h); }
  const lines = (len, step) => {
    const out = [];
    for (let p = step; p < len - 1e-6; p += step) out.push(p);
    return out;
  };
  const xs = lines(area.w, cw), ys = lines(area.h, chh);
  const lastW = area.w - xs.length * cw, lastH = area.h - ys.length * chh;
  return {
    region, area, cw, ch: chh, xs, ys,
    cols: xs.length + 1, rows: ys.length + 1,
    lastW, lastH,
    partialX: Math.abs(lastW - cw) > 1e-6 * f.W && lastW > 1e-6,
    partialY: Math.abs(lastH - chh) > 1e-6 * f.H && lastH > 1e-6,
    pxPerUnit: region.w / area.w,
  };
}

// 2.375 -> "2 3/8″" (nearest 1/16 inch); centimeters to 1 decimal.
export function fmt(v, unit) {
  if (unit === 'cm') return `${(Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '')} cm`;
  let sixteenths = Math.round(v * 16);
  const whole = Math.floor(sixteenths / 16);
  let num = sixteenths % 16, den = 16;
  while (num && num % 2 === 0) { num /= 2; den /= 2; }
  const frac = num ? `${num}/${den}` : '';
  return `${whole ? whole : ''}${whole && frac ? ' ' : ''}${frac || (whole ? '' : '0')}″`;
}
const colName = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

// ---------- drawing ----------
// Draw grid lines (and labels) inside rect r on ctx. scale: px per canvas unit.
function drawGrid(ctx, r, L, f, scale, { labelSize }) {
  const paths = [];
  for (const x of L.xs) paths.push([[r.x + x * scale, r.y], [r.x + x * scale, r.y + r.h]]);
  for (const y of L.ys) paths.push([[r.x, r.y + y * scale], [r.x + r.w, r.y + y * scale]]);
  paths.push([[r.x, r.y], [r.x + r.w, r.y]], [[r.x + r.w, r.y], [r.x + r.w, r.y + r.h]], [[r.x + r.w, r.y + r.h], [r.x, r.y + r.h]], [[r.x, r.y + r.h], [r.x, r.y]]);
  if (f.diag) {
    const X = [0, ...L.xs, L.area.w].map((v) => r.x + v * scale), Y = [0, ...L.ys, L.area.h].map((v) => r.y + v * scale);
    for (let i = 0; i < X.length - 1; i++) for (let j = 0; j < Y.length - 1; j++) {
      paths.push([[X[i], Y[j]], [X[i + 1], Y[j + 1]]], [[X[i + 1], Y[j]], [X[i], Y[j + 1]]]);
    }
  }
  const w = Math.max(1, labelSize / 9);
  const stroke = (color, width, alpha = 1) => {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (const [[a, b], [c, d]] of paths) { ctx.moveTo(a, b); ctx.lineTo(c, d); }
    ctx.stroke();
    ctx.restore();
  };
  if (f.line === 'auto') { stroke('#ffffff', w * 2.6, 0.75); stroke('#000000', w); }
  else stroke(f.line, w * 1.4);

  if (!f.labels) return;
  ctx.save();
  ctx.font = `600 ${labelSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tag = (text, x, y) => {
    const pad = labelSize * 0.3, tw = ctx.measureText(text).width + pad * 2, th = labelSize + pad;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(x - tw / 2, y - th / 2, tw, th);
    ctx.fillStyle = '#111';
    ctx.fillText(text, x, y);
  };
  const X = [0, ...L.xs, L.area.w], Y = [0, ...L.ys, L.area.h];
  for (let i = 0; i < X.length - 1; i++) {
    const cx = r.x + ((X[i] + X[i + 1]) / 2) * scale;
    if ((X[i + 1] - X[i]) * scale > labelSize * 1.2) tag(colName(i), cx, r.y + labelSize * 0.9);
  }
  for (let j = 0; j < Y.length - 1; j++) {
    const cy = r.y + ((Y[j] + Y[j + 1]) / 2) * scale;
    if ((Y[j + 1] - Y[j]) * scale > labelSize * 1.2) tag(String(j + 1), r.x + labelSize * 0.9, cy);
  }
  ctx.restore();
}

const view = $('#grid-canvas');
function renderReference(f, L) {
  const ctx = view.getContext('2d');
  const s = view.width / G.full.width; // display px per image px
  ctx.clearRect(0, 0, view.width, view.height);
  ctx.drawImage(G.view, 0, 0, view.width, view.height);
  const r = { x: L.region.x * s, y: L.region.y * s, w: L.region.w * s, h: L.region.h * s };
  // Dim the parts that won't be on the canvas.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, view.width, r.y);
  ctx.fillRect(0, r.y + r.h, view.width, view.height - r.y - r.h);
  ctx.fillRect(0, r.y, r.x, r.h);
  ctx.fillRect(r.x + r.w, r.y, view.width - r.x - r.w, r.h);
  drawGrid(ctx, r, L, f, L.pxPerUnit * s, { labelSize: Math.max(11, Math.min(view.width, view.height) / 34) });
}

function renderPlan(f, L) {
  const c = $('#plan-canvas');
  const maxW = 640, maxH = 520;
  const scale = Math.min(maxW / f.W, maxH / f.H);
  const pad = 34;
  c.width = Math.round(f.W * scale + pad * 2);
  c.height = Math.round(f.H * scale + pad * 2);
  const ctx = c.getContext('2d');
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = dark ? '#3a352e' : '#e4dbcf';
  ctx.fillRect(pad, pad, f.W * scale, f.H * scale); // border area (fit mode)
  const r = { x: pad + L.area.x * scale, y: pad + L.area.y * scale, w: L.area.w * scale, h: L.area.h * scale };
  ctx.fillStyle = '#fbf8f2';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  drawGrid(ctx, r, L, { ...f, line: '#5d564d' }, scale, { labelSize: 12 });
  ctx.strokeStyle = dark ? '#a59a8c' : '#776e64'; ctx.lineWidth = 2;
  ctx.strokeRect(pad, pad, f.W * scale, f.H * scale);
  ctx.fillStyle = dark ? '#eee7dc' : '#2a2622';
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(fmt(f.W, f.unit), pad + (f.W * scale) / 2, pad - 12);
  ctx.save();
  ctx.translate(pad - 14, pad + (f.H * scale) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(fmt(f.H, f.unit), 0, 0);
  ctx.restore();
}

function renderText(f, L) {
  const u = f.unit;
  const square = Math.abs(L.cw - L.ch) < 1e-9;
  const cell = square ? `${fmt(L.cw, u)} squares` : `${fmt(L.cw, u)} wide × ${fmt(L.ch, u)} tall`;
  const notes = [];
  if (L.partialX) notes.push(`The last column (${colName(L.cols - 1)}) is narrower: ${fmt(L.lastW, u)}.`);
  if (L.partialY) notes.push(`The last row (${L.rows}) is shorter: ${fmt(L.lastH, u)}.`);
  if (L.area.x > 1e-6) notes.push(`Leave a ${fmt(L.area.x, u)} border on the left and right; the image is narrower than the canvas.`);
  if (L.area.y > 1e-6) notes.push(`Leave a ${fmt(L.area.y, u)} border at the top and bottom; the image is shorter than the canvas.`);
  const cropped = f.fit === 'crop' && (L.region.w < G.full.width - 1 || L.region.h < G.full.height - 1);
  if (cropped) notes.push('Your image is a different shape from your canvas, so the dimmed part of the reference is cropped off. Drag the image to choose what stays.');
  $('#grid-summary').innerHTML = `
    <div class="summary-grid">
      <div>Square size on canvas<b>${cell}</b></div>
      <div>Grid<b>${L.cols} across × ${L.rows} down</b></div>
      <div>Squares to draw<b>${L.cols * L.rows}</b></div>
      <div>On the reference<b>${Math.round(L.cw * L.pxPerUnit)} px squares</b></div>
    </div>
    ${notes.map((n) => `<p class="tip" style="margin:0.75rem 0 0">${n}</p>`).join('')}`;
  const list = (vals, origin) => vals.map((v, i) => `<li>${fmt(origin + v, u)}${i === 0 ? '' : ''}</li>`).join('');
  $('#grid-marks').innerHTML = `
    <div class="marks">
      <h4>Vertical lines: measure from the left edge</h4>
      <ol>${L.area.x > 1e-6 ? `<li><small>border</small> ${fmt(L.area.x, u)}</li>` : ''}${list(L.xs, L.area.x)}${L.area.x > 1e-6 ? `<li><small>border</small> ${fmt(L.area.x + L.area.w, u)}</li>` : ''}</ol>
      <h4>Horizontal lines: measure from the top edge</h4>
      <ol>${L.area.y > 1e-6 ? `<li><small>border</small> ${fmt(L.area.y, u)}</li>` : ''}${list(L.ys, L.area.y)}${L.area.y > 1e-6 ? `<li><small>border</small> ${fmt(L.area.y + L.area.h, u)}</li>` : ''}</ol>
      <p class="muted small" style="margin-top:0.75rem">Mark each measurement on both opposite edges, then join the marks with a long ruler.
      Draw lightly (a hard pencil, or a watercolor pencil that disappears under paint) so the grid doesn’t show through.
      Copy one square at a time, matching where lines of the image cross each grid line.</p>
    </div>`;
}

function render() {
  showModeFields();
  saveForm();
  if (!G.full) return;
  const f = readForm();
  const L = layout(f, G.full.width, G.full.height, G.offset);
  $('#grid-result').hidden = false;
  const canDrag = f.fit === 'crop' && (L.region.w < G.full.width - 1 || L.region.h < G.full.height - 1);
  $('#drag-hint').hidden = !canDrag;
  renderReference(f, L);
  renderPlan(f, L);
  renderText(f, L);
}

// ---------- image ----------
async function load(file) {
  if (!file) return;
  try {
    const { full } = await loadImageInto(view, file, 1400);
    G.full = full;
    G.view = document.createElement('canvas');
    G.view.width = view.width; G.view.height = view.height;
    G.view.getContext('2d').drawImage(view, 0, 0);
    G.offset = 0.5;
  } catch {
    toast('That image couldn’t be opened.');
    return;
  }
  $('#grid-stage').classList.remove('empty');
  render();
}
$('#grid-camera').addEventListener('change', (e) => load(e.target.files[0]));
$('#grid-upload').addEventListener('change', (e) => load(e.target.files[0]));

// Drag to move the crop window along whichever axis has room.
let drag = null;
view.addEventListener('pointerdown', (e) => {
  if (!G.full) return;
  drag = { x: e.clientX, y: e.clientY, offset: G.offset };
  view.setPointerCapture(e.pointerId);
});
view.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const f = readForm();
  const L = layout(f, G.full.width, G.full.height, drag.offset);
  const rect = view.getBoundingClientRect();
  const pxPerScreen = G.full.width / rect.width;
  const freeX = G.full.width - L.region.w, freeY = G.full.height - L.region.h;
  if (freeX > 1) G.offset = drag.offset + ((e.clientX - drag.x) * pxPerScreen) / freeX;
  else if (freeY > 1) G.offset = drag.offset + ((e.clientY - drag.y) * pxPerScreen) / freeY;
  G.offset = Math.min(1, Math.max(0, G.offset));
  render();
});
const endDrag = () => { drag = null; };
view.addEventListener('pointerup', endDrag);
view.addEventListener('pointercancel', endDrag);

// ---------- download ----------
$('#grid-download').addEventListener('click', () => {
  const f = readForm();
  const L = layout(f, G.full.width, G.full.height, G.offset);
  const out = document.createElement('canvas');
  out.width = Math.round(L.region.w);
  out.height = Math.round(L.region.h);
  const ctx = out.getContext('2d');
  ctx.drawImage(G.full, L.region.x, L.region.y, L.region.w, L.region.h, 0, 0, out.width, out.height);
  drawGrid(ctx, { x: 0, y: 0, w: out.width, h: out.height }, L, f, L.pxPerUnit, { labelSize: Math.max(14, Math.min(out.width, out.height) / 34) });
  out.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `grid-${f.W}x${f.H}${f.unit}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
});

// ---------- boot ----------
loadForm();
for (const id of FIELDS) $('#' + id).addEventListener(['diag', 'labels'].includes(id) || $('#' + id).tagName === 'SELECT' ? 'change' : 'input', render);
render();
initShell();
