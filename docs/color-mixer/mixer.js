// Paint-mixing engine.
//
// Opaque media (oil, acrylic, gouache) use two-constant Kubelka–Munk theory
// per linear-RGB channel: each paint has absorption K and scattering S, a mix
// adds them by volume, and reflectance follows from K/S. This is what makes
// blue + yellow give green (not grey) and lets a pin-head of phthalo
// overpower a pile of white.
//
// Watercolor uses Beer–Lambert absorption of a transparent wash over white
// paper; lightness comes from dilution, not white paint.

import { clamp, hexToRgb, rgb255ToLinear, linearToLab, deltaE2000 } from './color.js';

const PAPER = 0.9; // linear reflectance of white watercolor paper
const ks = (R) => { R = clamp(R, 0.0008, 0.9995); return (1 - R) ** 2 / (2 * R); };
const reflect = (q) => 1 + q - Math.sqrt(q * q + 2 * q);

export function preparePaint(p) {
  const lin = rgb255ToLinear(hexToRgb(p.hex));
  const S = p.white ? 1 : 0.35 * p.strength; // K/S is fixed by the masstone, so tinting power scales both
  return {
    ...p,
    lin,
    S,
    K: lin.map((r) => ks(r) * S),
    absorb: lin.map((r) => -Math.log(clamp(r / PAPER, 0.0008, 1)) / 2),
  };
}

// weights: volume fractions (sum 1). d: wash density (watercolor only).
export function predictLinear(model, paints, weights, d = 1) {
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    if (model === 'transparent') {
      let a = 0;
      paints.forEach((p, i) => { a += weights[i] * p.strength * p.absorb[c]; });
      out[c] = PAPER * Math.exp(-2 * d * a);
    } else {
      let K = 0, S = 0;
      paints.forEach((p, i) => { K += weights[i] * p.K[c]; S += weights[i] * p.S; });
      out[c] = reflect(K / Math.max(S, 1e-9));
    }
  }
  return out;
}

const softmax = (y) => {
  const m = Math.max(...y), e = y.map((v) => Math.exp(v - m)), s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
};

// Small Nelder–Mead minimiser.
function nelderMead(fn, x0, { iters = 160, step = 1.2 } = {}) {
  const n = x0.length;
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step; simplex.push(x); }
  let vals = simplex.map(fn);
  for (let k = 0; k < iters; k++) {
    const order = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    simplex = order.map((i) => simplex[i]); vals = order.map((i) => vals[i]);
    if (vals[n] - vals[0] < 1e-4) break;
    const cen = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) cen[j] += simplex[i][j] / n;
    const along = (t) => cen.map((c, j) => c + t * (simplex[n][j] - c));
    const xr = along(-1), fr = fn(xr);
    if (fr < vals[0]) {
      const xe = along(-2), fe = fn(xe);
      [simplex[n], vals[n]] = fe < fr ? [xe, fe] : [xr, fr];
    } else if (fr < vals[n - 1]) {
      [simplex[n], vals[n]] = [xr, fr];
    } else {
      const xc = along(fr < vals[n] ? -0.5 : 0.5), fc = fn(xc);
      if (fc < Math.min(fr, vals[n])) [simplex[n], vals[n]] = [xc, fc];
      else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
          vals[i] = fn(simplex[i]);
        }
      }
    }
  }
  const best = vals.indexOf(Math.min(...vals));
  return { x: simplex[best], f: vals[best] };
}

function fitSet(model, paints, targetLab) {
  const n = paints.length;
  const transparent = model === 'transparent';
  const unpack = (x) => ({ w: softmax(x.slice(0, n)), d: transparent ? Math.exp(x[n]) : 1 });
  const cost = (x) => {
    const { w, d } = unpack(x);
    return deltaE2000(linearToLab(predictLinear(model, paints, w, d)), targetLab);
  };
  const x0 = new Array(n).fill(0);
  if (transparent) x0.push(0);
  let best = { x: x0, f: cost(x0) };
  // A few starts so strong pigments can settle at tiny amounts.
  for (let s = 0; s < (n > 1 ? 3 : 1); s++) {
    const start = x0.map((v, i) => (i < n && s > 0 ? (i === (s - 1) % n ? 2 : -1) : v));
    const r = nelderMead(cost, start, { iters: n === 1 && !transparent ? 1 : 140 + 40 * n });
    if (r.f < best.f) best = r;
  }
  const r = nelderMead(cost, best.x, { iters: 80, step: 0.3 });
  if (r.f < best.f) best = r;
  const { w, d } = unpack(best.x);
  return { paints, weights: w, d, dE: best.f };
}

const combos = (arr, k, start = 0, acc = [], out = []) => {
  if (acc.length === k) { out.push(acc.slice()); return out; }
  for (let i = start; i < arr.length; i++) { acc.push(arr[i]); combos(arr, k, i + 1, acc, out); acc.pop(); }
  return out;
};

// Drop pigments the optimiser pushed to ~0 and refit.
function prune(model, fit, targetLab) {
  const keep = fit.paints.filter((p, i) => fit.weights[i] >= 0.004);
  if (keep.length === fit.paints.length || keep.length === 0) return fit;
  const refit = fitSet(model, keep, targetLab);
  return refit.dE <= fit.dE + 0.4 ? refit : fit;
}

