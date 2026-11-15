// Earth-to-Moon flights: reference frames, and the path of a spacecraft from the launch pad to
// the Moon.
//
// Everything here is Earth-centred, in the ecliptic frame of J2000, in kilometres.
//
// Two kinds of flight exist:
//   'flown'         positions published by JPL Horizons for that spacecraft (see
//                   tools/fetch-flights.mjs), interpolated between samples;
//   'reconstructed' a path computed here from the real launch site, launch date, arrival
//                   date and landing site. It is two-body mechanics (parking orbit, a transfer
//                   conic that meets the Moon at the right time) joined by smooth blends into a
//                   lunar orbit and descent. It shows the shape and timing of the flight; it is
//                   NOT the spacecraft's actual trajectory, and the UI always says so.

import { Body, GeoMoon, GeoVector, MakeTime, Rotation_EQD_EQJ, RotationAxis, SiderealTime } from 'astronomy-engine';
import { AU_KM, DAY_MS, DEG, EARTH_RADIUS_KM, MOON_RADIUS_KM } from './constants.ts';

export const MU_EARTH = 398600.4418; // km^3/s^2
export const MU_MOON = 4902.8;
const PARKING_ALT_KM = 185;
const LUNAR_ORBIT_ALT_KM = 100;
const COS_E = Math.cos(23.4392911 * DEG), SIN_E = Math.sin(23.4392911 * DEG);

type V = Float64Array;
const v3 = (): V => new Float64Array(3);

/** J2000 equatorial -> J2000 ecliptic. */
function toEcl(x: number, y: number, z: number, out: V, o = 0): V {
  out[o] = x;
  out[o + 1] = y * COS_E + z * SIN_E;
  out[o + 2] = -y * SIN_E + z * COS_E;
  return out;
}

/** Moon's centre from Earth's centre. */
export function moonEcl(utcMs: number, out: V = v3()): V {
  const m = GeoMoon(MakeTime(new Date(utcMs)));
  return toEcl(m.x * AU_KM, m.y * AU_KM, m.z * AU_KM, out);
}

/** Sun's centre from Earth's centre. */
export function sunEcl(utcMs: number, out: V = v3()): V {
  const s = GeoVector(Body.Sun, MakeTime(new Date(utcMs)), false);
  return toEcl(s.x * AU_KM, s.y * AU_KM, s.z * AU_KM, out);
}

/** Body-fixed axes as the columns of a 3x3 matrix (x axis in [0..2], y in [3..5], z in [6..8]). */
export type Axes = Float64Array;

/** Earth-fixed axes (x through 0 N 0 E, z through the north pole) in the ecliptic frame. */
export function earthAxes(utcMs: number, out: Axes = new Float64Array(9)): Axes {
  const time = MakeTime(new Date(utcMs));
  const g = SiderealTime(time) * 15 * DEG;
  const r = Rotation_EQD_EQJ(time).rot; // column-major: v' = rot[col][row] * v[col]
  const col = (x: number, y: number, z: number, o: number) => toEcl(r[0][0] * x + r[1][0] * y + r[2][0] * z, r[0][1] * x + r[1][1] * y + r[2][1] * z, r[0][2] * x + r[1][2] * y + r[2][2] * z, out, o);
  col(Math.cos(g), Math.sin(g), 0, 0);
  col(-Math.sin(g), Math.cos(g), 0, 3);
  col(0, 0, 1, 6);
  return out;
}

/** Moon-fixed axes (x toward the mean sub-Earth point, z through the north pole) in the ecliptic frame. */
export function moonAxes(utcMs: number, out: Axes = new Float64Array(9)): Axes {
  const axis = RotationAxis(Body.Moon, MakeTime(new Date(utcMs)));
  const zx = axis.north.x, zy = axis.north.y, zz = axis.north.z;
  const a0 = axis.ra * 15 * DEG, w = axis.spin * DEG;
  const qx = -Math.sin(a0), qy = Math.cos(a0);
  const mx = -zz * qy, my = zz * qx, mz = zx * qy - zy * qx;
  const cw = Math.cos(w), sw = Math.sin(w);
  const xx = qx * cw + mx * sw, xy = qy * cw + my * sw, xz = mz * sw;
  toEcl(xx, xy, xz, out, 0);
  toEcl(zy * xz - zz * xy, zz * xx - zx * xz, zx * xy - zy * xx, out, 3);
  toEcl(zx, zy, zz, out, 6);
  return out;
}

