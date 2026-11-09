import { rgbToLab, hexToRgb, describeLab, deltaE2000 } from './color.js';
import { PIGMENTS, DEFAULT_OWNED } from './pigments.js';
import { preparePaint, solve } from './mixer.js';
import { MEDIA } from './media.js';
import { account } from './account.js';
import { loadImageInto, dominantColors } from './image.js';
import { harmonies, labHex, toLch } from './harmony.js';
import { $, esc, toast, initShell, openInMixer } from './shell.js';

const PREFS_KEY = 'pigment-lens:prefs';
const readPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; } };
let prefs = readPrefs();
let cloudSettings = null; // the signed-in person's paint settings, if any

const P = {
  found: [],      // [{ lab, share }]
  imageFound: [], // from a website's preview image
  key: null,      // lab of the key color
  source: '',
};

// ---------- source ----------
document.querySelectorAll('[data-src]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-src]').forEach((x) => {
    x.classList.toggle('on', x === b);
    x.setAttribute('aria-selected', x === b);
  });
  $('#src-image').hidden = b.dataset.src !== 'image';
  $('#src-url').hidden = b.dataset.src !== 'url';
}));

const previewCanvas = $('#pal-canvas');
async function fromImage(file, label) {
  if (!file) return;
  let imageData;
  try {
    ({ imageData } = await loadImageInto(previewCanvas, file, 900));
  } catch {
    toast('That image couldn’t be opened.');
    return;
  }
  $('#pal-preview').hidden = false;
  P.found = dominantColors(imageData, { k: 8, minDE: 7 }).slice(0, 7);
  P.imageFound = [];
  P.source = label || 'From your image, biggest areas first.';
  showResults();
}
$('#pal-camera').addEventListener('change', (e) => fromImage(e.target.files[0]));
$('#pal-upload').addEventListener('change', (e) => fromImage(e.target.files[0]));

$('#src-url').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = $('#pal-url').value.trim();
  if (!url) return;
  const btn = e.submitter || $('#src-url button');
  btn.disabled = true;
  btn.textContent = 'Reading…';
  try {
    const res = await fetch(`site-colors.php?url=${encodeURIComponent(url)}`);
    const data = await res.json().catch(() => null);
    if (!data) throw new Error('Website colors only work on toolkityourlife.com. Upload a screenshot instead.');
    if (!res.ok || data.error) throw new Error(data.error || 'Couldn’t read that site.');
    P.found = siteColors(data.colors);
    P.imageFound = [];
    P.source = `From ${data.title || data.url}: the colors its design uses most.`;
    $('#pal-preview').hidden = true;
    if (data.images?.[0]) {
      try {
        const img = await fetch(`site-colors.php?image=${encodeURIComponent(data.images[0])}`);
        if (img.ok) {
          const { imageData } = await loadImageInto(previewCanvas, await img.blob(), 900);
          P.imageFound = dominantColors(imageData, { k: 7, minDE: 7 }).slice(0, 6);
          $('#pal-preview').hidden = false;
        }
      } catch { /* preview image is optional */ }
    }
    if (!P.found.length && P.imageFound.length) { P.found = P.imageFound; P.imageFound = []; }
    if (!P.found.length) throw new Error('No colors found on that page. Try a screenshot instead.');
    showResults();
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Get colors';
  }
});

// Merge near-identical CSS colors and keep the most used, with pure
// black/white kept only if they dominate (they're in almost every stylesheet).
function siteColors(list = []) {
  const groups = [];
  for (const { hex, count } of list) {
    const lab = rgbToLab(hexToRgb(hex));
    const g = groups.find((x) => deltaE2000(x.lab, lab) < 6);
    if (g) g.count += count;
    else groups.push({ lab, count });
  }
  const total = groups.reduce((s, g) => s + g.count, 0) || 1;
  const sorted = groups.sort((a, b) => b.count - a.count);
  const extremes = sorted.filter((g) => g.lab[0] > 97 || g.lab[0] < 3).slice(0, 2);
  const rest = sorted.filter((g) => !extremes.includes(g)).slice(0, 7 - extremes.length);
  return [...rest, ...extremes].map((g) => ({ lab: g.lab, share: g.count / total }));
}

// ---------- results ----------
function pickKey(colors) {
  // Most colorful, weighted toward colors that cover more of the source.
  let best = colors[0], score = -1;
  for (const c of colors) {
    const s = toLch(c.lab)[1] * Math.sqrt(Math.max(c.share, 0.02));
    if (s > score) { score = s; best = c; }
  }
  return best.lab;
}

