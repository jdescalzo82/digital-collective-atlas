import {
  rgb255ToLinear, linearToRgb255, linearToLab, labToLinear, rgbToHex, hexToRgb,
  describeLab, deltaE2000,
} from './color.js';
import { PIGMENTS, DEFAULT_OWNED } from './pigments.js';
import { preparePaint, predictLinear, solve, matchQuality, washText } from './mixer.js';
import { MEDIA, FINISHES, withFinish, fromFinish, wetAppearance, valueStepsText } from './media.js';
import { account } from './account.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
const hexOfLin = (lin) => rgbToHex(linearToRgb255(lin));
const hexOfLab = (lab) => hexOfLin(labToLinear(lab));

// ---------- state ----------
const PREFS_KEY = 'pigment-lens:prefs';
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; } };
const saved = loadPrefs();
const S = {
  medium: saved.medium || 'oil',
  grade: saved.grade || 'artist',
  finish: saved.finish || MEDIA[saved.medium || 'oil'].naturalFinish,
  owned: saved.owned || structuredClone(DEFAULT_OWNED),
  overrides: saved.overrides || {},
  custom: saved.custom || [],
  colors: saved.colors || [],
  active: saved.active || null,
  choice: 0,
  gains: [1, 1, 1],
  mode: 'pick',
  image: null, // ImageData of the photo
};
const persist = () => {
  const { medium, grade, finish, owned, overrides, custom, colors, active } = S;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ medium, grade, finish, owned, overrides, custom, colors, active })); } catch { /* ignore */ }
};

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- paints ----------
function paintsFor(medium) {
  const builtIn = PIGMENTS.filter((p) => p.media.includes(medium));
  const custom = S.custom.filter((p) => p.media.includes(medium));
  return [...builtIn, ...custom].map((p) => ({ ...p, hex: S.overrides[p.id] || p.hex, custom: S.custom.includes(p) || undefined }));
}
const ownedPaints = () => {
  const owned = new Set(S.owned[S.medium] || []);
  return paintsFor(S.medium).filter((p) => owned.has(p.id)).map(preparePaint);
};

// ---------- photo ----------
const canvas = $('#photo');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

async function loadFile(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try { await img.decode(); } catch { toast('That image couldn’t be opened.'); return; }
  const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  S.image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  S.gains = [1, 1, 1];
  $('#wb-status').textContent = '';
  $('#stage').classList.remove('empty');
  $('#photo-tools').hidden = false;
  $('#marker').hidden = true;
  renderAutoPalette();
}

function pixelLinear(i) {
  const d = S.image.data;
  return [d[i], d[i + 1], d[i + 2]];
}

// Average in linear light over a (2r+1)² patch — smooths camera noise and canvas texture.
function sampleRaw(x, y, r) {
  const { width, height } = S.image;
  const acc = [0, 0, 0];
  let n = 0;
  for (let yy = Math.max(0, y - r); yy <= Math.min(height - 1, y + r); yy++) {
    for (let xx = Math.max(0, x - r); xx <= Math.min(width - 1, x + r); xx++) {
      const lin = rgb255ToLinear(pixelLinear((yy * width + xx) * 4));
      acc[0] += lin[0]; acc[1] += lin[1]; acc[2] += lin[2]; n++;
    }
  }
  return acc.map((v) => v / n);
}
const correct = (lin) => lin.map((v, c) => Math.min(1, v * S.gains[c]));

canvas.addEventListener('click', (e) => {
  if (!S.image) return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.round(((e.clientX - rect.left) / rect.width) * canvas.width);
  const y = Math.round(((e.clientY - rect.top) / rect.height) * canvas.height);
  const raw = sampleRaw(x, y, Number($('#radius').value));
  const marker = $('#marker');
  marker.style.left = `${((e.clientX - rect.left) / rect.width) * 100}%`;
  marker.style.top = `${((e.clientY - rect.top) / rect.height) * 100}%`;
  marker.hidden = false;

  if (S.mode === 'white') {
    const peak = Math.max(...raw);
    if (peak < 0.02) { toast('That spot is too dark. Tap something white or light grey.'); return; }
    S.gains = raw.map((v) => peak / Math.max(v, 1e-4)); // neutralise the cast, keep exposure
    const cast = Math.max(...S.gains) / Math.min(...S.gains);
    $('#wb-status').textContent = cast < 1.03 ? 'White point set (lighting was already neutral)' : 'White point set, color cast removed';
    marker.style.background = rgbToHex(linearToRgb255(correct(raw)));
    setMode('pick');
    renderAutoPalette();
    toast('White point set. Your samples now account for the lighting.');
    return;
  }
  const lin = correct(raw);
  marker.style.background = hexOfLin(lin);
  addColor(lin, 'photo');
});

