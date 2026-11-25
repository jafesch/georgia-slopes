// Georgia Slopes — map, layers, UI and tour planner. Relies on globals from terrain.js.

// ---------- Legend ----------
const legendHTML = CLASSES.map(c =>
  `<div><div class="sw" style="background:rgb(${c.color})"></div><div class="lb">${c.label}</div></div>`).join('');
document.getElementById('legend').innerHTML = legendHTML;
document.getElementById('legend-tour').innerHTML = legendHTML;

// ---------- Contours from the same DEM ----------
const demSource = new mlcontour.DemSource({ url: TERRARIUM, encoding: 'terrarium', maxzoom: 13, worker: true });
demSource.setupMaplibre(maplibregl);
const CONTOUR_URL = demSource.contourProtocolUrl({
  multiplier: 1,
  thresholds: { 10: [200, 1000], 11: [100, 500], 12: [50, 250], 13: [20, 100], 14: [20, 100], 15: [10, 50] },
  elevationKey: 'ele', levelKey: 'level', contourLayer: 'contours',
});

// ---------- Labels: English, else Latin, else transliterated Georgian ----------
const KA_LATIN = {
  'ა':'a','ბ':'b','გ':'g','დ':'d','ე':'e','ვ':'v','ზ':'z','თ':'t','ი':'i','კ':'k','ლ':'l','მ':'m',
  'ნ':'n','ო':'o','პ':'p','ჟ':'zh','რ':'r','ს':'s','ტ':'t','უ':'u','ფ':'p','ქ':'k','ღ':'gh','ყ':'q',
  'შ':'sh','ჩ':'ch','ც':'ts','ძ':'dz','წ':'ts','ჭ':'ch','ხ':'kh','ჯ':'j','ჰ':'h',
};
const MAX_TRANSLIT = 40;
const charMatch = ['match', ['var', 'c'], ...Object.entries(KA_LATIN).flat(), ['var', 'c']];
const translit = ['let', 's', ['get', 'name'],
  ['let', 't', ['concat', ...Array.from({ length: MAX_TRANSLIT }, (_, i) =>
      ['let', 'c', ['slice', ['var', 's'], i, i + 1], charMatch])],
    ['concat', ['upcase', ['slice', ['var', 't'], 0, 1]], ['slice', ['var', 't'], 1]]]];
const EN_NAME = ['case', ['has', 'name'], ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], translit], ''];

// ---------- State ----------
const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  topo: 'https://tiles.openfreemap.org/styles/liberty',
};
const GEORGIA = [[39.9, 41.0], [46.8, 43.65]];
const SLOPE_MIN_ZOOM = 10; // MapLibre zoom (512px scale) — renders 256px slope tiles from z11
const NAVY = '#2a5880';
const INK = '#1d2430';

