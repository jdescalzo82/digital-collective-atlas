// How each medium behaves between palette and finished painting.
// Shifts are typical published/observed ranges, not lab measurements of a
// specific brand — the app always recommends a dried test swatch.

import { clamp, labToLinear, linearToLab } from './color.js';

const smooth = (L) => 1 - 0.6 * ((L - 50) / 50) ** 2; // shifts fade near pure white/black

export const MEDIA = {
  oil: {
    label: 'Oil',
    model: 'opaque',
    naturalFinish: 'gloss',
    wet: (lab) => lab,
    dryingSummary: 'Oils keep the same color and value as they dry.',
    notes: [
      '“Sinking in”: as a layer dries, areas can go matte and look lighter and duller, especially darks. A retouch varnish or oiling out brings the true color back.',
      'Linseed oil yellows slightly over the years, most visibly in whites and pale blues, and faster if the painting is kept in the dark. Safflower- or poppy-based whites yellow less.',
      'Mixes with a lot of medium (glazes) dry glossier and look deeper than mixes straight from the tube.',
    ],
  },
  acrylic: {
    label: 'Acrylic',
    model: 'opaque',
    naturalFinish: 'satin',
    grades: { artist: 4, student: 8 }, // L* the dry film loses vs. wet
    wet: (lab, grade = 'artist') => {
      const s = MEDIA.acrylic.grades[grade] * smooth(lab[0]);
      return [clamp(lab[0] + s, 0, 100), lab[1], lab[2]];
    },
    dryingSummary: 'Acrylics dry darker: the acrylic binder looks milky white when wet and turns clear as the water evaporates.',
    notes: [
      'Student-grade paint (more binder and filler) shifts more than artist grade. Mid and dark values shift the most.',
      'Thick layers and mixes with a lot of white or matte medium look the most different between wet and dry.',
      'To check before you commit, dry a small swatch with a hair dryer (about 1 minute) and compare it to your target.',
    ],
  },
  gouache: {
    label: 'Gouache',
    model: 'opaque',
    naturalFinish: 'matte',
    wet: (lab) => [clamp(lab[0] + 0.12 * (lab[0] - 50), 0, 100), lab[1] * 1.08, lab[2] * 1.08],
    dryingSummary: 'Gouache shifts toward the middle as it dries: light colors dry slightly darker, dark colors dry noticeably lighter, and everything gets a little more chalky.',
    notes: [
      'The darkest mixes shift the most. Mix darks a little darker than your target.',
      'Gouache reactivates with water, so a heavy layer on top can lift and muddy the one underneath.',
      'Acrylic gouache (e.g. Turner, Holbein Acryla) dries matte like gouache but with a smaller value shift, closer to acrylic.',
    ],
  },
  watercolor: {
    label: 'Watercolor',
    model: 'transparent',
    naturalFinish: 'matte',
    wet: (lab) => {
      const k = 0.22 * (100 - lab[0]) * Math.min(1, lab[0] / 40);
      return [clamp(lab[0] - k, 0, 100), lab[1] * 1.15, lab[2] * 1.15];
    },
    dryingSummary: 'Watercolor dries lighter and less saturated, typically 10–30% lighter, because the water sinks into the paper and the paper shows through.',
    notes: [
      'Lighten watercolor with water rather than white. The amount of water sets the value.',
      'Mix your wet wash darker and more intense than the target so it dries to the right value.',
      'Paper matters: bright white cotton paper gives cleaner, lighter results than cream or wood-pulp paper. Granulating pigments (ultramarine, cerulean, burnt sienna) dry with a speckled texture.',
    ],
  },
};

export const FINISHES = {
  gloss: {
    label: 'Gloss',
    surface: 0.0,
    notes: 'Gloss looks darker and richer. Away from the glare, darks look deepest and colors most saturated, because the surface reflects light in one direction instead of scattering a haze of white across the color. At the glare angle it can look washed out, so hang it away from direct light.',
  },
  satin: {
    label: 'Satin',
    surface: 0.02,
    notes: 'Satin sits between gloss and matte. Darks lose a little depth compared to gloss, with much less glare.',
  },
  matte: {
    label: 'Matte',
    surface: 0.04,
    notes: 'Matte looks lighter and softer. The rough surface scatters about 4% of the light back as white, which lifts the darks and greys the colors slightly. No glare, though. Matte varnish over dark passages can look cloudy.',
  },
};

// Predicted colour is calibrated to a satin-ish swatch; re-apply surface reflection.
export function withFinish(lin, finish) {
  const base = FINISHES.satin.surface, s = FINISHES[finish].surface;
  return lin.map((r) => {
    const body = clamp((r - base) / (1 - base), 0.0005, 1);
    return body * (1 - s) + s;
  });
}

export function wetAppearance(lab, medium, grade) {
  return MEDIA[medium].wet(lab, grade);
}

// ΔL* -> "about 1 value step" on a 10-step value scale (≈10 L* per step).
export function valueStepsText(dL) {
  const steps = Math.abs(dL) / 10;
  if (steps < 0.15) return 'no visible value change';
  const half = Math.round(steps * 2) / 2;
  const word = half <= 0.5 ? 'about half a value step' : `about ${half} value step${half === 1 ? '' : 's'}`;
  return `${word} (on a 10-step value scale)`;
}

export const finishLab = (lab, finish) => linearToLab(withFinish(labToLinear(lab), finish));

// Inverse of withFinish: the satin-baseline colour that will *look* like
// `lin` once the chosen finish is applied. Used to solve for the paint body.
export function fromFinish(lin, finish) {
  const base = FINISHES.satin.surface, s = FINISHES[finish].surface;
  return lin.map((r) => {
    const body = clamp((r - s) / (1 - s), 0.0005, 1);
    return body * (1 - base) + base;
  });
}
