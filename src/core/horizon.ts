// Terrain horizon masks and how much of a disk (Sun or Earth) clears them.

import { DEG, MASK_SAMPLES, MOON_RADIUS_KM, RAD } from './constants.ts';
import { destination } from './topo.ts';

/**
 * Elevation angle (deg) of the terrain skyline for MASK_SAMPLES azimuths, starting at north
 * and running clockwise. `null` means "ideal sphere": the horizon is 0 deg in every direction.
 */
export type HorizonMask = Float32Array | null;

/** Skyline elevation (deg) at an azimuth, linearly interpolated. */
export function maskAt(mask: HorizonMask, azDeg: number): number {
  if (!mask) return 0;
  const n = mask.length;
  let u = (azDeg / 360) * n;
  u -= Math.floor(u / n) * n;
  const i = Math.floor(u);
  const f = u - i;
  const a = mask[i === n ? 0 : i];
  const b = mask[i + 1 >= n ? i + 1 - n : i + 1];
  return a + (b - a) * f;
}

const STRIPS = 15;

/**
 * Fraction (0..1) of a disk's area that is above the terrain skyline.
 *
 * The disk is cut into vertical strips; each strip is clipped against the skyline elevation at
 * its own azimuth, so a notch or a peak narrower than the disk is handled correctly. With no
 * mask this reduces to a disk crossing a straight horizon at 0 deg.
 */
export function diskVisibleFraction(mask: HorizonMask, azDeg: number, elDeg: number, radiusDeg: number): number {
  if (!mask) {
    if (elDeg >= radiusDeg) return 1;
    if (elDeg <= -radiusDeg) return 0;
  } else {
    // Cheap accept/reject before integrating: skyline bounds across the disk's width.
    const h0 = maskAt(mask, azDeg);
    const span = radiusDeg / Math.max(0.05, Math.cos(elDeg * DEG));
    const h1 = maskAt(mask, azDeg - span), h2 = maskAt(mask, azDeg + span);
    const h3 = maskAt(mask, azDeg - span * 0.5), h4 = maskAt(mask, azDeg + span * 0.5);
    const hi = Math.max(h0, h1, h2, h3, h4), lo = Math.min(h0, h1, h2, h3, h4);
    // The margin covers skyline detail between the five probes.
    if (elDeg - radiusDeg > hi + 0.5) return 1;
    if (elDeg + radiusDeg < lo - 0.5) return 0;
  }
  const azScale = 1 / Math.max(0.05, Math.cos(elDeg * DEG));
  let visible = 0, total = 0;
  for (let k = 0; k < STRIPS; k++) {
    const x = (-1 + (2 * k + 1) / STRIPS) * radiusDeg;
    const c = Math.sqrt(radiusDeg * radiusDeg - x * x);
    const h = maskAt(mask, azDeg + x * azScale);
    let v = elDeg + c - h;
    if (v < 0) v = 0;
    else if (v > 2 * c) v = 2 * c;
    visible += v;
    total += 2 * c;
  }
  return visible / total;
}

/** Anything that can return terrain height (m above the reference sphere) at a lat/lon. */
export interface TerrainSampler {
  /** Returns NaN where there is no coverage. */
  heightAt(latDeg: number, lonDeg: number, distKm: number): number;
  /** Smallest useful marching step (km) at a given distance from the observer. */
  minStepKm(distKm: number): number;
}

export interface HorizonOptions {
  /** Observer height above the local surface, m. One mask is produced per entry. */
  observerHeightsM: number[];
  /** How far to march, km. 350 km is beyond the visibility limit of the Moon's highest relief. */
  maxDistKm?: number;
  samples?: number;
}

export interface HorizonResult {
  /** One mask per requested observer height. */
  masks: Float32Array[];
  /** Surface height at the site, m above the reference sphere. */
  groundHeightM: number;
  /** Fraction of ray samples that fell outside DEM coverage. */
  uncoveredFraction: number;
}

/**
 * Computes the terrain skyline around a site by marching outward along great circles.
 *
 * For a terrain point at central angle theta from the site with radius r2, seen from an
 * observer at radius r1, the elevation angle above the local horizontal is
 *     atan2(r2 cos(theta) - r1, r2 sin(theta))
 * which accounts for the Moon's curvature exactly (terrain 150 km away sits ~6.5 km below the
 * local tangent plane). The skyline is the maximum of that angle along each azimuth.
 */
export function computeHorizon(sampler: TerrainSampler, latDeg: number, lonDeg: number, opts: HorizonOptions): HorizonResult {
  const n = opts.samples ?? MASK_SAMPLES;
  const maxDist = opts.maxDistKm ?? 350;
  const heights = opts.observerHeightsM;
  const ground = sampler.heightAt(latDeg, lonDeg, 0);
  const groundM = Number.isFinite(ground) ? ground : 0;
  const masks = heights.map(() => new Float32Array(n));
  const r1 = heights.map((h) => MOON_RADIUS_KM + (groundM + h) / 1000);
  const best = new Float64Array(heights.length);
  const dest = { lat: 0, lon: 0 };
  let total = 0, uncovered = 0;

  for (let i = 0; i < n; i++) {
    const az = (i * 360) / n;
    best.fill(-90);
    let d = sampler.minStepKm(0);
    while (d <= maxDist) {
      destination(latDeg, lonDeg, az, d, dest);
      const h = sampler.heightAt(dest.lat, dest.lon, d);
      total++;
      if (Number.isFinite(h)) {
        const theta = d / MOON_RADIUS_KM;
        const r2 = MOON_RADIUS_KM + h / 1000;
        const horiz = r2 * Math.sin(theta), vert = r2 * Math.cos(theta);
        for (let k = 0; k < heights.length; k++) {
          const e = Math.atan2(vert - r1[k], horiz) * RAD;
          if (e > best[k]) best[k] = e;
        }
      } else {
        uncovered++;
      }
      d += Math.max(sampler.minStepKm(d), d * 0.002);
    }
    for (let k = 0; k < heights.length; k++) {
      // No terrain data at all along this azimuth: fall back to the dip of a smooth sphere
      // passing through the ground under the observer.
      masks[k][i] = best[k] > -90 ? best[k] : -Math.acos(Math.min(1, (MOON_RADIUS_KM + groundM / 1000) / r1[k])) * RAD;
    }
  }
  return { masks, groundHeightM: groundM, uncoveredFraction: total ? uncovered / total : 1 };
}
