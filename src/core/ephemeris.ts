// Sun, Earth and Deep Space Network station positions in the Moon-fixed frame.
//
// Positions come from astronomy-engine (VSOP87 Sun, NAO/Brown Moon; validated by its author
// against JPL DE405 to about 1 arcminute). The Moon's orientation is the IAU Working Group
// rotation model for the Moon (pole + prime meridian with the E1..E13 periodic terms), which
// realises the Mean-Earth/Polar-Axis convention that LOLA cartography uses to within ~150 m
// on the surface (~0.005 deg in selenographic position).
//
// Everything downstream works with Moon-centred vectors in kilometres expressed in Moon-fixed
// axes (+X = mean sub-Earth meridian on the equator, +Z = north pole).

import { Body, GeoMoon, GeoVector, MakeTime, Rotation_EQD_EQJ, RotationAxis, SiderealTime } from 'astronomy-engine';
import { AU_KM, DEG } from './constants.ts';

/** A Deep Space Network complex (one representative 70 m antenna per complex). */
export interface GroundStation {
  id: string;
  name: string;
  antenna: string;
  latDeg: number;
  lonDeg: number;
  heightM: number;
}

/** Geodetic coordinates from the DSN Telecommunications Link Design Handbook (810-005, module 301). */
export const DSN_STATIONS: GroundStation[] = [
  { id: 'GDS', name: 'Goldstone', antenna: 'DSS-14', latDeg: 35.4259, lonDeg: -116.8895, heightM: 1001 },
  { id: 'MAD', name: 'Madrid', antenna: 'DSS-63', latDeg: 40.4314, lonDeg: -4.2481, heightM: 865 },
  { id: 'CAN', name: 'Canberra', antenna: 'DSS-43', latDeg: -35.4024, lonDeg: 148.9813, heightM: 689 },
];

// Earth-fixed station position (AU) and geodetic vertical on the WGS-84 ellipsoid.
const WGS84_A_KM = 6378.137;
const WGS84_E2 = 0.00669437999014;
const stationsEarthFixed = DSN_STATIONS.map((s) => {
  const lat = s.latDeg * DEG, lon = s.lonDeg * DEG;
  const n = WGS84_A_KM / Math.sqrt(1 - WGS84_E2 * Math.sin(lat) ** 2);
  const h = s.heightM / 1000;
  return {
    px: ((n + h) * Math.cos(lat) * Math.cos(lon)) / AU_KM,
    py: ((n + h) * Math.cos(lat) * Math.sin(lon)) / AU_KM,
    pz: ((n * (1 - WGS84_E2) + h) * Math.sin(lat)) / AU_KM,
    zx: Math.cos(lat) * Math.cos(lon),
    zy: Math.cos(lat) * Math.sin(lon),
    zz: Math.sin(lat),
  };
});

/** Offsets into a state record. */
export const SUN = 0;
export const EARTH = 3;
/** Station k: position at STATION + 6k (km, Moon-centred), local zenith unit vector at STATION + 6k + 3. */
export const STATION = 6;
export const STATE_SIZE = STATION + 6 * DSN_STATIONS.length;

/** One state record: Sun xyz, Earth xyz, then per station position xyz + zenith xyz. */
export type BodyVectors = Float64Array;

/** Exact (non-interpolated) Moon-fixed state for a UTC instant. */
export function moonFixedBodies(utcMs: number, out: BodyVectors = new Float64Array(STATE_SIZE)): BodyVectors {
  const time = MakeTime(new Date(utcMs));
  const moon = GeoMoon(time); // geocentric Moon, J2000 equatorial, AU
  const sun = GeoVector(Body.Sun, time, true); // geocentric Sun, light-time + aberration corrected
  const axis = RotationAxis(Body.Moon, time);

  // IAU body-fixed axes expressed in J2000 equatorial coordinates.
  const zx = axis.north.x, zy = axis.north.y, zz = axis.north.z;
  const a0 = axis.ra * 15 * DEG;
  const w = axis.spin * DEG;
  // Q: ascending node of the body equator on the J2000 equator.
  const qx = -Math.sin(a0), qy = Math.cos(a0), qz = 0;
  // M = Z x Q completes the equatorial basis.
  const mx = zy * qz - zz * qy, my = zz * qx - zx * qz, mz = zx * qy - zy * qx;
  const cw = Math.cos(w), sw = Math.sin(w);
  const xx = qx * cw + mx * sw, xy = qy * cw + my * sw, xz = qz * cw + mz * sw;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;

  const put = (o: number, vx: number, vy: number, vz: number, scale: number) => {
    out[o] = (vx * xx + vy * xy + vz * xz) * scale;
    out[o + 1] = (vx * yx + vy * yy + vz * yz) * scale;
    out[o + 2] = (vx * zx + vy * zy + vz * zz) * scale;
  };

  put(SUN, sun.x - moon.x, sun.y - moon.y, sun.z - moon.z, AU_KM);
  put(EARTH, -moon.x, -moon.y, -moon.z, AU_KM);

  if (out.length >= STATE_SIZE) {
    // Earth-fixed -> true equator of date (rotate by apparent sidereal time) -> J2000 equator
    // (precession + nutation). Polar motion (< 0.5 arcsec) is neglected.
    const gast = SiderealTime(time) * 15 * DEG;
    const cg = Math.cos(gast), sg = Math.sin(gast);
    const r = Rotation_EQD_EQJ(time).rot;
    const toJ2000 = (x: number, y: number, z: number, o: number, ox: number, oy: number, oz: number, scale: number) => {
      const dx = cg * x - sg * y, dy = sg * x + cg * y;
      // astronomy-engine stores rotation matrices column-major: v' = rot[col][row] * v[col].
      const jx = r[0][0] * dx + r[1][0] * dy + r[2][0] * z;
      const jy = r[0][1] * dx + r[1][1] * dy + r[2][1] * z;
      const jz = r[0][2] * dx + r[1][2] * dy + r[2][2] * z;
      put(o, jx + ox, jy + oy, jz + oz, scale);
    };
    for (let k = 0; k < stationsEarthFixed.length; k++) {
      const s = stationsEarthFixed[k];
      const o = STATION + 6 * k;
      toJ2000(s.px, s.py, s.pz, o, -moon.x, -moon.y, -moon.z, AU_KM);
      toJ2000(s.zx, s.zy, s.zz, o + 3, 0, 0, 0, 1);
    }
  }
  return out;
}

