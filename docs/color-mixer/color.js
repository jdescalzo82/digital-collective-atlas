// Color math: sRGB <-> linear <-> XYZ (D65) <-> CIELAB, plus CIEDE2000.

export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c) {
  c = clamp(c);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// [0..255] x3 -> linear [0..1] x3
export const rgb255ToLinear = (rgb) => rgb.map((v) => srgbToLinear(v / 255));
export const linearToRgb255 = (lin) => lin.map((v) => Math.round(linearToSrgb(v) * 255));

export function hexToRgb(hex) {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(rgb) {
  return '#' + rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}

const WHITE = [0.95047, 1.0, 1.08883];

export function linearToXyz([r, g, b]) {
  return [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    0.0193339 * r + 0.119192 * g + 0.9503041 * b,
  ];
}

export function xyzToLinear([x, y, z]) {
  return [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
}

const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const fInv = (t) => (t * t * t > 216 / 24389 ? t * t * t : (116 * t - 16) / (24389 / 27));

export function xyzToLab([x, y, z]) {
  const fx = f(x / WHITE[0]), fy = f(y / WHITE[1]), fz = f(z / WHITE[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToXyz([L, a, b]) {
  const fy = (L + 16) / 116;
  return [fInv(fy + a / 500) * WHITE[0], fInv(fy) * WHITE[1], fInv(fy - b / 200) * WHITE[2]];
}

export const linearToLab = (lin) => xyzToLab(linearToXyz(lin));
export const labToLinear = (lab) => xyzToLinear(labToXyz(lab));
export const rgbToLab = (rgb) => linearToLab(rgb255ToLinear(rgb));
export const labToRgb = (lab) => linearToRgb255(labToLinear(lab));

export const chroma = ([, a, b]) => Math.hypot(a, b);

// CIEDE2000 colour difference (Sharma, Wu & Dalal 2005).
export function deltaE2000([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hp = (a, b) => {
    if (a === 0 && b === 0) return 0;
    const h = Math.atan2(b, a) / rad;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hp(a1p, b1), h2p = hp(a2p, b2);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp += h1p + h2p < 360 ? 360 : -360;
    hbp /= 2;
  }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad)
    + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

// Approximate Munsell value (0 black .. 10 white) from L*.
export const munsellValue = (L) => L / 10;

const HUES = [
  [15, 'red'], [40, 'red-orange'], [65, 'orange'], [85, 'yellow-orange'], [105, 'yellow'],
  [135, 'yellow-green'], [175, 'green'], [215, 'blue-green'], [255, 'blue'],
  [290, 'blue-violet'], [325, 'violet'], [350, 'red-violet'], [361, 'red'],
];

// Plain-language name like "dark muted blue-green".
export function describeLab([L, a, b]) {
  const C = Math.hypot(a, b);
  const value = L < 20 ? 'very dark' : L < 38 ? 'dark' : L < 62 ? 'mid' : L < 80 ? 'light' : 'very light';
  if (C < 6) {
    const greys = L < 15 ? 'near-black' : L > 92 ? 'near-white' : `${value} grey`;
    return C < 2.5 ? greys : `${greys} (${a > 0 || b > 0 ? 'warm' : 'cool'})`;
  }
  let h = Math.atan2(b, a) * 180 / Math.PI;
  if (h < 0) h += 360;
  if (h >= 20 && h < 95 && C < 40) return L < 50 ? `${value} brown` : `${value} ${C < 22 ? 'beige' : 'tan'}`;
  const hue = HUES.find(([lim]) => h < lim)[1];
  const sat = C < 18 ? 'muted ' : C > 55 ? 'vivid ' : '';
  return `${value} ${sat}${hue}`.replace('mid ', '');
}
