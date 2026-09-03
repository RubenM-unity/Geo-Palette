/* Geo Palette — orchestration, map wiring and rendering. */
import { CFG } from './config.js';
import * as store from './store.js';
import * as geo from './geocode.js';
import * as img from './imagery.js';
import * as pal from './palette.js';
import * as wd from './wikidata.js';
import * as wiki from './wiki.js';

const $ = s => document.querySelector(s);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
/* Everything from the network is untrusted text — never inject it as HTML. */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { lat: null, lon: null, palette: null, place: null, runId: 0, canvas: null };

/* ------------------------------------------------ map ------------------------------------------------ */
const BASES = {
  sat: () => L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Imagery &copy; Esri' }),
  dark: () => L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    { maxZoom: 20, attribution: '&copy; OpenStreetMap, &copy; CARTO' }),
  street: () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }),
};

const map = L.map('map', { zoomControl: true, worldCopyJump: true, attributionControl: true })
             .setView([20, 10], 3);
let baseLayer = BASES.sat().addTo(map);
let marker = null, ring = null;

map.on('click', e => pick(e.latlng.lat, e.latlng.lng, { fly: false }));

function setBase(kind) {
  map.removeLayer(baseLayer);
  baseLayer = BASES[kind]().addTo(map);
  document.querySelectorAll('.segmented button').forEach(b => b.classList.toggle('on', b.dataset.base === kind));
}

/* Draw the pin plus the square kilometre actually being sampled. */
function showMarker(lat, lon) {
  if (marker) map.removeLayer(marker);
  if (ring) map.removeLayer(ring);
  marker = L.marker([lat, lon], {
    icon: L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
  }).addTo(map);

  const half = CFG.CAPTURE_METRES / 2;
  const dLat = half / 111320;
  const dLon = half / (111320 * Math.cos(lat * Math.PI / 180) || 1);
  ring = L.rectangle([[lat - dLat, lon - dLon], [lat + dLat, lon + dLon]],
    { className: 'ring', weight: 1.5, fillOpacity: .06, color: '#e8c06a' }).addTo(map);
}

/* ------------------------------------------- pipeline ------------------------------------------- */
async function pick(lat, lon, { fly = true, label = null } = {}) {
  const run = ++state.runId;                 // stale-response guard
  state.lat = lat; state.lon = lon;

  $('#maphint').classList.add('hide');
  $('#welcome').hidden = true;
  $('#report').hidden = false;
  $('#coord-read').textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  showMarker(lat, lon);
  if (fly) map.flyTo([lat, lon], Math.max(map.getZoom(), 14), { duration: .9 });

  $('#place-title').textContent = label || 'Locating…';
  $('#place-sub').textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  $('#place-extract').textContent = '';
  skeletons();

  // 1. Name the place first — dishes and people both key off it.
  const rev = await geo.reverse(lat, lon);
  if (run !== state.runId) return;
  state.place = rev;
  const title = label || rev.city || rev.county || rev.region || rev.country || 'Unnamed location';
  $('#place-title').textContent = title;
  $('#place-sub').textContent = [rev.city, rev.region, rev.country].filter(Boolean).join(' · ')
                              || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  refreshPin();

  // 2. Fire every section independently so one slow query never blocks the rest.
  runPalette(run, lat, lon);
  runPhotos(run, lat, lon);
  runDishes(run, rev);
  runPeople(run, lat, lon, rev);
  runNearby(run, lat, lon);
  runSummary(run, title, rev);

  store.pushHistory({ lat, lon, title, sub: rev.country || '' });
}

function skeletons() {
  $('#swatches').innerHTML = Array.from({ length: 8 }, () => '<div class="skel skel-sw"></div>').join('');
  $('#palette-meta').innerHTML = '<span class="spin"></span>sampling imagery…';
  $('#imagery').innerHTML = '<div class="skel" style="aspect-ratio:1"></div>';
  $('#photos').innerHTML = Array.from({ length: 6 }, () => '<div class="skel" style="aspect-ratio:4/3"></div>').join('');
  $('#dishes').innerHTML = Array.from({ length: 4 }, () => '<div class="skel skel-card"></div>').join('');
  $('#people').innerHTML = Array.from({ length: 4 }, () => '<div class="skel skel-card"></div>').join('');
  $('#nearby').innerHTML = '';
  ['imagery', 'photos', 'dishes', 'people'].forEach(k => $(`#${k}-note`) && ($(`#${k}-note`).textContent = ''));
}

