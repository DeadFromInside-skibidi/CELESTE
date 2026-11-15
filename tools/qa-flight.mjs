// Visual check of the flight view: drives the running dev server in headless Chrome and captures
// every scale, projection and camera, and each phase of a flight in the cinematic view. Fails on
// console errors. Needs the dev server (it reaches the app's store through Vite's module URLs):
//   npm run dev
//   node tools/qa-flight.mjs [baseUrl] [outDir] [comma-separated groups] [mission ids for "phases"]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'qa-shots';
const only = process.argv[4] ? process.argv[4].split(',') : null;
const phaseMissions = (process.argv[5] ?? 'apollo-11').split(',');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-swiftshader'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(`${base}#view=focus`, { waitUntil: 'networkidle' });
await page.waitForSelector('.app', { timeout: 30000 });

const want = (name) => !only || only.includes(name);
const shot = async (name) => { await page.screenshot({ path: join(out, `${name}.png`) }); console.log('shot', name); };
/** Runs `fn(store module, flight module, missions module, arg)` inside the app. */
const app = (fn, arg) => page.evaluate(async ([src, a]) => {
  const [store, flight, missions] = await Promise.all([import('/src/state/store.ts'), import('/src/core/flight.ts'), import('/src/core/missions.ts')]);
  return new Function('store', 'flight', 'missions', 'arg', `return (${src})(store, flight, missions, arg)`)(store, flight, missions, a);
}, [fn.toString(), arg]);
const state = (patch) => app((store, _f, _m, p) => store.useStore.setState(p), patch);
const settle = (ms = 2500) => page.waitForTimeout(ms);
/** Selects a mission and returns its phases once the flight has loaded. */
async function open(id) {
  const phases = await app(async (store, _f, missions, mid) => {
    const m = missions.missionById(mid);
    store.useStore.setState({ playing: false });
    store.selectMission(mid);
    const f = await missions.loadFlightForMission(m);
    store.setTime(f.launchMs);
    return f.phases.map((p) => ({ id: p.id, label: p.label, startMs: p.startMs, endMs: p.endMs }));
  }, id);
  await settle(3500);
  return phases;
}
const at = (ms) => app((store, _f, _m, t) => store.setTime(t), ms);

if (want('views')) {
  const phases = await open('apollo-11');
  const coast = phases.find((p) => p.id === 'transfer');
  await at(coast.startMs + (coast.endMs - coast.startMs) * 0.55);
  await state({ flightScale: 'earth-moon', flight2d: false, flightCam: 'overview' });
  await settle();
  await shot('f01-earth-moon-3d');
  await state({ flight2d: true });
  await settle();
  await shot('f02-earth-moon-2d');
  await state({ flightScale: 'solar', flight2d: false });
  await settle();
  await shot('f03-sun-earth-moon-3d');
  await state({ flight2d: true });
  await settle();
  await shot('f04-sun-earth-moon-2d');
  await state({ flightScale: 'earth-moon', flight2d: false, flightCam: 'earth' });
  await settle();
  await shot('f05-cam-earth');
  await state({ flightCam: 'moon' });
  await settle();
  await shot('f06-cam-moon');
  await state({ flightCam: 'chase' });
  await settle();
  await shot('f07-cam-chase');
}

if (want('phases')) {
  for (const id of phaseMissions) {
    const phases = await open(id);
    await state({ flightScale: 'earth-moon', flight2d: false, flightCam: 'cinematic' });
    for (const ph of phases) {
      // Early, middle and late in the short phases; the middle of the long ones.
      const marks = ['ascent', 'descent'].includes(ph.id) ? [0.03, 0.2, 0.5, 0.97] : ph.id === 'pad' ? [0.5] : ph.id === 'surface' ? [0.01] : [0.5];
      for (const k of marks) {
        await at(ph.startMs + (ph.endMs - ph.startMs) * k);
        await settle(2200);
        await shot(`p-${id}-${String(phases.indexOf(ph)).padStart(2, '0')}-${ph.id}-${Math.round(k * 100)}`);
      }
    }
  }
}

if (want('ui')) {
  await open('apollo-11');
  await state({ flightScale: 'earth-moon', flight2d: false, flightCam: 'overview' });
  await page.locator('.mission-key').click();
  await settle(800);
  await shot('u01-mission-directory');
  await page.keyboard.press('Escape');
}

await browser.close();
if (errors.length) {
  console.log(`\n${errors.length} console problem(s):`);
  for (const e of [...new Set(errors)].slice(0, 30)) console.log('  ' + e);
  process.exit(1);
}
console.log('\nno console errors');