/** Selenographic latitude/longitude (deg, east-positive, -180..180) of the point a vector passes through. */
export function subPoint(x: number, y: number, z: number): { lat: number; lon: number } {
  return { lat: Math.atan2(z, Math.hypot(x, y)) / DEG, lon: Math.atan2(y, x) / DEG };
}

/**
 * Uniformly sampled ephemeris with Catmull-Rom interpolation.
 *
 * In the Moon-fixed frame the Sun and Earth directions change by at most ~0.5 deg/hour and a
 * ground station sweeps ~15 deg/hour around Earth's axis, so half-hourly nodes with cubic
 * interpolation reproduce the exact vectors far better than the underlying ephemeris accuracy
 * (verified in tests/ephemeris.test.ts). Long sweeps then cost a handful of multiplications
 * per sample instead of a full series evaluation.
 */
export class EphemerisTable {
  readonly t0Ms: number;
  readonly stepMs: number;
  readonly count: number;
  readonly data: Float64Array;

  constructor(t0Ms: number, stepMs: number, count: number, data?: Float64Array) {
    this.t0Ms = t0Ms;
    this.stepMs = stepMs;
    this.count = count;
    this.data = data ?? new Float64Array(count * STATE_SIZE);
  }

  /** Builds a table covering [startMs, endMs] with one node of padding on each side. */
  static build(startMs: number, endMs: number, stepMs: number, onProgress?: (fraction: number) => void): EphemerisTable {
    const t0 = startMs - stepMs;
    const count = Math.ceil((endMs - startMs) / stepMs) + 4;
    const table = new EphemerisTable(t0, stepMs, count);
    const tmp = new Float64Array(STATE_SIZE);
    for (let i = 0; i < count; i++) {
      moonFixedBodies(t0 + i * stepMs, tmp);
      table.data.set(tmp, i * STATE_SIZE);
      if (onProgress && (i & 255) === 0) onProgress(i / count);
    }
    return table;
  }

  get startMs(): number {
    return this.t0Ms + this.stepMs;
  }

  get endMs(): number {
    return this.t0Ms + (this.count - 3) * this.stepMs;
  }

  covers(utcMs: number): boolean {
    return utcMs >= this.startMs && utcMs <= this.endMs;
  }

  sample(utcMs: number, out: BodyVectors): BodyVectors {
    const u = (utcMs - this.t0Ms) / this.stepMs;
    let i = Math.floor(u);
    if (i < 1) i = 1;
    else if (i > this.count - 3) i = this.count - 3;
    const f = u - i;
    const f2 = f * f, f3 = f2 * f;
    // Catmull-Rom basis weights for nodes i-1, i, i+1, i+2.
    const w0 = -0.5 * f3 + f2 - 0.5 * f;
    const w1 = 1.5 * f3 - 2.5 * f2 + 1;
    const w2 = -1.5 * f3 + 2 * f2 + 0.5 * f;
    const w3 = 0.5 * f3 - 0.5 * f2;
    const d = this.data;
    const b = (i - 1) * STATE_SIZE;
    const s1 = STATE_SIZE, s2 = 2 * STATE_SIZE, s3 = 3 * STATE_SIZE;
    for (let k = 0; k < STATE_SIZE; k++) {
      out[k] = w0 * d[b + k] + w1 * d[b + s1 + k] + w2 * d[b + s2 + k] + w3 * d[b + s3 + k];
    }
    return out;
  }
}
