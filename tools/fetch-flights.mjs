// Fetches flown trajectories from the JPL Horizons API for the lunar spacecraft it carries, as
// Earth-centred positions in the ecliptic J2000 frame, and writes them to public/data/flights.
// These are the navigation solutions JPL publishes, not a reconstruction.
//   node tools/fetch-flights.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'data', 'flights');
mkdirSync(outDir, { recursive: true });
const { missions } = JSON.parse(readFileSync(join(root, 'src', 'data', 'missions.json'), 'utf8'));

/** How long after launch to follow each spacecraft (days) and how often to sample (minutes). */
const WINDOW = { slim: [137, 15], 'artemis-1': [25.6, 5], 'korea-pathfinder-lunar-orbiter-danuri': [139, 15], 'lunar-reconnaissance-orbiter': [9, 5], capstone: [142, 20], 'lunar-prospector': [8, 5], clementine: [32, 10], 'lunar-atmosphere-and-dust-environment-explorer-ladee': [34, 10] };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const cal = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${MONTHS[d.getUTCMonth()]}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
/** TDB - UTC in seconds (32.184 s + leap seconds in force). */
const tdbMinusUtc = (ms) => 32.184 + (ms < Date.UTC(1994, 6, 1) ? 28 : ms < Date.UTC(1996, 0, 1) ? 29 : ms < Date.UTC(1997, 6, 1) ? 30 : ms < Date.UTC(1999, 0, 1) ? 31 : ms < Date.UTC(2006, 0, 1) ? 32 : ms < Date.UTC(2009, 0, 1) ? 33 : ms < Date.UTC(2012, 6, 1) ? 34 : ms < Date.UTC(2015, 6, 1) ? 35 : ms < Date.UTC(2017, 0, 1) ? 36 : 37);

async function query(id, startMs, stopMs, stepMin) {
  const params = {
    format: 'text', COMMAND: `'${id}'`, OBJ_DATA: "'NO'", MAKE_EPHEM: "'YES'", EPHEM_TYPE: "'VECTORS'", CENTER: "'500@399'",
    REF_PLANE: "'ECLIPTIC'", REF_SYSTEM: "'ICRF'", VEC_TABLE: "'1'", OUT_UNITS: "'KM-S'", CSV_FORMAT: "'YES'", VEC_LABELS: "'NO'",
    START_TIME: `'${cal(startMs)}'`, STOP_TIME: `'${cal(stopMs)}'`, STEP_SIZE: `'${stepMin}m'`,
  };
  const res = await fetch('https://ssd.jpl.nasa.gov/api/horizons.api?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'));
  return res.text();
}
/** "... prior to A.D. 2023-SEP-06 23:47:08.1826 TDB" -> ms */
function limitIn(text, word) {
  const m = new RegExp(`${word} A\\.D\\. (\\d{4})-([A-Za-z]{3})-(\\d{2}) (\\d{2}):(\\d{2})`, 'i').exec(text);
  if (!m) return null;
  return Date.UTC(+m[1], MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase()), +m[3], +m[4], +m[5]);
}

for (const m of missions.filter((x) => x.horizonsId && WINDOW[x.id])) {
  const [days, stepMin] = WINDOW[m.id];
  let start = Date.parse(m.launchUtc ?? `${m.launchDate}T00:00:00Z`), stop = start + days * 86400e3;
  let text = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    text = await query(m.horizonsId, start, stop, stepMin);
    if (text.includes('$$SOE')) break;
    const lo = limitIn(text, 'prior to'), hi = limitIn(text, 'after');
    if (lo) start = lo + 3 * 60e3;
    else if (hi) stop = hi - 3 * 60e3;
    else break;
  }
  const a = text.indexOf('$$SOE'), b = text.indexOf('$$EOE');
  if (a < 0) { console.log(`${m.name}: no data\n${text.slice(0, 600)}`); continue; }
  const xyz = [];
  let t0 = NaN, n = 0;
  for (const line of text.slice(a + 5, b).trim().split('\n')) {
    const c = line.split(',').map((s) => s.trim());
    const jd = Number(c[0]);
    if (!Number.isFinite(jd)) continue;
    if (n === 0) { const tdbMs = (jd - 2440587.5) * 86400e3; t0 = Math.round(tdbMs - tdbMinusUtc(tdbMs) * 1000); }
    xyz.push(Math.round(Number(c[2])), Math.round(Number(c[3])), Math.round(Number(c[4])));
    n++;
  }
  const target = /Target body name:\s*(.*?)\s*\{/.exec(text)?.[1] ?? m.name;
  writeFileSync(join(outDir, `${m.id}.json`), JSON.stringify({
    mission: m.id, source: `JPL Horizons, target "${target}" (${m.horizonsId})`, retrievedUtc: new Date().toISOString(),
    frame: 'Earth-centred, ecliptic and mean equinox of J2000, km', t0Ms: t0, stepMs: stepMin * 60e3, count: n, xyzKm: xyz,
  }));
  const last = xyz.slice(-3), r = Math.hypot(...last);
  console.log(`${m.name.padEnd(52)} ${String(n).padStart(6)} points from ${new Date(t0).toISOString().slice(0, 16)}Z, every ${stepMin} min; last point ${Math.round(r).toLocaleString()} km from Earth`);
}
