// Fetches independent reference values from the JPL Horizons API (https://ssd.jpl.nasa.gov/horizons/)
// and stores them as a test fixture. For each lunar surface site it asks Horizons for the apparent
// azimuth, elevation and range of the Sun and Earth as seen from that site (airless model).
// tests/horizons.test.ts then compares CELESTE's own calculation with these numbers.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Height 0 km on the 1737.4 km sphere so the comparison isolates ephemeris + frame accuracy.
const SITES = [
  { id: 'connecting-ridge', lat: -89.4632, lon: 222.51 },
  { id: 'malapert', lat: -85.9948, lon: 359.764 },
  { id: 'im2-mons-mouton', lat: -84.7906, lon: 29.1957 },
  { id: 'apollo-11', lat: 0.67416, lon: 23.47314 },
  { id: 'change-4-farside', lat: -45.4446, lon: 177.5991 },
  { id: 'north-mid', lat: 61.0, lon: 300.0 },
];
const TARGETS = [
  { id: 'sun', command: '10' },
  { id: 'earth', command: '399' },
];
const START = '2026-01-01 00:00';
const STOP = '2027-06-30 00:00';
const STEP = '97h'; // deliberately not a multiple of a day so local times vary

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

async function query(site, target) {
  const params = {
    format: 'text',
    COMMAND: `'${target.command}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'coord@301'",
    COORD_TYPE: "'GEODETIC'",
    SITE_COORD: `'${site.lon},${site.lat},0'`,
    START_TIME: `'${START}'`,
    STOP_TIME: `'${STOP}'`,
    STEP_SIZE: `'${STEP}'`,
    QUANTITIES: "'4,20'",
    CSV_FORMAT: "'YES'",
    ANG_FORMAT: "'DEG'",
    APPARENT: "'AIRLESS'",
    RANGE_UNITS: "'KM'",
  };
  const url = 'https://ssd.jpl.nasa.gov/api/horizons.api?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const res = await fetch(url);
  const text = await res.text();
  const a = text.indexOf('$$SOE'), b = text.indexOf('$$EOE');
  if (a < 0 || b < 0) throw new Error(`Horizons returned no ephemeris for ${site.id}/${target.id}:\n${text.slice(0, 1500)}`);
  const rows = [];
  for (const line of text.slice(a + 5, b).trim().split('\n')) {
    const c = line.split(',').map((s) => s.trim());
    const m = /^(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})/.exec(c[0]);
    if (!m) throw new Error('Unparsed row: ' + line);
    const utcMs = Date.UTC(+m[1], MONTHS[m[2]], +m[3], +m[4], +m[5]);
    const nums = c.slice(1).filter((s) => s !== '' && !Number.isNaN(Number(s))).map(Number);
    rows.push({ utcMs, az: nums[0], el: nums[1], rangeKm: nums[2] });
  }
  const header = text.slice(0, a);
  return { rows, header };
}

const out = { source: 'JPL Horizons API, ssd.jpl.nasa.gov/api/horizons.api', retrievedUtc: new Date().toISOString(), start: START, stop: STOP, step: STEP, cases: [] };
let shown = false;
for (const site of SITES) {
  for (const target of TARGETS) {
    const { rows, header } = await query(site, target);
    if (!shown) {
      console.log(header.split('\n').filter((l) => /Center|frame|Azimuth|Elevation|RA format|Target body|Center-site|geodetic|radii/i.test(l)).join('\n'));
      shown = true;
    }
    out.cases.push({ site: site.id, lat: site.lat, lon: site.lon, target: target.id, rows });
    console.log(`${site.id.padEnd(18)} ${target.id.padEnd(6)} ${rows.length} rows`);
  }
}
mkdirSync(join(root, 'tests', 'fixtures'), { recursive: true });
writeFileSync(join(root, 'tests', 'fixtures', 'horizons.json'), JSON.stringify(out));
console.log('wrote tests/fixtures/horizons.json');
