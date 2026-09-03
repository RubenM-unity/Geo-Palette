/* Endpoints and tunables. No secrets here — the optional Google key lives in localStorage. */
export const CFG = {
  // Contact string sent to Nominatim/Wikimedia per their usage policies.
  UA_APP: 'GeoPalette/1.0 (https://github.com/; open-source colour-of-place explorer)',

  NOMINATIM: 'https://nominatim.openstreetmap.org',
  WIKIPEDIA: 'https://en.wikipedia.org/w/api.php',
  COMMONS:   'https://commons.wikimedia.org/w/api.php',
  WIKIDATA_API: 'https://www.wikidata.org/w/api.php',
  WDQS: 'https://query.wikidata.org/sparql',

  // Keyless satellite imagery (sends Access-Control-Allow-Origin: *, so canvas pixels stay readable).
  ESRI_TILES: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',

  GOOGLE_STATIC: 'https://maps.googleapis.com/maps/api/staticmap',
  GOOGLE_SV:     'https://maps.googleapis.com/maps/api/streetview',
  GOOGLE_SV_META:'https://maps.googleapis.com/maps/api/streetview/metadata',

  CAPTURE_METRES: 1000,   // width of the ground square we sample
  TILE_PX: 256,
  SWATCHES: 8,            // palette size after quantisation
  PHOTO_RADIUS_M: 1200,
  PEOPLE_RADIUS_KM: 25,
  MAX_HISTORY: 60,
  SPARQL_TIMEOUT_MS: 32000,   // WDQS latency swings wildly; be patient but bounded
};

export const LS = {
  HISTORY: 'geopalette.history.v1',
  PINNED:  'geopalette.pinned.v1',
  SETTINGS:'geopalette.settings.v1',
  GKEY:    'geopalette.googlekey.v1',
};
