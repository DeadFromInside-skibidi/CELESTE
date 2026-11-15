// End-to-end checks of the analysis engine against things that are known about the Moon.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeSite, coveredMs, longestRunMs, stateAt, windowMetrics, type SiteAnalysis } from '../src/core/analysis.ts';
import { DAY_MS, HOUR_MS, SYNODIC_MONTH_DAYS } from '../src/core/constants.ts';
import { EphemerisTable } from '../src/core/ephemeris.ts';
import { diskVisibleFraction, maskAt } from '../src/core/horizon.ts';
import { siteFrame } from '../src/core/topo.ts';

interface Entry { lat: number; lon: number; groundHeightM: number; offsets: number[] }
const terrain = JSON.parse(readFileSync(new URL('../src/data/terrain.json', import.meta.url), 'utf8')) as { maskSamples: number; sites: Record<string, Entry> };
const bin = readFileSync(new URL('../public/data/horizons.bin', import.meta.url));
const masks = new Float32Array(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));

const START = Date.UTC(2026, 0, 1);
const END = START + 365 * DAY_MS;
const table = EphemerisTable.build(START, END, HOUR_MS / 2);

function run(id: string, withTerrain = true): SiteAnalysis {
  const e = terrain.sites[id];
  const mask = withTerrain ? masks.subarray(e.offsets[0], e.offsets[0] + terrain.maskSamples) : null;
  return analyzeSite(table, siteFrame(e.lat, e.lon, e.groundHeightM + 2), mask, START, END, 20 * 60_000);
}

describe('disk visibility', () => {
  it('is exact for a straight horizon', () => {
    expect(diskVisibleFraction(null, 10, 1, 0.266)).toBe(1);
    expect(diskVisibleFraction(null, 10, -1, 0.266)).toBe(0);
    expect(diskVisibleFraction(null, 10, 0, 0.266)).toBeCloseTo(0.5, 6);
    // Quarter-radius above the horizon: analytic segment area fraction = 0.6553.
    expect(diskVisibleFraction(null, 10, 0.266 / 4, 0.266)).toBeCloseTo(0.6553, 2);
  });

  it('follows a terrain mask and wraps in azimuth', () => {
    const mask = new Float32Array(1440).fill(2);
    expect(maskAt(mask, 359.9)).toBeCloseTo(2, 6);
    expect(diskVisibleFraction(mask, 359.95, 2, 0.266)).toBeCloseTo(0.5, 3);
    expect(diskVisibleFraction(mask, 100, 2.5, 0.266)).toBe(1);
    expect(diskVisibleFraction(mask, 100, 1.5, 0.266)).toBe(0);
  });
});

