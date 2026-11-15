// Solar array model. Deliberately simple and fully stated: direct beam only, no temperature
// derating, no dust, no reflected light. It ranks sites and dates; it is not a power budget.
import type { SiteSeries } from '../core/analysis.ts';
import { DEG } from '../core/constants.ts';

export type ArrayType = 'tracking' | 'vertical' | 'horizontal';

export const ARRAY_TYPES: { id: ArrayType; label: string; hint: string }[] = [
  { id: 'tracking', label: 'Sun-tracking', hint: 'Two-axis tracking: always faces the Sun' },
  { id: 'vertical', label: 'Vertical mast', hint: 'Vertical panel that turns to follow the Sun around the horizon: the usual choice at the poles' },
  { id: 'horizontal', label: 'Flat deck', hint: 'Fixed horizontal panel on top of the lander: works near the equator, poor at the poles' },
];

/** Cosine factor between the Sun direction and the panel normal. */
export function pointingFactor(type: ArrayType, sunElDeg: number): number {
  if (type === 'tracking') return 1;
  if (type === 'vertical') return Math.cos(sunElDeg * DEG);
  return Math.max(0, Math.sin(sunElDeg * DEG));
}

/** Electrical output (W) for a direct irradiance already scaled by distance and disk visibility. */
export function arrayPowerW(type: ArrayType, irradianceWm2: number, sunElDeg: number, areaM2: number, efficiency: number): number {
  return irradianceWm2 * pointingFactor(type, sunElDeg) * areaM2 * efficiency;
}

/** Mean output (W) and energy (kWh) between two instants of an analysed series. */
export function windowPower(series: SiteSeries, aMs: number, bMs: number, type: ArrayType, areaM2: number, efficiency: number): { meanW: number; energyKwh: number } {
  const i0 = Math.max(0, Math.ceil((aMs - series.t0Ms) / series.stepMs));
  const i1 = Math.min(series.count - 1, Math.floor((bMs - series.t0Ms) / series.stepMs));
  let sum = 0, n = 0;
  for (let i = i0; i <= i1; i++) {
    sum += series.irradiance[i] * pointingFactor(type, series.sunEl[i]);
    n++;
  }
  const meanW = n ? (sum / n) * areaM2 * efficiency : 0;
  return { meanW, energyKwh: (meanW * Math.max(0, i1 - i0) * series.stepMs) / 3.6e9 };
}
