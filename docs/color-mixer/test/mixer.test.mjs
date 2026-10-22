// Run: node docs/color-mixer/test/mixer.test.mjs
import assert from 'node:assert/strict';
import { rgbToLab, hexToRgb, linearToLab, deltaE2000, rgbToHex, linearToRgb255 } from '../color.js';
import { PIGMENTS, DEFAULT_OWNED } from '../pigments.js';
import { preparePaint, predictLinear, solve } from '../mixer.js';

const byId = Object.fromEntries(PIGMENTS.map((p) => [p.id, preparePaint(p)]));
const hexOf = (lin) => rgbToHex(linearToRgb255(lin));

// CIEDE2000 reference pair (Sharma et al. test data, pair 1): 2.0425
assert.ok(Math.abs(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485]) - 2.0425) < 1e-3);

// Physical sanity: blue + yellow is green, not grey.
const g = linearToLab(predictLinear('opaque', [byId['ultramarine'], byId['lemon-yellow']], [0.4, 0.6]));
assert.ok(g[1] < -5, `ultramarine + lemon should lean green, got a*=${g[1].toFixed(1)}`);
// Phthalo dominates white.
const tint = linearToLab(predictLinear('opaque', [byId['phthalo-blue'], byId['titanium-white']], [0.05, 0.95]));
assert.ok(tint[2] < -20, `5% phthalo in white should be clearly blue, got b*=${tint[2].toFixed(1)}`);
// A single paint reproduces itself.
const self = solve(rgbToLab(hexToRgb(byId['burnt-sienna'].hex)), 'opaque', DEFAULT_OWNED.oil.map((id) => byId[id]));
assert.ok(self[0].dE < 1, 'burnt sienna should match itself');

const targets = { sky: '#8fb8de', olive: '#6b6b2a', skin: '#e0ac8c', rust: '#b5512a', lavender: '#b4a0d0', charcoal: '#2e3136', teal: '#1f7f7a' };
for (const medium of ['oil', 'watercolor']) {
  const model = medium === 'watercolor' ? 'transparent' : 'opaque';
  const paints = DEFAULT_OWNED[medium].map((id) => byId[id]);
  for (const [name, hex] of Object.entries(targets)) {
    const t0 = performance.now();
    const [best, ...alts] = solve(rgbToLab(hexToRgb(hex)), model, paints);
    const ms = performance.now() - t0;
    const recipe = best.items.map((i) => `${i.parts} ${i.paint.name}`).join(' : ');
    console.log(`${medium.padEnd(10)} ${name.padEnd(9)} ${hex} ΔE ${best.dE.toFixed(2)}/${best.idealDE.toFixed(2)} (${ms.toFixed(0)}ms) ${recipe}${best.strength ? ` @${(best.strength * 100).toFixed(0)}%` : ''}`);
    assert.ok(best.dE < 8, `${medium} ${name} too far: ${best.dE}`);
  }
}
console.log('ok');