/** Point at a latitude/longitude on a body, relative to the body's centre. */
export function surfacePoint(axes: Axes, radiusKm: number, latDeg: number, lonDeg: number, out: V = v3()): V {
  const cl = Math.cos(latDeg * DEG), x = cl * Math.cos(lonDeg * DEG), y = cl * Math.sin(lonDeg * DEG), z = Math.sin(latDeg * DEG);
  for (let k = 0; k < 3; k++) out[k] = radiusKm * (axes[k] * x + axes[3 + k] * y + axes[6 + k] * z);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Two-body conics, measured from perigee
// ---------------------------------------------------------------------------------------------
/** Seconds from perigee (radius rp) to radius r on a conic of eccentricity e. */
export function timeToRadius(rp: number, e: number, r: number, mu = MU_EARTH): number {
  if (Math.abs(e - 1) < 1e-6) e = 1 + 1e-6;
  if (e < 1) {
    const a = rp / (1 - e);
    const E = Math.acos(Math.max(-1, Math.min(1, (1 - r / a) / e)));
    return Math.sqrt((a * a * a) / mu) * (E - e * Math.sin(E));
  }
  const a = rp / (e - 1);
  const H = Math.acosh(Math.max(1, (1 + r / a) / e));
  return Math.sqrt((a * a * a) / mu) * (e * Math.sinh(H) - H);
}

/** True anomaly (rad) and radius (km) a time dt after perigee. */
export function conicAt(rp: number, e: number, dt: number, mu = MU_EARTH, out = { nu: 0, r: 0 }): { nu: number; r: number } {
  if (Math.abs(e - 1) < 1e-6) e = 1 + 1e-6;
  if (e < 1) {
    const a = rp / (1 - e);
    const period = 2 * Math.PI * Math.sqrt((a * a * a) / mu);
    let M = ((dt % period) / period) * 2 * Math.PI;
    if (M < 0) M += 2 * Math.PI;
    let E = M > Math.PI ? M - e : M + e; // Kepler's equation by Newton, safeguarded
    for (let i = 0; i < 40; i++) {
      const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      E -= Math.max(-1, Math.min(1, d));
      if (Math.abs(d) < 1e-13) break;
    }
    out.nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
    out.r = a * (1 - e * Math.cos(E));
  } else {
    const a = rp / (e - 1);
    const M = dt / Math.sqrt((a * a * a) / mu);
    let H = Math.asinh(M / e);
    for (let i = 0; i < 60; i++) {
      const d = (e * Math.sinh(H) - H - M) / (e * Math.cosh(H) - 1);
      H -= Math.max(-1, Math.min(1, d));
      if (Math.abs(d) < 1e-13) break;
    }
    out.nu = 2 * Math.atan2(Math.sqrt(e + 1) * Math.sinh(H / 2), Math.sqrt(e - 1) * Math.cosh(H / 2));
    out.r = a * (e * Math.cosh(H) - 1);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Flights
// ---------------------------------------------------------------------------------------------
export type PhaseId = 'pad' | 'ascent' | 'earth-orbit' | 'transfer' | 'lunar-orbit' | 'descent' | 'surface' | 'flyby' | 'cruise';
export interface Phase { id: PhaseId; label: string; startMs: number; endMs: number }
export type FlightEnd = 'land' | 'impact' | 'orbit' | 'flyby';

export interface Flight {
  kind: 'flown' | 'reconstructed';
  /** First instant shown (a little before liftoff) and last. */
  startMs: number;
  endMs: number;
  launchMs: number;
  /** True when the time of day of launch was not on record and had to be estimated. */
  launchTimeEstimated: boolean;
  phases: Phase[];
  /** Spacecraft position, Earth-centred ecliptic J2000, km. */
  position(utcMs: number, out?: V): V;
  /** Polyline of the whole flight for drawing: xyz triplets (km) and the time of each vertex. */
  path: Float32Array;
  pathTimes: Float64Array;
}

export interface FlightInput {
  launchDate: string;
  launchUtc: string | null;
  launchLat: number;
  launchLon: number;
  end: FlightEnd;
  /** Days from launch to arrival at the Moon. Longer than ~5 means phasing orbits around Earth first. */
  transferDays: number;
  /** Landing or impact time and place, when the mission reached the surface. */
  surfaceMs?: number;
  siteLat?: number;
  siteLon?: number;
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (x * 6 - 15) + 10));
const cross = (a: V, b: V, out: V) => { const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0]; out[0] = x; out[1] = y; out[2] = z; return out; };
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; a[0] /= l; a[1] /= l; a[2] /= l; return a; };
/** Cubic Hermite on [0,1]: value p0 -> p1 with end slopes m0, m1 (per unit s). */
const hermite = (s: number, p0: number, p1: number, m0: number, m1: number) => { const s2 = s * s, s3 = s2 * s; return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * m1; };

