// Downloads close-range imagery for the flight view: the ground around every launch site on
// Earth and around every landing or impact site on the Moon, so that the cinematic camera has
// real terrain under it at the pad and at touchdown.
//
//   Earth  NASA GIBS (gibs.earthdata.nasa.gov), WMS:
//            Landsat WELD true colour, annual composite 2000 (30 m)   -> near and mid patches
//            Blue Marble Next Generation (500 m)                       -> wide patch
//   Moon   NASA Moon Trek (trek.nasa.gov), WMTS:
//            LROC WAC global mosaic, 303 pixels per degree (100 m)     -> near and wide patches
//
// Every patch is resampled to an azimuthal equidistant projection centred on the site (so it
// has the same scale in every direction, also near the poles), feathered to transparent at
// its edge, and written as WebP to public/sites. The list of patches goes to
// src/data/site-imagery.json. Source tiles are cached in data-cache/.
//   node tools/fetch-site-imagery.mjs [--only=earth|moon] [--force]
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, 'data-cache');
const outDir = join(root, 'public', 'sites');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const force = process.argv.includes('--force');
for (const d of [join(cache, 'gibs'), join(cache, 'trek'), join(outDir, 'earth'), join(outDir, 'moon')]) mkdirSync(d, { recursive: true });

const DEG = Math.PI / 180;
const EARTH_R = 6378.137, MOON_R = 1737.4;
const slug = (s) => s.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const { missions } = JSON.parse(readFileSync(join(root, 'src', 'data', 'missions.json'), 'utf8'));

/** Patches per body: half-width on the ground (km), output size (px) and where the pixels come from. */
const EARTH_LEVELS = [
  { id: 'wide', halfKm: 700, size: 1024, layer: 'BlueMarble_NextGeneration', time: null, label: 'Blue Marble Next Generation, 500 m' },
  { id: 'mid', halfKm: 150, size: 1024, layer: 'Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual', time: '2000-12-01', label: 'Landsat WELD annual composite, 30 m' },
  { id: 'near', halfKm: 28, size: 2048, layer: 'Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual', time: '2000-12-01', label: 'Landsat WELD annual composite, 30 m' },
];
const MOON_LEVELS = [
  { id: 'wide', halfKm: 180, size: 1024, maxZoom: 6 },
  { id: 'near', halfKm: 45, size: 1024, maxZoom: 8 },
];
const MAX_TILES = 90;

async function download(url, file, tries = 4) {
  if (existsSync(file) && statSync(file).size > 200) return readFileSync(file);
  for (let k = 0; k < tries; k++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 200 || buf.subarray(0, 5).toString() === '<?xml') throw new Error('not an image');
      writeFileSync(file, buf);
      return buf;
    } catch (e) {
      if (k === tries - 1) { console.log(`  FAILED ${url.slice(0, 110)}: ${e.cause?.code ?? e.message}`); return null; }
      await new Promise((r) => setTimeout(r, 1500 * (k + 1)));
    }
  }
  return null;
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