function strip(colors, { big = false, key = null } = {}) {
  return colors.map((c, i) => {
    const hex = labHex(c.lab);
    const ink = c.lab[0] > 60 ? '#1b1916' : '#ffffff';
    const isKey = key && deltaE2000(key, c.lab) < 0.5;
    const share = c.share != null ? `${Math.max(1, Math.round(c.share * 100))}%` : esc(c.role || '');
    return `<button type="button" class="chipc${isKey ? ' key' : ''}" data-i="${i}" style="background:${hex};color:${ink}"
      title="${esc(describeLab(c.lab))}, ${hex.toUpperCase()}. Tap to make this the key color.">
      ${big ? `<b>${hex.toUpperCase()}</b>` : ''}<span>${share}</span></button>`;
  }).join('');
}

function bindKeyPicks(el, colors) {
  el.querySelectorAll('.chipc').forEach((b) => b.addEventListener('click', () => {
    P.key = colors[Number(b.dataset.i)].lab;
    renderFound();
    renderIdeas();
  }));
}

function showResults() {
  P.key = pickKey(P.found);
  $('#extracted-card').hidden = false;
  $('#ideas-card').hidden = false;
  $('#paints-card').hidden = false;
  renderFound();
  renderIdeas();
  renderPlan();
  $('#extracted-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderFound() {
  $('#found-source').textContent = P.source;
  $('#found').innerHTML = strip(P.found, { big: true, key: P.key });
  bindKeyPicks($('#found'), P.found);
  $('#found-image-wrap').hidden = !P.imageFound.length;
  if (P.imageFound.length) {
    $('#found-image').innerHTML = strip(P.imageFound, { key: P.key });
    bindKeyPicks($('#found-image'), P.imageFound);
  }
}
$('#mix-found').addEventListener('click', () => openInMixer(P.found.map((c) => labHex(c.lab))));

function renderIdeas() {
  $('#key-name').textContent = describeLab(P.key);
  const neutral = [...P.found].sort((a, b) => toLch(a.lab)[1] - toLch(b.lab)[1])[0];
  const ideas = harmonies(P.key, neutral && toLch(neutral.lab)[1] < 12 ? neutral.lab : null);
  const wrap = $('#ideas');
  wrap.innerHTML = ideas.map((idea, n) => `
    <div class="idea">
      <h3>${esc(idea.name)}</h3>
      <p>${esc(idea.why)}</p>
      <div class="palette-strip">${strip(idea.colors)}</div>
      <div class="row">
        <button type="button" class="chip" data-a="mix" data-n="${n}">Mix these</button>
        <button type="button" class="chip ghost" data-a="save" data-n="${n}">Save</button>
        <button type="button" class="chip ghost" data-a="copy" data-n="${n}">Copy hex codes</button>
      </div>
    </div>`).join('');
  wrap.querySelectorAll('.idea .chipc').forEach((b) => { b.disabled = true; b.style.cursor = 'default'; b.removeAttribute('title'); });
  wrap.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
    const idea = ideas[Number(b.dataset.n)];
    const hexes = idea.colors.map((c) => labHex(c.lab));
    if (b.dataset.a === 'mix') return openInMixer(hexes);
    if (b.dataset.a === 'copy') {
      try { await navigator.clipboard.writeText(hexes.join(' ').toUpperCase()); toast('Hex codes copied.'); }
      catch { prompt('Copy these hex codes:', hexes.join(' ').toUpperCase()); }
      return;
    }
    const name = prompt('Name this palette', `${idea.name}: ${describeLab(P.key)}`);
    if (!name) return;
    try {
      await account.palettes.save({
        name, medium: $('#pal-medium').value, colors: idea.colors.map((c) => ({ hex: labHex(c.lab), name: describeLab(c.lab) })),
      });
      toast(account.user ? 'Saved to your Toolkit Your Life account.' : 'Saved in this browser. It’s listed on the Mix colors page.');
    } catch (e) {
      console.warn('[pigment-lens] save failed', e);
      toast('Couldn’t save. Check your connection and try again.');
    }
  }));
}

