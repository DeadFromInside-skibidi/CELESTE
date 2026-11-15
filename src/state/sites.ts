// Runtime site model: the curated catalogue joined with the precomputed terrain data.
import { OBSERVER_HEIGHTS_M, SITES, SOURCES, type SiteDef, type SiteGroup } from '../data/sites.ts';
import terrain from '../data/terrain.json';

export type TerrainQuality =
  /** LOLA polar grids at 80 m/px or finer near the site. */
  | 'high'
  /** In-browser trace of a reduced polar grid (custom polar sites when the 80 m grid is unavailable). */
  | 'medium'
  /** Global 1.9 km grid: regional relief only. */
  | 'coarse'
  /** No terrain: ideal sphere, horizon at 0 deg. */
  | 'sphere';

export interface Site {
  id: string;
  name: string;
  group: SiteGroup;
  /** Analysis coordinates (after any snap-to-peak). */
  lat: number;
  lon: number;
  catalogLat: number;
  catalogLon: number;
  blurb: string;
  sourceLabel: string;
  sourceUrl: string;
  sourceNote: string;
  groundHeightM: number;
  /** Terrain skyline per observer height (index matches OBSERVER_HEIGHTS_M); null = ideal sphere. */
  masks: (Float32Array | null)[];
  quality: TerrainQuality;
  terrainLabel: string;
  snappedKm: number;
  /** Resolution (m/px) of the grid the analysis point was chosen on; 0 if it was not moved. */
  snapGridM: number;
  pgdaTile?: string;
  landed?: string;
  /** Custom site whose terrain trace is still running. */
  pending?: boolean;
}

interface TerrainEntry {
  lat: number; lon: number; groundHeightM: number; snappedKm: number; snapGridM?: number; offsets: number[];
  terrain: string; resolution: string; uncovered: number;
}

const index = terrain as unknown as { maskSamples: number; sites: Record<string, TerrainEntry> };

export const QUALITY_LABEL: Record<TerrainQuality, string> = {
  high: 'Terrain horizon · LOLA',
  medium: 'Terrain horizon · LOLA reduced',
  coarse: 'Regional horizon · LOLA 1.9 km',
  sphere: 'Ideal sphere · no terrain',
};

function fromDef(def: SiteDef, all: Float32Array | null): Site {
  const t = index.sites[def.id];
  const src = SOURCES[def.source];
  const masks = OBSERVER_HEIGHTS_M.map((_, k) => (t && all ? all.subarray(t.offsets[k], t.offsets[k] + index.maskSamples) : null));
  return {
    id: def.id, name: def.name, group: def.group,
    lat: t?.lat ?? def.lat, lon: t?.lon ?? def.lon,
    catalogLat: def.lat, catalogLon: def.lon,
    blurb: def.blurb,
    sourceLabel: src.label, sourceUrl: src.url, sourceNote: src.note,
    groundHeightM: t?.groundHeightM ?? 0,
    masks,
    quality: t && all ? (t.resolution === 'high' ? 'high' : 'coarse') : 'sphere',
    terrainLabel: t?.terrain ?? 'Ideal sphere (no terrain model)',
    snappedKm: t?.snappedKm ?? 0,
    snapGridM: t?.snapGridM ?? 0,
    pgdaTile: def.pgdaTile, landed: def.landed,
  };
}

/** Loads the precomputed skyline masks and builds the catalogue. */
export async function loadCatalogue(): Promise<Site[]> {
  let all: Float32Array | null = null;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/horizons.bin`);
    if (res.ok) all = new Float32Array(await res.arrayBuffer());
  } catch {
    // Without the masks the app still works on the ideal-sphere model; sites are flagged accordingly.
  }
  return SITES.map((d) => fromDef(d, all));
}

export function makeCustomSite(id: string, name: string, lat: number, lon: number): Site {
  const src = SOURCES.user;
  return {
    id, name, group: 'custom', lat, lon, catalogLat: lat, catalogLon: lon,
    blurb: 'Custom coordinates.',
    sourceLabel: src.label, sourceUrl: src.url, sourceNote: src.note,
    groundHeightM: 0, masks: OBSERVER_HEIGHTS_M.map(() => null),
    quality: 'sphere', terrainLabel: 'Ideal sphere (no terrain model)', snappedKm: 0, snapGridM: 0,
  };
}

/** Folder holding the south-polar elevation grids. */
export const TERRAIN_BASE_URL = `${import.meta.env.BASE_URL}data/`;
