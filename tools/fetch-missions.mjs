// Builds the lunar mission catalogue (src/data/missions.json).
//
// From NASA records, fetched and cached in data-cache/nssdca:
//   - NSSDCA Lunar Exploration Timeline: every mission, its launch date and mission type
//   - NSSDCA table of spacecraft on the lunar surface: landing / impact date and coordinates
//   - NSSDCA Master Catalog page per spacecraft (launch vehicle, launch site), when that
//     server answers; it rate-limits scripts heavily, so by default only cached pages are used.
// Compiled by hand below, and marked as such in the output:
//   - launch vehicle and launch site per programme (PROGRAMMES)
//   - launch pad coordinates (SITES)
//   - launch time of day for the few missions where it is on record here (LAUNCH_UTC)
//
//   node tools/fetch-missions.mjs            use cached NASA pages
//   node tools/fetch-missions.mjs --catalog  also try the Master Catalog, one page at a time
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, 'data-cache', 'nssdca');
mkdirSync(cache, { recursive: true });

const TIMELINE = 'https://nssdc.gsfc.nasa.gov/planetary/lunar/lunartimeline.html';
const SURFACE = 'https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_artifact_impacts.html';
const PAGE = (id) => `https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=${id}`;

function curl(url) {
  return execFileSync(process.platform === 'win32' ? 'curl.exe' : 'curl', ['-sS', '-L', '--max-time', '60', url], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}
function cached(name, url, { fetchIfMissing = true } = {}) {
  const file = join(cache, name);
  if (existsSync(file)) return readFileSync(file, 'utf8');
  if (!fetchIfMissing) return null;
  const text = curl(url);
  if (text.length < 500 || text.includes('Errors and Messages')) return null;
  writeFileSync(file, text);
  return text;
}

const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ').trim();
const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const NATION = { ussr: 'USSR', usa: 'United States', japan: 'Japan', esa: 'ESA', china: 'China', india: 'India', israel: 'Israel', skorea: 'South Korea', russia: 'Russia' };
const pad2 = (n) => String(n).padStart(2, '0');
function parseDate(text) {
  const d = /([A-Z][a-z]{2})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})/.exec(text);
  if (d && MONTHS[d[1]]) return `${d[3]}-${pad2(MONTHS[d[1]])}-${pad2(d[2])}`;
  const e = /(\d{1,2})\s+([A-Z][a-z]{2})[a-z]*\.?\s+(\d{4})/.exec(text);
  if (e && MONTHS[e[2]]) return `${e[3]}-${pad2(MONTHS[e[2]])}-${pad2(e[1])}`;
  return null;
}

// ---- Compiled tables ----------------------------------------------------------------------------
/** Launch complexes: approximate pad coordinates (deg, east-positive). */
const SITES = {
  cape: { name: 'Cape Canaveral, Florida, USA', lat: 28.49, lon: -80.58 },
  ksc: { name: 'Kennedy Space Center LC-39, Florida, USA', lat: 28.608, lon: -80.604 },
  vandenberg: { name: 'Vandenberg, California, USA', lat: 34.74, lon: -120.57 },
  wallops: { name: 'Wallops Island, Virginia, USA', lat: 37.83, lon: -75.49 },
  mahia: { name: 'Mahia Peninsula, New Zealand', lat: -39.26, lon: 177.86 },
  baikonur: { name: 'Baikonur Cosmodrome, Kazakhstan', lat: 45.96, lon: 63.31 },
  vostochny: { name: 'Vostochny Cosmodrome, Russia', lat: 51.88, lon: 128.33 },
  uchinoura: { name: 'Uchinoura Space Center, Japan', lat: 31.25, lon: 131.08 },
  tanegashima: { name: 'Tanegashima Space Center, Japan', lat: 30.4, lon: 130.97 },
  kourou: { name: 'Guiana Space Centre, Kourou', lat: 5.24, lon: -52.77 },
  xichang: { name: 'Xichang Satellite Launch Center, China', lat: 28.25, lon: 102.03 },
  wenchang: { name: 'Wenchang Space Launch Site, China', lat: 19.61, lon: 110.95 },
  sriharikota: { name: 'Satish Dhawan Space Centre, Sriharikota, India', lat: 13.73, lon: 80.23 },
};

/**
 * Launch vehicle and site by programme: [name pattern, vehicle, vehicle class, site, typical
 * days from launch to lunar arrival]. First match wins. `cls` picks the 3D model.
 */
