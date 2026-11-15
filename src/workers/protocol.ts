// Messages between the UI thread and the analysis worker.
import type { SiteAnalysis } from '../core/analysis.ts';
import type { TerrainTier } from '../core/polardem.ts';

export interface AnalyzeRequest {
  type: 'analyze';
  id: number;
  lat: number;
  lon: number;
  /** Observer height above the reference sphere (ground + mast), m. */
  heightM: number;
  mask: Float32Array | null;
  startMs: number;
  endMs: number;
  stepMs: number;
}

export interface HorizonRequest {
  type: 'horizon';
  id: number;
  lat: number;
  lon: number;
  observerHeightsM: number[];
  /** Folder holding the spole_*.demz grids. */
  baseUrl: string;
  /** Grids to try, finest first. */
  tiers: TerrainTier[];
}

export type WorkerRequest = AnalyzeRequest | HorizonRequest;

export interface AnalyzeResponse {
  type: 'analyze';
  id: number;
  analysis: SiteAnalysis;
  computeMs: number;
}

export interface HorizonResponse {
  type: 'horizon';
  id: number;
  /** null when the point lies outside the bundled polar terrain model. */
  masks: Float32Array[] | null;
  groundHeightM: number;
  uncovered: number;
  /** Resolution of the grid the skyline was traced on. */
  metersPerPixel: number;
  computeMs: number;
}

export interface ProgressMessage {
  type: 'progress';
  label: string;
  fraction: number;
}

export interface ErrorResponse {
  type: 'error';
  id: number;
  message: string;
}

export type WorkerResponse = AnalyzeResponse | HorizonResponse | ProgressMessage | ErrorResponse;
