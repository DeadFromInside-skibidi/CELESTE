// Screenshots of the model contact sheets (tools/hangar.html). Needs the dev server.
//   node tools/qa-hangar.mjs [baseUrl] [outDir]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'qa-shots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const errors = [];
const sheets = [['rockets', -1, 0], ['rockets', 130, 0], ['rockets', 330, 0], ['rockets', 538, 0], ['spacecraft', 0, 0], ['spacecraft', 0, 1], ['surface', 0, 0]];
for (const [set, t, page] of sheets) {
  const p = await browser.newPage({ viewport: { width: 1800, height: 1100 }, deviceScaleFactor: 1 });
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`[${set}] ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`[${set}] ${e.message}`));
  await p.goto(`${base}tools/hangar.html?set=${set}&t=${t}&page=${page}&per=${set === 'rockets' ? 40 : 28}`);
  await p.waitForFunction(() => document.title === 'ready', null, { timeout: 60000 }).catch(() => errors.push(`[${set}] did not finish`));
  await p.waitForTimeout(400);
  const name = `hangar-${set}${set === 'rockets' ? `-t${t}` : `-${page}`}.png`;
  await p.screenshot({ path: join(out, name) });
  console.log('shot', name);
  await p.close();
}
await browser.close();
if (errors.length) { console.log(`${errors.length} problem(s):`); for (const e of [...new Set(errors)].slice(0, 20)) console.log('  ' + e); process.exit(1); }
console.log('no console errors');
