// Shared image helpers: load a photo into a canvas, and find its main colors.

import { rgb255ToLinear, linearToLab, deltaE2000 } from './color.js';

// Draw an image file (or Blob) into `canvas`, scaled so its long side is at most maxSide.
// Returns the decoded <img> (full resolution) and the canvas ImageData.
export async function loadImageInto(canvas, file, maxSide = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    // Keep the full-resolution bitmap for exports (e.g. the gridded reference).
    const full = document.createElement('canvas');
    full.width = img.naturalWidth;
    full.height = img.naturalHeight;
    full.getContext('2d').drawImage(img, 0, 0);
    return { full, imageData: ctx.getImageData(0, 0, canvas.width, canvas.height) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// k-means in Lab over a subsample of the image. `toLinear` lets callers apply
// a white-balance correction. Returns [{ lab, share }] biggest first, with
// near-duplicates (ΔE ≤ minDE) merged away.
export function dominantColors(imageData, { k = 7, minDE = 6, toLinear = (lin) => lin } = {}) {
  const { data, width, height } = imageData;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 5000)));
  const pts = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) continue; // skip transparent pixels (logos, PNGs)
      pts.push(linearToLab(toLinear(rgb255ToLinear([data[i], data[i + 1], data[i + 2]]))));
    }
  }
  if (!pts.length) return [];
  const dist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const cents = [pts[Math.floor(pts.length / 2)]];
  while (cents.length < Math.min(k, pts.length)) { // k-means++ style: pick farthest point
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
  return out.filter((c, i) => out.slice(0, i).every((o) => deltaE2000(o.lab, c.lab) > minDE));
}
