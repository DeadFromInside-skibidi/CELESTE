// Topocentric (local horizon) geometry for a point on the Moon.

import { DEG, MOON_RADIUS_KM, RAD } from './constants.ts';

/** Local east/north/up basis and position of a surface point, in the Moon-fixed frame. */
export interface SiteFrame {
  /** Site position from the Moon's centre, km. */
  px: number; py: number; pz: number;
  ux: number; uy: number; uz: number;
  ex: number; ey: number; ez: number;
  nx: number; ny: number; nz: number;
}

/**
 * @param latDeg   selenographic latitude (north positive)
 * @param lonDeg   selenographic longitude (east positive)
 * @param heightM  height of the observer above the 1737.4 km reference sphere
 */
export function siteFrame(latDeg: number, lonDeg: number, heightM = 0): SiteFrame {
  const lat = latDeg * DEG, lon = lonDeg * DEG;
  const cl = Math.cos(lat), sl = Math.sin(lat), co = Math.cos(lon), so = Math.sin(lon);
  const r = MOON_RADIUS_KM + heightM / 1000;
  const ux = cl * co, uy = cl * so, uz = sl;
  return {
    px: r * ux, py: r * uy, pz: r * uz,
    ux, uy, uz,
    ex: -so, ey: co, ez: 0,
    nx: -sl * co, ny: -sl * so, nz: cl,
  };
}

export interface LookAngles {
  /** Azimuth clockwise from local north through east, 0..360 deg. */
  az: number;
  /** Elevation of the body's centre above the ideal (spherical, airless) horizon plane, deg. */
  el: number;
  /** Distance from the site to the body's centre, km. */
  range: number;
}

/**
 * Direction of a body as seen from the site (parallax included: the vector is taken from the
 * site, not from the Moon's centre). No refraction term exists because the Moon has no atmosphere.
 */
export function lookAngles(f: SiteFrame, bx: number, by: number, bz: number, out: LookAngles): LookAngles {
  const dx = bx - f.px, dy = by - f.py, dz = bz - f.pz;
  const range = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const up = (dx * f.ux + dy * f.uy + dz * f.uz) / range;
  const east = dx * f.ex + dy * f.ey + dz * f.ez;
  const north = dx * f.nx + dy * f.ny + dz * f.nz;
  let az = Math.atan2(east, north) * RAD;
  if (az < 0) az += 360;
  out.az = az;
  out.el = Math.asin(up > 1 ? 1 : up < -1 ? -1 : up) * RAD;
  out.range = range;
  return out;
}

/** Apparent angular radius (deg) of a sphere of the given radius at the given distance. */
export function angularRadiusDeg(bodyRadiusKm: number, rangeKm: number): number {
  return Math.asin(Math.min(1, bodyRadiusKm / rangeKm)) * RAD;
}

/** Great-circle destination: start point, azimuth and surface distance -> lat/lon (deg). */
export function destination(latDeg: number, lonDeg: number, azDeg: number, distKm: number, out: { lat: number; lon: number }): void {
  const lat1 = latDeg * DEG, lon1 = lonDeg * DEG, az = azDeg * DEG;
  const ang = distKm / MOON_RADIUS_KM;
  const sinLat = Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(az);
  const lat2 = Math.asin(sinLat > 1 ? 1 : sinLat < -1 ? -1 : sinLat);
  const lon2 = lon1 + Math.atan2(Math.sin(az) * Math.sin(ang) * Math.cos(lat1), Math.cos(ang) - Math.sin(lat1) * sinLat);
  out.lat = lat2 * RAD;
  out.lon = lon2 * RAD;
}

/** Great-circle distance between two surface points, km. */
export function surfaceDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a = Math.sin(((lat2 - lat1) * DEG) / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(((lon2 - lon1) * DEG) / 2) ** 2;
  return 2 * MOON_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Wraps a longitude to (-180, 180]. */
export function wrapLon(lonDeg: number): number {
  let l = ((lonDeg + 180) % 360 + 360) % 360 - 180;
  if (l === -180) l = 180;
  return l;
}