/* ---- palette ---- */
async function runPalette(run, lat, lon) {
  const useGoogle = store.getSettings().useGoogle && store.getGoogleKey();
  const key = store.getGoogleKey();
  const shots = [];
  let cap;

  try {
    if (useGoogle) {
      try { cap = await img.captureGoogle(lat, lon, key); }
      catch { cap = await img.captureTiles(lat, lon, CFG.CAPTURE_METRES, p =>
        run === state.runId && ($('#palette-meta').innerHTML = `<span class="spin"></span>stitching tiles ${Math.round(p * 100)}%`)); }
    } else {
      cap = await img.captureTiles(lat, lon, CFG.CAPTURE_METRES, p =>
        run === state.runId && ($('#palette-meta').innerHTML = `<span class="spin"></span>stitching tiles ${Math.round(p * 100)}%`));
    }
  } catch (e) {
    if (run !== state.runId) return;
    $('#swatches').innerHTML = '';
    $('#palette-meta').textContent = 'Could not load imagery for this point.';
    $('#imagery').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    return;
  }
  if (run !== state.runId) return;
  shots.push({ canvas: cap.canvas, cap: `Satellite · ${CFG.CAPTURE_METRES} m across · z${cap.zoom}` });

  // Street View adds the colours you actually see at ground level.
  let sv = null;
  if (useGoogle) {
    try {
      sv = await img.streetViewSet(lat, lon, key);
      if (run !== state.runId) return;
      for (const s of sv.images || []) {
        const c = document.createElement('canvas');
        c.width = s.img.width; c.height = s.img.height;
        c.getContext('2d', { willReadFrequently: true }).drawImage(s.img, 0, 0);
        shots.push({ canvas: c, cap: `Street View · ${s.heading}°` });
      }
    } catch { /* street view is a bonus, not a requirement */ }
  }

  let palette;
  try {
    const merged = shots.length > 1 ? pal.mergeCanvases(shots.map(s => s.canvas)) : shots[0].canvas;
    palette = pal.extractPalette(merged, CFG.SWATCHES);
  } catch (e) {
    if (run !== state.runId) return;
    const tainted = e.name === 'SecurityError';
    $('#swatches').innerHTML = '';
    $('#palette-meta').textContent = tainted
      ? 'The imagery blocked pixel access (CORS), so no palette could be read.'
      : `Palette failed: ${e.message}`;
    return;
  }
  if (run !== state.runId) return;

  state.palette = palette; state.canvas = shots[0].canvas;
  renderPalette(palette);
  $('#palette-meta').textContent =
    `${palette.pixelCount.toLocaleString()} pixels sampled · ${cap.metresPerPixel.toFixed(2)} m/px`
    + (shots.length > 1 ? ` · ${shots.length} sources` : '');

  // imagery strip
  const strip = $('#imagery');
  strip.innerHTML = '';
  shots.forEach(s => {
    const f = el('figure');
    s.canvas.style.width = '100%'; s.canvas.style.height = 'auto';
    f.append(s.canvas, el('figcaption', null, esc(s.cap)));
    strip.append(f);
  });
  $('#imagery-note').textContent = cap.google ? 'Google Static Maps'
    : `Esri World Imagery · ${cap.tilesLoaded}/${cap.tilesTotal} tiles`;
  if (useGoogle && sv && !sv.available) $('#imagery-note').textContent += ' · no Street View here';
  refreshPin();
}

function renderPalette(p) {
  const wrap = $('#swatches');
  wrap.innerHTML = '';
  p.swatches.forEach(s => {
    const d = el('div', 'sw');
    d.style.background = s.hex;
    d.style.color = s.text;
    d.title = `${s.hex} — click to copy`;
    d.innerHTML = `<span class="hex">${s.hex}</span><span class="pct">${(s.share * 100).toFixed(1)}%</span>`;
    d.onclick = () => copy(s.hex, `${s.hex} copied`);
    wrap.append(d);
  });
  $('#hero-grad').style.background = p.gradientCSS;
  $('#aurora').style.background =
    `radial-gradient(38% 45% at 20% 25%, ${p.swatches[0].hex}55, transparent 70%),` +
    `radial-gradient(35% 40% at 80% 70%, ${(p.swatches[2] || p.swatches[0]).hex}33, transparent 70%)`;
}

