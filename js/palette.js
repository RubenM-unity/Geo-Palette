/* Median-cut colour quantisation over the captured imagery.
   Naive averaging turns every landscape into brown mud; median cut keeps the
   distinct greens, roofs and water apart. */

export const rgbToHex = (r, g, b) =>
  '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

/* Relative luminance -> pick readable text colour over a swatch. */
export function contrastText(r, g, b) {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) > 0.42 ? '#0b0f14' : '#ffffff';
}

/* Pull pixels out of a canvas, skipping transparent and pure-black gap pixels. */
export function samplePixels(canvas, maxSamples = 24000) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data; // throws SecurityError if tainted
  const total = w * h;
  const stride = Math.max(1, Math.floor(total / maxSamples));
  const out = [];
  for (let i = 0; i < total; i += stride) {
    const p = i * 4;
    const a = data[p + 3];
    if (a < 128) continue;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    if (r < 6 && g < 6 && b < 6) continue; // unloaded tile gap
    out.push([r, g, b]);
  }
  return out;
}

const channelRange = (px, c) => {
  let lo = 255, hi = 0;
  for (const p of px) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; }
  return hi - lo;
};

function medianCut(pixels, depth) {
  let boxes = [pixels];
  while (boxes.length < depth) {
    // Split the box with the widest single-channel spread — that's where detail hides.
    let bi = -1, best = -1, bc = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let c = 0; c < 3; c++) {
        const r = channelRange(box, c);
        if (r > best) { best = r; bi = i; bc = c; }
      }
    });
    if (bi < 0 || best <= 0) break;
    const box = boxes[bi];
    box.sort((a, b) => a[bc] - b[bc]);
    const mid = box.length >> 1;
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes.filter(b => b.length);
}

/**
 * Extract a palette.
 * @returns {{swatches: Array, gradientCSS: string, dominant: object, pixelCount: number}}
 */
export function extractPalette(canvas, count = 8) {
  const pixels = samplePixels(canvas);
  if (!pixels.length) throw new Error('No usable pixels in the captured imagery.');

  const boxes = medianCut(pixels, count);
  const swatches = boxes.map(box => {
    let r = 0, g = 0, b = 0;
    for (const p of box) { r += p[0]; g += p[1]; b += p[2]; }
    const n = box.length;
    const rgb = [r / n, g / n, b / n];
    const hsl = rgbToHsl(...rgb);
    return {
      rgb: rgb.map(Math.round),
      hex: rgbToHex(...rgb),
      hsl,
      share: n / pixels.length,
      text: contrastText(...rgb),
    };
  }).sort((a, b) => b.share - a.share);

  // Gradient reads best as a smooth dark -> light sweep rather than by frequency.
  const ordered = [...swatches].sort((a, b) => a.hsl.l - b.hsl.l);
  const stops = ordered.map((s, i) =>
    `${s.hex} ${((i / Math.max(1, ordered.length - 1)) * 100).toFixed(1)}%`).join(', ');

  return {
    swatches,
    ordered,
    gradientCSS: `linear-gradient(135deg, ${stops})`,
    dominant: swatches[0],
    pixelCount: pixels.length,
  };
}

/* Merge palettes from several sources (satellite + street view) by pooling their pixels. */
export function mergeCanvases(canvases) {
  const total = canvases.reduce((a, c) => a + c.width * c.height, 0);
  const side = Math.max(64, Math.min(900, Math.round(Math.sqrt(total))));
  const out = document.createElement('canvas');
  out.width = out.height = side;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  const cols = Math.ceil(Math.sqrt(canvases.length));
  const cell = side / cols;
  canvases.forEach((c, i) => {
    ctx.drawImage(c, (i % cols) * cell, Math.floor(i / cols) * cell, cell, cell);
  });
  return out;
}

export function paletteToCSS(p, name = 'place') {
  const vars = p.swatches.map((s, i) => `  --${name}-${i + 1}: ${s.hex};`).join('\n');
  return `:root {\n${vars}\n  --${name}-gradient: ${p.gradientCSS};\n}`;
}