function setMode(mode) {
  S.mode = mode;
  document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('#mode-hint').hidden = mode !== 'white';
}
document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

// k-means in Lab over a subsample of the photo.
function dominantColors(k = 7) {
  const { data, width, height } = S.image;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 5000)));
  const pts = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      pts.push(linearToLab(correct(rgb255ToLinear([data[i], data[i + 1], data[i + 2]]))));
    }
  }
  const dist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const cents = [pts[Math.floor(pts.length / 2)]];
  while (cents.length < k) { // k-means++ style: pick farthest point
    let far = pts[0], fd = -1;
    for (const p of pts) { const d = Math.min(...cents.map((c) => dist(p, c))); if (d > fd) { fd = d; far = p; } }
    cents.push(far);
  }
  let counts = [];
  for (let it = 0; it < 10; it++) {
    const sums = cents.map(() => [0, 0, 0]);
    counts = cents.map(() => 0);
    for (const p of pts) {
      let bi = 0, bd = Infinity;
      cents.forEach((c, i) => { const d = dist(p, c); if (d < bd) { bd = d; bi = i; } });
      sums[bi][0] += p[0]; sums[bi][1] += p[1]; sums[bi][2] += p[2]; counts[bi]++;
    }
    cents.forEach((c, i) => { if (counts[i]) cents[i] = sums[i].map((v) => v / counts[i]); });
  }
  const out = cents.map((lab, i) => ({ lab, share: counts[i] / pts.length }))
    .filter((c) => c.share > 0.02).sort((a, b) => b.share - a.share);
  return out.filter((c, i) => out.slice(0, i).every((o) => deltaE2000(o.lab, c.lab) > 6));
}

function renderAutoPalette() {
  const wrap = $('#auto-swatches');
  wrap.innerHTML = '';
  for (const { lab, share } of dominantColors()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.background = hexOfLab(lab);
    b.title = `${describeLab(lab)}, ${Math.round(share * 100)}% of the photo`;
    b.setAttribute('aria-label', `Add ${describeLab(lab)}`);
    b.addEventListener('click', () => addColor(labToLinear(lab), 'auto'));
    wrap.appendChild(b);
  }
  $('#auto-palette').hidden = false;
}

$('#camera-input').addEventListener('change', (e) => loadFile(e.target.files[0]));
$('#upload-input').addEventListener('change', (e) => loadFile(e.target.files[0]));
$('#hex-input').addEventListener('change', (e) => addColor(rgb255ToLinear(hexToRgb(e.target.value)), 'manual'));

// ---------- selected colors ----------
function addColor(lin, source) {
  const lab = linearToLab(lin);
  const dup = S.colors.find((c) => deltaE2000(c.lab, lab) < 1);
  if (dup) { selectColor(dup.id); return; }
  const c = { id: uid(), lab, hex: hexOfLin(lin), source };
  S.colors.push(c);
  selectColor(c.id);
}

function selectColor(id) {
  S.active = id;
  S.choice = 0;
  persist();
  renderSelected();
  renderRecipe();
}

function renderSelected() {
  const wrap = $('#selected');
  $('#save-btn').disabled = !S.colors.length;
  if (!S.colors.length) {
    wrap.innerHTML = '<p class="muted">No colors yet. Tap the photo, or tap one of the suggested colors above.</p>';
    return;
  }
  wrap.innerHTML = '';
  for (const c of S.colors) {
    const el = document.createElement('div');
    el.className = 'sel' + (c.id === S.active ? ' on' : '');
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.innerHTML = `<span class="swatch" style="background:${c.hex}"></span>
      <span class="meta"><b>${esc(describeLab(c.lab))}</b><span class="muted">${c.hex.toUpperCase()}</span></span>
      <button class="x" type="button" aria-label="Remove color">×</button>`;
    el.addEventListener('click', () => selectColor(c.id));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectColor(c.id); } });
    el.querySelector('.x').addEventListener('click', (e) => {
      e.stopPropagation();
      S.colors = S.colors.filter((x) => x.id !== c.id);
      if (S.active === c.id) S.active = S.colors.at(-1)?.id || null;
      persist();
      renderSelected();
      renderRecipe();
    });
    wrap.appendChild(el);
  }
}