/* ---- photographs ---- */
async function runPhotos(run, lat, lon) {
  try {
    const photos = await wiki.photosNear(lat, lon, CFG.PHOTO_RADIUS_M);
    if (run !== state.runId) return;
    const g = $('#photos'); g.innerHTML = '';
    if (!photos.length) {
      g.innerHTML = '<div class="empty">No geotagged photographs within 1.2 km.</div>';
      $('#photos-note').textContent = ''; return;
    }
    photos.forEach(ph => {
      const a = el('a');
      a.href = ph.page || ph.full; a.target = '_blank'; a.rel = 'noopener';
      a.innerHTML =
        `<img loading="lazy" src="${esc(ph.thumb)}" alt="${esc(ph.title)}">` +
        (ph.dist != null ? `<span class="dist">${Math.round(ph.dist)} m</span>` : '') +
        `<span class="cap">${esc(ph.title)}${ph.licence ? ' · ' + esc(ph.licence) : ''}</span>`;
      g.append(a);
    });
    $('#photos-note').textContent = `${photos.length} from Wikimedia Commons, nearest first`;
  } catch (e) {
    if (run !== state.runId) return;
    $('#photos').innerHTML = `<div class="empty">Commons lookup failed: ${esc(e.message)}</div>`;
  }
}

/* ---- dishes ---- */
async function runDishes(run, rev) {
  const names = geo.placeChain(rev);
  if (!names.length) {
    $('#dishes').innerHTML = '<div class="empty">No administrative area resolved for this point.</div>';
    return;
  }
  // Wikidata is the better source but its response time swings from 6s to 75s,
  // so race it against the fast Wikipedia categories and upgrade if it wins.
  $('#dishes-note').innerHTML = '<span class="spin"></span>searching';
  let shown = null;

  const fast = wd.dishesFallback([rev.country, rev.region].filter(Boolean).flatMap(demonym))
    .then(alt => {
      if (run !== state.runId || shown === 'wikidata' || !alt.length) return;
      shown = 'wikipedia';
      cards($('#dishes'), alt);
      $('#dishes-note').textContent = 'via Wikipedia cuisine categories';
    }).catch(() => {});

  const rich = wd.dishesFor([...names].reverse())        // country first — richest source
    .then(({ dishes, origins }) => {
      if (run !== state.runId || !dishes.length) return;
      shown = 'wikidata';
      cards($('#dishes'), dishes.map(d => ({ ...d, meta: d.origin })));
      $('#dishes-note').textContent = `traditional to ${origins.join(', ')} · via Wikidata`;
    }).catch(() => {});

  await Promise.allSettled([fast, rich]);
  if (run === state.runId && !shown) {
    $('#dishes').innerHTML = '<div class="empty">No documented local dishes found for this area.</div>';
    $('#dishes-note').textContent = '';
  }
}

/* Rough English demonyms so "Japan" can reach "Japanese cuisine". */
function demonym(country) {
  const map = {
    Japan: 'Japanese', France: 'French', Italy: 'Italian', Spain: 'Spanish', China: 'Chinese',
    Germany: 'German', India: 'Indian', Greece: 'Greek', Turkey: 'Turkish', Mexico: 'Mexican',
    Portugal: 'Portuguese', Poland: 'Polish', Thailand: 'Thai', Vietnam: 'Vietnamese',
    Brazil: 'Brazilian', Peru: 'Peruvian', Morocco: 'Moroccan', Egypt: 'Egyptian',
    Sweden: 'Swedish', Norway: 'Norwegian', Denmark: 'Danish', Netherlands: 'Dutch',
    Russia: 'Russian', Korea: 'Korean', 'South Korea': 'Korean', Ireland: 'Irish',
    Scotland: 'Scottish', Wales: 'Welsh', England: 'English',
    'United Kingdom': 'British', 'United States': 'American',
  };
  const out = [];
  if (map[country]) out.push(map[country]);
  out.push(country);
  return out;
}

