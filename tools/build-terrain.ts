// Terrain pipeline: turns the public LOLA elevation products in ./data-cache into
//   public/data/horizons.bin      terrain skyline masks for every catalogued site
//   src/data/terrain.json         index + provenance for those masks
//   public/data/spole_*.demz      south-polar DEM at 80, 160 and 320 m/px for the 3D view and
//                                 for tracing custom-site horizons in the browser
//   public/textures/*.webp        globe albedo + normal maps
// Run with:  npm run data:build   (after npm run data:fetch)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import sharp from 'sharp';
import { MASK_SAMPLES } from '../src/core/constants.ts';
import { DemStack, GlobalDem, PolarDem } from '../src/core/dem.ts';
import { encodeDem } from '../src/core/demcodec.ts';
import { computeHorizon } from '../src/core/horizon.ts';
import { surfaceDistanceKm } from '../src/core/topo.ts';
import { OBSERVER_HEIGHTS_M, SITES } from '../src/data/sites.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, 'data-cache');
const outData = join(root, 'public', 'data');
const outTex = join(root, 'public', 'textures');
mkdirSync(outData, { recursive: true });
mkdirSync(outTex, { recursive: true });

function loadInt16(file: string, expected: number): Int16Array {
  const buf = readFileSync(join(cache, file));
  if (buf.byteLength !== expected * 2) throw new Error(`${file}: unexpected size ${buf.byteLength}`);
  // LOLA .IMG products are little-endian 16-bit; copy to guarantee alignment.
  return new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/** Ridge/rim sites are analysed at the highest ground within this distance of the tile centre. */
const SNAP_RADIUS_KM = 4;

const only = process.argv.slice(2);
const want = (step: string) => only.length === 0 || only.includes(step);

/** Loads a finer polar grid if "npm run data:fetch -- --hires" has downloaded it. */
function optionalPolar(name: string, px: number, mpp: number): PolarDem | null {
  if (!existsSync(join(cache, `${name}.img`))) return null;
  console.log(`  using ${name} (${mpp} m/px)`);
  return new PolarDem(loadInt16(`${name}.img`, px * px), px, mpp, 0.5);
}

console.log('loading LOLA elevation models ...');
const global16 = new GlobalDem(loadInt16('ldem_16.img', 5760 * 2880), 5760, 2880, 0.5);
const polar240 = new PolarDem(loadInt16('ldem_75s_240m.img', 3812 * 3812), 3812, 240, 0.5);
const polar80 = new PolarDem(loadInt16('ldem_80s_80m.img', 7600 * 7600), 7600, 80, 0.5);
const fine10 = optionalPolar('ldem_875s_10m', 15168, 10);
const fine20 = optionalPolar('ldem_875s_20m', 7584, 20);
const fine40 = optionalPolar('ldem_80s_40m', 15200, 40) ?? optionalPolar('ldem_85s_40m', 7584, 40);

// ---------------------------------------------------------------------------------------------
// Orientation self-check against well-known relief, so a flipped axis can never ship silently.
// ---------------------------------------------------------------------------------------------
{
  const checks: [string, number, number, (h: number) => boolean][] = [
    ['Shackleton floor', -89.67, 129.78, (h) => h < -2000],
    ['Malapert massif', -85.99, -0.24, (h) => h > 3000],
    ['Mons Mouton summit plateau', -85.43, 31.74, (h) => h > 4000],
    ['Cabeus floor', -85.3, -42.1, (h) => h < -2500],
  ];
  for (const [name, lat, lon, ok] of checks) {
    const a = polar80.heightAt(lat, lon), b = polar240.heightAt(lat, lon), c = global16.heightAt(lat, lon);
    console.log(`  ${name.padEnd(28)} 80m ${a.toFixed(0).padStart(6)} m | 240m ${b.toFixed(0).padStart(6)} m | 16ppd ${c.toFixed(0).padStart(6)} m`);
    if (!ok(a) || !ok(b) || Math.abs(a - c) > 1500) throw new Error(`DEM orientation check failed at ${name}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Horizon masks
// ---------------------------------------------------------------------------------------------
if (want('horizons')) {
  // Finest grid nearest the site, where terrain moves the skyline most; each level steps at
  // half its pixel size. Levels that do not cover a site are dropped for that site.
  const stack = new DemStack([
    ...(fine10 ? [{ dem: fine10, maxDistKm: 4, stepKm: 0.005, label: 'LOLA 10 m/px within 4 km' }] : []),
    ...(fine20 ? [{ dem: fine20, maxDistKm: 10, stepKm: 0.01, label: 'LOLA 20 m/px within 10 km' }] : []),
    ...(fine40 ? [{ dem: fine40, maxDistKm: 30, stepKm: 0.02, label: 'LOLA 40 m/px within 30 km' }] : []),
    { dem: polar80, maxDistKm: fine40 ? 60 : 30, stepKm: 0.04, label: `LOLA 80 m/px within ${fine40 ? 60 : 30} km` },
    { dem: polar240, maxDistKm: 400, stepKm: 0.12, label: 'LOLA LDEM_75S_240M (240 m/px) beyond' },
    { dem: global16, maxDistKm: 400, stepKm: 0.9, label: 'LOLA LDEM_16 (1.9 km/px) outside polar coverage' },
  ]);
  const globalOnly = new DemStack([{ dem: global16, maxDistKm: 400, stepKm: 0.9, label: 'LOLA LDEM_16 global grid (1.9 km/px): regional relief only' }]);

  const index: Record<string, unknown> = {};
  const chunks: Float32Array[] = [];
  let offset = 0;
  const t0 = performance.now();
  for (const site of SITES) {
    let lat = site.lat, lon = site.lon, snappedKm = 0;
    const polar = Number.isFinite(polar80.heightAt(lat, lon));
    let snapGridM = 0;
    if (site.snapToPeak && polar) {
      // Highest cell within SNAP_RADIUS_KM of the catalogued coordinate, on the finest grid
      // that covers the whole search disc. It must be the same grid the skyline is traced on:
      // a crest picked on a coarser grid sits a few tens of metres off the true crest, which
      // then shadows it. Searched in the grid's own stereographic pixels, which stay
      // well-behaved right up to the pole.
      const grid = [fine10, fine20, fine40, polar80].find((d): d is PolarDem => {
        if (!d) return false;
        const c = d.latLonToPixel(site.lat, site.lon), r = (SNAP_RADIUS_KM * 1000) / d.metersPerPixel + 2;
        return c.u - r >= 0 && c.v - r >= 0 && c.u + r <= d.size - 1 && c.v + r <= d.size - 1;
      })!;
      const c = grid.latLonToPixel(site.lat, site.lon);
      const ci = Math.round(c.u), cj = Math.round(c.v), r = Math.round((SNAP_RADIUS_KM * 1000) / grid.metersPerPixel);
      let best = -Infinity, bi = ci, bj = cj;
      for (let j = cj - r; j <= cj + r; j++) {
        for (let i = ci - r; i <= ci + r; i++) {
          if (Math.hypot(i - c.u, j - c.v) > r) continue;
          const h = grid.heightAtPixel(i, j);
          if (h > best) { best = h; bi = i; bj = j; }
        }
      }
      const p = grid.pixelToLatLon(bi, bj);
      lat = p.lat;
      lon = p.lon;
      snappedKm = surfaceDistanceKm(site.lat, site.lon, lat, lon);
      snapGridM = grid.metersPerPixel;
    }
    const sampler = polar ? stack.forSite(lat, lon) : globalOnly;
    const res = computeHorizon(sampler, lat, lon, { observerHeightsM: OBSERVER_HEIGHTS_M, maxDistKm: 350, samples: MASK_SAMPLES });
    const offsets: number[] = [];
    for (const m of res.masks) {
      offsets.push(offset);
      chunks.push(m);
      offset += m.length;
    }
    let lo = Infinity, hi = -Infinity;
    for (const v of res.masks[0]) { if (v < lo) lo = v; if (v > hi) hi = v; }
    index[site.id] = {
      lat: +lat.toFixed(5), lon: +lon.toFixed(5),
      groundHeightM: Math.round(res.groundHeightM),
      snappedKm: +snappedKm.toFixed(2),
      snapGridM,
      offsets,
      terrain: sampler.describe(),
      resolution: polar ? 'high' : 'coarse',
      uncovered: +res.uncoveredFraction.toFixed(4),
      skylineMinDeg: +lo.toFixed(2), skylineMaxDeg: +hi.toFixed(2),
    };
    console.log(`  ${site.id.padEnd(24)} ground ${String(Math.round(res.groundHeightM)).padStart(6)} m  skyline ${lo.toFixed(2).padStart(6)}..${hi.toFixed(2).padStart(5)} deg  ${polar ? 'polar' : 'global'}${snappedKm ? `  snapped ${snappedKm.toFixed(2)} km` : ''}`);
  }
  const all = new Float32Array(offset);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  writeFileSync(join(outData, 'horizons.bin'), Buffer.from(all.buffer));
  writeFileSync(join(root, 'src', 'data', 'terrain.json'), JSON.stringify({
    generatedUtc: new Date().toISOString(),
    maskSamples: MASK_SAMPLES,
    observerHeightsM: OBSERVER_HEIGHTS_M,
    maxDistKm: 350,
    snapRadiusKm: SNAP_RADIUS_KM,
    sites: index,
  }, null, 1));
  console.log(`horizon masks: ${SITES.length} sites in ${((performance.now() - t0) / 1000).toFixed(1)} s -> horizons.bin (${(all.byteLength / 1024).toFixed(0)} KB)`);
}

// ---------------------------------------------------------------------------------------------
// South-polar DEM for the browser: the LOLA 80 m product at full resolution, and box-averaged
// to 160 and 320 m/px for GPUs that cannot hold the full grid.
// ---------------------------------------------------------------------------------------------
if (want('dem')) {
  for (const f of [1, 2, 4]) {
    const n = polar80.size / f;
    const src = polar80.data;
    let out: Int16Array;
    if (f === 1) out = src as Int16Array;
    else {
      out = new Int16Array(n * n);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          let s = 0;
          for (let b = 0; b < f; b++) for (let a = 0; a < f; a++) s += src[(j * f + b) * polar80.size + i * f + a];
          out[j * n + i] = Math.round(s / (f * f));
        }
      }
    }
    const packed = gzipSync(encodeDem(out, n), { level: 9 });
    const name = `spole_${80 * f}m.demz`;
    writeFileSync(join(outData, name), packed);
    console.log(`south-polar DEM: ${n}x${n} @ ${80 * f} m/px -> ${name} (${(packed.byteLength / 1e6).toFixed(2)} MB)`);
  }
}

// ---------------------------------------------------------------------------------------------
// Globe textures
// ---------------------------------------------------------------------------------------------
if (want('textures')) {
  // Normal map from the 16 ppd global DEM, in equirectangular tangent space (x = east, y = north).
  // Built twice: at the grid's native 5760 x 2880, and at 4096 x 2048 for GPUs with a 4096 limit.
  for (const [W, H, name] of [[5760, 2880, 'moon_normal_6k.webp'], [4096, 2048, 'moon_normal_4k.webp']] as const) {
  const rgb = Buffer.alloc(W * H * 3);
  const EXAGGERATION = 2.5;
  for (let j = 0; j < H; j++) {
    const lat = 90 - ((j + 0.5) * 180) / H;
    const cosLat = Math.max(0.02, Math.cos((lat * Math.PI) / 180));
    const dLat = 180 / H, dLon = (360 / W) / cosLat;
    const metresNorth = (dLat * Math.PI / 180) * 1737400 * 2;
    const metresEast = (dLon * Math.PI / 180) * 1737400 * cosLat * 2;
    for (let i = 0; i < W; i++) {
      const lon = ((i + 0.5) * 360) / W;
      const e = global16.heightAt(lat, lon + dLon), w = global16.heightAt(lat, lon - dLon);
      const nn = global16.heightAt(Math.min(90, lat + dLat), lon), s = global16.heightAt(Math.max(-90, lat - dLat), lon);
      let nx = (-(e - w) / metresEast) * EXAGGERATION, ny = (-(nn - s) / metresNorth) * EXAGGERATION;
      const len = Math.hypot(nx, ny, 1);
      nx /= len; ny /= len;
      const o = (j * W + i) * 3;
      rgb[o] = Math.round((nx * 0.5 + 0.5) * 255);
      rgb[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      rgb[o + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
    }
  }
  await sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).webp({ quality: 92 }).toFile(join(outTex, name));
  console.log(`globe normal map -> ${name}`);
  }

  const albedo = join(cache, 'lroc_color_poles_4k.tif');
  if (existsSync(albedo)) {
    await sharp(albedo, { limitInputPixels: false }).resize(4096, 2048).webp({ quality: 88 }).toFile(join(outTex, 'moon_albedo_4k.webp'));
    await sharp(albedo, { limitInputPixels: false }).resize(1024, 512).webp({ quality: 80 }).toFile(join(outTex, 'moon_albedo_1k.webp'));
    console.log('globe albedo -> moon_albedo_4k.webp, moon_albedo_1k.webp');
  } else {
    console.warn('lroc_color_poles_4k.tif missing: albedo textures not rebuilt');
  }
  // Optional 8k albedo (npm run data:fetch -- --hires).
  const albedo8k = join(cache, 'lroc_color_poles_8k.tif');
  if (existsSync(albedo8k)) {
    await sharp(albedo8k, { limitInputPixels: false }).resize(8192, 4096).webp({ quality: 88 }).toFile(join(outTex, 'moon_albedo_8k.webp'));
    console.log('globe albedo -> moon_albedo_8k.webp');
  }
}
