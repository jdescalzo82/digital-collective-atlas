// Color-harmony palettes built in CIE LCh (perceptual lightness, chroma, hue).

import { labToLinear, linearToRgb255, rgbToHex } from './color.js';

export const toLch = ([L, a, b]) => {
  let h = Math.atan2(b, a) * 180 / Math.PI;
  if (h < 0) h += 360;
  return [L, Math.hypot(a, b), h];
};
export const fromLch = ([L, C, h]) => [L, C * Math.cos(h * Math.PI / 180), C * Math.sin(h * Math.PI / 180)];

// Lower chroma until the color fits on screen (inside sRGB).
export function inGamut(lch) {
  let [L, C, h] = lch;
  L = Math.min(98, Math.max(4, L));
  for (let i = 0; i < 40; i++) {
    const lin = labToLinear(fromLch([L, C, h]));
    if (lin.every((v) => v >= -0.001 && v <= 1.001)) break;
    C *= 0.92;
  }
  return fromLch([L, C, h]);
}

export const labHex = (lab) => rgbToHex(linearToRgb255(labToLinear(lab)));
const rot = ([L, C, h], d, dL = 0, k = 1) => inGamut([L + dL, C * k, (h + d + 360) % 360]);

// palettes: [{ name, why, colors: [{ lab, role }] }]
export function harmonies(keyLab, neutralLab) {
  const k = toLch(keyLab);
  const base = { lab: inGamut(k), role: 'key color' };
  const neutral = neutralLab ? { lab: neutralLab, role: 'neutral from the source' } : { lab: rot(k, 0, 0, 0.12), role: 'neutral' };
  const light = { lab: rot(k, 0, Math.min(25, 92 - k[0]), 0.55), role: 'light tint' };
  const dark = { lab: rot(k, 0, -Math.min(30, k[0] - 12), 0.8), role: 'shadow' };
  const out = [];
  if (k[1] < 10) {
    // Nearly grey source: value studies read better than hue harmonies.
    out.push({ name: 'Value study', why: 'Your source is mostly neutral, so this palette works in values. Five steps from light to dark, keeping its slight color temperature.',
      colors: [88, 72, 55, 38, 20].map((L, i) => ({ lab: inGamut([L, k[1], k[2]]), role: ['highlight', 'light', 'middle', 'dark', 'deepest'][i] })) });
    out.push({ name: 'Warm accent', why: 'Neutrals with one warm accent to draw the eye.',
      colors: [base, light, dark, { lab: inGamut([60, 55, 55]), role: 'warm accent' }, neutral] });
    return out;
  }
  out.push({ name: 'Complementary', why: 'The key color with its opposite. Strong contrast; let one dominate and use the other as an accent.',
    colors: [base, light, dark, { lab: rot(k, 180, 0, 0.9), role: 'complement' }, neutral] });
  out.push({ name: 'Analogous', why: 'Neighbors on the color wheel. Calm and unified, good for landscapes and mood pieces.',
    colors: [{ lab: rot(k, -30, 4), role: 'neighbor' }, base, { lab: rot(k, 30, -4), role: 'neighbor' }, dark, light] });
  out.push({ name: 'Split complementary', why: 'The two colors either side of the complement. Lively contrast that’s easier to balance than a direct complement.',
    colors: [base, { lab: rot(k, 150, 0, 0.85), role: 'split' }, { lab: rot(k, 210, 0, 0.85), role: 'split' }, light, neutral] });
  out.push({ name: 'Triadic', why: 'Three evenly spaced hues. Vibrant. Mute two of them so the painting doesn’t fight itself.',
    colors: [base, { lab: rot(k, 120, 0, 0.7), role: 'triad' }, { lab: rot(k, 240, 0, 0.7), role: 'triad' }, dark, light] });
  out.push({ name: 'Monochrome', why: 'One hue in five values. A classic way to practise value before adding color.',
    colors: [88, 72, 55, 38, 20].map((L, i) => ({ lab: inGamut([L, k[1] * (i === 0 ? 0.45 : 0.85), k[2]]), role: ['highlight', 'light', 'middle', 'dark', 'deepest'][i] })) });
  return out;
}