/* ---- people ---- */
async function runPeople(run, lat, lon, rev) {
  // Same race as dishes: category listing lands fast, the geo query lands better.
  $('#people-note').innerHTML = '<span class="spin"></span>searching';
  const place = rev.city || rev.county || rev.region;
  let shown = null;

  const fast = (place ? wd.peopleFallback(place) : Promise.resolve([]))
    .then(alt => {
      if (run !== state.runId || shown === 'wikidata' || !alt.length) return;
      shown = 'wikipedia';
      cards($('#people'), alt);
      $('#people-note').textContent = `from Wikipedia’s “People from ${place}” category`;
    }).catch(() => {});

  const rich = wd.peopleNear(lat, lon, CFG.PEOPLE_RADIUS_KM)
    .then(people => {
      if (run !== state.runId || !people.length) return;
      shown = 'wikidata';
      cards($('#people'), people.map(p => ({
        ...p, meta: [p.born, p.birthplace].filter(Boolean).join(' · '),
      })));
      $('#people-note').textContent =
        `born within ${CFG.PEOPLE_RADIUS_KM} km · ranked by Wikipedia language count`;
    }).catch(() => {});

  await Promise.allSettled([fast, rich]);
  if (run === state.runId && !shown) {
    $('#people').innerHTML = '<div class="empty">No notable birthplaces recorded near this point.</div>';
    $('#people-note').textContent = '';
  }
}

function cards(container, items) {
  container.innerHTML = '';
  if (!items.length) { container.innerHTML = '<div class="empty">Nothing found.</div>'; return; }
  items.forEach(it => {
    const a = el('a', 'card');
    a.href = it.url || '#'; a.target = '_blank'; a.rel = 'noopener';
    a.innerHTML =
      (it.img ? `<div class="ph"><img loading="lazy" src="${esc(it.img)}" alt="" onerror="this.parentElement.remove()"></div>` : '') +
      `<div class="bd"><div class="nm">${esc(it.name)}</div>` +
      (it.desc ? `<div class="ds">${esc(it.desc)}</div>` : '') +
      (it.meta ? `<div class="meta">${esc(it.meta)}</div>` : '') +
      `</div>`;
    container.append(a);
  });
}

/* ---- nearby articles + place summary ---- */
async function runNearby(run, lat, lon) {
  try {
    const arts = await wiki.articlesNear(lat, lon);
    if (run !== state.runId) return;
    const box = $('#nearby'); box.innerHTML = '';
    if (!arts.length) { box.innerHTML = '<div class="empty">Nothing catalogued nearby.</div>'; return; }
    arts.forEach(a => {
      const n = el('a', 'pill');
      n.href = a.url; n.target = '_blank'; n.rel = 'noopener';
      n.innerHTML = `${esc(a.title)}<span>${Math.round(a.dist)}m</span>`;
      box.append(n);
    });
  } catch { /* nearby is decorative */ }
}

async function runSummary(run, title, rev) {
  const s = await wiki.summary(rev.city || title);
  if (run !== state.runId || !s) return;
  $('#place-extract').textContent = s.extract;
}

/* ------------------------------------------- search ------------------------------------------- */
let sugTimer = null, sugItems = [], sugIndex = -1;

$('#search').addEventListener('input', e => {
  const q = e.target.value.trim();
  clearTimeout(sugTimer);
  if (q.length < 2) return hideSuggest();
  sugTimer = setTimeout(() => suggest(q), 280);   // stay polite to Nominatim
});

$('#search').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const coords = geo.parseCoords(e.target.value);
    if (coords) { hideSuggest(); return pick(coords.lat, coords.lon); }
    if (sugIndex >= 0 && sugItems[sugIndex]) return chooseSuggest(sugIndex);
    if (sugItems.length) return chooseSuggest(0);
    suggest(e.target.value.trim());
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!sugItems.length) return;
    e.preventDefault();
    sugIndex = (sugIndex + (e.key === 'ArrowDown' ? 1 : -1) + sugItems.length) % sugItems.length;
    [...$('#suggest').children].forEach((c, i) => c.classList.toggle('on', i === sugIndex));
  } else if (e.key === 'Escape') hideSuggest();
});

async function suggest(q) {
  const coords = geo.parseCoords(q);
  const box = $('#suggest');
  if (coords) {
    sugItems = [{ lat: coords.lat, lon: coords.lon, label: `Go to ${coords.lat}, ${coords.lon}`, type: 'coordinates' }];
    return paintSuggest();
  }
  try {
    sugItems = await geo.search(q);
    paintSuggest();
  } catch { hideSuggest(); }
}

function paintSuggest() {
  const box = $('#suggest');
  sugIndex = -1;
  if (!sugItems.length) return hideSuggest();
  box.innerHTML = '';
  sugItems.forEach((s, i) => {
    const b = el('button');
    const main = s.label.split(',')[0];
    b.innerHTML = `<span class="t">${esc(main)}</span><span class="d">${esc(s.label)}</span>`;
    b.onclick = () => chooseSuggest(i);
    box.append(b);
  });
  box.hidden = false;
}
const hideSuggest = () => { $('#suggest').hidden = true; sugItems = []; sugIndex = -1; };

