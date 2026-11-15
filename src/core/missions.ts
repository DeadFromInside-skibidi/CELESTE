// Lunar mission catalogue and flight loader.
// Combines the mission records (src/data/missions.json, built by tools/fetch-missions.mjs from
// NASA NSSDCA pages) with the flight mechanics (flight.ts) and, for the spacecraft JPL Horizons
// carries, the flown trajectory (public/data/flights, tools/fetch-flights.mjs).
import missionsData from '../data/missions.json';
import imageryData from '../data/site-imagery.json';
import { SITES } from '../data/sites.ts';
import { type Flight, type FlightInput, flownFlight, type FlownTable, reconstructFlight } from './flight.ts';

export interface Mission {
  id: string;
  name: string;
  nation: string;
  launchDate: string;
  /** Launch time, when it is on record here; otherwise the time of day is estimated. */
  launchUtc: string | null;
  /** NSSDCA's one-line mission type. */
  kind: string;
  category: 'flyby' | 'impact' | 'lander' | 'orbiter' | 'crewed' | 'sample-return';
  attempted: boolean;
  vehicle: string;
  vehicleClass: string;
  launchSite: { name: string; lat: number; lon: number };
  vehicleSource?: string;
  transferDays: number;
  nssdcaId?: string | null;
  horizonsId?: number;
  surface?: { what: string; date: string; lat: number; lon: number };
  /** Site in the app's catalogue (src/data/sites.ts) where this mission came down. */
  siteId?: string;
  note?: string;
}

export const MISSIONS: Mission[] = (missionsData as unknown as { missions: Mission[] }).missions;

export function missionById(id: string): Mission | undefined {
  return MISSIONS.find((m) => m.id === id);
}

export function missionForSite(siteId: string): Mission | undefined {
  return MISSIONS.find((m) => m.siteId === siteId);
}

/** True when the spacecraft reached the surface in one piece. */
export function landedIntact(m: Mission): boolean {
  return !!m.surface && !/^impact/i.test(m.surface.what);
}

/**
 * When the mission reached the surface. NSSDCA's table gives the date only; the time of day is
 * on record for the missions whose site is in the app's catalogue, and is otherwise shown as
 * 12:00 UTC and flagged as an estimate.
 */
export function surfaceTime(m: Mission): { ms: number; estimated: boolean } | null {
  if (!m.surface) return null;
  const landed = m.siteId ? SITES.find((s) => s.id === m.siteId)?.landed : undefined;
  if (landed) return { ms: Date.parse(landed), estimated: false };
  return { ms: Date.parse(`${m.surface.date}T12:00:00Z`), estimated: true };
}

export function inputForMission(m: Mission): FlightInput {
  return {
    launchDate: m.launchDate,
    launchUtc: m.launchUtc,
    launchLat: m.launchSite.lat,
    launchLon: m.launchSite.lon,
    transferDays: m.transferDays,
    end: m.surface ? (m.category === 'impact' ? 'impact' : 'land') : m.category === 'orbiter' ? 'orbit' : 'flyby',
    surfaceMs: surfaceTime(m)?.ms,
    siteLat: m.surface?.lat,
    siteLon: m.surface?.lon,
  };
}

// ---------------------------------------------------------------------------------------------
// Close-range imagery of the launch and landing sites (tools/fetch-site-imagery.mjs)
// ---------------------------------------------------------------------------------------------
export interface ImageryLevel { file: string; halfKm: number; source: string }
export interface SiteImagery { lat: number; lon: number; levels: ImageryLevel[] }
const imagery = imageryData as unknown as { earth: Record<string, SiteImagery>; moon: Record<string, SiteImagery> };
const slug = (s: string) => s.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function launchImagery(m: Mission): SiteImagery | undefined {
  return imagery.earth[slug(m.launchSite.name)];
}
export function landingImagery(m: Mission): SiteImagery | undefined {
  return imagery.moon[m.id];
}

// ---------------------------------------------------------------------------------------------
// Flights
// ---------------------------------------------------------------------------------------------
const flightCache = new Map<string, Promise<Flight>>();

/** True when JPL Horizons publishes this spacecraft's flown trajectory and the app carries it. */
export function hasFlownTrajectory(m: Mission): boolean {
  return m.horizonsId !== undefined;
}

/**
 * The flight for a mission: the JPL Horizons trajectory when there is one, otherwise the
 * reconstruction from the launch site, dates and landing site.
 */
export function loadFlightForMission(m: Mission): Promise<Flight> {
  let p = flightCache.get(m.id);
  if (!p) {
    p = (async () => {
      const input = inputForMission(m);
      if (hasFlownTrajectory(m)) {
        try {
          const res = await fetch(`${import.meta.env?.BASE_URL ?? '/'}data/flights/${m.id}.json`);
          if (res.ok) return flownFlight((await res.json()) as FlownTable, input);
        } catch {
          // No table reachable: fall back to the reconstruction, which says what it is.
        }
      }
      return reconstructFlight(input);
    })();
    flightCache.set(m.id, p);
  }
  return p;
}