// ---------- recipe ----------
const cache = new Map();
function recipesFor(color) {
  const paints = ownedPaints();
  const model = MEDIA[S.medium].model;
  // Solve for the paint body that will read as the target under the chosen finish.
  const bodyLab = linearToLab(fromFinish(labToLinear(color.lab), S.finish));
  const key = [color.hex, S.medium, S.finish, paints.map((p) => p.id + p.hex).join()].join('|');
  if (!cache.has(key)) {
    const recipes = paints.length ? solve(bodyLab, model, paints) : [];
    let suggestion = null;
    if (!recipes.length || recipes[0].dE >= 5) {
      const all = paintsFor(S.medium).filter((p) => !p.custom).map(preparePaint);
      const [better] = solve(bodyLab, model, all, { count: 1 });
      const ownedIds = new Set(paints.map((p) => p.id));
      const missing = better.items.filter((i) => !ownedIds.has(i.paint.id)).map((i) => i.paint);
      if (missing.length && (!recipes.length || better.dE < recipes[0].dE - 2)) suggestion = { better, missing };
    }
    cache.set(key, { recipes, suggestion, bodyLab });
  }
  return cache.get(key);
}

function amountText(item) {
  if (item.touch) return `a touch<small>≈${Math.max(0.5, Math.round(item.fraction * 200) / 2)}%</small>`;
  return `${item.parts} part${item.parts === 1 ? '' : 's'}<small>${Math.round(item.fraction * 100)}%</small>`;
}

function mixingTip(recipe) {
  if (MEDIA[S.medium].model === 'transparent') {
    return 'Mix the paints together in your palette first, then add water until a test stroke on scrap paper <em>dries</em> to the target.';
  }
  const items = recipe.items;
  if (items.length === 1) return 'Use this paint straight from the tube.';
  const base = items[0].paint;
  const strong = items.slice(1).reduce((a, b) => (b.paint.strength > a.paint.strength ? b : a)).paint;
  return `Lay out the ${esc(base.name)} first, then work in the ${esc(strong.name)} a little at a time. ` +
    'It’s easy to add more of a strong paint and hard to take it back. Mix a little more than you think you need, because matching a second batch is difficult.';
}

function recipeLine(r) {
  return r.items.map((i) => (i.touch ? `touch of ${i.paint.name}` : `${i.parts} ${i.paint.name}`)).join(' : ');
}

function renderRecipe() {
  const card = $('#recipe-card');
  const color = S.colors.find((c) => c.id === S.active);
  card.hidden = !color;
  if (!color) return;
  const out = $('#recipe');
  out.innerHTML = '<p class="working">Mixing…</p>';
  // Let the "Mixing…" frame paint before the solver runs.
  setTimeout(() => {
    if (S.active !== color.id) return;
    const { recipes, suggestion, bodyLab } = recipesFor(color);
    out.innerHTML = recipeHtml(color, recipes, suggestion, bodyLab);
    out.querySelectorAll('.alt').forEach((b) => b.addEventListener('click', () => {
      S.choice = Number(b.dataset.i);
      renderRecipe();
    }));
  }, 30);
}