const store = {
  get(k, d) { try { const v = localStorage.getItem('gs-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('gs-' + k, JSON.stringify(v)); } catch (e) {} },
};
const settings = Object.assign(
  { base: 'light', slope: true, opacity: 0.7, contours: true, hillshade: true },
  store.get('settings', {}));
let currentStyle = settings.base === 'topo' ? 'topo' : 'light';

// ---------- Map ----------
const map = new maplibregl.Map({
  container: 'map',
  style: STYLES[currentStyle],
  center: [44.45, 42.55], zoom: 9.6, minZoom: 6, maxZoom: 17,
  maxBounds: [[37.5, 39.8], [49.2, 44.8]],
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'bottom-right');
map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

map.on('styleimagemissing', e => {
  if (e.id !== 'peak-tri' || map.hasImage('peak-tri')) return;
  const s = 24, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d'); g.fillStyle = '#4b5563';
  g.beginPath(); g.moveTo(s / 2, 3); g.lineTo(s - 3, s - 4); g.lineTo(3, s - 4); g.closePath(); g.fill();
  map.addImage('peak-tri', g.getImageData(0, 0, s, s), { pixelRatio: 2 });
});

function vis(on) { return on ? 'visible' : 'none'; }

function setupLayers() {
  const layers = map.getStyle().layers;
  for (const l of layers) {
    if (l.type !== 'symbol') continue;
    const tf = JSON.stringify(map.getLayoutProperty(l.id, 'text-field') || '');
    if (tf.includes('name')) map.setLayoutProperty(l.id, 'text-field', EN_NAME);
  }
  const firstSymbol = layers.find(l => l.type === 'symbol').id;
  const firstStructure = layers.find(l => ['transportation', 'building', 'boundary', 'waterway'].includes(l['source-layer'])).id;
  const light = currentStyle === 'light';

  map.addSource('esri-imagery', {
    type: 'raster', tileSize: 256, maxzoom: 19,
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
  });
  map.addLayer({ id: 'satellite', type: 'raster', source: 'esri-imagery', layout: { visibility: vis(settings.base === 'sat') } }, firstStructure);

  map.addSource('dem', {
    type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 14, tiles: [TERRARIUM],
    attribution: '<a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a> (SRTM)',
  });
  map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem', layout: { visibility: vis(settings.hillshade) },
    paint: {
      'hillshade-exaggeration': settings.base === 'sat' ? 0.15 : light ? 0.55 : 0.45,
      'hillshade-shadow-color': light ? '#56606c' : '#4a4a4a',
      'hillshade-highlight-color': '#ffffff',
      'hillshade-accent-color': light ? '#56606c' : '#000000',
    } }, firstStructure);

  map.addSource('contours', { type: 'vector', maxzoom: 15, tiles: [CONTOUR_URL] });
  const contourColor = light && settings.base !== 'sat' ? '#8a94a0' : settings.base === 'sat' ? '#ffffff' : '#a0703c';
  map.addLayer({ id: 'contour-lines', type: 'line', source: 'contours', 'source-layer': 'contours', minzoom: 10,
    layout: { visibility: vis(settings.contours) },
    paint: {
      'line-color': contourColor,
      'line-opacity': ['match', ['get', 'level'], 1, 0.6, 0.32],
      'line-width': ['match', ['get', 'level'], 1, 1, 0.5],
    } }, firstStructure);

  map.addSource('slope', { type: 'raster', tileSize: 256, minzoom: 11, maxzoom: 16, bounds: GEORGIA.flat(), tiles: ['slope://{z}/{x}/{y}'] });
  map.addLayer({ id: 'slope', type: 'raster', source: 'slope', minzoom: SLOPE_MIN_ZOOM, layout: { visibility: vis(settings.slope) },
    paint: { 'raster-opacity': settings.opacity, 'raster-fade-duration': 0 } }, firstSymbol);

  map.addLayer({ id: 'contour-labels', type: 'symbol', source: 'contours', 'source-layer': 'contours', minzoom: 12,
    filter: ['>', ['get', 'level'], 0], layout: {
      visibility: vis(settings.contours),
      'symbol-placement': 'line', 'text-field': ['concat', ['number-format', ['get', 'ele'], {}], ' m'],
      'text-size': 10, 'text-font': ['Noto Sans Regular'] },
    paint: { 'text-color': settings.base === 'sat' ? '#ffffff' : '#6b7480', 'text-halo-color': settings.base === 'sat' ? 'rgba(0,0,0,.5)' : 'rgba(255,255,255,.9)', 'text-halo-width': 1.2 } });
  map.addLayer({ id: 'peaks', type: 'symbol', source: 'openmaptiles', 'source-layer': 'mountain_peak', minzoom: 11.5,
    filter: ['has', 'ele'], layout: {
      'text-field': ['format', EN_NAME, {}, '\n', {}, ['concat', ['to-string', ['get', 'ele']], ' m'], { 'font-scale': 0.85 }],
      'text-font': ['Noto Sans Italic'], 'text-size': 11, 'text-offset': [0, 0.7], 'text-anchor': 'top',
      'icon-image': 'peak-tri', 'icon-size': 1, 'text-optional': true },
    paint: { 'text-color': '#2f3742', 'text-halo-color': '#fff', 'text-halo-width': 1.3 } });

  // Route
  map.addSource('route', { type: 'geojson', data: routeGeoJSON() });
  map.addLayer({ id: 'route-casing', type: 'line', source: 'route',
    layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': 7 } });
  map.addLayer({ id: 'route-line', type: 'line', source: 'route',
    layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': NAVY, 'line-width': 3.5 } });
  map.addSource('route-hover', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'route-hover', type: 'circle', source: 'route-hover',
    paint: { 'circle-radius': 6, 'circle-color': NAVY, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 } });
}

let firstLoad = true;
map.on('style.load', () => {
  setupLayers();
  if (firstLoad) {
    firstLoad = false;
    map.on('mousemove', 'route-line', onRouteHover);
    map.on('mouseleave', 'route-line', hideHover);
    const saved = store.get('route', []);
    if (Array.isArray(saved) && saved.length) { waypoints = saved; routeChanged(false); }
  }
});

function saveSettings() { store.set('settings', settings); }

function setBase(mode) {
  settings.base = mode; saveSettings();
  document.querySelectorAll('#baseopts .opt').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.base === mode)));
  const want = mode === 'topo' ? 'topo' : 'light';
  if (want !== currentStyle) { currentStyle = want; map.setStyle(STYLES[want], { diff: false }); return; }
  map.setLayoutProperty('satellite', 'visibility', vis(mode === 'sat'));
  map.setPaintProperty('hillshade', 'hillshade-exaggeration', mode === 'sat' ? 0.15 : 0.55);
  map.setPaintProperty('contour-lines', 'line-color', mode === 'sat' ? '#ffffff' : '#8a94a0');
  map.setPaintProperty('contour-labels', 'text-color', mode === 'sat' ? '#ffffff' : '#6b7480');
  map.setPaintProperty('contour-labels', 'text-halo-color', mode === 'sat' ? 'rgba(0,0,0,.5)' : 'rgba(255,255,255,.9)');
}

// ---------- Views, tabs, collapse ----------
function setView(view) {
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-current', String(b.dataset.view === view)));
  document.querySelectorAll('[data-card]').forEach(c => { c.hidden = c.dataset.card !== view; });
  document.getElementById('profile').hidden = !(view === 'tour' && samples.length);
  document.body.classList.toggle('has-profile', view === 'tour' && samples.length > 0);
  if (view !== 'tour' && drawing) toggleDrawing();
  if (view === 'tour' && samples.length) renderChart();
  store.set('view', view);
}
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => setView(b.dataset.goto)));

