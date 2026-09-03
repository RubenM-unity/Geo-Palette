/* Structured lookups against Wikidata. Everything here degrades gracefully:
   if the query service is busy (it rate-limits hard during outages) we fall back
   to plain MediaWiki category listings. */
import { CFG } from './config.js';
import { sparql, rows, getJSON, mwURL } from './net.js';

const commonsThumb = (fileUrl, px = 240) => {
  // Wikidata P18 hands back http:// Special:FilePath URLs. Force https (mixed
  // content is blocked on Pages) and let FilePath do the scaling for us.
  if (!fileUrl) return '';
  return `${fileUrl.replace(/^http:/, 'https:')}?width=${px}`;
};

export async function resolveEntity(name) {
  if (!name) return null;
  try {
    const d = await getJSON(mwURL(CFG.WIKIDATA_API, {
      action: 'wbsearchentities', search: name, language: 'en', uselang: 'en', limit: 1, type: 'item',
    }), { timeout: 10000 });
    const hit = d.search?.[0];
    return hit ? { id: hit.id, label: hit.label, description: hit.description } : null;
  } catch { return null; }
}

/* ---------------- People born near the point ---------------- */
const PEOPLE_Q = (lat, lon, km) => `
SELECT ?person ?personLabel (SAMPLE(?img) AS ?image) (SAMPLE(?desc) AS ?descr)
       (MAX(?sl) AS ?links) (SAMPLE(?birth) AS ?born) (SAMPLE(?placeLabel) AS ?birthplace) WHERE {
  SERVICE wikibase:around {
    ?place wdt:P625 ?loc .
    bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${km}" .
  }
  ?person wdt:P19 ?place ;
          wdt:P31 wd:Q5 ;
          wikibase:sitelinks ?sl .
  FILTER(?sl > 12)
  OPTIONAL { ?person wdt:P18 ?img }
  OPTIONAL { ?person wdt:P569 ?birth }
  OPTIONAL { ?person schema:description ?desc FILTER(LANG(?desc) = "en") }
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en,mul" .
    ?person rdfs:label ?personLabel . ?place rdfs:label ?placeLabel .
  }
}
GROUP BY ?person ?personLabel
ORDER BY DESC(?links)
LIMIT 14`;

export async function peopleNear(lat, lon, km = CFG.PEOPLE_RADIUS_KM) {
  const bs = await sparql(CFG.WDQS, PEOPLE_Q(lat, lon, km), CFG.SPARQL_TIMEOUT_MS);
  return rows(bs).map(r => ({
    name: r.personLabel,
    desc: r.descr || '',
    img: r.image ? commonsThumb(r.image, 200) : '',
    born: r.born ? new Date(r.born).getUTCFullYear() : null,
    birthplace: r.birthplace || '',
    fame: +r.links || 0,
    url: `https://www.wikidata.org/wiki/${r.person.split('/').pop()}`,
  }));
}

/* ---------------- Traditional dishes ---------------- */
const DISH_Q = qids => `
SELECT ?dish ?dishLabel (SAMPLE(?img) AS ?image) (SAMPLE(?desc) AS ?descr)
       (MAX(?sl) AS ?links) (SAMPLE(?originLabel) AS ?origin) WHERE {
  VALUES ?place { ${qids.map(q => 'wd:' + q).join(' ')} }
  ?dish wdt:P31/wdt:P279* ?class .
  VALUES ?class { wd:Q2095 wd:Q746549 wd:Q19861951 }
  ?dish wdt:P495 ?place ;
        wikibase:sitelinks ?sl .
  FILTER(?sl > 4)
  OPTIONAL { ?dish wdt:P18 ?img }
  OPTIONAL { ?dish schema:description ?desc FILTER(LANG(?desc) = "en") }
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en,mul" .
    ?dish rdfs:label ?dishLabel . ?place rdfs:label ?originLabel .
  }
}
GROUP BY ?dish ?dishLabel
ORDER BY DESC(?links)
LIMIT 18`;

export async function dishesFor(placeNames) {
  // Two origins is the sweet spot: adding a third QID took the same query from
  // ~17s to ~75s on the live endpoint, for almost no extra dishes.
  const entities = (await Promise.all(placeNames.slice(0, 2).map(resolveEntity))).filter(Boolean);
  if (!entities.length) return { dishes: [], origins: [] };
  const bs = await sparql(CFG.WDQS, DISH_Q(entities.map(e => e.id)), CFG.SPARQL_TIMEOUT_MS);
  return {
    origins: entities.map(e => e.label),
    dishes: rows(bs).map(r => ({
      name: r.dishLabel,
      desc: r.descr || '',
      img: r.image ? commonsThumb(r.image, 300) : '',
      origin: r.origin || '',
      fame: +r.links || 0,
      url: `https://www.wikidata.org/wiki/${r.dish.split('/').pop()}`,
    })),
  };
}

/* ---------------- Fallbacks via MediaWiki categories ---------------- */
async function categoryMembers(category, limit = 14) {
  const d = await getJSON(mwURL(CFG.WIKIPEDIA, {
    action: 'query', list: 'categorymembers', cmtitle: `Category:${category}`,
    cmlimit: limit, cmnamespace: 0, cmtype: 'page',
  }), { timeout: 12000 });
  return (d.query?.categorymembers || []).map(m => m.title);
}

/* Attach short descriptions + thumbnails to plain article titles. */
export async function describeTitles(titles) {
  if (!titles.length) return [];
  const d = await getJSON(mwURL(CFG.WIKIPEDIA, {
    action: 'query', prop: 'pageimages|description', piprop: 'thumbnail',
    pithumbsize: 240, pilimit: 50, titles: titles.slice(0, 40).join('|'),
  }), { timeout: 14000 });
  const pages = Object.values(d.query?.pages || {});
  return pages.filter(p => !p.missing).map(p => ({
    name: p.title,
    desc: p.description || '',
    img: p.thumbnail?.source || '',
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
  }));
}

export async function peopleFallback(place) {
  for (const cat of [`People from ${place}`, `People from ${place} (city)`]) {
    try {
      const t = await categoryMembers(cat);
      if (t.length) return await describeTitles(t);
    } catch {}
  }
  return [];
}

export async function dishesFallback(adjectives) {
  for (const adj of adjectives) {
    for (const cat of [`${adj} cuisine`, `${adj} dishes`]) {
      try {
        const t = await categoryMembers(cat);
        if (t.length) return await describeTitles(t);
      } catch {}
    }
  }
  return [];
}
