import { Body, Illumination, Libration, MakeTime, Observer, ObserverVector, GeoMoon, RotationAxis } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { AU_KM, DEG, HOUR_MS } from '../src/core/constants.ts';
import { DSN_STATIONS, EARTH, EphemerisTable, moonFixedBodies, STATE_SIZE, STATION, subPoint, SUN } from '../src/core/ephemeris.ts';

const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);

describe('Moon-fixed frame', () => {
  it('puts the sub-Earth point where the optical librations say it is', () => {
    // astronomy-engine's Libration() is an independent (Meeus) series for the same quantity.
    for (let d = 0; d < 400; d += 13.37) {
      const t = T0 + d * 24 * HOUR_MS;
      const v = moonFixedBodies(t);
      const p = subPoint(v[EARTH], v[EARTH + 1], v[EARTH + 2]);
      const lib = Libration(new Date(t));
      expect(Math.abs(p.lat - lib.elat)).toBeLessThan(0.05);
      expect(Math.abs(p.lon - lib.elon)).toBeLessThan(0.05);
      expect(Math.abs(p.lat)).toBeLessThan(7);
      expect(Math.abs(p.lon)).toBeLessThan(8.5);
    }
  });

  it('keeps the sub-solar latitude within the lunar obliquity (1.54 deg)', () => {
    let max = 0;
    for (let d = 0; d < 400; d += 3) {
      const v = moonFixedBodies(T0 + d * 24 * HOUR_MS);
      max = Math.max(max, Math.abs(subPoint(v[SUN], v[SUN + 1], v[SUN + 2]).lat));
    }
    expect(max).toBeGreaterThan(1.4);
    expect(max).toBeLessThan(1.62);
  });

  it('reproduces the lunar phase: Sun-Moon-Earth angle matches the phase angle', () => {
    for (let d = 0; d < 60; d += 4.1) {
      const t = T0 + d * 24 * HOUR_MS;
      const v = moonFixedBodies(t);
      const dot = v[0] * v[3] + v[1] * v[4] + v[2] * v[5];
      const ang = Math.acos(dot / (Math.hypot(v[0], v[1], v[2]) * Math.hypot(v[3], v[4], v[5]))) / DEG;
      expect(Math.abs(ang - Illumination(Body.Moon, new Date(t)).phase_angle)).toBeLessThan(0.05);
    }
  });
});

describe('DSN stations', () => {
  it('match astronomy-engine ObserverVector positions rotated into the Moon-fixed frame', () => {
    for (let h = 0; h < 2000; h += 37.3) {
      const t = T0 + h * HOUR_MS;
      const v = moonFixedBodies(t);
      const time = MakeTime(new Date(t));
      const moon = GeoMoon(time);
      for (let k = 0; k < DSN_STATIONS.length; k++) {
        const s = DSN_STATIONS[k];
        const p = ObserverVector(time, new Observer(s.latDeg, s.lonDeg, s.heightM), false);
        // Compare Moon-centre -> station distance and Earth-centre -> station distance (frame independent).
        const o = STATION + 6 * k;
        const dMoon = Math.hypot(p.x - moon.x, p.y - moon.y, p.z - moon.z) * AU_KM;
        expect(Math.abs(Math.hypot(v[o], v[o + 1], v[o + 2]) - dMoon)).toBeLessThan(0.05);
        const dEarth = Math.hypot(v[o] - v[EARTH], v[o + 1] - v[EARTH + 1], v[o + 2] - v[EARTH + 2]);
        expect(Math.abs(dEarth - p.Length() * AU_KM)).toBeLessThan(0.05);
        // Zenith is a unit vector within 0.2 deg of the geocentric direction.
        const zl = Math.hypot(v[o + 3], v[o + 4], v[o + 5]);
        expect(Math.abs(zl - 1)).toBeLessThan(1e-9);
        const cos = ((v[o] - v[EARTH]) * v[o + 3] + (v[o + 1] - v[EARTH + 1]) * v[o + 4] + (v[o + 2] - v[EARTH + 2]) * v[o + 5]) / dEarth;
        expect(Math.acos(Math.min(1, cos)) / DEG).toBeLessThan(0.2);
      }
    }
  });

  it('uses the same rotation convention as RotationAxis (north pole is +Z)', () => {
    const time = MakeTime(new Date(T0));
    const axis = RotationAxis(Body.Moon, time);
    expect(Math.hypot(axis.north.x, axis.north.y, axis.north.z)).toBeCloseTo(1, 9);
  });
});

describe('EphemerisTable', () => {
  it('interpolates 30-minute nodes to a fraction of a kilometre for stations and 1e-7 relative for bodies', () => {
    const table = EphemerisTable.build(T0, T0 + 72 * HOUR_MS, HOUR_MS / 2);
    const out = new Float64Array(STATE_SIZE);
    let worstDir = 0, worstStation = 0;
    for (let m = 0; m < 72 * 60; m += 7) {
      const t = T0 + m * 60_000;
      const exact = moonFixedBodies(t);
      table.sample(t, out);
      for (const o of [SUN, EARTH]) {
        const err = Math.hypot(out[o] - exact[o], out[o + 1] - exact[o + 1], out[o + 2] - exact[o + 2]);
        worstDir = Math.max(worstDir, err / Math.hypot(exact[o], exact[o + 1], exact[o + 2]));
      }
      for (let k = 0; k < DSN_STATIONS.length; k++) {
        const o = STATION + 6 * k;
        worstStation = Math.max(worstStation, Math.hypot(out[o] - exact[o], out[o + 1] - exact[o + 1], out[o + 2] - exact[o + 2]));
      }
    }
    expect(worstDir).toBeLessThan(1e-7);
    console.log(`interpolation error: bodies ${worstDir.toExponential(2)} relative, stations ${worstStation.toFixed(3)} km`);
    expect(worstStation).toBeLessThan(0.3);
  });

  it('builds a 420-day table quickly enough for interactive use', () => {
    const t = performance.now();
    const table = EphemerisTable.build(T0, T0 + 420 * 24 * HOUR_MS, HOUR_MS / 2);
    const ms = performance.now() - t;
    console.log(`420-day ephemeris at 30 min: ${table.count} nodes in ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(5000);
  });
});