document.querySelectorAll('#card-slope [role=tab]').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('#card-slope [role=tab]').forEach(t => t.setAttribute('aria-selected', String(t === tab)));
  document.querySelectorAll('#card-slope [data-pane-body]').forEach(p => { p.hidden = p.dataset.paneBody !== tab.dataset.pane; });
  document.getElementById('card-slope').classList.remove('collapsed');
}));
document.querySelectorAll('.handle').forEach(h => h.addEventListener('click', () => {
  const card = h.closest('.card');
  card.classList.toggle('collapsed');
  h.setAttribute('aria-label', card.classList.contains('collapsed') ? 'Expand panel' : 'Collapse panel');
}));

// ---------- Display settings ----------
const opacityEl = document.getElementById('opacity');
const opacityOut = document.getElementById('opacity-out');
opacityEl.value = settings.opacity; opacityOut.textContent = Math.round(settings.opacity * 100) + '%';
opacityEl.addEventListener('input', () => {
  settings.opacity = +opacityEl.value; saveSettings();
  opacityOut.textContent = Math.round(settings.opacity * 100) + '%';
  map.getLayer('slope') && map.setPaintProperty('slope', 'raster-opacity', settings.opacity);
});
function bindToggle(id, key, layerIds) {
  const el = document.getElementById(id);
  el.checked = settings[key];
  el.addEventListener('change', () => {
    settings[key] = el.checked; saveSettings();
    layerIds.forEach(l => map.getLayer(l) && map.setLayoutProperty(l, 'visibility', vis(el.checked)));
  });
}
bindToggle('toggle-slope', 'slope', ['slope']);
bindToggle('toggle-contours', 'contours', ['contour-lines', 'contour-labels']);
bindToggle('toggle-hillshade', 'hillshade', ['hillshade']);
document.querySelectorAll('#baseopts .opt').forEach(b => {
  b.setAttribute('aria-pressed', String(b.dataset.base === settings.base));
  b.addEventListener('click', () => setBase(b.dataset.base));
});

const zoomHint = document.getElementById('zoomhint');
const updateHint = () => { zoomHint.hidden = map.getZoom() >= SLOPE_MIN_ZOOM; };
map.on('zoomend', updateHint); updateHint();