function recipeHtml(color, recipes, suggestion, bodyLab) {
  const med = MEDIA[S.medium];
  if (!recipes.length) {
    return `<p>You haven't ticked any ${med.label.toLowerCase()} paints yet. Open <b>My paints</b> and choose the ones you own.</p>`;
  }
  const r = recipes[Math.min(S.choice, recipes.length - 1)];
  const q = matchQuality(r.dE);
  const mixLin = labToLinear(r.lab);
  const seenLin = withFinish(mixLin, S.finish);
  const wetLab = wetAppearance(r.lab, S.medium, S.grade);
  const dL = wetLab[0] - r.lab[0];
  const showWet = Math.abs(dL) >= 1.5;

  const compare = `
    <div class="compare">
      <div class="cmp"><div class="chipcolor" style="background:${color.hex}"></div><b>Your target</b>${esc(describeLab(color.lab))}</div>
      <div class="cmp"><div class="chipcolor" style="background:${hexOfLin(seenLin)}"></div><b>This mix, dry</b>${FINISHES[S.finish].label.toLowerCase()} finish</div>
      ${showWet ? `<div class="cmp"><div class="chipcolor" style="background:${hexOfLab(wetLab)}"></div><b>Wet on palette</b>${dL > 0 ? 'looks lighter' : 'looks darker'}</div>` : ''}
    </div>`;

  const steps = r.items.map((i) => `
    <li>
      <span class="swatch" style="background:${i.paint.hex}"></span>
      <span class="name">${esc(i.paint.name)} <small>${esc(i.paint.ci || 'custom')} · ${esc(i.paint.opacity || '')}</small></span>
      <span class="amt">${amountText(i)}</span>
      <span class="bar-track"><span class="bar-fill" style="display:block;width:${Math.max(2, i.fraction * 100)}%;background:${i.paint.hex}"></span></span>
      ${i.paint.note ? `<span class="paint-note">${esc(i.paint.note)}</span>` : ''}
    </li>`).join('');

  const wash = r.strength != null ? `<p class="tip"><b>Dilution:</b> ${washText(r.strength)}</p>` : '';

  const alts = recipes.length > 1 ? `
    <div class="alts"><h3>Other ways to mix it</h3>
      ${recipes.map((x, i) => (x === r ? '' : `<button type="button" class="alt" data-i="${i}"><b>ΔE ${x.dE.toFixed(1)} ·</b> ${esc(recipeLine(x))}</button>`)).join('')}
    </div>` : '';

  const sugg = suggestion ? `
    <p class="tip"><b>To get closer:</b> adding ${suggestion.missing.map((p) => esc(p.name)).join(' and ')} to your paints
    would improve this to ${matchQuality(suggestion.better.dE).label.toLowerCase()} (ΔE ${suggestion.better.dE.toFixed(1)}):
    ${esc(recipeLine(suggestion.better))}.</p>` : '';

  // Drying.
  const dryLine = showWet
    ? `For this color: while wet it will look <b>${dL > 0 ? 'lighter' : 'darker'}</b> than it dries, ${valueStepsText(dL)}. ${dL > 0 ? 'Don’t darken the wet mix to match your target; it will darken on its own.' : 'Mix it slightly darker than the target, because it will lighten as it dries.'}`
    : 'For this color: expect little or no visible change between wet and dry.';
  const gradeLine = S.medium === 'acrylic'
    ? `<p>${S.grade === 'student' ? 'Student-grade acrylics shift about twice as much as artist grade.' : 'Artist-grade acrylics shift less than student grade (about half as much).'}</p>` : '';

  // Finish: show the same mix under all three finishes.
  const finishRow = Object.entries(FINISHES).map(([k, f]) => {
    const lab = linearToLab(withFinish(mixLin, k));
    return `<div class="cmp"><div class="chipcolor" style="background:${hexOfLab(lab)};height:40px"></div><b>${f.label}</b>L* ${lab[0].toFixed(0)}</div>`;
  }).join('');
  const shiftG = linearToLab(withFinish(mixLin, 'gloss'))[0] - linearToLab(withFinish(mixLin, 'matte'))[0];
  const finishImpact = Math.abs(shiftG) < 1
    ? 'This color is light enough that the finish barely changes its value.'
    : `For this color, gloss reads ${valueStepsText(shiftG).replace(' (on a 10-step value scale)', '')} darker than matte.`;
  const compensated = deltaE2000(bodyLab, color.lab) > 0.5
    ? ` The recipe already makes up for your ${FINISHES[S.finish].label.toLowerCase()} finish, so the dried, finished painting matches your target.` : '';

  return `
    ${compare}
    <div class="quality"><span class="badge l${q.level}">${q.label}</span><span class="muted small">${q.detail} ΔE2000 ${r.dE.toFixed(1)}</span></div>
    <ol class="steps">${steps}</ol>
    ${wash}
    <p class="tip">${mixingTip(r)}</p>
    ${sugg}
    ${alts}
    <div class="notes">
      <div class="note"><h4>Drying: ${esc(med.label)}</h4>
        <p>${esc(med.dryingSummary)}</p><p>${dryLine}</p>${gradeLine}
        <ul>${med.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      </div>
      <div class="note"><h4>Gloss, satin or matte</h4>
        <div class="compare" style="margin:0.4rem 0">${finishRow}</div>
        <p>${esc(FINISHES[S.finish].notes)}</p>
        <p>${finishImpact}${compensated}</p>
      </div>
    </div>`;
}

