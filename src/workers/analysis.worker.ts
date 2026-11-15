/// <reference lib="webworker" />
// Analysis worker: keeps every long computation (ephemeris tables, year-long site sweeps,
// terrain horizon tracing) off the UI thread so interaction stays at display refresh rate.
import { analyzeSite } from '../core/analysis.ts';
import { HOUR_MS } from '../core/constants.ts';
import { DemStack } from '../core/dem.ts';
import { EphemerisTable } from '../core/ephemeris.ts';
import { computeHorizon } from '../core/horizon.ts';
import { loadPolarDem } from '../core/polardem.ts';
import { siteFrame } from '../core/topo.ts';
import type { HorizonResponse, WorkerRequest, WorkerResponse } from './protocol.ts';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (msg: WorkerResponse, transfer: Transferable[] = []) => ctx.postMessage(msg, transfer);

let table: EphemerisTable | null = null;

function ephemerisFor(startMs: number, endMs: number): EphemerisTable {
  if (table && table.covers(startMs) && table.covers(endMs)) return table;
  table = EphemerisTable.build(startMs, endMs, HOUR_MS / 2, (fraction) => post({ type: 'progress', label: 'Computing Sun and Earth ephemeris', fraction }));
  post({ type: 'progress', label: '', fraction: 1 });
  return table;
}

ctx.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.type === 'analyze') {
      const t = performance.now();
      const eph = ephemerisFor(req.startMs, req.endMs);
      const analysis = analyzeSite(eph, siteFrame(req.lat, req.lon, req.heightM), req.mask, req.startMs, req.endMs, req.stepMs);
      const s = analysis.series;
      post({ type: 'analyze', id: req.id, analysis, computeMs: performance.now() - t }, [
        s.sunEl.buffer, s.sunAz.buffer, s.sunFrac.buffer, s.sunClear.buffer, s.irradiance.buffer,
        s.earthEl.buffer, s.earthAz.buffer, s.earthFrac.buffer, s.earthClear.buffer, s.stationMask.buffer,
      ]);
    } else if (req.type === 'horizon') {
      const t = performance.now();
      // Finest grid first; fall back to a coarser one if it cannot be fetched.
      let lastError: unknown = null;
      for (const tier of req.tiers) {
        try {
          post({ type: 'progress', label: `Loading LOLA ${tier.label} terrain`, fraction: 0.2 });
          const dem = await loadPolarDem(req.baseUrl, tier);
          post({ type: 'progress', label: '', fraction: 1 });
          const none: HorizonResponse = { type: 'horizon', id: req.id, masks: null, groundHeightM: 0, uncovered: 1, metersPerPixel: tier.metersPerPixel, computeMs: performance.now() - t };
          if (!Number.isFinite(dem.heightAt(req.lat, req.lon))) return post(none);
          const km = tier.metersPerPixel / 1000;
          // Half-pixel steps near the site, where terrain sets the skyline to fractions of a
          // degree; 1.5-pixel steps beyond 30 km, where a pixel subtends under 10 arcminutes.
          const stack = new DemStack([
            { dem, maxDistKm: 30, stepKm: km / 2, label: `LOLA ${tier.label} within 30 km` },
            { dem, maxDistKm: 400, stepKm: km * 1.5, label: `LOLA ${tier.label} beyond` },
          ]);
          const res = computeHorizon(stack, req.lat, req.lon, { observerHeightsM: req.observerHeightsM, maxDistKm: 320 });
          return post({ ...none, masks: res.masks, groundHeightM: res.groundHeightM, uncovered: res.uncoveredFraction, computeMs: performance.now() - t }, res.masks.map((m) => m.buffer));
        } catch (e) {
          lastError = e;
        }
      }
      post({ type: 'progress', label: '', fraction: 1 });
      throw lastError ?? new Error('No terrain model available');
    }
  } catch (e) {
    post({ type: 'error', id: req.id, message: e instanceof Error ? e.message : String(e) });
  }
};