const complexity = (fit) => fit.paints.reduce((s, p) => s + (p.white ? 0.25 : 1), 0);
const score = (fit) => fit.dE + 0.8 * Math.max(0, complexity(fit) - 1);
const keyOf = (fit) => fit.paints.map((p) => p.id).sort().join('+');

/**
 * Find recipes for targetLab using the given paint objects (from preparePaint).
 * Returns up to `count` recipes, best first.
 */
export function solve(targetLab, model, paints, { count = 3, maxColors = 3 } = {}) {
  const whites = model === 'transparent' ? [] : paints.filter((p) => p.white).slice(0, 1);
  const colors = paints.filter((p) => !p.white);
  const withWhite = (set) => [...set, ...whites];
  const fits = [];
  if (whites.length) fits.push(fitSet(model, whites, targetLab));

  const singles = colors.map((p) => fitSet(model, withWhite([p]), targetLab));
  fits.push(...singles);
  if (maxColors >= 2) {
    const pairs = combos(colors, 2).map((set) => fitSet(model, withWhite(set), targetLab));
    fits.push(...pairs);
    if (maxColors >= 3) {
      const topPairs = pairs.sort((a, b) => a.dE - b.dE).slice(0, 10);
      const seen = new Set();
      for (const pf of topPairs) {
        const base = pf.paints.filter((p) => !p.white);
        for (const p of colors) {
          if (base.includes(p)) continue;
          const set = [...base, p];
          const k = set.map((q) => q.id).sort().join('+');
          if (seen.has(k)) continue;
          seen.add(k);
          fits.push(fitSet(model, withWhite(set), targetLab));
        }
      }
    }
  }

  const unique = new Map();
  for (const fit of fits.map((f) => prune(model, f, targetLab))) {
    const k = keyOf(fit);
    if (!unique.has(k) || unique.get(k).dE > fit.dE) unique.set(k, fit);
  }
  const ranked = [...unique.values()].sort((a, b) => score(a) - score(b));
  const closest = ranked.reduce((a, b) => (b.dE < a.dE ? b : a), ranked[0]);
  const out = ranked.slice(0, count);
  if (!out.includes(closest)) out[out.length - 1] = closest;
  return out.map((fit) => finalize(model, fit, targetLab));
}

// Turn continuous fractions into whole "parts" an artist can measure,
// choosing the smallest batch whose colour still matches.
function finalize(model, fit, targetLab) {
  const order = fit.weights.map((w, i) => i).sort((a, b) => fit.weights[b] - fit.weights[a]);
  const paints = order.map((i) => fit.paints[i]);
  const weights = order.map((i) => fit.weights[i]);
  // Amounts under 2% are "a touch" (added by eye); the rest become whole
  // parts, using the smallest batch within 1 ΔE of the ideal mix.
  const touch = weights.map((w) => w < 0.02);
  const touchSum = weights.reduce((s, w, i) => s + (touch[i] ? w : 0), 0);
  const mainSum = 1 - touchSum;
  let best = null, closest = null;
  for (let total = 1; total <= 60 && !best; total++) {
    const parts = weights.map((w, i) => (touch[i] ? 0 : Math.max(1, Math.round((w / mainSum) * total))));
    const sum = parts.reduce((a, b) => a + b, 0);
    const mix = weights.map((w, i) => (touch[i] ? w : (parts[i] / sum) * mainSum));
    const lab = linearToLab(predictLinear(model, paints, mix, fit.d));
    const r = { parts, mix, lab, dE: deltaE2000(lab, targetLab) };
    if (r.dE <= fit.dE + 1) best = r;
    if (!closest || r.dE < closest.dE) closest = r;
  }
  best = best || closest;
  const strength = model === 'transparent'
    ? fit.d * weights.reduce((s, w, i) => s + w * paints[i].strength, 0)
    : null;
  return {
    items: paints.map((p, i) => ({ paint: p, parts: best.parts[i], fraction: best.mix[i], touch: touch[i] })),
    lab: best.lab,
    dE: best.dE,
    idealDE: fit.dE,
    strength,
  };
}

export function matchQuality(dE) {
  if (dE < 1) return { label: 'Exact match', detail: 'Indistinguishable to the eye.', level: 4 };
  if (dE < 2.5) return { label: 'Very close', detail: 'Only visible side by side.', level: 3 };
  if (dE < 5) return { label: 'Close', detail: 'Small difference; adjust by eye at the end.', level: 2 };
  if (dE < 10) return { label: 'Approximate', detail: 'Noticeable difference. A paint you don’t own may get closer.', level: 1 };
  return { label: 'Out of reach', detail: 'Your paints can’t reach this color. See the suggestion below.', level: 0 };
}

export function washText(strength) {
  if (strength >= 0.8) return 'Full strength: paint straight from the pan or tube with very little water.';
  if (strength >= 0.4) return `Medium wash, about ${Math.round(strength * 100)}% strength: roughly equal paint and water.`;
  if (strength >= 0.15) return `Light wash, about ${Math.round(strength * 100)}% strength: mostly water.`;
  return `Pale tint, about ${Math.max(1, Math.round(strength * 100))}% strength: a little paint in a lot of water.`;
}
