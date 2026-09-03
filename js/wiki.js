/* Photographs and articles tied to real coordinates.
   Commons geosearch is the honest substitute for Instagram/Snapchat: the images
   are genuinely geotagged, openly licensed, and reachable from a static site. */
import { CFG } from './config.js';
import { getJSON, mwURL } from './net.js';

const meta = (p, k) => p?.imageinfo?.[0]?.extmetadata?.[k]?.value?.replace(/<[^>]*>/g, '').trim() || '';

/* Photos physically taken within `radius` metres of the point. */
export async function photosNear(lat, lon, radius = CFG.PHOTO_RADIUS_M, limit = 24) {
  const d = await getJSON(mwURL(CFG.COMMONS, {
    action: 'query',
    generator: 'geosearch',
    ggscoord: `${lat}|${lon}`,
    ggsradius: radius,
    ggslimit: limit,
    ggsnamespace: 6,
    prop: 'imageinfo|coordinates',
    iiprop: 'url|extmetadata',
    iiurlwidth: 480,
  }), { timeout: 18000 });

  const pages = Object.values(d.query?.pages || {});
  return pages
    .filter(p => p.imageinfo?.[0]?.thumburl)
    .map(p => {
      const ii = p.imageinfo[0];
      const c = p.coordinates?.[0];
      return {
        title: p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''),
        thumb: ii.thumburl,
        full: ii.url,
        page: ii.descriptionurl,
        artist: meta(p, 'Artist'),
        licence: meta(p, 'LicenseShortName'),
        date: (meta(p, 'DateTimeOriginal') || '').slice(0, 10),
        lat: c?.lat, lon: c?.lon,
        dist: c ? haversine(lat, lon, c.lat, c.lon) : null,
      };
    })
    .sort((a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9));
}

/* Wikipedia articles about things at this spot — landmarks, districts, events. */
export async function articlesNear(lat, lon, radius = 3000, limit = 12) {
  const d = await getJSON(mwURL(CFG.WIKIPEDIA, {
    action: 'query', list: 'geosearch', gscoord: `${lat}|${lon}`,
    gsradius: radius, gslimit: limit,
  }), { timeout: 14000 });
  return (d.query?.geosearch || []).map(g => ({
    title: g.title, dist: g.dist,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(g.title.replace(/ /g, '_'))}`,
  }));
}

/* Lead image + intro for the place itself. */
export async function summary(title) {
  try {
    const d = await getJSON(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`,
      { timeout: 12000 });
    if (d.type === 'disambiguation') return null;
    return {
      title: d.title,
      extract: d.extract || '',
      thumb: d.thumbnail?.source || '',
      url: d.content_urls?.desktop?.page || '',
    };
  } catch { return null; }
}

export function haversine(la1, lo1, la2, lo2) {
  const R = 6371000, r = Math.PI / 180;
  const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
