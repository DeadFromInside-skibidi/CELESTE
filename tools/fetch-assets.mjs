// Downloads the NASA assets used by the Flight view and prepares them for the browser:
//   - Blue Marble Next Generation (land surface + bathymetry), NASA Earth Observatory
//   - Saturn V, Apollo Lunar Module, LRO, Clementine and LADEE models from NASA 3D Resources
//     (github.com/nasa/NASA-3D-Resources). NASA publishes its SLS model only as a Blender file
//     and has no model of the other launch vehicles: those are built in src/gl/rockets.ts.
// Output: public/textures/earth_*.webp and public/models/*.glb
// (Close-range imagery of the launch and landing sites: tools/fetch-site-imagery.mjs.)
//   node tools/fetch-assets.mjs
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, 'data-cache');
const tex = join(root, 'public', 'textures');
const models = join(root, 'public', 'models');
for (const d of [cache, tex, models]) mkdirSync(d, { recursive: true });

const BMNG = 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/december';
const GH = 'https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/3D%20Models';

async function get(url, dest) {
  if (existsSync(dest) && statSync(dest).size > 10_000) return true;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    console.log(`done   ${dest.slice(root.length + 1)} (${(statSync(dest).size / 1e6).toFixed(2)} MB)`);
    return true;
  } catch (e) {
    console.log(`FAILED ${url}: ${e.cause?.code ?? e.message}`);
    return false;
  }
}

// Earth: prefer the 21600-pixel mosaic (resampled to 8192), fall back to the 5400-pixel one.
const big = join(cache, 'bluemarble_21600.jpg'), small = join(cache, 'bluemarble_5400.jpg');
const haveSmall = await get(`${BMNG}/world.topo.bathy.200412.3x5400x2700.jpg`, small);
const haveBig = process.argv.includes('--hires') && (await get(`${BMNG}/world.topo.bathy.200412.3x21600x10800.jpg`, big));
if (haveSmall) {
  await sharp(small).resize(4096, 2048).webp({ quality: 86 }).toFile(join(tex, 'earth_4k.webp'));
  await sharp(small).resize(1024, 512).webp({ quality: 78 }).toFile(join(tex, 'earth_1k.webp'));
  console.log('earth  -> earth_4k.webp, earth_1k.webp');
}
if (haveBig) {
  await sharp(big, { limitInputPixels: false }).resize(8192, 4096).webp({ quality: 86 }).toFile(join(tex, 'earth_8k.webp'));
  console.log('earth  -> earth_8k.webp');
}

for (const [dir, file] of [['Saturn V', 'saturn-v.glb'], ['Apollo Lunar Module', 'apollo-lm.glb'], ['Lunar Reconnaissance Orbiter (A)', 'lro.glb'], ['Clementine', 'clementine.glb'], ['Lunar Atmosphere and Dust Environment Explorer (LADEE)', 'ladee.glb']]) {
  await get(`${GH}/${encodeURIComponent(dir)}/${encodeURIComponent(dir)}.glb`, join(models, file));
}

// The Lunar Module and LRO models are Draco-compressed: ship three.js's decoder beside them.
const draco = join(root, 'public', 'draco');
mkdirSync(draco, { recursive: true });
for (const f of ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']) copyFileSync(join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco', 'gltf', f), join(draco, f));
console.log('draco  -> public/draco');
