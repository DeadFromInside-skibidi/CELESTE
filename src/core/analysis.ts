// Site analysis: what the Sun, the Earth and the Deep Space Network look like from one point
// on the Moon, at one instant and across a span of time.

import { AU_KM, EARTH_RADIUS_KM, RAD, SOLAR_CONSTANT_W_M2, SUN_RADIUS_KM } from './constants.ts';
import { DSN_STATIONS, EARTH, type BodyVectors, type EphemerisTable, STATE_SIZE, STATION, SUN } from './ephemeris.ts';
import { diskVisibleFraction, type HorizonMask, maskAt } from './horizon.ts';
import { angularRadiusDeg, lookAngles, type SiteFrame } from './topo.ts';

/** Minimum elevation of the Moon above a DSN antenna's horizon for a usable pass (810-005 receive limit). */
export const DSN_ELEVATION_MASK_DEG = 6;
export const STATION_COUNT = DSN_STATIONS.length;

/** Everything CELESTE reports for one site at one instant. Angles in degrees. */
export interface Instant {
  sunAz: number;
  sunEl: number;
  /** Apparent angular radius of the solar disk. */
  sunRadius: number;
  /** Fraction of the solar disk above the terrain skyline, 0..1. */
  sunFrac: number;
  /** Elevation of the Sun's centre above the skyline at its azimuth (negative = centre hidden). */
  sunClear: number;
  /** Direct irradiance on a Sun-facing surface, W/m^2 (distance-scaled, times visible fraction). */
  irradiance: number;
  earthAz: number;
  earthEl: number;
  earthRadius: number;
  earthFrac: number;
  earthClear: number;
  earthRangeKm: number;
  /** Bit k set = geometric two-way line of sight with DSN complex k. */
  stationMask: number;
  /** Elevation of the Moon above each DSN complex's local horizon. */
  stationEl: Float32Array;
}

export function newInstant(): Instant {
  return {
    sunAz: 0, sunEl: 0, sunRadius: 0, sunFrac: 0, sunClear: 0, irradiance: 0,
    earthAz: 0, earthEl: 0, earthRadius: 0, earthFrac: 0, earthClear: 0, earthRangeKm: 0,
    stationMask: 0, stationEl: new Float32Array(STATION_COUNT),
  };
}

const look = { az: 0, el: 0, range: 0 };

/** Evaluates the instantaneous geometry for a site from a Moon-fixed state record. */
export function evaluate(state: BodyVectors, frame: SiteFrame, mask: HorizonMask, out: Instant): Instant {
  lookAngles(frame, state[SUN], state[SUN + 1], state[SUN + 2], look);
  out.sunAz = look.az;
  out.sunEl = look.el;
  out.sunRadius = angularRadiusDeg(SUN_RADIUS_KM, look.range);
  out.sunClear = look.el - maskAt(mask, look.az);
  out.sunFrac = diskVisibleFraction(mask, look.az, look.el, out.sunRadius);
  const au = look.range / AU_KM;
  out.irradiance = (SOLAR_CONSTANT_W_M2 / (au * au)) * out.sunFrac;

  lookAngles(frame, state[EARTH], state[EARTH + 1], state[EARTH + 2], look);
  out.earthAz = look.az;
  out.earthEl = look.el;
  out.earthRangeKm = look.range;
  out.earthRadius = angularRadiusDeg(EARTH_RADIUS_KM, look.range);
  out.earthClear = look.el - maskAt(mask, look.az);
  out.earthFrac = diskVisibleFraction(mask, look.az, look.el, out.earthRadius);

  let bits = 0;
  for (let k = 0; k < STATION_COUNT; k++) {
    const o = STATION + 6 * k;
    const sx = state[o], sy = state[o + 1], sz = state[o + 2];
    // Station side: is the lunar site above the antenna's elevation mask?
    const dx = frame.px - sx, dy = frame.py - sy, dz = frame.pz - sz;
    const range = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const up = (dx * state[o + 3] + dy * state[o + 4] + dz * state[o + 5]) / range;
    const stEl = Math.asin(up > 1 ? 1 : up < -1 ? -1 : up) * RAD;
    out.stationEl[k] = stEl;
    if (stEl < DSN_ELEVATION_MASK_DEG) continue;
    // Lunar side: is the antenna above the terrain skyline as seen from the site?
    lookAngles(frame, sx, sy, sz, look);
    if (look.el > maskAt(mask, look.az)) bits |= 1 << k;
  }
  out.stationMask = bits;
  return out;
}

/** Closed time intervals stored as [start0, end0, start1, end1, ...] in UTC milliseconds. */
export type Intervals = Float64Array;

