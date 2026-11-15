// Turns analysis results into words: countdowns, status labels, the plain-language briefing,
// and the "Moon versus Earth" comparisons shown to non-specialists.
import { type Instant, type Intervals, type SiteAnalysis, stateAt, type WindowMetrics } from '../core/analysis.ts';
import { DEG, SYNODIC_MONTH_DAYS } from '../core/constants.ts';
import { fmtDate, fmtDuration, fmtHours, fmtNumber, fmtPct } from './format.ts';

/** "Sunset in 3 d 04 h", "Stays up through 12 Feb 2028", or the `never` text. */
export function countdown(iv: Intervals | undefined, t: number, spanEnd: number, whenIn: string, whenOut: string, never: string): string {
  if (!iv) return 'Computing…';
  const st = stateAt(iv, t, spanEnd);
  if (st.changeMs === null) {
    if (!st.inside && iv.length === 0) return never;
    return `${st.inside ? 'Stays up' : 'Stays down'} through ${fmtDate(spanEnd)}`;
  }
  return `${st.inside ? whenIn : whenOut} in ${fmtDuration(st.changeMs - t)}`;
}

export function sunStatus(i: Instant): { label: string; cls: string } {
  if (i.sunFrac >= 0.999) return { label: 'Full Sun', cls: 'ok-sun' };
  if (i.sunFrac > 0) return { label: `Partial ${Math.round(i.sunFrac * 100)}%`, cls: 'warn' };
  return { label: 'In shadow', cls: 'off' };
}

/** Last sample time covered by an analysis. */
export function spanEndOf(an: SiteAnalysis | undefined): number {
  return an ? an.series.t0Ms + (an.series.count - 1) * an.series.stepMs : 0;
}

/** The plain-language reading of the numbers for one site, instant and mission. */
export function briefing(inst: Instant, m: WindowMetrics | null, missionDays: number, polar: boolean): string[] {
  const out: string[] = [];
  if (inst.sunFrac >= 0.999) out.push(`The Sun is fully visible, ${Math.abs(inst.sunClear).toFixed(1)}° above the terrain skyline.`);
  else if (inst.sunFrac > 0) out.push(`Terrain is covering ${Math.round((1 - inst.sunFrac) * 100)}% of the Sun's disk, so solar power is reduced.`);
  else out.push(`The Sun is ${Math.abs(inst.sunClear).toFixed(1)}° below the skyline: the site is in shadow and running on stored energy.`);
  if (polar && inst.sunEl > 0.05 && inst.sunFrac > 0) out.push(`At ${inst.sunEl.toFixed(1)}° elevation a 1 m rock casts a ${fmtNumber(1 / Math.tan(inst.sunEl * DEG))} m shadow.`);
  if (m) {
    if (m.litPct >= 99.95) out.push(`Landing now for ${missionDays} days gives uninterrupted direct sunlight for the whole mission.`);
    else if (m.litPct <= 0.05) out.push(`Landing now for ${missionDays} days gives no direct sunlight at all: the mission would run entirely on stored or non-solar power.`);
    else out.push(`Landing now for ${missionDays} days gives direct sunlight ${fmtPct(m.litPct)} of the time; the longest stretch without it is ${fmtHours(m.longestDarkH)}.`);
    out.push(m.dsnPct < 0.5
      ? `No Deep Space Network antenna comes into view during these ${missionDays} days: talking to Earth from here needs a relay satellite.`
      : `A Deep Space Network antenna is in view ${fmtPct(m.dsnPct)} of the time, with a longest gap of ${fmtHours(m.longestOutageH)}.`);
  }
  return out;
}

export interface Contrast { label: string; moon: string; earth: string; note: string }

/**
 * Site-specific comparisons with everyday conditions on Earth, computed from the analysed
 * year. Every "Moon" value comes from this site's own analysis, not from a textbook.
 */
export function contrasts(an: SiteAnalysis, tMs: number): Contrast[] {
  const s = an.series;
  let sunMax = -90, sunMin = 90, eMin = 90, eMax = -90;
  for (let i = 0; i < s.count; i += 3) {
    if (s.sunEl[i] > sunMax) sunMax = s.sunEl[i];
    if (s.sunEl[i] < sunMin) sunMin = s.sunEl[i];
    if (s.earthEl[i] > eMax) eMax = s.earthEl[i];
    if (s.earthEl[i] < eMin) eMin = s.earthEl[i];
  }
  const out: Contrast[] = [
    { label: 'One day and night', moon: `${SYNODIC_MONTH_DAYS.toFixed(1)} Earth days`, earth: '24 hours', note: 'The Moon turns once per orbit, so the Sun crawls across the sky at half a degree per hour.' },
    { label: 'Highest the Sun gets', moon: `${sunMax.toFixed(1)}°`, earth: 'up to 90°', note: sunMax < 12 ? 'Near the pole the Sun only ever skims the horizon, so every hill casts a shadow kilometres long.' : 'Away from the poles the Sun climbs high, as it does on Earth.' },
  ];

  // Duration of the next sunset: from the Sun's disk first touching the skyline to gone.
  for (let i = 0; i < an.lit.length; i += 2) {
    const end = an.lit[i + 1];
    if (end <= tMs || end >= spanEndOf(an) - 1) continue;
    let touch = NaN;
    for (let k = 0; k < an.fullSun.length; k += 2) if (an.fullSun[k + 1] <= end && an.fullSun[k + 1] > an.lit[i]) touch = an.fullSun[k + 1];
    if (Number.isFinite(touch) && end - touch > 0) {
      out.push({ label: 'The next sunset takes', moon: fmtDuration(end - touch), earth: 'about 2 minutes', note: 'With the Sun moving so slowly, and often sliding sideways along the skyline, a sunset can last hours or days.' });
    }
    break;
  }

  out.push(eMax < -0.5
    ? { label: 'Earth in the sky', moon: 'never rises', earth: 'Moon rises daily', note: 'The Moon keeps one face toward Earth. From the far side, Earth is never above the horizon.' }
    : { label: 'Earth in the sky', moon: `stays within ${(eMax - eMin).toFixed(1)}°`, earth: 'Moon crosses the sky', note: 'Earth hangs almost still. It only wobbles a few degrees each month (libration), which near the pole is enough to carry it below the horizon.' });
  out.push({ label: 'Twilight', moon: 'none', earth: '30 minutes or more', note: 'There is no air to scatter light or bend it over the horizon: shadows are black, and the horizon is exactly the terrain.' });
  return out;
}