function chooseSuggest(i) {
  const s = sugItems[i];
  if (!s) return;
  $('#search').value = s.label.split(',')[0];
  hideSuggest();
  $('#search').blur();
  pick(s.lat, s.lon, { label: s.label.split(',')[0] });
}

document.addEventListener('click', e => {
  if (!e.target.closest('.searchwrap')) hideSuggest();
});

/* ------------------------------------------- controls ------------------------------------------- */
document.querySelectorAll('.segmented button').forEach(b => b.onclick = () => setBase(b.dataset.base));

$('#btn-locate').onclick = () => {
  if (!navigator.geolocation) return toast('Geolocation unavailable');
  toast('Locating…');
  navigator.geolocation.getCurrentPosition(
    p => pick(p.coords.latitude, p.coords.longitude),
    () => toast('Location permission denied'),
    { enableHighAccuracy: true, timeout: 10000 });
};

const SURPRISE = [
  [35.0116, 135.7681, 'Kyoto'], [40.8518, 14.2681, 'Naples'], [-13.1631, -72.5450, 'Machu Picchu'],
  [31.6295, -7.9811, 'Marrakesh'], [64.1466, -21.9426, 'Reykjavík'], [-33.9249, 18.4241, 'Cape Town'],
  [27.1751, 78.0421, 'Agra'], [59.9139, 10.7522, 'Oslo'], [13.7563, 100.5018, 'Bangkok'],
  [41.3851, 2.1734, 'Barcelona'], [-22.9519, -43.2105, 'Rio de Janeiro'], [37.9838, 23.7275, 'Athens'],
  [55.9533, -3.1883, 'Edinburgh'], [30.0444, 31.2357, 'Cairo'], [-36.8485, 174.7633, 'Auckland'],
  [46.4983, 11.3548, 'Bolzano'], [68.3, 14.4, 'Lofoten'], [36.7213, -4.4213, 'Málaga'],
];
$('#btn-random').onclick = () => {
  const [lat, lon, name] = SURPRISE[Math.floor(Math.random() * SURPRISE.length)];
  $('#search').value = name;
  pick(lat, lon, { label: name });
};

$('#btn-copy-coord').onclick = () => {
  if (state.lat == null) return toast('Pick a place first');
  copy(`${state.lat.toFixed(6)}, ${state.lon.toFixed(6)}`, 'Coordinates copied');
};

/* palette export */
document.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
  const p = state.palette;
  if (!p) return toast('No palette yet');
  const name = ($('#place-title').textContent || 'place').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (b.dataset.copy === 'hex') copy(p.swatches.map(s => s.hex).join(', '), 'Hex codes copied');
  else if (b.dataset.copy === 'css') copy(pal.paletteToCSS(p, name || 'place'), 'CSS variables copied');
  else downloadPNG(p, name || 'palette');
});

function downloadPNG(p, name) {
  const W = 1200, H = 630, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, W, H);
  p.ordered.forEach((s, i) => g.addColorStop(i / Math.max(1, p.ordered.length - 1), s.hex));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  const bw = W / p.swatches.length;
  p.swatches.forEach((s, i) => {
    ctx.fillStyle = s.hex;
    ctx.fillRect(i * bw, H - 150, bw, 150);
    ctx.fillStyle = s.text;
    ctx.font = '600 19px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(s.hex, i * bw + 14, H - 40);
  });
  ctx.fillStyle = '#fff';
  ctx.font = '700 46px ui-sans-serif, system-ui, sans-serif';
  ctx.shadowColor = '#0009'; ctx.shadowBlur = 18;
  ctx.fillText($('#place-title').textContent, 46, 82);
  ctx.font = '400 22px ui-monospace, Menlo, monospace';
  ctx.fillText(`${state.lat.toFixed(4)}, ${state.lon.toFixed(4)}`, 46, 118);

  const a = document.createElement('a');
  a.download = `${name}-palette.png`;
  a.href = c.toDataURL('image/png');
  a.click();
  toast('Palette downloaded');
}