// ---------- paints plan ----------
function ownedPaints(medium) {
  const s = cloudSettings || prefs;
  const owned = new Set((s.owned || DEFAULT_OWNED)[medium] || DEFAULT_OWNED[medium]);
  const overrides = s.overrides || {};
  const custom = (s.custom || []).filter((p) => p.media.includes(medium));
  return [...PIGMENTS.filter((p) => p.media.includes(medium)), ...custom]
    .filter((p) => owned.has(p.id))
    .map((p) => preparePaint({ ...p, hex: overrides[p.id] || p.hex }));
}

let planToken = 0;
function renderPlan() {
  const medium = $('#pal-medium').value;
  const out = $('#paint-plan');
  const paints = ownedPaints(medium);
  if (!paints.length) {
    out.innerHTML = `<p>You haven’t ticked any ${MEDIA[medium].label.toLowerCase()} paints. Set them under Mix colors → My paints.</p>`;
    return;
  }
  out.innerHTML = '<p class="working">Working out your paints…</p>';
  const token = ++planToken;
  const colors = P.found.slice(0, 7);
  const options = []; // per color: a few good recipes
  let i = 0;
  // Solve one color per tick so the page stays responsive.
  const step = () => {
    if (token !== planToken) return;
    if (i < colors.length) {
      const c = colors[i++];
      const recipes = solve(c.lab, MEDIA[medium].model, paints, { count: 4 });
      const best = recipes[0].dE;
      options.push(recipes.filter((r) => r.dE <= Math.max(best + 2, 3)));
      return setTimeout(step, 0);
    }
    renderPlanResult(out, colors, pickPaints(options));
  };
  setTimeout(step, 30);
}

// Choose one recipe per color so the paints needed overall are as few as
// possible (then as accurate as possible). At most 4^7 combinations.
function pickPaints(options) {
  let best = null;
  const walk = (i, chosen, ids, err) => {
    if (best && (ids.size > best.ids.size || (ids.size === best.ids.size && err >= best.err))) return;
    if (i === options.length) { best = { chosen: chosen.slice(), ids: new Set(ids), err }; return; }
    for (const r of options[i]) {
      const added = r.items.map((it) => it.paint.id).filter((id) => !ids.has(id));
      added.forEach((id) => ids.add(id));
      chosen.push(r);
      walk(i + 1, chosen, ids, err + r.dE);
      chosen.pop();
      added.forEach((id) => ids.delete(id));
    }
  };
  walk(0, [], new Set(), 0);
  return best.chosen;
}

function renderPlanResult(out, colors, chosen) {
  const usage = new Map();
  chosen.forEach((r, n) => {
    for (const item of r.items) {
      const u = usage.get(item.paint.id) || { paint: item.paint, weight: 0, colors: [] };
      u.weight += item.fraction * Math.max(colors[n].share, 0.05);
      u.colors.push(colors[n].lab);
      usage.set(item.paint.id, u);
    }
  });
  const misses = colors.filter((c, n) => chosen[n].dE > 5);
  const list = [...usage.values()].sort((a, b) => b.weight - a.weight);
  out.innerHTML = `
    <p><b>Put out ${list.length} paint${list.length === 1 ? '' : 's'}:</b></p>
    <ul class="plan-list">${list.map((u) => `
      <li><span class="swatch" style="background:${u.paint.hex}"></span>
        <span>${esc(u.paint.name)}<small>Used in ${u.colors.length} of ${colors.length} colors
          <span class="minis">${u.colors.map((l) => `<i style="background:${labHex(l)}"></i>`).join('')}</span></small></span></li>`).join('')}
    </ul>
    ${misses.length ? `<p class="tip">${misses.length} color${misses.length === 1 ? ' is' : 's are'} hard to reach with your paints
      <span class="minis">${misses.map((m) => `<i style="background:${labHex(m.lab)}"></i>`).join('')}</span>.
      Open them in Mix colors to see which paint would help.</p>` : ''}
    <p class="muted small">Tap <b>Mix these</b> above for the exact recipe for each color.</p>`;
}
$('#pal-medium').addEventListener('change', () => { if (P.found.length) renderPlan(); });
$('#pal-medium').value = prefs.medium in MEDIA ? prefs.medium : 'oil';

// ---------- boot ----------
initShell(async (user) => {
  cloudSettings = null;
  if (!user) return;
  try {
    cloudSettings = await account.settings.load();
    if (cloudSettings?.medium in MEDIA) $('#pal-medium').value = cloudSettings.medium;
    if (P.found.length) renderPlan();
  } catch { /* use this device's paints */ }
});