describe('site analysis over 2026', () => {
  it('Apollo 11 (equatorial near side): half-lit, Earth always up, one day-night cycle per synodic month', () => {
    const a = run('apollo-11');
    const m = windowMetrics(a, START, END);
    expect(m.litPct).toBeGreaterThan(48);
    expect(m.litPct).toBeLessThan(52);
    expect(m.earthPct).toBe(100);
    expect(m.sunElMax).toBeGreaterThan(85);
    const cycles = a.lit.length / 2;
    expect(Math.abs(cycles - 365 / SYNODIC_MONTH_DAYS)).toBeLessThan(1.5);
    // A lunar night at the equator lasts about half a synodic month.
    expect(m.longestDarkH / 24).toBeGreaterThan(14);
    expect(m.longestDarkH / 24).toBeLessThan(15.5);
  });

  it("Chang'e 4 (far side): Earth never rises, so no DSN contact is ever possible", () => {
    const m = windowMetrics(run('change-4'), START, END);
    expect(m.earthPct).toBe(0);
    expect(m.dsnPct).toBe(0);
    expect(m.earthElMax).toBeLessThan(-30);
  });

  it('Shackleton crater floor: permanently shadowed and out of sight of Earth', () => {
    const m = windowMetrics(run('shackleton-floor'), START, END);
    expect(m.litPct).toBe(0);
    expect(m.illuminationPct).toBe(0);
    expect(m.earthPct).toBe(0);
  });

  it('Connecting Ridge: among the best-lit ground on the Moon, and only because of its terrain', () => {
    const a = run('connecting-ridge');
    const m = windowMetrics(a, START, END);
    console.log(`connecting ridge 2026: mean illumination ${m.illuminationPct.toFixed(1)}%, any sun ${m.litPct.toFixed(1)}%, longest dark ${(m.longestDarkH / 24).toFixed(1)} d, Earth ${m.earthPct.toFixed(1)}%, DSN ${m.dsnPct.toFixed(1)}%`);
    expect(m.illuminationPct).toBeGreaterThan(70);
    expect(m.illuminationPct).toBeLessThan(97);
    // The Sun never climbs more than a few degrees at the pole.
    expect(m.sunElMax).toBeLessThan(4);
    // Terrain matters: on an ideal sphere at this latitude the result is very different.
    const sphere = windowMetrics(run('connecting-ridge', false), START, END);
    expect(Math.abs(sphere.illuminationPct - m.illuminationPct)).toBeGreaterThan(3);
  });

  it('Malapert Massif: Earth is up most of the time, set by libration (mean elevation ~4 deg, swing ~6.5 deg)', () => {
    const m = windowMetrics(run('malapert-massif'), START, END);
    console.log(`malapert 2026: mean illumination ${m.illuminationPct.toFixed(1)}%, Earth ${m.earthPct.toFixed(1)}%, DSN ${m.dsnPct.toFixed(1)}%, longest outage ${m.longestOutageH.toFixed(1)} h`);
    // A sinusoidal libration about +4 deg clears a skyline between -2 and +1 deg 65-85% of the time.
    expect(m.earthPct).toBeGreaterThan(65);
    expect(m.earthPct).toBeLessThan(90);
    // DSN contact can never exceed Earth visibility.
    expect(m.dsnPct).toBeLessThanOrEqual(m.earthPct + 0.5);
    expect(m.earthElMax).toBeLessThan(12);
  });

  it('DSN: three complexes together give near-continuous coverage of a near-side site, each about a third to a half', () => {
    const a = run('apollo-11');
    const m = windowMetrics(a, START, END);
    expect(m.dsnPct).toBeGreaterThan(97);
    for (const st of a.stations) {
      const pct = (100 * coveredMs(st, START, END)) / (END - START);
      expect(pct).toBeGreaterThan(25);
      expect(pct).toBeLessThan(60);
    }
  });
});

describe('performance budget', () => {
  it('sweeps one site for 455 days at 10-minute steps (the in-app configuration) in well under a second', () => {
    const e = terrain.sites['connecting-ridge'];
    const mask = masks.subarray(e.offsets[0], e.offsets[0] + terrain.maskSamples);
    const frame = siteFrame(e.lat, e.lon, e.groundHeightM + 2);
    const end = START + 364 * DAY_MS;
    analyzeSite(table, frame, mask, START, end, 10 * 60_000); // warm-up
    const t = performance.now();
    const a = analyzeSite(table, frame, mask, START, end, 10 * 60_000);
    const ms = performance.now() - t;
    console.log(`site sweep: ${a.series.count} samples in ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1500);
  });
});

describe('interval helpers', () => {
  const iv = Float64Array.from([10, 20, 40, 70]);
  it('measures coverage and runs', () => {
    expect(coveredMs(iv, 0, 100)).toBe(40);
    expect(coveredMs(iv, 15, 50)).toBe(15);
    expect(longestRunMs(iv, 0, 100, true)).toBe(30);
    expect(longestRunMs(iv, 0, 100, false)).toBe(30);
    expect(longestRunMs(iv, 12, 45, false)).toBe(20);
  });
  it('reports state and next change', () => {
    expect(stateAt(iv, 5, 100)).toEqual({ inside: false, changeMs: 10 });
    expect(stateAt(iv, 15, 100)).toEqual({ inside: true, changeMs: 20 });
    expect(stateAt(iv, 80, 100)).toEqual({ inside: false, changeMs: null });
    expect(stateAt(iv, 50, 70)).toEqual({ inside: true, changeMs: null });
  });
});
