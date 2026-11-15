// Links to the NASA and partner resources named by the challenge.
import { fmtUtc } from './format.ts';

/**
 * JPL Horizons API request for the apparent azimuth and elevation of the Sun or the Earth as
 * seen from a point on the Moon, at one instant. It opens Horizons' own plain-text answer, so
 * anyone can check CELESTE's "Elevation" and "Azimuth" readouts against JPL independently.
 * (Same request shape as tools/fetch-horizons.mjs, which builds the validation fixture.)
 */
export function horizonsUrl(target: 'sun' | 'earth', latDeg: number, lonDeg: number, heightM: number, tMs: number): string {
  const lonE = ((lonDeg % 360) + 360) % 360;
  const params: Record<string, string> = {
    format: 'text',
    COMMAND: `'${target === 'sun' ? '10' : '399'}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'coord@301'",
    COORD_TYPE: "'GEODETIC'",
    SITE_COORD: `'${lonE.toFixed(5)},${latDeg.toFixed(5)},${(heightM / 1000).toFixed(4)}'`,
    START_TIME: `'${fmtUtc(tMs)}'`,
    STOP_TIME: `'${fmtUtc(tMs + 3600_000)}'`,
    STEP_SIZE: "'30m'",
    QUANTITIES: "'4,20'",
    ANG_FORMAT: "'DEG'",
    APPARENT: "'AIRLESS'",
    RANGE_UNITS: "'KM'",
  };
  return 'https://ssd.jpl.nasa.gov/api/horizons.api?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

/** The interactive tools listed under the challenge's resources. */
export const RESOURCES = {
  quickmap: { label: 'LROC QuickMap', url: 'https://quickmap.lroc.im-ldi.com/', note: 'High-resolution imagery and terrain for this spot. Paste the coordinates into its search box.' },
  moontrek: { label: 'NASA Moon Trek', url: 'https://trek.nasa.gov/moon/', note: '3D exploration of the same LRO data.' },
  horizons: { label: 'JPL Horizons', url: 'https://ssd.jpl.nasa.gov/horizons/app.html', note: 'The ephemeris system CELESTE is validated against.' },
  csa: { label: 'CSA Moon exploration', url: 'https://www.asc-csa.gc.ca/eng/astronomy/moon-exploration/', note: 'Canadian Space Agency: missions and Artemis contributions.' },
} as const;