export interface SiteSeries {
  t0Ms: number;
  stepMs: number;
  count: number;
  sunEl: Float32Array;
  sunAz: Float32Array;
  sunFrac: Float32Array;
  sunClear: Float32Array;
  irradiance: Float32Array;
  earthEl: Float32Array;
  earthAz: Float32Array;
  earthFrac: Float32Array;
  earthClear: Float32Array;
  stationMask: Uint8Array;
}

export interface SiteAnalysis {
  series: SiteSeries;
  /** Any part of the solar disk visible. */
  lit: Intervals;
  /** Entire solar disk visible. */
  fullSun: Intervals;
  /** Earth's centre above the terrain skyline. */
  earth: Intervals;
  /** Two-way geometric line of sight per DSN complex. */
  stations: Intervals[];
  /** At least one DSN complex in view. */
  dsn: Intervals;
}

type Predicate = (i: Instant) => boolean;

const PREDICATES: Predicate[] = [
  (i) => i.sunFrac > 0,
  (i) => i.sunFrac >= 0.999,
  (i) => i.earthClear > 0,
  (i) => i.stationMask !== 0,
  ...DSN_STATIONS.map((_, k) => (i: Instant) => (i.stationMask & (1 << k)) !== 0),
];

/**
 * Sweeps a site across [startMs, endMs] at a fixed step, then refines every state change by
 * bisection (to under one second) so window edges are not quantised to the sampling step.
 */
