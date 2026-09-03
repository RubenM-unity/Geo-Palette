# Geo · Palette

**Pick any point on Earth and see what colour it is.**

Geo·Palette samples roughly a square kilometre of satellite imagery around a point,
distils it into a colour palette with median-cut quantisation, and then pulls together
the traditional dishes, the notable people and the geotagged photographs that belong
to that exact spot.

Everything is queried live from open data. Nothing is generated, guessed or invented,
and there is no AI anywhere in the pipeline — just HTTP requests and a colour
quantiser.

Static site, no build step, no backend. Drop it on GitHub Pages and it works.

---

## Features

| | |
|---|---|
| **Effortless picking** | Click the map, search a town or landmark, or paste `35.0116, 135.7681`. Also supports geolocation and a “surprise me” button. |
| **Real colour extraction** | Stitches map tiles into a canvas covering ~1 km of ground, then runs median-cut quantisation for eight dominant colours plus a gradient. |
| **Traditional dishes** | Dishes whose *country/region of origin* matches the area, ranked by how many Wikipedias cover them. |
| **Notable people** | People **born within 25 km**, ranked by article count across languages. |
| **Geotagged photographs** | Real photos taken at those coordinates, nearest first, with distance in metres. |
| **Local history** | Search history, pinned palettes and settings live in `localStorage`. No account, no server. |
| **Export** | Copy hex codes, copy CSS custom properties, or download a 1200×630 palette card. |

### Keyboard

- `/` — focus search
- `↑` `↓` — move through suggestions
- `Enter` — accept
- `Esc` — close

---

## Running it

It is plain static files, so any static server works:

```bash
python -m http.server 5605
```

Then open <http://localhost:5605>.

> Opening `index.html` directly via `file://` will **not** work — the code uses ES
> modules, which browsers block on the `file:` protocol. Serve it over HTTP.

### Deploying to GitHub Pages

```bash
git remote add origin git@github.com:<you>/geo-palette.git
git push -u origin main
```

Then in **Settings → Pages**, set the source to `main` / root. No build step is needed.

---

## Where the data comes from

| Source | Used for | Key needed |
|---|---|---|
| [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) | Satellite tiles for the palette | No |
| [OpenStreetMap Nominatim](https://nominatim.org/) | Place search and reverse geocoding | No |
| [Wikimedia Commons](https://commons.wikimedia.org/) | Geotagged photographs | No |
| [Wikidata Query Service](https://query.wikidata.org/) | Dishes and people | No |
| [Wikipedia](https://en.wikipedia.org/) | Summaries, nearby articles, fallbacks | No |
| Google Maps Static / Street View | *Optional* sharper imagery | Yes |

All of these send permissive CORS headers, which is what makes a backend-free
site possible — the browser can read the pixels and the JSON directly.

---

## The optional Google key

The site works fully without it. If you add one you get higher-resolution satellite
imagery and Street View colours mixed into the palette.

**Be aware of what this means.** This is a static site, so a key you paste in is
visible to anyone who uses your deployment. It is stored only in your own browser's
`localStorage` and sent straight to Google, never to any server of mine — but if you
publish the site and use it yourself, restrict the key:

1. Google Cloud Console → **Credentials** → your key
2. **Application restrictions** → *HTTP referrers*, add `https://<you>.github.io/*`
3. **API restrictions** → allow only *Maps Static API* and *Street View Static API*
4. Set a billing budget alert

Without a referrer restriction, someone can lift the key and bill you for it.

---

## Things this deliberately does not do

**Instagram and Snapchat are not used.** The original idea was to pull photos from
them. That is not possible from a static site and I would rather say so than fake it:

- Both require authenticated sessions; there is no public read API for location photos.
- Neither sends CORS headers, so browser JavaScript cannot read their responses at
  all — this is a hard technical wall, not a matter of effort.
- Automated scraping is against both of their terms of service.

Wikimedia Commons geosearch is used instead. The photographs it returns carry real
GPS coordinates, so they were genuinely taken at the spot, and they are openly
licensed and safe to display.

**There is no AI in the pipeline.** Dishes, people and photos are all deterministic
queries against structured open data. Run the same coordinates twice and you get the
same answer.

---

## How the colour extraction works

1. Compute the zoom level at which ~1 km of ground fills about 1024 px. Because
   Web Mercator's scale depends on latitude, this is recomputed per location —
   at the equator it lands near z17, and further north the same zoom covers less ground.
2. Work out which tiles cover that square, fetch them in parallel, and draw them into
   an offscreen canvas cropped to the exact bounds.
3. Sample ~24,000 pixels, discarding transparent ones and the pure black left by any
   tile that failed to load.
4. Recursively split the colour space along whichever channel has the widest spread,
   cutting at the median, until there are eight buckets (median cut). Averaging
   instead of quantising turns every landscape into the same brown.
5. Average each bucket, sort by population for the swatches, and sort by lightness
   for the gradient — a lightness ramp reads as a gradient, a frequency ramp does not.

`palette.js` has no DOM dependencies beyond a canvas, so it is reusable on its own.

---

## Project layout

```
index.html          markup and panel scaffolding
css/styles.css      all styling; dark, responsive, respects prefers-reduced-motion
js/
  config.js         endpoints and tunables
  net.js            fetch helpers: timeouts, CORS, in-memory cache, SPARQL
  store.js          localStorage: history, pins, settings
  geocode.js        Nominatim search, reverse geocoding, coordinate parsing
  imagery.js        Web Mercator maths, tile stitching, Google + Street View
  palette.js        median-cut quantisation and export helpers
  wiki.js           Commons photos, nearby articles, summaries
  wikidata.js       SPARQL for dishes and people, with MediaWiki fallbacks
  app.js            map wiring, the pipeline, rendering
```

---

## Notes from building it

A few things that are not obvious and cost real debugging time:

- **Wikidata moved shared labels to the `mul` language code.** Asking the label
  service for `"en"` returns the bare QID (`Q177`) for items like *pizza*, whose name
  is the same in every language. The label service needs `"en,mul"` or your dish list
  fills up with identifiers. This affects food especially.
- **The query service's latency is wildly unstable.** The same dish query measured
  6 s, 17 s and 75 s within one session. Adding a third place QID to the `VALUES`
  clause took it from ~17 s to ~75 s. Two origins is the sweet spot.
  Because of that, dishes and people each race a fast Wikipedia-category lookup
  against the slower Wikidata query, render whichever arrives first, and quietly
  upgrade to the richer result if it lands.
- **`P18` image URLs come back as `http://`.** Used as-is they are blocked as mixed
  content on an HTTPS deployment. They are rewritten to `https:`.
- **Canvas pixel access needs `crossOrigin = "anonymous"` *and* a cooperating host.**
  Esri and Wikimedia both send `Access-Control-Allow-Origin: *`; without that the
  canvas is tainted and `getImageData` throws `SecurityError`. That path is caught
  and reported rather than failing silently.

## Courtesy

Nominatim asks for no more than one request per second — searches are debounced by
280 ms and results are cached in memory. If you fork this into something heavier,
read their [usage policy](https://operations.osmfoundation.org/policies/nominatim/)
first.

## Licence

MIT — see [LICENSE](LICENSE).

Data from OpenStreetMap (ODbL), Wikimedia Commons and Wikidata (CC0 / per-file
licences), and Esri World Imagery. Photographs remain under their own licences,
shown on each thumbnail.
