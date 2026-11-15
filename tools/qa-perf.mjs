// Performance probe: loads the app in headless Chrome, measures start-up, analysis latency and
// frame pacing during playback in both 3D views. Usage: node tools/qa-perf.mjs [baseUrl]
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:4173/';
const HASH = '#site=connecting-ridge&pin=malapert-massif,haworth&t=2026-11-14T12:00Z&days=14&view=control';

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const t0 = Date.now();
await page.goto(base + HASH, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.app');
const shellMs = Date.now() - t0;
// All three compared sites analysed = the "Analysing" placeholder in the mission card is gone
// and the comparison table has numbers.
await page.getByRole('tab', { name: 'Compare sites' }).click();
await page.waitForFunction(() => document.querySelectorAll('table.cmp .val.muted').length === 0 && document.querySelectorAll('table.cmp .val').length > 0, null, { timeout: 60000 });
const readyMs = Date.now() - t0;
await page.getByRole('tab', { name: 'Timeline' }).click();

const renderer = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});

async function frames(label, seconds = 5) {
  const r = await page.evaluate((ms) => new Promise((resolve) => {
    const deltas = [];
    let last = performance.now();
    const start = last;
    const tick = (now) => {
      deltas.push(now - last);
      last = now;
      if (now - start < ms) requestAnimationFrame(tick);
      else {
        deltas.shift();
        deltas.sort((a, b) => a - b);
        const sum = deltas.reduce((s, d) => s + d, 0);
        resolve({ fps: (1000 * deltas.length) / sum, p50: deltas[Math.floor(deltas.length * 0.5)], p95: deltas[Math.floor(deltas.length * 0.95)], worst: deltas[deltas.length - 1], n: deltas.length });
      }
    };
    requestAnimationFrame(tick);
  }), seconds * 1000);
  console.log(`${label.padEnd(44)} ${r.fps.toFixed(1).padStart(5)} fps   median ${r.p50.toFixed(1)} ms   p95 ${r.p95.toFixed(1)} ms   worst ${r.worst.toFixed(1)} ms`);
}

console.log(`GPU: ${renderer}`);
console.log(`app shell visible: ${shellMs} ms   ·   three sites analysed for 455 days: ${readyMs} ms`);
await frames('idle (nothing animating)', 3);
await page.getByRole('button', { name: 'Play' }).click();
await frames('playback, globe view, 6 h/s');
await page.getByRole('button', { name: 'Pause' }).click();
await page.getByRole('button', { name: 'Polar terrain' }).click();
await page.waitForFunction(() => !document.querySelector('.viewport-msg'), null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Play' }).click();
await frames('playback, south-pole terrain + live shadows');
await page.getByRole('button', { name: 'Pause' }).click();

// Scrubbing: drag across the timeline.
const box = await page.locator('.timeline canvas').boundingBox();
await page.mouse.move(box.x + 300, box.y + 80);
await page.mouse.down();
const scrub = frames('scrubbing the timeline (terrain view)', 4);
for (let i = 0; i < 160; i++) { await page.mouse.move(box.x + 300 + i * 4, box.y + 80); await page.waitForTimeout(20); }
await page.mouse.up();
await scrub;

// Flight trajectory view & chase cam
await page.getByRole('button', { name: 'Earth-Moon flight' }).click();
await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'Play' }).click();
await frames('playback, Earth-Moon flight view');
await page.getByRole('button', { name: 'Chase Cam' }).click();
await frames('playback, flight chase camera');
await page.getByRole('button', { name: 'Pause' }).click();

// Solar orbit view (Orrery)
await page.getByRole('button', { name: 'Solar orbit' }).click();
await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'Play' }).click();
await frames('playback, solar orbit orrery view');
await page.getByRole('button', { name: 'Pause' }).click();

await browser.close();
if (errors.length) { console.log('errors:', [...new Set(errors)].slice(0, 10)); process.exit(1); }