/* pin / favourite */
const currentId = () => state.lat == null ? null : `${state.lat.toFixed(4)},${state.lon.toFixed(4)}`;
function refreshPin() {
  const id = currentId();
  $('#btn-pin').classList.toggle('on', !!id && store.isPinned(id));
  $('#btn-pin').textContent = (id && store.isPinned(id)) ? '★' : '☆';
}
$('#btn-pin').onclick = () => {
  const id = currentId();
  if (!id) return;
  store.togglePin({
    id, lat: state.lat, lon: state.lon,
    title: $('#place-title').textContent,
    hex: state.palette?.dominant.hex || '#334',
    grad: state.palette?.gradientCSS || '',
  });
  refreshPin();
  toast(store.isPinned(id) ? 'Pinned' : 'Unpinned');
};

/* ------------------------------------------- drawers ------------------------------------------- */
const openDrawer = id => { $('#' + id).hidden = false; $('#scrim').hidden = false; };
const closeDrawers = () => {
  document.querySelectorAll('.drawer').forEach(d => d.hidden = true);
  $('#scrim').hidden = true;
};
$('#scrim').onclick = closeDrawers;
document.querySelectorAll('[data-close]').forEach(b => b.onclick = closeDrawers);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeDrawers();
  if (e.key === '/' && document.activeElement !== $('#search')) { e.preventDefault(); $('#search').focus(); }
});

$('#btn-history').onclick = () => { paintHistory('recent'); openDrawer('drawer-history'); };
document.querySelectorAll('.dtabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.dtabs button').forEach(x => x.classList.toggle('on', x === b));
  paintHistory(b.dataset.tab);
});

function paintHistory(tab) {
  const list = $('#history-list');
  const items = tab === 'pinned' ? store.getPinned() : store.getHistory();
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = `<div class="empty">${tab === 'pinned' ? 'No pinned palettes yet.' : 'No searches yet.'}</div>`;
    return;
  }
  items.forEach(it => {
    const row = el('div', 'hitem');
    const dot = el('div', 'dot');
    dot.style.background = it.grad || it.hex || '#222b36';
    const txt = el('div', 'txt',
      `<b>${esc(it.title || 'Unnamed')}</b><small>${it.lat.toFixed(4)}, ${it.lon.toFixed(4)}</small>`);
    row.append(dot, txt);
    row.onclick = () => { closeDrawers(); pick(it.lat, it.lon, { label: it.title }); };
    if (tab === 'recent') {
      const x = el('button', 'x', '✕');
      x.onclick = e => { e.stopPropagation(); store.removeHistory(it.ts); paintHistory('recent'); };
      row.append(x);
    }
    list.append(row);
  });
}

$('#btn-clear').onclick = () => {
  if (!confirm('Clear your entire search history? Pinned palettes are kept.')) return;
  store.clearHistory(); paintHistory('recent'); toast('History cleared');
};
$('#btn-export').onclick = () => {
  const blob = new Blob([store.exportAll()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'geo-palette-data.json';
  a.click();
  URL.revokeObjectURL(a.href);
};

/* settings */
$('#btn-settings').onclick = () => {
  const s = store.getSettings();
  $('#opt-google').checked = s.useGoogle;
  $('#opt-hires').checked = s.highRes;
  $('#gkey').value = store.getGoogleKey();
  openDrawer('drawer-settings');
};
$('#opt-google').onchange = e => store.setSettings({ useGoogle: e.target.checked });
$('#opt-hires').onchange = e => store.setSettings({ highRes: e.target.checked });
$('#gkey').onchange = e => { store.setGoogleKey(e.target.value); toast('API key saved locally'); };

/* ------------------------------------------- misc ------------------------------------------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.hidden = true, 2200);
}
async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch {
    const ta = el('textarea'); ta.value = text; document.body.append(ta);
    ta.select(); document.execCommand('copy'); ta.remove(); toast(msg);
  }
}

/* quick-start chips on the welcome screen */
(function chips() {
  const box = $('#quickchips');
  const recent = store.getHistory().slice(0, 3);
  const picks = recent.length
    ? recent.map(r => [r.lat, r.lon, r.title])
    : [SURPRISE[0], SURPRISE[1], SURPRISE[3], SURPRISE[4]];
  picks.forEach(([lat, lon, name]) => {
    const c = el('button', 'chip', esc(name));
    c.onclick = () => { $('#search').value = name; pick(lat, lon, { label: name }); };
    box.append(c);
  });
  const any = el('button', 'chip', '🎲 surprise me');
  any.onclick = () => $('#btn-random').click();
  box.append(any);
})();

/* deep link: index.html#35.0116,135.7681 */
(function deepLink() {
  const c = geo.parseCoords(decodeURIComponent(location.hash.replace(/^#/, '')));
  if (c) pick(c.lat, c.lon);
})();