// ---------- Cursor readout ----------
const toGlobal = (lng, lat) => [
  (lng + 180) / 360 * WORLD_PX,
  (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * WORLD_PX,
];
const readout = document.getElementById('readout');
let readoutSeq = 0;
map.on('mousemove', e => {
  const { lng, lat } = e.lngLat;
  const [gx, gy] = toGlobal(lng, lat);
  const seq = ++readoutSeq;
  Promise.all(demTilesFor(gx, gy, gx, gy).map(([x, y]) => loadDem(x, y))).then(() => {
    if (seq !== readoutSeq) return;
    const z = elevBilinear(gx, gy);
    if (isNaN(z)) { readout.textContent = 'No elevation data here'; return; }
    const s = slopeAt(gx, gy, metersPerPixel(gy));
    readout.innerHTML = `${lat.toFixed(4)}, ${lng.toFixed(4)} · <b>${Math.round(z)} m</b> · <b>${s.toFixed(0)}°</b>`;
  });
});

// ---------- Tour planner ----------
const SAMPLE_STEP = 20; // metres between profile samples
const FLAT_FILL = '#dde3ea';
let waypoints = [];
let markers = [];
let drawing = false;
let samples = [];
let profileSeq = 0;

function haversine([lng1, lat1], [lng2, lat2]) {
  const R = 6371008.8, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function densify(pts) {
  const out = []; let dist = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = haversine(a, b), n = Math.max(1, Math.ceil(L / SAMPLE_STEP));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ lng: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t, d: dist + L * t });
    }
    dist += L;
  }
  const last = pts[pts.length - 1];
  out.push({ lng: last[0], lat: last[1], d: dist });
  return out;
}

const slopeClass = s => s >= 30 ? LUT[Math.min(900, Math.round(s * 10))] : -1;
const fmtTime = h => { const m = Math.round(h * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };
const routeGeoJSON = () => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: waypoints.length > 1 ? waypoints : [] } });
const setRouteData = () => map.getSource('route')?.setData(routeGeoJSON());

function renderMarkers() {
  markers.forEach(m => m.remove());
  markers = waypoints.map((p, i) => {
    const el = document.createElement('div');
    el.className = 'wp' + (i === 0 ? ' start' : i === waypoints.length - 1 ? ' end' : '');
    el.title = drawing ? 'Drag to move · click to remove' : 'Drag to move';
    const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(p).addTo(map);
    let dragged = false;
    m.on('dragstart', () => { dragged = true; });
    m.on('drag', () => { const ll = m.getLngLat(); waypoints[i] = [ll.lng, ll.lat]; setRouteData(); });
    m.on('dragend', () => { routeChanged(); setTimeout(() => { dragged = false; }, 0); });
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (dragged || !drawing) return;
      waypoints.splice(i, 1); routeChanged();
    });
    return m;
  });
}

function routeChanged(save = true) {
  if (save) store.set('route', waypoints);
  document.getElementById('undoBtn').disabled = !waypoints.length;
  document.getElementById('clearBtn').disabled = !waypoints.length;
  setRouteData();
  renderMarkers();
  computeProfile();
}

async function computeProfile() {
  const seq = ++profileSeq;
  if (waypoints.length < 2) { samples = []; showProfile(); return; }
  const pts = densify(waypoints);
  const need = new Map();
  for (const p of pts) {
    [p.gx, p.gy] = toGlobal(p.lng, p.lat);
    for (const [x, y] of demTilesFor(p.gx, p.gy, p.gx, p.gy)) need.set(demKey(x, y), [x, y]);
  }
  await Promise.all([...need.values()].map(([x, y]) => loadDem(x, y)));
  if (seq !== profileSeq) return;
  for (const p of pts) {
    p.ele = elevBilinear(p.gx, p.gy);
    p.slope = slopeAt(p.gx, p.gy, metersPerPixel(p.gy));
  }
  samples = pts.filter(p => !isNaN(p.ele));
  if (samples.length < 2) samples = [];
  showProfile();
}

function showProfile() {
  const has = samples.length > 0;
  const inTour = !document.getElementById('card-tour').hidden;
  document.getElementById('profile').hidden = !(has && inTour);
  document.body.classList.toggle('has-profile', has && inTour);
  document.getElementById('gpxBtn').disabled = !has;
  document.getElementById('stats').hidden = !has;
  if (!has) {
    document.getElementById('tour-sub').textContent = waypoints.length ? 'Add a second point to see the profile' : 'Click the map to set waypoints';
    return;
  }
  renderStats();
  renderChart();
}