// ---------- settings ----------
const mediumSel = $('#medium'), gradeSel = $('#grade'), finishSel = $('#finish');
function renderSettings() {
  mediumSel.value = S.medium;
  gradeSel.value = S.grade;
  finishSel.value = S.finish;
  $('#grade-wrap').hidden = S.medium !== 'acrylic';
  const n = (S.owned[S.medium] || []).length;
  $('#paints-summary').textContent = `Recipes use the ${n} ${MEDIA[S.medium].label.toLowerCase()} paint${n === 1 ? '' : 's'} you own. Change them under My paints.`;
}
mediumSel.addEventListener('change', () => {
  S.medium = mediumSel.value;
  S.finish = MEDIA[S.medium].naturalFinish;
  if (!S.owned[S.medium]) S.owned[S.medium] = [...DEFAULT_OWNED[S.medium]];
  persist(); renderSettings(); renderRecipe();
});
gradeSel.addEventListener('change', () => { S.grade = gradeSel.value; persist(); renderRecipe(); });
finishSel.addEventListener('change', () => { S.finish = finishSel.value; persist(); renderRecipe(); });

// ---------- My paints dialog ----------
const dlg = $('#paints-dialog');
function renderPaintList() {
  $('#dlg-medium').textContent = MEDIA[S.medium].label;
  const owned = new Set(S.owned[S.medium] || []);
  const list = $('#paint-list');
  list.innerHTML = '';
  for (const p of paintsFor(S.medium)) {
    const row = document.createElement('label');
    row.className = 'paint-row';
    const edited = S.overrides[p.id];
    row.innerHTML = `<input type="checkbox" ${owned.has(p.id) ? 'checked' : ''} />
      <input type="color" value="${p.hex}" aria-label="Adjust ${esc(p.name)} color" />
      <span>${esc(p.name)}<br><small>${esc(p.ci || 'custom')} · ${esc(p.opacity || '')}${edited ? ' · edited' : ''}</small></span>
      ${p.custom ? '<button type="button" class="rm" aria-label="Delete custom paint">×</button>'
        : edited ? '<button type="button" class="rm" aria-label="Reset color">↺</button>' : '<span></span>'}`;
    row.querySelector('input[type=checkbox]').addEventListener('change', (e) => {
      const set = new Set(S.owned[S.medium] || []);
      e.target.checked ? set.add(p.id) : set.delete(p.id);
      S.owned[S.medium] = [...set];
      persist(); renderSettings();
    });
    row.querySelector('input[type=color]').addEventListener('change', (e) => {
      if (p.custom) S.custom.find((c) => c.id === p.id).hex = e.target.value;
      else S.overrides[p.id] = e.target.value;
      persist(); renderPaintList();
    });
    const rm = row.querySelector('.rm');
    if (rm) rm.addEventListener('click', (e) => {
      e.preventDefault();
      if (p.custom) S.custom = S.custom.filter((c) => c.id !== p.id);
      else delete S.overrides[p.id];
      persist(); renderPaintList(); renderSettings();
    });
    list.appendChild(row);
  }
}
$('#paints-btn').addEventListener('click', () => { renderPaintList(); dlg.showModal(); });
dlg.addEventListener('close', () => renderRecipe());
$('#reset-paints').addEventListener('click', () => {
  S.owned[S.medium] = [...DEFAULT_OWNED[S.medium]];
  for (const p of PIGMENTS) delete S.overrides[p.id];
  persist(); renderPaintList(); renderSettings();
});
$('#add-custom').addEventListener('click', () => {
  const color = S.colors.find((c) => c.id === S.active);
  if (!color) { toast('Pick a color first. Tap a paint swatch in your photo.'); return; }
  const name = prompt('Name this paint (e.g. "Golden Quinacridone Gold")');
  if (!name) return;
  const opaque = confirm('Is it opaque? OK = opaque, Cancel = transparent');
  const p = {
    id: 'custom-' + uid(), name: name.trim(), ci: 'custom', hex: color.hex, strength: 1,
    opacity: opaque ? 'opaque' : 'transparent', media: [S.medium],
  };
  S.custom.push(p);
  S.owned[S.medium] = [...(S.owned[S.medium] || []), p.id];
  persist(); renderPaintList(); renderSettings();
  toast(`${p.name} added to your ${MEDIA[S.medium].label.toLowerCase()} paints.`);
});