/** Latitude and longitude (deg) of the point `x` km east and `y` km north of a site. */
function offsetToLatLon(lat0, lon0, x, y, R) {
  const rho = Math.hypot(x, y) / R, az = Math.atan2(x, y);
  const s0 = Math.sin(lat0 * DEG), c0 = Math.cos(lat0 * DEG);
  const sl = s0 * Math.cos(rho) + c0 * Math.sin(rho) * Math.cos(az);
  const lat = Math.asin(Math.max(-1, Math.min(1, sl)));
  const lon = lon0 * DEG + Math.atan2(Math.sin(az) * Math.sin(rho) * c0, Math.cos(rho) - s0 * sl);
  return [lat / DEG, lon / DEG];
}
/** The lat/lon box that contains a square patch, with a margin; `all` when it wraps a pole. */
function boundsOf(lat0, lon0, halfKm, R) {
  let latMin = 90, latMax = -90, dLon = 0;
  const n = 48;
  for (let i = 0; i <= n; i++) for (const [x, y] of [[-1, i / n * 2 - 1], [1, i / n * 2 - 1], [i / n * 2 - 1, -1], [i / n * 2 - 1, 1]]) {
    const [la, lo] = offsetToLatLon(lat0, lon0, x * halfKm, y * halfKm, R);
    latMin = Math.min(latMin, la); latMax = Math.max(latMax, la);
    dLon = Math.max(dLon, Math.abs(((lo - lon0 + 540) % 360) - 180));
  }
  const reach = (halfKm * Math.SQRT2) / R / DEG;
  const pole = Math.abs(lat0) + reach >= 89.9;
  if (pole) { if (lat0 > 0) latMax = 90; else latMin = -90; dLon = 180; }
  const m = (latMax - latMin) * 0.04;
  return { latMin: Math.max(-90, latMin - m), latMax: Math.min(90, latMax + m), lonMin: lon0 - Math.min(180, dLon * 1.04 + 0.01), lonMax: lon0 + Math.min(180, dLon * 1.04 + 0.01) };
}

/**
 * Resamples an equirectangular source (RGBA, covering `b`; longitude may run past +-180) to
 * the site-centred projection, and fades the edge to transparent.
 */
function project(src, sw, sh, b, lat0, lon0, halfKm, size, R) {
  const out = Buffer.alloc(size * size * 4);
  const lonSpan = b.lonMax - b.lonMin, latSpan = b.latMax - b.latMin;
  const wraps = lonSpan >= 359.9;
  for (let j = 0; j < size; j++) {
    const y = (1 - (2 * (j + 0.5)) / size) * halfKm;
    for (let i = 0; i < size; i++) {
      const x = ((2 * (i + 0.5)) / size - 1) * halfKm;
      const [lat, lon] = offsetToLatLon(lat0, lon0, x, y, R);
      let dl = ((lon - b.lonMin) % 360 + 360) % 360;
      let fx = (dl / lonSpan) * sw - 0.5, fy = ((b.latMax - lat) / latSpan) * sh - 0.5;
      fy = Math.max(0, Math.min(sh - 1.001, fy));
      if (!wraps) fx = Math.max(0, Math.min(sw - 1.001, fx));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
      const xa = ((x0 % sw) + sw) % sw, xb = wraps ? (xa + 1) % sw : Math.min(sw - 1, xa + 1);
      const p00 = (y0 * sw + xa) * 4, p01 = (y0 * sw + xb) * 4, p10 = ((y0 + 1) * sw + xa) * 4, p11 = ((y0 + 1) * sw + xb) * 4;
      const o = (j * size + i) * 4;
      // Alpha-weighted, so that empty source pixels do not darken their neighbours.
      const w00 = (1 - ax) * (1 - ay) * src[p00 + 3], w01 = ax * (1 - ay) * src[p01 + 3], w10 = (1 - ax) * ay * src[p10 + 3], w11 = ax * ay * src[p11 + 3];
      const wsum = w00 + w01 + w10 + w11;
      if (wsum > 0) for (let c = 0; c < 3; c++) out[o + c] = Math.round((src[p00 + c] * w00 + src[p01 + c] * w01 + src[p10 + c] * w10 + src[p11 + c] * w11) / wsum);
      // Feather: full strength inside 80% of the half-width, gone at the edge.
      const edge = Math.max(Math.abs(x), Math.abs(y)) / halfKm;
      const fade = edge <= 0.8 ? 1 : Math.max(0, 1 - (edge - 0.8) / 0.19);
      out[o + 3] = Math.round(Math.min(255, wsum) * fade * fade * (3 - 2 * fade));
    }
  }
  return out;
}

async function writePatch(file, rgba, size, quality) {
  await sharp(rgba, { raw: { width: size, height: size, channels: 4 } }).webp({ quality, alphaQuality: 90, effort: 5 }).toFile(file);
  return statSync(file).size;
}