function renderStats() {
  let up = 0, down = 0, steep = 0, maxSlope = 0;
  for (let i = 1; i < samples.length; i++) {
    const dz = samples[i].ele - samples[i - 1].ele;
    if (dz > 0) up += dz; else down -= dz;
    if ((samples[i].slope + samples[i - 1].slope) / 2 >= 30) steep += samples[i].d - samples[i - 1].d;
    maxSlope = Math.max(maxSlope, samples[i].slope);
  }
  const eles = samples.map(s => s.ele);
  const dist = samples[samples.length - 1].d;
  const hH = dist / 1000 / 4, hV = up / 400;
  const time = Math.max(hH, hV) + Math.min(hH, hV) / 2;
  const km = (dist / 1000).toFixed(1);
  const sum = `${km} km · ↑ ${Math.round(up)} m · ↓ ${Math.round(down)} m · ${fmtTime(time)}`;
  document.getElementById('tour-sub').textContent = sum;
  document.getElementById('profile-sum').textContent = sum;
  const items = [
    ['Distance', `${km} km`], ['Ascent', `${Math.round(up)} m`], ['Descent', `${Math.round(down)} m`],
    ['Highest', `${Math.round(Math.max(...eles))} m`], ['Max slope', `${maxSlope.toFixed(0)}°`], ['Time up', fmtTime(time)],
    ['Lowest', `${Math.round(Math.min(...eles))} m`], ['≥ 30° terrain', `${(steep / 1000).toFixed(2)} km`], ['Waypoints', `${waypoints.length}`],
  ];
  document.getElementById('stats').innerHTML = items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

function niceStep(range, target) {
  const raw = range / target, p = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw) || 10 * p;
}

let chartGeom = null;
function renderChart() {
  const svg = document.getElementById('chart');
  const W = svg.clientWidth, H = svg.clientHeight;
  if (!W) return;
  const M = { l: 44, r: 8, t: 8, b: 20 };
  const dist = samples[samples.length - 1].d;
  const eles = samples.map(s => s.ele);
  let lo = Math.min(...eles), hi = Math.max(...eles);
  const yStep = niceStep(Math.max(hi - lo, 50), H < 140 ? 3 : 4);
  lo = Math.floor((lo - yStep * 0.2) / yStep) * yStep; hi = Math.ceil((hi + yStep * 0.1) / yStep) * yStep;
  const x = d => M.l + d / dist * (W - M.l - M.r);
  const y = e => M.t + (hi - e) / (hi - lo) * (H - M.t - M.b);
  const base = y(lo);
  let out = '';
  for (let e = lo; e <= hi + 1e-6; e += yStep) {
    out += `<line x1="${M.l}" x2="${W - M.r}" y1="${y(e)}" y2="${y(e)}" stroke="#eceff2"/>`;
    out += `<text x="${M.l - 6}" y="${y(e) + 3.5}" text-anchor="end">${Math.round(e)}</text>`;
  }
  const xStep = niceStep(dist / 1000, Math.max(3, Math.floor(W / 90)));
  for (let k = 0; k <= dist / 1000 + 1e-6; k += xStep) {
    out += `<text x="${x(k * 1000)}" y="${H - 4}" text-anchor="middle">${+k.toFixed(2)}${k === 0 ? ' km' : ''}</text>`;
  }
  let runStart = 0;
  const segCls = i => slopeClass((samples[i].slope + samples[i + 1].slope) / 2);
  for (let i = 0; i < samples.length - 1; i++) {
    const c = segCls(i);
    if (i < samples.length - 2 && segCls(i + 1) === c) continue;
    const run = samples.slice(runStart, i + 2);
    const fill = c < 0 ? FLAT_FILL : `rgb(${CLASSES[c].color})`;
    const pts = run.map(s => `${x(s.d).toFixed(1)},${y(s.ele).toFixed(1)}`).join(' ');
    out += `<polygon points="${x(run[0].d).toFixed(1)},${base} ${pts} ${x(run[run.length - 1].d).toFixed(1)},${base}" fill="${fill}"/>`;
    runStart = i + 1;
  }
  out += `<polyline points="${samples.map(s => `${x(s.d).toFixed(1)},${y(s.ele).toFixed(1)}`).join(' ')}" fill="none" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`;
  out += `<line x1="${M.l}" x2="${W - M.r}" y1="${base}" y2="${base}" stroke="#c4cad1"/>`;
  out += `<line id="xhair" y1="${M.t}" y2="${base}" stroke="${INK}" stroke-width="1" visibility="hidden"/>`;
  out += `<circle id="xdot" r="4.5" fill="${NAVY}" stroke="#fff" stroke-width="2" visibility="hidden"/>`;
  svg.innerHTML = out;
  chartGeom = { x, y, M, W, dist };
}

function sampleAtD(d) {
  let lo = 0, hi = samples.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (samples[m].d < d) lo = m; else hi = m; }
  return d - samples[lo].d < samples[hi].d - d ? lo : hi;
}
function routeGradient(i) {
  const j0 = Math.max(0, i - 2), j1 = Math.min(samples.length - 1, i + 2);
  const dd = samples[j1].d - samples[j0].d;
  return dd > 0 ? Math.atan((samples[j1].ele - samples[j0].ele) / dd) * 180 / Math.PI : 0;
}

