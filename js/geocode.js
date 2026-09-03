/* Place <-> coordinate translation via OpenStreetMap Nominatim (keyless, CORS-enabled). */
import { CFG } from './config.js';
import { getJSON } from './net.js';

/* Accepts "48.8584, 2.2945", "48.8584 2.2945", or "48°51'N 2°17'E"-ish decimal pairs. */
export function parseCoords(text) {
  const m = String(text).trim().match(
    /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/
  );
  if (!m) return null;
  const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export async function search(query, limit = 6) {
  const url = `${CFG.NOMINATIM}/search?${new URLSearchParams({
    q: query, format: 'jsonv2', limit, addressdetails: 1, 'accept-language': 'en',
  })}`;
  const data = await getJSON(url, { timeout: 12000 });
  return data.map(d => ({
    lat: parseFloat(d.lat), lon: parseFloat(d.lon),
    label: d.display_name, type: d.type, cls: d.class, address: d.address || {},
  }));
}

export async function reverse(lat, lon) {
  const url = `${CFG.NOMINATIM}/reverse?${new URLSearchParams({
    lat, lon, format: 'jsonv2', 'accept-language': 'en', zoom: 14,
  })}`;
  try {
    const d = await getJSON(url, { timeout: 12000 });
    const a = d.address || {};
    return {
      label: d.display_name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
      city: a.city || a.town || a.village || a.municipality || a.hamlet || a.suburb || '',
      county: a.county || '',
      region: a.state || a.province || a.region || '',
      country: a.country || '',
      countryCode: (a.country_code || '').toUpperCase(),
      address: a,
    };
  } catch {
    return { label: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, city: '', county: '', region: '', country: '', countryCode: '', address: {} };
  }
}

/* Ordered best-guess place names, most specific first — used to look up cuisine and people. */
export function placeChain(rev) {
  return [rev.city, rev.county, rev.region, rev.country].filter(Boolean);
}