const PROGRAMMES = [
  [/^Luna [1-3]$/, 'Luna 8K72 (R-7)', 'r7', 'baikonur', 1.5],
  [/^Luna ([4-9]|1[0-4])$|^Zond 3$/, 'Molniya 8K78 (R-7)', 'r7', 'baikonur', 3.4],
  [/^Luna (1[5-9]|2[0-4])$|^Zond [5-8]$/, 'Proton-K / Blok D', 'proton', 'baikonur', 4.3],
  [/^Luna 25$/, 'Soyuz-2.1b / Fregat', 'r7', 'vostochny', 5.4],
  [/^Pioneer 4$/, 'Juno II', 'small', 'cape', 1.7],
  [/^Ranger/, 'Atlas-Agena B', 'atlas', 'cape', 2.75],
  [/^Surveyor/, 'Atlas-Centaur', 'atlas', 'cape', 2.7],
  [/^Lunar Orbiter \d/, 'Atlas-Agena D', 'atlas', 'cape', 3.8],
  [/^Explorer (33|35)/, 'Delta E1', 'delta', 'cape', 3.5],
  [/^Explorer 49/, 'Delta 1913', 'delta', 'cape', 4.6],
  [/^Apollo/, 'Saturn V', 'saturn-v', 'ksc', 3.15],
  [/^Clementine/, 'Titan II(23)G', 'titan', 'vandenberg', 25],
  [/^AsiaSat/, 'Proton-K / Blok DM3', 'proton', 'baikonur', 4.5],
  [/^Lunar Prospector/, 'Athena II', 'small', 'cape', 4.4],
  [/^Lunar Reconnaissance Orbiter|^LCROSS/, 'Atlas V 401', 'atlas5', 'cape', 4.5],
  [/GRAIL/, 'Delta II 7920H', 'delta2', 'cape', 110],
  [/LADEE/, 'Minotaur V', 'small', 'wallops', 30],
  [/^CAPSTONE/, 'Electron / Lunar Photon', 'electron', 'mahia', 138],
  [/^Artemis 1|^LunaH-Map|^Lunar Ice Cube|LunIR|^OMOTENASHI|^EQUULEUS/, 'SLS Block 1', 'sls', 'ksc', 5.5],
  [/^Peregrine/, 'Vulcan Centaur VC2S', 'vulcan', 'cape', 5],
  [/^Hakuto-R M1|^Lunar Flashlight|^Beresheet|Danuri/, 'Falcon 9 Block 5', 'falcon9', 'cape', 5],
  [/^Intuitive Machines|^Blue Ghost|^Resilience|^Lunar Trailblazer/, 'Falcon 9 Block 5', 'falcon9', 'ksc', 5],
  [/^Hiten/, 'Mu-3SII', 'small', 'uchinoura', 55],
  [/^Kaguya|^SLIM/, 'H-IIA', 'h2a', 'tanegashima', 20],
  [/^SMART/, 'Ariane 5G', 'ariane5', 'kourou', 410],
  [/^Chang'e 1$/, 'Long March 3A', 'lm3', 'xichang', 12],
  [/^Chang'e 2$|^Chang'e 5 Test/, 'Long March 3C', 'lm3', 'xichang', 4.7],
  [/^Chang'e [34]$/, 'Long March 3B', 'lm3', 'xichang', 4.6],
  [/^Queqiao$/, 'Long March 4C', 'lm3', 'xichang', 4.5],
  [/^Queqiao 2/, 'Long March 8', 'lm3', 'wenchang', 4.7],
  [/^Chang'e [56]$/, 'Long March 5', 'lm5', 'wenchang', 4.7],
  [/^Chandrayaan-1/, 'PSLV-XL', 'pslv', 'sriharikota', 17],
  [/^Chandrayaan [23]/, 'LVM3 (GSLV Mk III)', 'lvm3', 'sriharikota', 22],
];

/** Launch times of day on record here (UTC). Everything else is estimated at run time. */
const LAUNCH_UTC = {
  'Apollo 8': '1968-12-21T12:51:00Z', 'Apollo 10': '1969-05-18T16:49:00Z', 'Apollo 11': '1969-07-16T13:32:00Z',
  'Apollo 12': '1969-11-14T16:22:00Z', 'Apollo 13': '1970-04-11T19:13:00Z', 'Apollo 14': '1971-01-31T21:03:02Z',
  'Apollo 15': '1971-07-26T13:34:00Z', 'Apollo 16': '1972-04-16T17:54:00Z', 'Apollo 17': '1972-12-07T05:33:00Z',
  'Artemis 1': '2022-11-16T06:47:44Z', 'Chandrayaan 3': '2023-07-14T09:05:17Z',
};

/** Timeline name -> row in NASA's surface table (where they differ) and -> site in the app. */
const SURFACE_ALIAS = {
  'Chandrayaan 2': 'Vikram', 'Intuitive Machines 1 (Odysseus)': 'Odysseus (IM-1)', 'Blue Ghost 1 (Firefly)': 'Blue Ghost 1',
  'Intuitive Machines 2 (PRIME 1)': 'Intuitive Machines 2', 'Hakuto-R M1': 'Hakuto-R Mission 1', 'Resilience/M2': 'Hakuto-R Mission 2',
};
for (const n of [11, 12, 14, 15, 16, 17]) SURFACE_ALIAS[`Apollo ${n}`] = `Apollo ${n} LM descent stage`;
const SITE_LINK = {
  'Apollo 11': 'apollo-11', 'Apollo 12': 'apollo-12', 'Apollo 14': 'apollo-14', 'Apollo 15': 'apollo-15', 'Apollo 16': 'apollo-16', 'Apollo 17': 'apollo-17',
  "Chang'e 3": 'change-3', "Chang'e 4": 'change-4', "Chang'e 5": 'change-5', "Chang'e 6": 'change-6', 'Chandrayaan 3': 'chandrayaan-3', SLIM: 'slim',
  'Intuitive Machines 1 (Odysseus)': 'im1-odysseus', 'Intuitive Machines 2 (PRIME 1)': 'im2-athena', 'Blue Ghost 1 (Firefly)': 'blue-ghost-1',
};
/** Spacecraft whose flown trajectory JPL Horizons publishes. */
const HORIZONS = { SLIM: -240, 'Artemis 1': -1023, 'Korea Pathfinder Lunar Orbiter (Danuri)': -155, 'Lunar Reconnaissance Orbiter': -85, CAPSTONE: -1176, 'Lunar Prospector': -25, Clementine: -40, 'Lunar Atmosphere and Dust Environment Explorer (LADEE)': -12 };
/** Dates the timeline gives only as a planned month, and outcomes its one-line label does not carry. */
const DATE_FIX = { 'Chandrayaan 2': '2019-07-22' };
const NOTES = {
  'Apollo 13': 'Landing aborted after an oxygen tank failure; the crew swung around the Moon and returned safely.',
  'Peregrine Mission 1 (Astrobotic)': 'A propellant leak after launch ruled out a landing; the spacecraft never reached the Moon and re-entered over the Pacific.',
  'Chandrayaan 2': 'The orbiter succeeded; the Vikram lander was lost during its descent.',
  'Beresheet': 'Reached lunar orbit; lost during the landing attempt.',
  'Hakuto-R M1': 'Reached lunar orbit; lost during the landing attempt.',
  'Resilience/M2': 'Reached lunar orbit; lost during the landing attempt.',
  'Luna 25': 'Reached lunar orbit; lost after an orbit-lowering burn.',
  'Intuitive Machines 1 (Odysseus)': 'Soft-landed and operated, but came to rest tipped on its side.',
  'Intuitive Machines 2 (PRIME 1)': 'Touched down but came to rest on its side in a shadowed crater.',
};

// ---- 1. Timeline -------------------------------------------------------------------------------
const timeline = cached('timeline.html', TIMELINE);
if (!timeline) throw new Error('Could not load the NSSDCA lunar timeline');
const COSPAR = { 'Apollo 8': '1968-118A', 'Apollo 10': '1969-043A', 'Apollo 11': '1969-059A', 'Apollo 12': '1969-099A', 'Apollo 13': '1970-029A', 'Apollo 14': '1971-008A', 'Apollo 15': '1971-063A', 'Apollo 16': '1972-031A', 'Apollo 17': '1972-096A', Clementine: '1994-004A', 'Lunar Prospector': '1998-001A' };
const ENTRY = /SRC="(\w+?)line\.gif"[^>]*>\s*<a href="([^"]+)"[^>]*>\s*(.*?)\s*<\/a>(?:\s|&nbsp;)*-(?:\s|&nbsp;)*([^<\r\n]*?)(?:\s|&nbsp;)+-(?:\s|&nbsp;)+([^<\r\n]*)/gi;
const entries = [];
const seen = new Set();
for (const m of timeline.matchAll(ENTRY)) {
  const name = strip(m[3]);
  const launchDate = DATE_FIX[name] ?? parseDate(strip(m[4]));
  if (!launchDate || seen.has(name)) continue; // undated entries are missions that have not flown
  seen.add(name);
  entries.push({ name, launchDate, kind: strip(m[5]), nation: NATION[m[1].toLowerCase()] ?? m[1], nssdcaId: /display\.action\?id=([0-9A-Za-z-]+)/.exec(m[2])?.[1] ?? COSPAR[name] ?? null });
}

// ---- 2. Surface coordinates --------------------------------------------------------------------
const surface = cached('surface.html', SURFACE);
const rows = new Map();
for (const row of (surface ?? '').split(/<tr/i).slice(1)) {
  const cells = [...row.matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/gis)].map((c) => strip(c[1]));
  const ll = /(-?\d+(?:\.\d+)?)\s*([NS]),?\s*(-?\d+(?:\.\d+)?)\s*([EW])/.exec(cells[3] ?? '');
  if (cells.length < 4 || !ll) continue;
  rows.set(cells[0], { what: cells[1], date: parseDate(cells[2]), lat: Number(ll[1]) * (ll[2] === 'S' ? -1 : 1), lon: Number(ll[3]) * (ll[4] === 'W' ? -1 : 1) });
}

