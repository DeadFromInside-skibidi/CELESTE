// Physical constants and conventions shared by every calculation in CELESTE.
// Units are stated in the name; angles are degrees unless a name says Rad.

/** LOLA / IAU reference sphere radius of the Moon. All DEM heights are relative to this. */
export const MOON_RADIUS_KM = 1737.4;
/** IAU nominal solar radius. */
export const SUN_RADIUS_KM = 695700;
/** WGS-84 equatorial radius of Earth. */
export const EARTH_RADIUS_KM = 6378.137;
export const AU_KM = 149597870.7;
/** Total solar irradiance at 1 AU (W/m^2). */
export const SOLAR_CONSTANT_W_M2 = 1361;
/** Mean synodic month: one lunar day/night cycle. */
export const SYNODIC_MONTH_DAYS = 29.530588;

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const HOUR_MS = 3600_000;
export const DAY_MS = 86_400_000;

/** Number of azimuth samples in a terrain horizon mask (0.25 degree spacing). */
export const MASK_SAMPLES = 1440;