function showHover(i) {
  if (!chartGeom || !samples[i]) return;
  const s = samples[i], g = chartGeom;
  const svg = document.getElementById('chart'), tip = document.getElementById('tip');
  const hx = g.x(s.d), hy = g.y(s.ele);
  const xh = svg.querySelector('#xhair'), xd = svg.querySelector('#xdot');
  xh.setAttribute('x1', hx); xh.setAttribute('x2', hx); xh.setAttribute('visibility', 'visible');
  xd.setAttribute('cx', hx); xd.setAttribute('cy', hy); xd.setAttribute('visibility', 'visible');
  tip.innerHTML = `${(s.d / 1000).toFixed(2)} km · <b>${Math.round(s.ele)} m</b><br>Terrain ${s.slope.toFixed(0)}° · track ${routeGradient(i).toFixed(0)}°`;
  tip.hidden = false;
  const tw = tip.offsetWidth;
  tip.style.left = (hx + 12 + tw > g.W ? hx - 12 - tw : hx + 12) + 'px';
  map.getSource('route-hover')?.setData({ type: 'Point', coordinates: [s.lng, s.lat] });
}
function hideHover() {
  const svg = document.getElementById('chart');
  svg.querySelector('#xhair')?.setAttribute('visibility', 'hidden');
  svg.querySelector('#xdot')?.setAttribute('visibility', 'hidden');
  document.getElementById('tip').hidden = true;
  map.getSource('route-hover')?.setData({ type: 'FeatureCollection', features: [] });
}
function onRouteHover(e) {
  if (!samples.length) return;
  const [gx, gy] = toGlobal(e.lngLat.lng, e.lngLat.lat);
  let best = 0, bd = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const dx = samples[i].gx - gx, dy = samples[i].gy - gy, dd = dx * dx + dy * dy;
    if (dd < bd) { bd = dd; best = i; }
  }
  showHover(best);
}

const chartEl = document.getElementById('chart');
function chartPointer(e) {
  if (!samples.length || !chartGeom) return;
  const r = chartEl.getBoundingClientRect(), g = chartGeom;
  const px = Math.min(Math.max(e.clientX - r.left, g.M.l), g.W - g.M.r);
  showHover(sampleAtD((px - g.M.l) / (g.W - g.M.l - g.M.r) * g.dist));
}
chartEl.addEventListener('pointermove', chartPointer);
chartEl.addEventListener('pointerdown', chartPointer);
chartEl.addEventListener('pointerleave', hideHover);
window.addEventListener('resize', () => samples.length && renderChart());

document.getElementById('profile-toggle').addEventListener('click', e => {
  const p = document.getElementById('profile');
  p.classList.toggle('min');
  const min = p.classList.contains('min');
  e.currentTarget.setAttribute('aria-label', min ? 'Expand profile' : 'Minimise profile');
  e.currentTarget.querySelector('svg').style.transform = min ? 'rotate(180deg)' : '';
  if (!min) renderChart();
});

map.on('click', e => {
  if (!drawing) return;
  waypoints.push([e.lngLat.lng, e.lngLat.lat]);
  routeChanged();
});

const drawBtn = document.getElementById('drawBtn');
function toggleDrawing() {
  drawing = !drawing;
  drawBtn.querySelector('span').textContent = drawing ? 'Finish drawing' : 'Draw route';
  document.body.classList.toggle('drawing', drawing);
  drawing ? map.doubleClickZoom.disable() : map.doubleClickZoom.enable();
  renderMarkers();
}
drawBtn.addEventListener('click', toggleDrawing);
document.getElementById('undoBtn').addEventListener('click', () => { waypoints.pop(); routeChanged(); });
document.getElementById('clearBtn').addEventListener('click', () => { waypoints = []; routeChanged(); });

document.getElementById('gpxBtn').addEventListener('click', () => {
  if (!samples.length) return;
  const trkpts = samples.map(s =>
    `      <trkpt lat="${s.lat.toFixed(6)}" lon="${s.lng.toFixed(6)}"><ele>${s.ele.toFixed(1)}</ele></trkpt>`).join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Georgia Slopes" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Ski tour</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  a.download = 'skitour.gpx';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// Start in the last-used view.
setView(['slope', 'tour', 'about'].includes(store.get('view')) ? store.get('view') : 'slope');
