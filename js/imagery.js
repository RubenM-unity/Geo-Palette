/* Builds a canvas holding roughly CAPTURE_METRES of ground centred on a point.
   Keyless path stitches Esri World Imagery tiles; the optional Google path uses
   the Static Maps API. Both send CORS headers, so canvas pixels stay readable. */
import { CFG } from './config.js';
import { loadImage, getJSON } from './net.js';

const EARTH_C = 156543.03392; // metres per pixel at zoom 0 on the equator

export const metresPerPixel = (lat, z) => EARTH_C * Math.cos(lat * Math.PI / 180) / 2 ** z;
const lonToTileX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const latToTileY = (lat, z) => {
  const r = lat * Math.PI / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

/* Pick the zoom whose pixel scale renders `metres` at close to `targetPx` wide. */
export function zoomFor(lat, metres, targetPx = 1024) {
  const z = Math.log2((targetPx * EARTH_C * Math.cos(lat * Math.PI / 180)) / metres);
  return Math.max(1, Math.min(19, Math.round(z)));
}

/* Stitch Esri tiles into a canvas cropped to the exact ground square. */
export async function captureTiles(lat, lon, metres = CFG.CAPTURE_METRES, onProgress) {
  const z = zoomFor(lat, metres);
  const mpp = metresPerPixel(lat, z);
  const sizePx = Math.round(metres / mpp);

  const cx = lonToTileX(lon, z) * CFG.TILE_PX;
  const cy = latToTileY(lat, z) * CFG.TILE_PX;
  const left = cx - sizePx / 2, top = cy - sizePx / 2;

  const x0 = Math.floor(left / CFG.TILE_PX), x1 = Math.floor((left + sizePx - 1) / CFG.TILE_PX);
  const y0 = Math.floor(top / CFG.TILE_PX),  y1 = Math.floor((top + sizePx - 1) / CFG.TILE_PX);
  const span = 2 ** z;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = sizePx;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const jobs = [];
  for (let ty = y0; ty <= y1; ty++) {
    if (ty < 0 || ty >= span) continue;
    for (let tx = x0; tx <= x1; tx++) {
      const wrapped = ((tx % span) + span) % span; // wrap across the antimeridian
      const url = CFG.ESRI_TILES.replace('{z}', z).replace('{x}', wrapped).replace('{y}', ty);
      jobs.push({ url, dx: tx * CFG.TILE_PX - left, dy: ty * CFG.TILE_PX - top });
    }
  }

  let done = 0, ok = 0;
  await Promise.all(jobs.map(async job => {
    try {
      const img = await loadImage(job.url);
      ctx.drawImage(img, job.dx, job.dy, CFG.TILE_PX, CFG.TILE_PX);
      ok++;
    } catch { /* a missing tile just leaves a gap; the palette still works */ }
    onProgress?.(++done / jobs.length);
  }));

  if (!ok) throw new Error('No imagery tiles could be loaded.');
  return { canvas, zoom: z, metresPerPixel: mpp, sizePx, tilesLoaded: ok, tilesTotal: jobs.length };
}

/* Optional higher-fidelity path when the user supplies a Google key. */
export async function captureGoogle(lat, lon, key, metres = CFG.CAPTURE_METRES) {
  const z = zoomFor(lat, metres, 640);
  const url = `${CFG.GOOGLE_STATIC}?${new URLSearchParams({
    center: `${lat},${lon}`, zoom: z, size: '640x640', scale: 2,
    maptype: 'satellite', format: 'png', key,
  })}`;
  const img = await loadImage(url);
  const canvas = document.createElement('canvas');
  canvas.width = img.width; canvas.height = img.height;
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
  return { canvas, zoom: z, metresPerPixel: metresPerPixel(lat, z) / 2, sizePx: img.width, google: true };
}

/* Street View: check availability first (metadata calls are free), then pull four headings. */
export async function streetViewSet(lat, lon, key, radius = 120) {
  const meta = await getJSON(`${CFG.GOOGLE_SV_META}?${new URLSearchParams({
    location: `${lat},${lon}`, radius, key,
  })}`, { timeout: 10000 });
  if (meta.status !== 'OK') return { available: false, status: meta.status, images: [] };

  const headings = [0, 90, 180, 270];
  const images = await Promise.all(headings.map(async h => {
    const url = `${CFG.GOOGLE_SV}?${new URLSearchParams({
      location: `${meta.location.lat},${meta.location.lng}`,
      size: '480x320', fov: 100, heading: h, pitch: 0, key,
    })}`;
    try { return { heading: h, img: await loadImage(url), url }; }
    catch { return null; }
  }));
  return { available: true, status: 'OK', location: meta.location, date: meta.date,
           images: images.filter(Boolean) };
}