// ---------------------------------------------------------------------------------------------
// Earth: one WMS request per patch (two when the box crosses the antimeridian)
// ---------------------------------------------------------------------------------------------
async function gibs(layer, time, b, w, h, tag) {
  const parts = [];
  if (b.lonMin < -180) parts.push([b.lonMin + 360, 180], [-180, b.lonMax]);
  else if (b.lonMax > 180) parts.push([b.lonMin, 180], [-180, b.lonMax - 360]);
  else parts.push([b.lonMin, b.lonMax]);
  const total = b.lonMax - b.lonMin;
  const tiles = [];
  let x = 0;
  for (const [k, [lo, hi]] of parts.entries()) {
    const pw = k === parts.length - 1 ? w - x : Math.max(1, Math.round((w * (hi - lo)) / total));
    const url = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layer}&STYLES=&CRS=EPSG:4326&BBOX=${b.latMin.toFixed(6)},${lo.toFixed(6)},${b.latMax.toFixed(6)},${hi.toFixed(6)}&WIDTH=${pw}&HEIGHT=${h}&FORMAT=image/png&TRANSPARENT=TRUE${time ? `&TIME=${time}` : ''}`;
    const buf = await download(url, join(cache, 'gibs', `${tag}-${k}.png`));
    if (!buf) return null;
    tiles.push({ input: await sharp(buf).ensureAlpha().resize(pw, h, { fit: 'fill' }).png().toBuffer(), left: x, top: 0 });
    x += pw;
  }
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(tiles).raw().toBuffer();
}

const manifest = { note: 'Written by tools/fetch-site-imagery.mjs. Patches are azimuthal equidistant, centred on the site, north up; halfKm is the distance from the centre to the edge.', earth: {}, moon: {} };
const prior = existsSync(join(root, 'src', 'data', 'site-imagery.json')) ? JSON.parse(readFileSync(join(root, 'src', 'data', 'site-imagery.json'), 'utf8')) : null;

if (only !== 'moon') {
  const pads = new Map();
  for (const m of missions) pads.set(slug(m.launchSite.name), m.launchSite);
  console.log(`Earth: ${pads.size} launch sites`);
  for (const [id, pad] of pads) {
    const levels = [];
    for (const lv of EARTH_LEVELS) {
      const file = join(outDir, 'earth', `${id}-${lv.id}.webp`);
      if (!force && existsSync(file)) { levels.push({ file: `earth/${id}-${lv.id}.webp`, halfKm: lv.halfKm, source: lv.label }); continue; }
      const b = boundsOf(pad.lat, pad.lon, lv.halfKm, EARTH_R);
      const h = Math.round(lv.size * 1.15);
      const w = Math.max(256, Math.min(4096, Math.round((h * (b.lonMax - b.lonMin) * Math.cos(pad.lat * DEG)) / (b.latMax - b.latMin))));
      const src = await gibs(lv.layer, lv.time, b, w, h, `${id}-${lv.id}`);
      if (!src) continue;
      const rgba = project(src, w, h, b, pad.lat, pad.lon, lv.halfKm, lv.size, EARTH_R);
      let seen = 0;
      for (let p = 3; p < rgba.length; p += 4 * 97) if (rgba[p] > 8) seen++;
      if (seen < (rgba.length / (4 * 97)) * 0.03) { console.log(`  ${id} ${lv.id}: no imagery there, skipped`); continue; }
      const bytes = await writePatch(file, rgba, lv.size, lv.id === 'near' ? 84 : 80);
      levels.push({ file: `earth/${id}-${lv.id}.webp`, halfKm: lv.halfKm, source: lv.label });
      console.log(`  ${id} ${lv.id}: ${(bytes / 1024).toFixed(0)} kB`);
    }
    if (levels.length) manifest.earth[id] = { lat: pad.lat, lon: pad.lon, levels };
  }
} else if (prior) manifest.earth = prior.earth;

// ---------------------------------------------------------------------------------------------
// Moon: WMTS tiles of the LROC WAC mosaic, stitched
// ---------------------------------------------------------------------------------------------
const WAC = 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm';
async function wac(b, maxZoom) {
  let z = maxZoom, c0, c1, r0, r1, t;
  for (; z >= 2; z--) {
    t = 180 / 2 ** z;
    c0 = Math.floor((b.lonMin + 180) / t); c1 = Math.floor((b.lonMax + 180 - 1e-9) / t);
    r0 = Math.max(0, Math.floor((90 - b.latMax) / t)); r1 = Math.min(2 ** z - 1, Math.floor((90 - b.latMin - 1e-9) / t));
    if ((c1 - c0 + 1) * (r1 - r0 + 1) <= MAX_TILES) break;
  }
  const cols = 2 ** (z + 1), nx = c1 - c0 + 1, ny = r1 - r0 + 1;
  const jobs = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) jobs.push({ r, c: ((c % cols) + cols) % cols, left: (c - c0) * 256, top: (r - r0) * 256 });
  const tiles = [];
  await pool(jobs, 8, async (j) => {
    const buf = await download(`${WAC}/${z}/${j.r}/${j.c}.jpg`, join(cache, 'trek', `wac-${z}-${j.r}-${j.c}.jpg`));
    if (buf) tiles.push({ input: buf, left: j.left, top: j.top });
  });
  if (tiles.length < jobs.length * 0.9) return null;
  const w = nx * 256, h = ny * 256;
  const src = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(tiles).raw().toBuffer();
  // The stitched tiles cover a slightly larger box than the one asked for.
  return { src, w, h, z, box: { lonMin: c0 * t - 180, lonMax: (c1 + 1) * t - 180, latMax: 90 - r0 * t, latMin: 90 - (r1 + 1) * t } };
}

if (only !== 'earth') {
  const sites = missions.filter((m) => m.surface);
  console.log(`Moon: ${sites.length} landing and impact sites`);
  for (const m of sites) {
    const levels = [];
    for (const lv of MOON_LEVELS) {
      const file = join(outDir, 'moon', `${m.id}-${lv.id}.webp`);
      if (!force && existsSync(file) && prior?.moon?.[m.id]?.levels.find((x) => x.file.endsWith(`-${lv.id}.webp`))) { levels.push(prior.moon[m.id].levels.find((x) => x.file.endsWith(`-${lv.id}.webp`))); continue; }
      const got = await wac(boundsOf(m.surface.lat, m.surface.lon, lv.halfKm, MOON_R), lv.maxZoom);
      if (!got) { console.log(`  ${m.id} ${lv.id}: tiles missing, skipped`); continue; }
      const rgba = project(got.src, got.w, got.h, got.box, m.surface.lat, m.surface.lon, lv.halfKm, lv.size, MOON_R);
      const bytes = await writePatch(file, rgba, lv.size, 82);
      const mpp = Math.round((Math.PI * MOON_R * 1000) / (256 * 2 ** got.z));
      levels.push({ file: `moon/${m.id}-${lv.id}.webp`, halfKm: lv.halfKm, source: `LROC WAC global mosaic, tiles at ${mpp} m/px` });
      console.log(`  ${m.id} ${lv.id}: zoom ${got.z}, ${(bytes / 1024).toFixed(0)} kB`);
    }
    if (levels.length) manifest.moon[m.id] = { lat: m.surface.lat, lon: m.surface.lon, levels };
  }
} else if (prior) manifest.moon = prior.moon;

writeFileSync(join(root, 'src', 'data', 'site-imagery.json'), JSON.stringify(manifest, null, 1));
console.log(`site imagery: ${Object.keys(manifest.earth).length} launch sites, ${Object.keys(manifest.moon).length} lunar sites -> public/sites, src/data/site-imagery.json`);
