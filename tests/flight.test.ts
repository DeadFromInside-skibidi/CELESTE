// Flight mechanics: frames, conics, and the reconstructed and flown trajectories.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DAY_MS, EARTH_RADIUS_KM, MOON_RADIUS_KM } from '../src/core/constants.ts';
import { moonFixedBodies, subPoint, EARTH } from '../src/core/ephemeris.ts';
import { conicAt, earthAxes, type FlightInput, type FlownTable, flownFlight, moonAxes, moonEcl, phaseAt, reconstructFlight, surfacePoint, timeToRadius } from '../src/core/flight.ts';

interface Mission { id: string; name: string; launchDate: string; launchUtc: string | null; launchSite: { lat: number; lon: number }; category: string; transferDays: number; surface?: { date: string; lat: number; lon: number } }
const { missions } = JSON.parse(readFileSync(new URL('../src/data/missions.json', import.meta.url), 'utf8')) as { missions: Mission[] };
const mission = (id: string) => missions.find((m) => m.id === id)!;
const inputFor = (m: Mission, surfaceUtc?: string): FlightInput => ({
  launchDate: m.launchDate, launchUtc: m.launchUtc, launchLat: m.launchSite.lat, launchLon: m.launchSite.lon, transferDays: m.transferDays,
  end: m.surface ? (m.category === 'impact' ? 'impact' : 'land') : m.category === 'orbiter' ? 'orbit' : 'flyby',
  surfaceMs: m.surface ? Date.parse(surfaceUtc ?? `${m.surface.date}T12:00:00Z`) : undefined, siteLat: m.surface?.lat, siteLon: m.surface?.lon,
});
const dist = (a: Float64Array, b: Float64Array) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('frames', () => {
  it('Moon-fixed axes agree with the site-analysis frame: +X points at the sub-Earth point', () => {
    for (const t of [Date.UTC(1969, 6, 20), Date.UTC(2026, 10, 14, 12)]) {
      const ax = moonAxes(t), m = moonEcl(t);
      // Direction Moon -> Earth, expressed in Moon-fixed axes.
      const e = [-m[0], -m[1], -m[2]];
      const local = [0, 3, 6].map((o) => e[0] * ax[o] + e[1] * ax[o + 1] + e[2] * ax[o + 2]);
      const here = subPoint(local[0], local[1], local[2]);
      const ref = moonFixedBodies(t);
      const there = subPoint(ref[EARTH], ref[EARTH + 1], ref[EARTH + 2]);
      expect(Math.abs(here.lat - there.lat)).toBeLessThan(1e-6);
      expect(Math.abs(here.lon - there.lon)).toBeLessThan(1e-6);
    }
  });

  it('Earth-fixed axes are orthonormal and turn once per sidereal day', () => {
    const t = Date.UTC(2024, 1, 15, 6);
    const a = earthAxes(t), b = earthAxes(t + 86164090.5);
    expect(Math.hypot(a[0], a[1], a[2])).toBeCloseTo(1, 9);
    expect(a[0] * a[3] + a[1] * a[4] + a[2] * a[5]).toBeCloseTo(0, 9);
    expect(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]).toBeGreaterThan(0.999999);
  });
});

describe('two-body conics', () => {
  it('time to radius and position at time are inverses, elliptic and hyperbolic', () => {
    for (const e of [0.2, 0.9667, 0.99, 1.3, 2.5]) {
      for (const r of [9000, 60000, 384400]) {
        if (e < 1 && r > (6563 * (1 + e)) / (1 - e)) continue;
        const dt = timeToRadius(6563, e, r);
        expect(Math.abs(conicAt(6563, e, dt).r - r) / r).toBeLessThan(1e-7);
      }
    }
  });

  it('a minimum-energy transfer to the Moon takes about five days', () => {
    const rp = 6563, rm = 384400;
    expect(timeToRadius(rp, (rm - rp) / (rm + rp), rm) / 86400).toBeGreaterThan(4.8);
    expect(timeToRadius(rp, (rm - rp) / (rm + rp), rm) / 86400).toBeLessThan(5.1);
  });
});

