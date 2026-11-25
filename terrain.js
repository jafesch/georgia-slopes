// Terrain engine: decodes AWS Terrarium DEM tiles and computes slope (Horn's method).
// Exposes globals used by app.js.

// ---------- Slope classes (from legend) ----------
const CLASSES = [
  { min: 30, max: 35, color: [236, 225, 126], label: '30-35°' },
  { min: 35, max: 40, color: [227, 149, 116], label: '35-40°' },
  { min: 40, max: 45, color: [209, 112, 124], label: '40-45°' },
  { min: 45, max: 50, color: [205, 168, 200], label: '45-50°' },
  { min: 50, max: 91, color: [ 77,  77,  77], label: '>50°'   },
];
const LUT = new Int8Array(901).fill(-1); // slope in 0.1° steps -> class index
for (let i = 0; i <= 900; i++) LUT[i] = CLASSES.findIndex(c => i / 10 >= c.min && i / 10 < c.max);

// ---------- DEM (AWS Terrain Tiles, Terrarium encoding) ----------
// Zoom 12 ≈ 28 m/px in Georgia, matching the native SRTM 1" resolution.
const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const DEM_Z = 12;
const DEM_N = 1 << DEM_Z;
const WORLD_PX = DEM_N * 256;
const demData = new Map();    // key -> Float32Array | null
const demPending = new Map(); // key -> Promise
const DEM_CACHE_MAX = 400;

const decodeCanvas = document.createElement('canvas');
decodeCanvas.width = decodeCanvas.height = 256;
const decodeCtx = decodeCanvas.getContext('2d', { willReadFrequently: true });

const demKey = (x, y) => y * DEM_N + x;

function loadDem(x, y) {
  const key = demKey(x, y);
  if (demData.has(key)) return Promise.resolve(demData.get(key));
  if (demPending.has(key)) return demPending.get(key);
  const p = new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      decodeCtx.clearRect(0, 0, 256, 256);
      decodeCtx.drawImage(img, 0, 0);
      const px = decodeCtx.getImageData(0, 0, 256, 256).data;
      const arr = new Float32Array(256 * 256);
      for (let i = 0, j = 0; i < arr.length; i++, j += 4) arr[i] = px[j] * 256 + px[j + 1] + px[j + 2] / 256 - 32768;
      resolve(arr);
    };
    img.onerror = () => resolve(null);
    img.src = TERRARIUM.replace('{z}', DEM_Z).replace('{x}', x).replace('{y}', y);
  }).then(arr => {
    demPending.delete(key);
    demData.set(key, arr);
    if (demData.size > DEM_CACHE_MAX) demData.delete(demData.keys().next().value);
    return arr;
  });
  demPending.set(key, p);
  return p;
}

let lastKey = -1, lastArr = null;
function elevAt(ix, iy) {
  if (iy < 0) iy = 0; else if (iy >= WORLD_PX) iy = WORLD_PX - 1;
  ix = ((ix % WORLD_PX) + WORLD_PX) % WORLD_PX;
  const key = demKey(ix >> 8, iy >> 8);
  if (key !== lastKey) { lastKey = key; lastArr = demData.get(key) || null; }
  return lastArr ? lastArr[((iy & 255) << 8) | (ix & 255)] : NaN;
}

function elevBilinear(gx, gy) {
  const fx = gx - 0.5, fy = gy - 0.5;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix, ty = fy - iy;
  const a = elevAt(ix, iy), b = elevAt(ix + 1, iy), c = elevAt(ix, iy + 1), d = elevAt(ix + 1, iy + 1);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

const EARTH_CIRC = 40075016.686;
function metersPerPixel(gy) {
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * gy / WORLD_PX)));
  return EARTH_CIRC * Math.cos(lat) / WORLD_PX;
}

// Horn's 3x3 method (as in GDAL/QGIS) on the bilinear surface, 1-DEM-pixel stencil.
function slopeAt(gx, gy, res) {
  const a = elevBilinear(gx - 1, gy - 1), b = elevBilinear(gx, gy - 1), c = elevBilinear(gx + 1, gy - 1);
  const d = elevBilinear(gx - 1, gy),                                    f = elevBilinear(gx + 1, gy);
  const g = elevBilinear(gx - 1, gy + 1), h = elevBilinear(gx, gy + 1), i = elevBilinear(gx + 1, gy + 1);
  const dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * res);
  const dzdy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8 * res);
  return Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI;
}

function demTilesFor(gx0, gy0, gx1, gy1) {
  const out = [];
  const tx0 = Math.floor((gx0 - 3) / 256), tx1 = Math.floor((gx1 + 3) / 256);
  const ty0 = Math.max(0, Math.floor((gy0 - 3) / 256)), ty1 = Math.min(DEM_N - 1, Math.floor((gy1 + 3) / 256));
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) out.push([((tx % DEM_N) + DEM_N) % DEM_N, ty]);
  return out;
}

// Render one 256px slope tile (web-mercator z/x/y) to PNG bytes.
const tileCanvas = document.createElement('canvas');
tileCanvas.width = tileCanvas.height = 256;
const tileCtx = tileCanvas.getContext('2d');

async function renderSlopeTile(z, x, y) {
  const scale = Math.pow(2, z - DEM_Z);
  const gx0 = x * 256 / scale, gy0 = y * 256 / scale;
  const gx1 = (x + 1) * 256 / scale, gy1 = (y + 1) * 256 / scale;
  await Promise.all(demTilesFor(gx0, gy0, gx1, gy1).map(([tx, ty]) => loadDem(tx, ty)));
  const img = tileCtx.createImageData(256, 256);
  const d = img.data;
  for (let py = 0; py < 256; py++) {
    const gy = gy0 + (py + 0.5) / scale;
    const res = metersPerPixel(gy);
    for (let px = 0; px < 256; px++) {
      const s = slopeAt(gx0 + (px + 0.5) / scale, gy, res);
      if (!(s >= 30)) continue;
      const ci = LUT[Math.min(900, Math.round(s * 10))];
      if (ci < 0) continue;
      const c = CLASSES[ci].color, o = (py * 256 + px) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
  }
  tileCtx.putImageData(img, 0, 0);
  const blob = await new Promise(r => tileCanvas.toBlob(r, 'image/png'));
  return blob.arrayBuffer();
}

maplibregl.addProtocol('slope', async (params) => {
  const [z, x, y] = params.url.replace('slope://', '').split('/').map(Number);
  return { data: await renderSlopeTile(z, x, y) };
});