/** Launch plane through the pad and the Moon's arrival point; returns the cosine of its inclination. */
function launchPlane(launchMs: number, lat: number, lon: number, moonDir: V, u: V, w: V, n: V): number {
  const ax = earthAxes(launchMs);
  norm(surfacePoint(ax, 1, lat, lon, u));
  cross(u, moonDir, n);
  if (Math.hypot(n[0], n[1], n[2]) < 1e-3) { n[0] = ax[6]; n[1] = ax[7]; n[2] = ax[8]; cross(u, n, n); }
  norm(n);
  const spin = v3();
  spin.set(ax.subarray(6, 9));
  if (dot(n, spin) < 0) { n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; } // launch eastward
  cross(n, u, w);
  return dot(n, spin);
}

/** Builds the reconstructed (illustrative) flight for a mission. */
export function reconstructFlight(input: FlightInput): Flight {
  const SEC = 1000;
  const land = input.end === 'land' || input.end === 'impact';
  const haveSurface = land && input.surfaceMs !== undefined && input.siteLat !== undefined && input.siteLon !== undefined;

  // --- When -----------------------------------------------------------------------------
  const estimated = !input.launchUtc;
  let launchMs = Date.parse(input.launchUtc ?? `${input.launchDate}T12:00:00Z`);
  let toMoonDays = input.transferDays;
  let surfaceMs = haveSurface ? input.surfaceMs! : NaN;
  if (haveSurface) {
    let total = (surfaceMs - launchMs) / DAY_MS;
    if (total < 1.3) { surfaceMs = launchMs + Math.max(1.4, Math.min(input.transferDays, 5)) * DAY_MS; total = (surfaceMs - launchMs) / DAY_MS; }
    toMoonDays = input.end === 'impact' ? total : Math.min(input.transferDays, total - 0.02);
  }
  const arrivalDir = v3();
  const arrivalMsFor = (lMs: number) => lMs + toMoonDays * DAY_MS;

  // --- Launch plane (and, if the time of day is not on record, the hour that needs the
  //     least steering: the plane closest to due east) ------------------------------------------
  const u = v3(), w = v3(), n = v3();
  if (estimated) {
    const day0 = Date.parse(`${input.launchDate}T00:00:00Z`);
    let best = -2, bestMs = launchMs;
    for (let k = 0; k < 144; k++) {
      const t = day0 + k * 600_000;
      norm(moonEcl(haveSurface && input.end === 'impact' ? surfaceMs : arrivalMsFor(t), arrivalDir));
      const c = launchPlane(t, input.launchLat, input.launchLon, arrivalDir, u, w, n);
      if (c > best) { best = c; bestMs = t; }
    }
    launchMs = bestMs;
  }
  const arrivalMs = haveSurface && input.end === 'impact' ? surfaceMs : arrivalMsFor(launchMs);
  const moonAtArrival = moonEcl(arrivalMs);
  const rMoon = Math.hypot(moonAtArrival[0], moonAtArrival[1], moonAtArrival[2]);
  arrivalDir.set(moonAtArrival);
  norm(arrivalDir);
  launchPlane(launchMs, input.launchLat, input.launchLon, arrivalDir, u, w, n);
  let thetaMoon = Math.atan2(dot(arrivalDir, w), dot(arrivalDir, u));
  if (thetaMoon < 0) thetaMoon += 2 * Math.PI;

  // --- Ascent and parking orbit ---------------------------------------------------------
  const rp = EARTH_RADIUS_KM + PARKING_ALT_KM;
  const nPark = Math.sqrt(MU_EARTH / (rp * rp * rp));
  const ASCENT_S = 540;
  const spinRate = 7.2921159e-5 * Math.cos(input.launchLat * DEG); // pad's own eastward angular rate
  const thetaIns = 0.3;
  const insertMs = launchMs + ASCENT_S * SEC;

  // --- Transfer conic: perigee on the parking orbit, radius rMoon at the arrival time ------------
  const eMin = (rMoon - rp) / (rMoon + rp);
  let tofS = Math.max(1.2, Math.min(4.9, toMoonDays - 0.08)) * 86400;
  if (toMoonDays > 6) tofS = 4.5 * 86400; // phasing missions: the last leg is an ordinary transfer
  let e = eMin, nuArr = Math.PI, thetaPerigee = 0, tliMs = insertMs;
  for (let pass = 0; pass < 6; pass++) {
    if (tofS >= timeToRadius(rp, eMin, rMoon)) e = eMin;
    else {
      let lo = eMin, hi = 8;
      for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (timeToRadius(rp, mid, rMoon) > tofS) lo = mid; else hi = mid; }
      e = (lo + hi) / 2;
    }
    nuArr = Math.acos(Math.max(-1, Math.min(1, ((rp * (1 + e)) / rMoon - 1) / e)));
    thetaPerigee = thetaMoon - nuArr;
    // Coast in the parking orbit to the perigee point, with whole extra revolutions as needed.
    let coast = (((thetaPerigee - thetaIns) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const wanted = (arrivalMs - insertMs) / SEC - tofS;
    coast += Math.max(0, Math.round((wanted * nPark - coast) / (2 * Math.PI))) * 2 * Math.PI;
    tliMs = insertMs + (coast / nPark) * SEC;
    tofS = Math.max(0.9 * 86400, (arrivalMs - tliMs) / SEC);
  }
  const conic = { nu: 0, r: 0 };
  const inPlane = (theta: number, r: number, out: V) => { const c = Math.cos(theta) * r, s = Math.sin(theta) * r; out[0] = c * u[0] + s * w[0]; out[1] = c * u[1] + s * w[1]; out[2] = c * u[2] + s * w[2]; return out; };
  const earthSide = (t: number, out: V): V => {
    const dt = (t - launchMs) / SEC;
    if (dt <= ASCENT_S) {
      const s = dt / ASCENT_S;
      return inPlane(hermite(s, 0, thetaIns, spinRate * ASCENT_S, nPark * ASCENT_S), EARTH_RADIUS_KM + PARKING_ALT_KM * (1 - (1 - s) ** 3), out);
    }
    if (t <= tliMs) return inPlane(thetaIns + nPark * (dt - ASCENT_S), rp, out);
    conicAt(rp, e, (t - tliMs) / SEC, MU_EARTH, conic);
    return inPlane(thetaPerigee + conic.nu, conic.r, out);
  };

  // --- Moon side: orbit, descent, surface -----------------------------------------------
  const rOrbit = MOON_RADIUS_KM + LUNAR_ORBIT_ALT_KM;
  const nOrbit = Math.sqrt(MU_MOON / (rOrbit * rOrbit * rOrbit));
  const DESCENT_S = 720;
  const phiDescent = nOrbit * DESCENT_S * 0.55; // arc covered during powered descent
  const pdiMs = haveSurface ? surfaceMs - DESCENT_S * SEC : NaN;
  const captureMs = input.end === 'land' && haveSurface ? Math.min(arrivalMs, pdiMs) : arrivalMs;
  const tmp = v3(), moonNow = v3(), approach = v3(), mu = v3(), mw = v3(), mn = v3();
  // Direction the spacecraft comes in from, seen from the Moon.
  earthSide(captureMs - 2 * 3600e3, approach);
  moonEcl(captureMs - 2 * 3600e3, tmp);
  approach[0] -= tmp[0]; approach[1] -= tmp[1]; approach[2] -= tmp[2];
  norm(approach);
  const siteAxes = new Float64Array(9);
  if (haveSurface) {
    norm(surfacePoint(moonAxes(surfaceMs, siteAxes), 1, input.siteLat!, input.siteLon!, mu));
    cross(approach, mu, mn);
  } else {
    mu.set(approach);
    const ax = moonAxes(arrivalMs, siteAxes);
    tmp[0] = ax[6]; tmp[1] = ax[7]; tmp[2] = ax[8];
    cross(mu, tmp, mn); // polar orbit through the approach direction
  }
  if (Math.hypot(mn[0], mn[1], mn[2]) < 1e-3) { mn[0] = 0; mn[1] = 0; mn[2] = 1; cross(mu, mn, mn); }
  norm(mn);
  cross(mn, mu, mw);
  const flybyR = 6500;
  const nFlyby = Math.sqrt(MU_MOON / flybyR ** 3) * 4; // a fast pass, not a bound orbit
  /** Position relative to the Moon's centre. */
  const moonSide = (t: number, out: V): V => {
    if (haveSurface && t >= surfaceMs) return surfacePoint(moonAxes(t, siteAxes), MOON_RADIUS_KM, input.siteLat!, input.siteLon!, out);
    let alpha: number, r: number;
    if (input.end === 'impact' && haveSurface) { alpha = 0; r = MOON_RADIUS_KM; }
    else if (input.end === 'land' && haveSurface) {
      if (t >= pdiMs) {
        const s = (t - pdiMs) / (DESCENT_S * SEC);
        alpha = hermite(s, -phiDescent, 0, nOrbit * DESCENT_S, 0);
        r = MOON_RADIUS_KM + LUNAR_ORBIT_ALT_KM * (1 - s) ** 2;
      } else { alpha = -phiDescent - (nOrbit * (pdiMs - t)) / SEC; r = rOrbit; }
    } else if (input.end === 'flyby') { alpha = (nFlyby * (t - arrivalMs)) / SEC; r = flybyR; }
    else { alpha = (nOrbit * (t - arrivalMs)) / SEC; r = rOrbit; }
    const c = Math.cos(alpha) * r, s2 = Math.sin(alpha) * r;
    out[0] = c * mu[0] + s2 * mw[0]; out[1] = c * mu[1] + s2 * mw[1]; out[2] = c * mu[2] + s2 * mw[2];
    return out;
  };

  // --- Joined path --------------------------------------------------------------------------
  const blendS = Math.min(8 * 3600, 0.25 * tofS);
  const flybyOutS = 6 * 3600;
  const padAxes = new Float64Array(9);
  const position = (t: number, out: V = v3()): V => {
    if (t <= launchMs) return surfacePoint(earthAxes(t, padAxes), EARTH_RADIUS_KM, input.launchLat, input.launchLon, out);
    const k = smooth((t - (captureMs - blendS * SEC)) / (blendS * SEC));
    if (k <= 0) return earthSide(t, out);
    moonEcl(t, moonNow);
    moonSide(t, tmp);
    tmp[0] += moonNow[0]; tmp[1] += moonNow[1]; tmp[2] += moonNow[2];
    // A fly-by lets go of the Moon again and carries on along the conic, back toward Earth.
    const kk = input.end === 'flyby' ? k * (1 - smooth((t - arrivalMs) / (flybyOutS * SEC))) : k;
    if (kk >= 1) { out.set(tmp); return out; }
    earthSide(t, out);
    out[0] += (tmp[0] - out[0]) * kk; out[1] += (tmp[1] - out[1]) * kk; out[2] += (tmp[2] - out[2]) * kk;
    // Keep the blend between the incoming conic and the lunar orbit from dipping inside the Moon.
    const rx = out[0] - moonNow[0], ry = out[1] - moonNow[1], rz = out[2] - moonNow[2];
    const r = Math.hypot(rx, ry, rz);
    const minR = Math.hypot(tmp[0] - moonNow[0], tmp[1] - moonNow[1], tmp[2] - moonNow[2]);
    if (r < minR) {
      const scale = minR / r;
      out[0] = moonNow[0] + rx * scale; out[1] = moonNow[1] + ry * scale; out[2] = moonNow[2] + rz * scale;
    }
    return out;
  };

  // --- Phases -------------------------------------------------------------------------------
  const startMs = launchMs - 120 * SEC;
  const endMs = input.end === 'flyby' ? arrivalMs + Math.min(tofS, 5 * 86400) * SEC : haveSurface ? surfaceMs + DAY_MS : arrivalMs + 3 * DAY_MS;
  const phases: Phase[] = [
    { id: 'pad', label: 'On the pad', startMs, endMs: launchMs },
    { id: 'ascent', label: 'Ascent', startMs: launchMs, endMs: insertMs },
    { id: 'earth-orbit', label: tliMs - insertMs > 6 * 3600e3 ? 'Earth orbit (phasing)' : 'Parking orbit', startMs: insertMs, endMs: tliMs },
    { id: 'transfer', label: 'Translunar coast', startMs: tliMs, endMs: captureMs },
  ];
  if (input.end === 'flyby') phases.push({ id: 'flyby', label: 'Lunar fly-by', startMs: captureMs, endMs: arrivalMs + flybyOutS * SEC }, { id: 'cruise', label: 'Return leg', startMs: arrivalMs + flybyOutS * SEC, endMs });
  else if (input.end === 'impact' && haveSurface) phases.push({ id: 'surface', label: 'Impact site', startMs: surfaceMs, endMs });
  else if (input.end === 'land' && haveSurface) {
    if (pdiMs > captureMs) phases.push({ id: 'lunar-orbit', label: 'Lunar orbit', startMs: captureMs, endMs: pdiMs });
    phases.push({ id: 'descent', label: 'Descent', startMs: Math.max(captureMs, pdiMs), endMs: surfaceMs }, { id: 'surface', label: 'On the surface', startMs: surfaceMs, endMs });
  } else phases.push({ id: 'lunar-orbit', label: 'Lunar orbit', startMs: captureMs, endMs });

  const { path, pathTimes } = tracePath(position, phases, startMs, endMs);
  return { kind: 'reconstructed', startMs, endMs, launchMs, launchTimeEstimated: estimated, phases, position, path, pathTimes };
}

/**
 * Samples a flight into a polyline. The step follows the distance to the nearest body, so
 * orbits stay round and the long coast stays cheap; the repetitive middle of long orbit phases
 * is skipped (the ring is already drawn).
 */
function tracePath(position: (t: number, out?: V) => V, phases: Phase[], startMs: number, endMs: number): { path: Float32Array; pathTimes: Float64Array } {
  const pts: number[] = [], times: number[] = [];
  const p = v3(), m = v3();
  const skips = phases.filter((ph) => (ph.id === 'earth-orbit' && ph.endMs - ph.startMs > 5 * 3600e3) || (ph.id === 'lunar-orbit' && ph.endMs - ph.startMs > 7 * 3600e3) || ph.id === 'surface')
    .map((ph) => (ph.id === 'surface' ? [ph.startMs + 60e3, ph.endMs] : [ph.startMs + (ph.id === 'earth-orbit' ? 100 : 130) * 60e3, ph.endMs - (ph.id === 'earth-orbit' ? 100 : 130) * 60e3]));
  let t = startMs;
  while (t <= endMs && pts.length < 60000) {
    position(t, p);
    pts.push(p[0], p[1], p[2]);
    times.push(t);
    const skip = skips.find(([a, b]) => t >= a && t < b);
    if (skip) { t = skip[1]; continue; }
    moonEcl(t, m);
    const d = Math.max(0, Math.min(Math.hypot(p[0], p[1], p[2]) - EARTH_RADIUS_KM, Math.hypot(p[0] - m[0], p[1] - m[1], p[2] - m[2]) - MOON_RADIUS_KM));
    t += Math.max(4, Math.min(1500, d / 3.5)) * 1000;
  }
  return { path: Float32Array.from(pts), pathTimes: Float64Array.from(times) };
}

/** A trajectory table as written by tools/fetch-flights.mjs. */
export interface FlownTable { source: string; t0Ms: number; stepMs: number; count: number; xyzKm: number[] }

/**
 * Wraps a JPL Horizons trajectory as a Flight. Horizons tables begin at spacecraft separation,
 * so the minutes from the pad to the first sample are filled with a reconstructed ascent that
 * blends into the real data; after the last sample a lander is shown at its landing site.
 */
export function flownFlight(table: FlownTable, input: FlightInput): Flight {
  const { t0Ms, stepMs, count } = table;
  const xyz = Float64Array.from(table.xyzKm);
  const tableEnd = t0Ms + (count - 1) * stepMs;
  const sample = (t: number, out: V): V => {
    const uu = Math.max(0, Math.min(count - 1.000001, (t - t0Ms) / stepMs));
    const i = Math.max(1, Math.min(count - 3, Math.floor(uu)));
    const f = uu - i, f2 = f * f, f3 = f2 * f;
    const w0 = -0.5 * f3 + f2 - 0.5 * f, w1 = 1.5 * f3 - 2.5 * f2 + 1, w2 = -1.5 * f3 + 2 * f2 + 0.5 * f, w3 = 0.5 * f3 - 0.5 * f2;
    const b = (i - 1) * 3;
    for (let k = 0; k < 3; k++) out[k] = w0 * xyz[b + k] + w1 * xyz[b + 3 + k] + w2 * xyz[b + 6 + k] + w3 * xyz[b + 9 + k];
    return out;
  };
  const first = sample(t0Ms, v3());
  const r0 = Math.hypot(first[0], first[1], first[2]);
  // Launch time: on record, or estimated from how far out the first sample already is.
  const estimated = !input.launchUtc;
  const launchMs = input.launchUtc ? Date.parse(input.launchUtc) : t0Ms - (r0 < 9000 ? 20 : 45) * 60e3;
  const u = v3(), w = v3(), n = v3(), dir = v3();
  dir.set(first);
  norm(dir);
  launchPlane(launchMs, input.launchLat, input.launchLon, dir, u, w, n);
  const rp = EARTH_RADIUS_KM + PARKING_ALT_KM, nPark = Math.sqrt(MU_EARTH / rp ** 3), ASCENT_S = 540, thetaIns = 0.3;
  const spinRate = 7.2921159e-5 * Math.cos(input.launchLat * DEG);
  const ascent = (t: number, out: V): V => {
    const dt = (t - launchMs) / 1000;
    const s = Math.min(1, dt / ASCENT_S);
    const theta = dt <= ASCENT_S ? hermite(s, 0, thetaIns, spinRate * ASCENT_S, nPark * ASCENT_S) : thetaIns + nPark * (dt - ASCENT_S);
    const r = EARTH_RADIUS_KM + PARKING_ALT_KM * (1 - (1 - s) ** 3);
    const c = Math.cos(theta) * r, sn = Math.sin(theta) * r;
    out[0] = c * u[0] + sn * w[0]; out[1] = c * u[1] + sn * w[1]; out[2] = c * u[2] + sn * w[2];
    return out;
  };
  const haveSurface = input.surfaceMs !== undefined && input.siteLat !== undefined && input.siteLon !== undefined;
  const surfaceMs = haveSurface ? Math.max(input.surfaceMs!, tableEnd) : NaN;
  const padAxes = new Float64Array(9), siteAxes = new Float64Array(9), tmp = v3(), moonNow = v3();
  const joinMs = Math.max(launchMs + ASCENT_S * 1000, t0Ms - 25 * 60e3);
  const position = (t: number, out: V = v3()): V => {
    if (t <= launchMs) return surfacePoint(earthAxes(t, padAxes), EARTH_RADIUS_KM, input.launchLat, input.launchLon, out);
    if (t < t0Ms) {
      ascent(t, out);
      const k = smooth((t - joinMs) / Math.max(1, t0Ms - joinMs));
      if (k > 0) { sample(t0Ms, tmp); for (let i = 0; i < 3; i++) out[i] += (tmp[i] - out[i]) * k; }
      return out;
    }
    if (haveSurface && t > tableEnd) {
      // The table stops shortly before touchdown: ease from its last point onto the site.
      surfacePoint(moonAxes(Math.max(t, surfaceMs), siteAxes), MOON_RADIUS_KM, input.siteLat!, input.siteLon!, out);
      moonEcl(t, moonNow);
      out[0] += moonNow[0]; out[1] += moonNow[1]; out[2] += moonNow[2];
      const k = smooth((t - tableEnd) / Math.max(1, surfaceMs - tableEnd));
      if (k < 1) { sample(tableEnd, tmp); for (let i = 0; i < 3; i++) out[i] = tmp[i] + (out[i] - tmp[i]) * k; }
      return out;
    }
    return sample(t, out);
  };
  const startMs = launchMs - 120e3;
  const endMs = haveSurface ? surfaceMs + DAY_MS : tableEnd;
  // Phases from the data itself: the first time the spacecraft comes within 60,000 km of the Moon.
  let nearMs = tableEnd;
  for (let i = 0; i < count; i += 2) {
    const t = t0Ms + i * stepMs;
    moonEcl(t, moonNow);
    if (Math.hypot(xyz[i * 3] - moonNow[0], xyz[i * 3 + 1] - moonNow[1], xyz[i * 3 + 2] - moonNow[2]) < 60000) { nearMs = t; break; }
  }
  const phases: Phase[] = [
    { id: 'pad', label: 'On the pad', startMs, endMs: launchMs },
    { id: 'ascent', label: 'Ascent (reconstructed)', startMs: launchMs, endMs: t0Ms },
    { id: 'transfer', label: 'Cruise to the Moon', startMs: t0Ms, endMs: nearMs },
    { id: 'lunar-orbit', label: 'At the Moon', startMs: nearMs, endMs: haveSurface ? tableEnd : endMs },
  ];
  if (haveSurface) phases.push({ id: 'surface', label: 'On the surface', startMs: surfaceMs, endMs });

  // Polyline: the pad-to-table join, then the table itself.
  const pts: number[] = [], times: number[] = [];
  const p = v3();
  for (let t = startMs; t < t0Ms; t += 20e3) { position(t, p); pts.push(p[0], p[1], p[2]); times.push(t); }
  for (let i = 0; i < count; i++) { pts.push(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]); times.push(t0Ms + i * stepMs); }
  if (haveSurface) { position(surfaceMs, p); pts.push(p[0], p[1], p[2]); times.push(surfaceMs); }
  return { kind: 'flown', startMs, endMs, launchMs, launchTimeEstimated: estimated, phases, position, path: Float32Array.from(pts), pathTimes: Float64Array.from(times) };
}

/** Phase in force at a time (the last one once the flight is over). */
export function phaseAt(flight: Flight, utcMs: number): Phase {
  for (const ph of flight.phases) if (utcMs < ph.endMs) return ph;
  return flight.phases[flight.phases.length - 1];
}