// ---------- account + saved palettes ----------
function renderAccount() {
  const btn = $('#account-btn');
  btn.hidden = !account.connected;
  btn.textContent = account.user ? (account.user.name || account.user.email || 'Account') : 'Sign in';
  btn.title = account.user ? 'Signed in with Toolkit Your Life. Click to sign out.' : 'Sign in with your Toolkit Your Life account';
}
$('#account-btn').addEventListener('click', () => {
  if (!account.user) return account.signIn();
  if (confirm(`Sign out of Toolkit Your Life (${account.user.email || account.user.name})?`)) account.signOut();
});
account.onChange(() => { renderAccount(); renderSaved(); });

async function renderSaved() {
  let list = [];
  try { list = await account.palettes.list(); } catch { /* offline */ }
  $('#saved-card').hidden = !list.length;
  const wrap = $('#saved');
  wrap.innerHTML = '';
  for (const p of list) {
    const row = document.createElement('div');
    row.className = 'saved-item';
    row.innerHTML = `<div class="left"><b>${esc(p.name)}</b>
        <span class="swatch-row">${p.colors.map((c) => `<span class="swatch" style="background:${esc(c.hex)}"></span>`).join('')}</span>
        <span class="muted small">${esc(MEDIA[p.medium]?.label || p.medium)} · ${new Date(p.createdAt).toLocaleDateString()}</span></div>
      <div class="row"><button class="chip" type="button" data-a="open">Open</button><button class="chip ghost" type="button" data-a="del" aria-label="Delete">Delete</button></div>`;
    row.querySelector('[data-a=open]').addEventListener('click', () => {
      S.medium = p.medium in MEDIA ? p.medium : S.medium;
      S.colors = p.colors.map((c) => ({ id: uid(), hex: c.hex, lab: linearToLab(rgb255ToLinear(hexToRgb(c.hex))), source: 'saved' }));
      S.active = S.colors[0]?.id || null;
      persist(); renderSettings(); renderSelected(); renderRecipe();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    row.querySelector('[data-a=del]').addEventListener('click', async () => {
      if (!confirm(`Delete “${p.name}”?`)) return;
      await account.palettes.remove(p.id);
      renderSaved();
    });
    wrap.appendChild(row);
  }
}

$('#save-btn').addEventListener('click', async () => {
  const name = prompt('Name this palette', `Palette ${new Date().toLocaleDateString()}`);
  if (!name) return;
  const colors = S.colors.map((c) => {
    const { recipes } = recipesFor(c);
    return { hex: c.hex, name: describeLab(c.lab), recipe: recipes[0] ? recipeLine(recipes[0]) : null };
  });
  try {
    await account.palettes.save({ name, medium: S.medium, finish: S.finish, colors });
    toast(account.user ? 'Saved to your Toolkit Your Life account.'
      : account.connected ? 'Saved in this browser. Sign in to keep it in your account.' : 'Saved in this browser.');
    renderSaved();
  } catch (e) {
    console.warn('[pigment-lens] save failed', e);
    toast(e?.code === 'permission-denied'
      ? 'Saving is blocked by the Firestore security rules. The Pigment Lens rule needs adding.'
      : 'Couldn’t save. Check your connection and try again.');
  }
});

// ---------- boot ----------
renderSettings();
renderSelected();
renderRecipe();
renderAccount();
account.init().catch((e) => console.warn('[pigment-lens] sign-in unavailable', e)).finally(() => { renderAccount(); renderSaved(); });