describe('reconstructed flight: Apollo 11', () => {
  const m = mission('apollo-11');
  const f = reconstructFlight(inputFor(m, '1969-07-20T20:17:00Z'));
  const p = new Float64Array(3), q = new Float64Array(3);

  it('starts on the pad at Kennedy Space Center at the recorded launch time', () => {
    expect(f.launchTimeEstimated).toBe(false);
    expect(f.launchMs).toBe(Date.parse('1969-07-16T13:32:00Z'));
    f.position(f.launchMs, p);
    surfacePoint(earthAxes(f.launchMs), EARTH_RADIUS_KM, m.launchSite.lat, m.launchSite.lon, q);
    expect(dist(p, q)).toBeLessThan(1e-6);
  });

  it('ends on the Moon at Tranquility Base at the recorded landing time', () => {
    const t = Date.parse('1969-07-20T20:17:00Z');
    f.position(t, p);
    const moon = moonEcl(t);
    surfacePoint(moonAxes(t), MOON_RADIUS_KM, 0.67416, 23.47314, q);
    q[0] += moon[0]; q[1] += moon[1]; q[2] += moon[2];
    expect(dist(p, q)).toBeLessThan(1);
    expect(phaseAt(f, t + 1000).id).toBe('surface');
  });

  it('is continuous: no jump anywhere between pad and surface', () => {
    let worst = 0, at = 0;
    f.position(f.startMs, q);
    for (let t = f.startMs + 2000; t <= f.endMs; t += 2000) {
      f.position(t, p);
      const d = dist(p, q);
      if (d > worst) { worst = d; at = t; }
      q.set(p);
    }
    // 2 s of flight never covers more than ~22 km (11 km/s at translunar injection).
    console.log(`Apollo 11 reconstruction: fastest 2 s step ${worst.toFixed(1)} km at ${new Date(at).toISOString()}; phases ${f.phases.map((ph) => `${ph.label} ${((ph.endMs - ph.startMs) / 3600e3).toFixed(1)} h`).join(', ')}`);
    expect(worst).toBeLessThan(24);
  });

  it('never passes through the Earth or the Moon', () => {
    const moon = new Float64Array(3);
    for (let t = f.launchMs + 30e3; t < Date.parse('1969-07-20T20:17:00Z'); t += 20e3) {
      f.position(t, p);
      expect(Math.hypot(p[0], p[1], p[2])).toBeGreaterThan(EARTH_RADIUS_KM);
      moonEcl(t, moon);
      expect(dist(p, moon)).toBeGreaterThan(MOON_RADIUS_KM - 0.5);
    }
  });

  it('has a drawable path', () => {
    expect(f.path.length / 3).toBeGreaterThan(300);
    expect(f.path.length / 3).toBe(f.pathTimes.length);
  });
});

describe('every catalogued mission reconstructs', () => {
  it('produces a finite, continuous flight that arrives at the Moon', () => {
    const p = new Float64Array(3), moon = new Float64Array(3);
    for (const m of missions) {
      const inp = inputFor(m);
      const f = reconstructFlight(inp);
      expect(f.endMs).toBeGreaterThan(f.launchMs);
      expect(Number.isFinite(f.path[f.path.length - 1])).toBe(true);
      // At the end of the flight a lander is on the surface, an orbiter near the Moon.
      if (inp.end !== 'flyby') {
        f.position(f.endMs, p);
        moonEcl(f.endMs, moon);
        expect(dist(p, moon), m.name).toBeLessThan(MOON_RADIUS_KM + 150);
      }
      expect((f.endMs - f.launchMs) / DAY_MS, m.name).toBeLessThan(600);
    }
  });
});

describe('flown flight: Artemis I from JPL Horizons', () => {
  const table = JSON.parse(readFileSync(new URL('../public/data/flights/artemis-1.json', import.meta.url), 'utf8')) as FlownTable;
  const f = flownFlight(table, inputFor(mission('artemis-1')));
  const p = new Float64Array(3);

  it('reproduces the published samples exactly at sample times', () => {
    for (const i of [1, 500, 3000, table.count - 3]) {
      f.position(table.t0Ms + i * table.stepMs, p);
      expect(Math.abs(p[0] - table.xyzKm[i * 3])).toBeLessThan(1e-6);
      expect(Math.abs(p[2] - table.xyzKm[i * 3 + 2])).toBeLessThan(1e-6);
    }
  });

  it('passes close to the Moon and comes home', () => {
    let closest = Infinity;
    const moon = new Float64Array(3);
    for (let i = 0; i < table.count; i++) {
      const t = table.t0Ms + i * table.stepMs;
      f.position(t, p);
      moonEcl(t, moon);
      closest = Math.min(closest, dist(p, moon) - MOON_RADIUS_KM);
    }
    console.log(`Artemis I closest approach in the Horizons data: ${closest.toFixed(0)} km above the lunar surface`);
    expect(closest).toBeLessThan(400); // the outbound powered fly-by was at about 130 km
    f.position(f.endMs, p);
    expect(Math.hypot(p[0], p[1], p[2])).toBeLessThan(20000);
  });
});