// ---- 3. Assemble -------------------------------------------------------------------------------
const tryCatalog = process.argv.includes('--catalog');
const slug = (s) => s.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const out = [];
let fromCatalog = 0;
for (const e of entries) {
  const prog = PROGRAMMES.find((p) => p[0].test(e.name));
  if (!prog) { console.log(`  no programme rule for ${e.name}: skipped`); continue; }
  const k = e.kind.toLowerCase();
  const category = k.includes('crewed') ? 'crewed' : k.includes('sample') ? 'sample-return' : k.includes('rover') || k.includes('lander') ? 'lander'
    : k.includes('impact') && !k.includes('orbiter') ? 'impact' : k.includes('orbiter') || k.includes('relay') || k.includes('orbit') ? 'orbiter' : 'flyby';
  const m = {
    id: slug(e.name), name: e.name, nation: e.nation, launchDate: e.launchDate, launchUtc: LAUNCH_UTC[e.name] ?? null,
    kind: e.kind, category, attempted: /attempted|aborted/i.test(e.kind),
    vehicle: prog[1], vehicleClass: prog[2], launchSite: SITES[prog[3]], vehicleSource: 'compiled',
    transferDays: prog[4], nssdcaId: e.nssdcaId,
  };
  // NASA's own vehicle and site, when the Master Catalog page is available.
  if (e.nssdcaId) {
    let html = null;
    try {
      html = cached(`${e.nssdcaId}.html`, PAGE(e.nssdcaId), { fetchIfMissing: tryCatalog });
      if (tryCatalog && !existsSync(join(cache, `${e.nssdcaId}.html`))) await new Promise((r) => setTimeout(r, 2500));
    } catch { /* leave the compiled values */ }
    const fact = (label) => { const f = html && new RegExp(`<strong>${label}:</strong>\\s*(.*?)<br`, 'i').exec(html); return f ? strip(f[1]) : null; };
    const vehicle = fact('Launch Vehicle');
    if (vehicle) { m.vehicleNasa = vehicle; m.launchSiteNasa = fact('Launch Site'); m.vehicleSource = 'nssdca'; fromCatalog++; }
  }
  // Where it ended up on the Moon, for missions whose goal was the surface.
  const row = rows.get(SURFACE_ALIAS[e.name] ?? e.name);
  if (row && ['crewed', 'lander', 'sample-return', 'impact'].includes(category) && e.name !== 'Apollo 13') {
    m.surface = { what: row.what, date: row.date, lat: row.lat, lon: row.lon > 180 ? row.lon - 360 : row.lon };
  }
  if (SITE_LINK[e.name]) m.siteId = SITE_LINK[e.name];
  if (HORIZONS[e.name]) m.horizonsId = HORIZONS[e.name];
  if (NOTES[e.name]) m.note = NOTES[e.name];
  if (e.name === 'Apollo 13') m.category = 'flyby';
  out.push(m);
}

writeFileSync(join(root, 'src', 'data', 'missions.json'), JSON.stringify({
  source: { timeline: TIMELINE, surface: SURFACE, catalog: 'https://nssdc.gsfc.nasa.gov/nmc/' },
  note: 'Mission list, launch dates and mission types: NASA NSSDCA Lunar Exploration Timeline. Landing and impact coordinates: NASA NSSDCA. Launch vehicle, launch pad coordinates and launch time of day: compiled (vehicleSource says which records NASA\'s Master Catalog confirmed).',
  missions: out,
}, null, 1));
const by = (f) => Object.entries(out.reduce((a, m) => ((a[f(m)] = (a[f(m)] ?? 0) + 1), a), {})).map(([k2, v]) => `${k2} ${v}`).join(', ');
console.log(`missions: ${out.length} -> src/data/missions.json`);
console.log(`  categories: ${by((m) => m.category)}`);
console.log(`  with surface coordinates: ${out.filter((m) => m.surface).length}; linked to a site in the app: ${out.filter((m) => m.siteId).length}; with a JPL Horizons trajectory: ${out.filter((m) => m.horizonsId).length}`);
console.log(`  vehicle/site confirmed by NASA Master Catalog pages: ${fromCatalog} of ${out.length}`);
