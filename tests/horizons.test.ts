// Independent validation: CELESTE's Sun/Earth azimuth, elevation and range for lunar surface
// sites versus the JPL Horizons system (DE441, MEAN_ME lunar frame, airless apparent positions).
// The fixture is produced by `npm run data:horizons`.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EARTH, moonFixedBodies, SUN } from '../src/core/ephemeris.ts';
import { lookAngles, siteFrame } from '../src/core/topo.ts';

interface Row { utcMs: number; az: number; el: number; rangeKm: number }
interface Case { site: string; lat: number; lon: number; target: 'sun' | 'earth'; rows: Row[] }
const fixture = JSON.parse(readFileSync(new URL('./fixtures/horizons.json', import.meta.url), 'utf8')) as { cases: Case[] };

const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe('agreement with JPL Horizons', () => {
  const look = { az: 0, el: 0, range: 0 };
  const summary: Record<string, { el: number; az: number; n: number }> = {};

  for (const c of fixture.cases) {
    it(`${c.target} from ${c.site}`, () => {
      const frame = siteFrame(c.lat, c.lon, 0);
      const o = c.target === 'sun' ? SUN : EARTH;
      let maxEl = 0, maxAz = 0, maxRange = 0;
      for (const row of c.rows) {
        const v = moonFixedBodies(row.utcMs);
        lookAngles(frame, v[o], v[o + 1], v[o + 2], look);
        maxEl = Math.max(maxEl, Math.abs(look.el - row.el));
        // Azimuth error is measured on the sky (scaled by cos el) so it stays meaningful near the zenith.
        maxAz = Math.max(maxAz, angDiff(look.az, row.az) * Math.cos((row.el * Math.PI) / 180));
        maxRange = Math.max(maxRange, Math.abs(look.range - row.rangeKm) / row.rangeKm);
      }
      const s = (summary[c.target] ??= { el: 0, az: 0, n: 0 });
      s.el = Math.max(s.el, maxEl);
      s.az = Math.max(s.az, maxAz);
      s.n += c.rows.length;
      // Acceptance: 0.01 deg, about 1/50 of the solar diameter.
      expect(maxEl).toBeLessThan(0.01);
      expect(maxAz).toBeLessThan(0.01);
      expect(maxRange).toBeLessThan(2e-4);
    });
  }

  it('reports the worst-case error', () => {
    for (const [target, s] of Object.entries(summary)) {
      console.log(`${target}: ${s.n} samples, max |d elevation| = ${s.el.toFixed(4)} deg, max |d azimuth| (on sky) = ${s.az.toFixed(4)} deg`);
    }
    expect(Object.keys(summary).length).toBe(2);
  });
});
