/* Fetch helpers: timeouts, JSONP-free CORS calls, and a tiny cache so panning
   around the same town doesn't re-hit the APIs. */
const memo = new Map();

export async function getJSON(url, { timeout = 15000, cache = true, headers = {} } = {}) {
  if (cache && memo.has(url)) return memo.get(url);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (cache) memo.set(url, data);
    return data;
  } finally { clearTimeout(t); }
}

/* MediaWiki needs origin=* to return CORS headers for anonymous requests. */
export function mwURL(base, params) {
  return `${base}?${new URLSearchParams({ ...params, format: 'json', origin: '*' })}`;
}

export async function sparql(endpoint, query, timeout = 25000) {
  const url = `${endpoint}?format=json&query=${encodeURIComponent(query)}`;
  const data = await getJSON(url, { timeout, headers: { Accept: 'application/sparql-results+json' } });
  return data.results.bindings;
}

/* Flatten SPARQL bindings to plain objects. */
export const rows = bs => bs.map(b => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));

export function loadImage(src, { crossOrigin = 'anonymous', timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    const timer = setTimeout(() => { img.src = ''; reject(new Error('image timeout')); }, timeout);
    img.onload  = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('image failed')); };
    img.src = src;
  });
}
