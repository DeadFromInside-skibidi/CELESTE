// Downloads the public NASA source products used by the terrain pipeline into ./data-cache.
// Nothing here is redistributed in git; `npm run data:build` turns it into the browser assets
// under public/data. Downloads resume where they stopped, and finished files are skipped.
//
//   node tools/fetch-data.mjs            the base set (about 190 MB)
//   node tools/fetch-data.mjs --hires    plus the finer polar grids (about 1.1 GB more)
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, 'data-cache');
mkdirSync(cache, { recursive: true });

const PDS = 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr';
const SVS = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720';
const polar = (name, px) => ({ file: `${name}.img`, url: `${PDS}/polar/img/${name}.img`, bytes: px * px * 2 });

const BASE = [
  { file: 'ldem_4.img', url: `${PDS}/cylindrical/img/ldem_4.img`, bytes: 2073600 },
  { file: 'ldem_16.img', url: `${PDS}/cylindrical/img/ldem_16.img`, bytes: 33177600 },
  polar('ldem_75s_240m', 3812),
  polar('ldem_80s_80m', 7600),
  { file: 'lroc_color_poles_4k.tif', url: `${SVS}/lroc_color_poles_4k.tif` },
];
// Finer LOLA polar grids, most valuable first. Each one the pipeline finds is used
// automatically for the terrain close to a site.
const HIRES = [
  polar('ldem_875s_20m', 7584), // 87.5 S to the pole, 20 m/px
  polar('ldem_85s_40m', 7584), // 85 S to the pole, 40 m/px
  polar('ldem_80s_40m', 15200), // 80 S to the pole, 40 m/px
  polar('ldem_875s_10m', 15168), // 87.5 S to the pole, 10 m/px
  { file: 'lroc_color_poles_8k.tif', url: `${SVS}/lroc_color_poles_8k.tif`, optional: true },
];

const sources = process.argv.includes('--hires') ? [...BASE, ...HIRES] : BASE;

async function download(src) {
  const dest = join(cache, src.file);
  if (existsSync(dest) && (!src.bytes || statSync(dest).size === src.bytes)) return console.log(`ok       ${src.file}`);
  const tmp = dest + '.part';
  for (let attempt = 1; attempt <= 8; attempt++) {
    const have = existsSync(tmp) ? statSync(tmp).size : 0;
    try {
      const res = await fetch(src.url, have ? { headers: { Range: `bytes=${have}-` } } : {});
      if (!(res.ok || res.status === 206) || !res.body) throw new Error(`HTTP ${res.status}`);
      const resumed = res.status === 206;
      console.log(`${resumed ? 'resuming' : 'fetching'} ${src.file}${resumed ? ` at ${(have / 1e6).toFixed(0)} MB` : ''}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp, { flags: resumed ? 'a' : 'w' }));
      const size = statSync(tmp).size;
      if (src.bytes && size !== src.bytes) throw new Error(`incomplete: ${size} of ${src.bytes} bytes`);
      renameSync(tmp, dest);
      return console.log(`done     ${src.file} (${(size / 1e6).toFixed(1)} MB)`);
    } catch (e) {
      console.log(`retry ${attempt} ${src.file}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  throw new Error(`gave up on ${src.file}`);
}

// Three streams at a time: the archive throttles per connection, not per client.
let failed = 0;
const queue = [...sources];
await Promise.all(Array.from({ length: 3 }, async () => {
  for (let s = queue.shift(); s; s = queue.shift()) {
    try {
      await download(s);
    } catch (e) {
      if (!s.optional) failed++;
      console.error(`FAILED   ${s.file}: ${e.message}`);
    }
  }
}));
process.exit(failed ? 1 : 0);
