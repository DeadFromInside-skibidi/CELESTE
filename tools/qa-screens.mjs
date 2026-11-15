// Visual smoke test: drives the running app in headless Chrome, captures screenshots of every
// layout mode and major state, and fails on console errors. Usage:
//   npm run dev            (in another terminal)
//   node tools/qa-screens.mjs [baseUrl] [outDir] [comma-separated groups]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'qa-shots';
const only = process.argv[4]?.split(',');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-swiftshader'],
});
const errors = [];
async function open(width, height, hash = '') {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(base + hash, { waitUntil: 'networkidle' });
  await page.waitForSelector('.app', { timeout: 30000 });
  await page.waitForTimeout(3500);
  return page;
}
const want = (name) => !only || only.includes(name);
const shot = async (page, name) => { await page.screenshot({ path: join(out, `${name}.png`) }); console.log('shot', name); };

const AT = 'site=connecting-ridge&pin=malapert-massif,haworth&t=2026-11-14T12:00Z&days=14';
const url = (view, rest = AT) => `#${rest}&view=${view}`;

if (want('modes')) {
  for (const [view, name] of [['explore', '01-explore'], ['focus', '02-focus'], ['control', '03-control']]) {
    const page = await open(1600, 900, url(view));
    await shot(page, name);
    await page.close();
  }
}
if (want('tabs')) {
  const page = await open(1600, 900, url('control'));
  for (const [tab, name] of [['Compare sites', '04-compare'], ['Event reports', '05-events'], ['Date finder', '06-finder']]) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(500);
    await shot(page, name);
  }
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await page.getByRole('button', { name: '1 yr' }).click();
  await page.waitForTimeout(500);
  await shot(page, '07-timeline-year');
  await page.close();
}
if (want('pole')) {
  const page = await open(1600, 900, url('focus'));
  await page.getByRole('button', { name: 'Polar terrain' }).click();
  await page.waitForFunction(() => !document.querySelector('.viewport-msg'), null, { timeout: 120000 });
  await page.waitForTimeout(6000);
  await shot(page, '08-pole');
  await page.getByRole('button', { name: '2D map' }).click();
  await page.waitForTimeout(2500);
  await shot(page, '09-pole-map');
  await page.getByRole('button', { name: 'View options' }).click();
  await page.getByRole('switch', { name: 'Mission light map' }).click();
  await page.waitForTimeout(9000);
  await shot(page, '10-pole-mission-light');
  await page.close();
}
if (want('pole')) {
  // Regression: entering the polar view with a site that is not on the polar map must show
  // the whole cap, not empty space off the edge of the map.
  const page = await open(1600, 900, '#site=apollo-11&pin=&t=2026-11-14T12:00Z&days=14&view=focus');
  await page.getByRole('button', { name: 'Polar terrain' }).click();
  await page.waitForFunction(() => !document.querySelector('.viewport-msg:not(.subtle)'), null, { timeout: 120000 });
  await page.waitForTimeout(5000);
  await shot(page, '10b-pole-with-nonpolar-site');
  await page.getByRole('button', { name: '2D map' }).click();
  await page.waitForTimeout(2500);
  await shot(page, '10c-map-with-nonpolar-site');
  await page.close();
}
if (want('sites')) {
  for (const [id, name] of [['apollo-17', '11-apollo17'], ['shackleton-floor', '12-shackleton-floor'], ['change-4', '13-change4']]) {
    const page = await open(1600, 900, `#site=${id}&pin=&t=2026-11-14T12:00Z&days=14&view=explore`);
    await shot(page, name);
    await page.close();
  }
}
if (want('small')) {
  const page = await open(1366, 768, url('control'));
  await shot(page, '14-laptop-1366');
  await page.close();
  const m = await open(430, 900, url('explore'));
  await m.screenshot({ path: join(out, '15-phone.png'), fullPage: true });
  console.log('shot 15-phone');
  await m.close();
}
if (want('about')) {
  const page = await open(1600, 900, url('explore'));
  await page.getByRole('button', { name: /Methods/ }).click();
  await page.waitForTimeout(400);
  await shot(page, '16-about');
  await page.close();
}

await browser.close();
if (errors.length) {
  console.log(`\n${errors.length} console problem(s):`);
  for (const e of [...new Set(errors)].slice(0, 30)) console.log('  ' + e);
  process.exit(1);
}
console.log('\nno console errors');
