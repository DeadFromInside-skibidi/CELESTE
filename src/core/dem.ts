// Digital elevation models (LOLA) and the multi-resolution sampler used to trace horizons.
// The same code runs in the Node data pipeline and in the browser worker.

import { DEG, MOON_RADIUS_KM } from './constants.ts';
import type { TerrainSampler } from './horizon.ts';

/** Height grid in the LOLA south-polar stereographic projection (centre = pole, +Y = 0 deg E, +X = 90 deg E). */
export class PolarDem {
  readonly data: Int16Array | Float32Array;
  readonly size: number;
  readonly metersPerPixel: number;
  /** Multiply a stored sample by this to get metres above the 1737.4 km sphere. */
  readonly scale: number;
  /** Northernmost latitude fully covered (deg, negative). */
  readonly edgeLatDeg: number;

  constructor(data: Int16Array | Float32Array, size: number, metersPerPixel: number, scale: number) {
    this.data = data;
    this.size = size;
    this.metersPerPixel = metersPerPixel;
    this.scale = scale;
    const rhoKm = ((size / 2) * metersPerPixel) / 1000;
    this.edgeLatDeg = -90 + (2 * Math.atan(rhoKm / (2 * MOON_RADIUS_KM))) / DEG;
  }

  /** Bilinear height in metres; NaN outside the grid. */
  heightAt(latDeg: number, lonDeg: number): number {
    const rho = 2 * MOON_RADIUS_KM * 1000 * Math.tan(((90 + latDeg) * DEG) / 2);
    const lon = lonDeg * DEG;
    const half = this.size / 2;
    const u = (rho * Math.sin(lon)) / this.metersPerPixel + half - 0.5;
    const v = half - 0.5 - (rho * Math.cos(lon)) / this.metersPerPixel;
    return this.heightAtPixel(u, v);
  }

  /** Latitude/longitude (deg) -> fractional pixel coordinates. */
  latLonToPixel(latDeg: number, lonDeg: number): { u: number; v: number } {
    const rho = 2 * MOON_RADIUS_KM * 1000 * Math.tan(((90 + latDeg) * DEG) / 2);
    const lon = lonDeg * DEG;
    const half = this.size / 2;
    return { u: (rho * Math.sin(lon)) / this.metersPerPixel + half - 0.5, v: half - 0.5 - (rho * Math.cos(lon)) / this.metersPerPixel };
  }

  heightAtPixel(u: number, v: number): number {
    const n = this.size;
    if (!(u >= 0 && v >= 0 && u <= n - 1 && v <= n - 1)) return NaN;
    const i = Math.min(n - 2, Math.floor(u)), j = Math.min(n - 2, Math.floor(v));
    const fu = u - i, fv = v - j;
    const d = this.data, o = j * n + i;
    const top = d[o] + (d[o + 1] - d[o]) * fu;
    const bot = d[o + n] + (d[o + n + 1] - d[o + n]) * fu;
    return (top + (bot - top) * fv) * this.scale;
  }

  /** Pixel coordinates -> latitude/longitude (deg). */
  pixelToLatLon(u: number, v: number): { lat: number; lon: number } {
    const half = this.size / 2;
    const x = (u + 0.5 - half) * this.metersPerPixel;
    const y = (half - 0.5 - v) * this.metersPerPixel;
    const rho = Math.hypot(x, y) / 1000;
    return { lat: -90 + (2 * Math.atan(rho / (2 * MOON_RADIUS_KM))) / DEG, lon: Math.atan2(x, y) / DEG };
  }
}

/** Global simple-cylindrical height grid: row 0 = 90 N, column 0 = 0 deg E, east-positive. */
export class GlobalDem {
  readonly data: Int16Array;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly pixelsPerDegree: number;

  constructor(data: Int16Array, width: number, height: number, scale: number) {
    this.data = data;
    this.width = width;
    this.height = height;
    this.scale = scale;
    this.pixelsPerDegree = width / 360;
  }

  heightAt(latDeg: number, lonDeg: number): number {
    const w = this.width, h = this.height;
    let u = (((lonDeg % 360) + 360) % 360) * this.pixelsPerDegree - 0.5;
    let v = (90 - latDeg) * this.pixelsPerDegree - 0.5;
    if (v < 0) v = 0;
    else if (v > h - 1) v = h - 1;
    if (u < 0) u += w;
    const i = Math.floor(u), j = Math.min(h - 2, Math.floor(v));
    const fu = u - i, fv = v - j;
    const i0 = i % w, i1 = (i + 1) % w;
    const d = this.data;
    const top = d[j * w + i0] + (d[j * w + i1] - d[j * w + i0]) * fu;
    const bot = d[(j + 1) * w + i0] + (d[(j + 1) * w + i1] - d[(j + 1) * w + i0]) * fu;
    return (top + (bot - top) * fv) * this.scale;
  }
}

export interface DemLevel {
  dem: PolarDem | GlobalDem;
  /** This level is used out to this distance from the observer (km). */
  maxDistKm: number;
  /** Marching step that does justice to this level's resolution (km). */
  stepKm: number;
  label: string;
}

/**
 * Picks the finest elevation model appropriate for each distance from the observer: fine
 * terrain close by (where it sets the skyline within fractions of a degree), coarser terrain
 * far away (where a pixel subtends a small angle anyway). Falls through to the next level
 * wherever a level has no coverage.
 */
export class DemStack implements TerrainSampler {
  readonly levels: DemLevel[];

  constructor(levels: DemLevel[]) {
    this.levels = levels;
  }

  /** Restricts the stack to the levels that are meaningful for a given site. */
  forSite(latDeg: number, lonDeg: number): DemStack {
    const covering = this.levels.filter((l) => Number.isFinite(l.dem.heightAt(latDeg, lonDeg)));
    return new DemStack(covering.length ? covering : this.levels.slice(-1));
  }

  heightAt(latDeg: number, lonDeg: number, distKm: number): number {
    const ls = this.levels;
    for (let k = 0; k < ls.length; k++) {
      if (distKm > ls[k].maxDistKm && k < ls.length - 1) continue;
      const h = ls[k].dem.heightAt(latDeg, lonDeg);
      if (h === h) return h;
    }
    return NaN;
  }

  minStepKm(distKm: number): number {
    const ls = this.levels;
    for (let k = 0; k < ls.length; k++) if (distKm <= ls[k].maxDistKm || k === ls.length - 1) return ls[k].stepKm;
    return ls[ls.length - 1].stepKm;
  }

  /** Human-readable description of the terrain data behind a mask, for provenance labels. */
  describe(): string {
    return this.levels.map((l) => l.label).join(' + ');
  }
}
