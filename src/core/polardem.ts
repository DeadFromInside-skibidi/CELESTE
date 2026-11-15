// South-polar LOLA elevation grids shipped with the app (public/data/spole_*.demz), in three
// resolutions of the same NASA product (LDEM_80S_80M: 80 S to the pole, 608 km across).
import { PolarDem } from './dem.ts';
import { decodeDem } from './demcodec.ts';

export interface TerrainTier {
  id: 'ultra' | 'high' | 'standard';
  /** Shown in the quality selector. */
  label: string;
  file: string;
  size: number;
  metersPerPixel: number;
  /** Approximate download size, MB. */
  downloadMb: number;
}

/** Finest first. The first tier is the full-resolution product. */
export const TERRAIN_TIERS: TerrainTier[] = [
  { id: 'ultra', label: '80 m', file: 'spole_80m.demz', size: 7600, metersPerPixel: 80, downloadMb: 33 },
  { id: 'high', label: '160 m', file: 'spole_160m.demz', size: 3800, metersPerPixel: 160, downloadMb: 10 },
  { id: 'standard', label: '320 m', file: 'spole_320m.demz', size: 1900, metersPerPixel: 320, downloadMb: 3 },
];

/** Stored samples are LOLA DN: 0.5 m per count. */
export const POLAR_DEM_SCALE = 0.5;

const pending = new Map<string, Promise<PolarDem>>();

/** Fetches and unpacks a tier once per thread; later calls share the same promise. */
export function loadPolarDem(baseUrl: string, tier: TerrainTier): Promise<PolarDem> {
  const url = baseUrl + tier.file;
  let p = pending.get(url);
  if (!p) {
    p = (async () => {
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`Could not load terrain model (${res.status})`);
      const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      if (bytes.length !== tier.size * tier.size * 2) throw new Error('Terrain model has an unexpected size');
      return new PolarDem(decodeDem(bytes, tier.size), tier.size, tier.metersPerPixel, POLAR_DEM_SCALE);
    })();
    pending.set(url, p);
    p.catch(() => pending.delete(url));
  }
  return p;
}