export function analyzeSite(table: EphemerisTable, frame: SiteFrame, mask: HorizonMask, startMs: number, endMs: number, stepMs: number): SiteAnalysis {
  const count = Math.floor((endMs - startMs) / stepMs) + 1;
  const series: SiteSeries = {
    t0Ms: startMs, stepMs, count,
    sunEl: new Float32Array(count), sunAz: new Float32Array(count), sunFrac: new Float32Array(count),
    sunClear: new Float32Array(count), irradiance: new Float32Array(count),
    earthEl: new Float32Array(count), earthAz: new Float32Array(count), earthFrac: new Float32Array(count),
    earthClear: new Float32Array(count), stationMask: new Uint8Array(count),
  };
  const state = new Float64Array(STATE_SIZE);
  const inst = newInstant();
  const np = PREDICATES.length;
  const flags = new Uint8Array(np);
  const edges: number[][] = PREDICATES.map(() => []);
  const lastMs = startMs + (count - 1) * stepMs;

  const refine = (p: Predicate, loMs: number, hiMs: number, loVal: boolean): number => {
    let lo = loMs, hi = hiMs;
    for (let k = 0; k < 11; k++) {
      const mid = (lo + hi) / 2;
      evaluate(table.sample(mid, state), frame, mask, inst);
      if (p(inst) === loVal) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };

  for (let i = 0; i < count; i++) {
    const t = startMs + i * stepMs;
    evaluate(table.sample(t, state), frame, mask, inst);
    series.sunEl[i] = inst.sunEl;
    series.sunAz[i] = inst.sunAz;
    series.sunFrac[i] = inst.sunFrac;
    series.sunClear[i] = inst.sunClear;
    series.irradiance[i] = inst.irradiance;
    series.earthEl[i] = inst.earthEl;
    series.earthAz[i] = inst.earthAz;
    series.earthFrac[i] = inst.earthFrac;
    series.earthClear[i] = inst.earthClear;
    series.stationMask[i] = inst.stationMask;
    for (let p = 0; p < np; p++) {
      const v = PREDICATES[p](inst) ? 1 : 0;
      if (i === 0) {
        if (v) edges[p].push(startMs);
      } else if (v !== flags[p]) {
        edges[p].push(refine(PREDICATES[p], t - stepMs, t, flags[p] === 1));
        // refine() reuses the scratch instant; restore it for the remaining predicates.
        evaluate(table.sample(t, state), frame, mask, inst);
      }
      flags[p] = v;
    }
  }
  for (let p = 0; p < np; p++) if (flags[p]) edges[p].push(lastMs);

  const iv = edges.map((e) => Float64Array.from(e));
  return { series, lit: iv[0], fullSun: iv[1], earth: iv[2], dsn: iv[3], stations: iv.slice(4) };
}

/** Total time (ms) covered by the intervals inside [aMs, bMs]. */
export function coveredMs(iv: Intervals, aMs: number, bMs: number): number {
  let sum = 0;
  for (let i = 0; i < iv.length; i += 2) {
    const s = Math.max(iv[i], aMs), e = Math.min(iv[i + 1], bMs);
    if (e > s) sum += e - s;
  }
  return sum;
}

/** Longest continuous stretch (ms) inside [aMs, bMs] that is covered (`inside`) or not covered. */
export function longestRunMs(iv: Intervals, aMs: number, bMs: number, inside: boolean): number {
  let best = 0;
  if (inside) {
    for (let i = 0; i < iv.length; i += 2) {
      const s = Math.max(iv[i], aMs), e = Math.min(iv[i + 1], bMs);
      if (e - s > best) best = e - s;
    }
    return best;
  }
  let cursor = aMs;
  for (let i = 0; i < iv.length; i += 2) {
    if (iv[i + 1] <= aMs) continue;
    if (iv[i] >= bMs) break;
    if (iv[i] - cursor > best) best = iv[i] - cursor;
    cursor = Math.max(cursor, iv[i + 1]);
  }
  if (bMs - cursor > best) best = bMs - cursor;
  return best;
}

/**
 * Whether tMs is inside an interval, and when that next changes. `changeMs` is null when no
 * change happens before the end of the analysed span (callers report "beyond the analysed span").
 */
export function stateAt(iv: Intervals, tMs: number, spanEndMs: number): { inside: boolean; changeMs: number | null } {
  for (let i = 0; i < iv.length; i += 2) {
    if (tMs < iv[i]) return { inside: false, changeMs: iv[i] };
    if (tMs <= iv[i + 1]) return { inside: true, changeMs: iv[i + 1] < spanEndMs - 1 ? iv[i + 1] : null };
  }
  return { inside: false, changeMs: null };
}

/** Headline numbers for one site over one time window (a candidate surface mission). */
export interface WindowMetrics {
  startMs: number;
  endMs: number;
  /** % of the window with any direct sunlight. */
  litPct: number;
  /** Mean visible fraction of the solar disk, % (the "average illumination" of the literature). */
  illuminationPct: number;
  longestDarkH: number;
  longestLitH: number;
  /** % of the window with Earth's centre above the skyline. */
  earthPct: number;
  /** % of the window with at least one DSN complex in two-way view. */
  dsnPct: number;
  longestOutageH: number;
  /** % of the window with sunlight and a DSN contact at the same time. */
  bothPct: number;
  sunElMin: number;
  sunElMax: number;
  earthElMin: number;
  earthElMax: number;
  /** Mean direct irradiance on a Sun-tracking surface, W/m^2. */
  meanIrradiance: number;
  /** Energy collected by 1 m^2 of ideal Sun-tracking surface over the window, kWh. */
  energyKwhM2: number;
}

export function windowMetrics(an: SiteAnalysis, aMs: number, bMs: number): WindowMetrics {
  const s = an.series;
  const lastMs = s.t0Ms + (s.count - 1) * s.stepMs;
  const a = Math.max(aMs, s.t0Ms), b = Math.min(bMs, lastMs);
  const span = Math.max(1, b - a);
  const i0 = Math.max(0, Math.ceil((a - s.t0Ms) / s.stepMs));
  const i1 = Math.min(s.count - 1, Math.floor((b - s.t0Ms) / s.stepMs));
  let frac = 0, irr = 0, both = 0, n = 0;
  let sMin = Infinity, sMax = -Infinity, eMin = Infinity, eMax = -Infinity;
  for (let i = i0; i <= i1; i++) {
    frac += s.sunFrac[i];
    irr += s.irradiance[i];
    if (s.sunFrac[i] > 0 && s.stationMask[i] !== 0) both++;
    if (s.sunEl[i] < sMin) sMin = s.sunEl[i];
    if (s.sunEl[i] > sMax) sMax = s.sunEl[i];
    if (s.earthEl[i] < eMin) eMin = s.earthEl[i];
    if (s.earthEl[i] > eMax) eMax = s.earthEl[i];
    n++;
  }
  n = Math.max(1, n);
  const meanIrr = irr / n;
  return {
    startMs: a, endMs: b,
    litPct: (100 * coveredMs(an.lit, a, b)) / span,
    illuminationPct: (100 * frac) / n,
    longestDarkH: longestRunMs(an.lit, a, b, false) / 3600_000,
    longestLitH: longestRunMs(an.lit, a, b, true) / 3600_000,
    earthPct: (100 * coveredMs(an.earth, a, b)) / span,
    dsnPct: (100 * coveredMs(an.dsn, a, b)) / span,
    longestOutageH: longestRunMs(an.dsn, a, b, false) / 3600_000,
    bothPct: (100 * both) / n,
    sunElMin: sMin, sunElMax: sMax, earthElMin: eMin, earthElMax: eMax,
    meanIrradiance: meanIrr,
    energyKwhM2: (meanIrr * (span / 3600_000)) / 1000,
  };
}
