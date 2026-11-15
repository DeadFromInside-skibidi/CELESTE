// Instantaneous ("live") geometry on the UI thread. A single exact ephemeris evaluation costs
// a few tens of microseconds, so the readouts and the 3D view use it directly every frame.
import { useEffect, useState } from 'react';
import { evaluate, type Instant, newInstant } from '../core/analysis.ts';
import { moonFixedBodies, STATE_SIZE } from '../core/ephemeris.ts';
import { siteFrame, type SiteFrame } from '../core/topo.ts';
import { OBSERVER_HEIGHTS_M } from '../data/sites.ts';
import type { Site } from './sites.ts';
import { useStore } from './store.ts';

let cachedT = NaN;
const cached = new Float64Array(STATE_SIZE);

/** Moon-fixed Sun/Earth/station vectors for a UTC instant (memoised on the last instant). */
export function bodiesAt(timeMs: number): Float64Array {
  if (timeMs !== cachedT) {
    moonFixedBodies(timeMs, cached);
    cachedT = timeMs;
  }
  return cached;
}

const frames = new WeakMap<Site, SiteFrame[]>();

export function frameFor(site: Site, heightIdx: number): SiteFrame {
  let f = frames.get(site);
  if (!f) {
    f = OBSERVER_HEIGHTS_M.map((h) => siteFrame(site.lat, site.lon, site.groundHeightM + h));
    frames.set(site, f);
  }
  return f[heightIdx];
}

export function instantAt(site: Site, heightIdx: number, timeMs: number, out: Instant = newInstant()): Instant {
  return evaluate(bodiesAt(timeMs), frameFor(site, heightIdx), site.masks[heightIdx], out);
}

/**
 * The cursor time, re-read at most `hz` times a second. Text readouts use this so that
 * playback (which advances the store every animation frame) does not re-render them at 60 Hz.
 */
export function useThrottledTime(hz = 12): number {
  const [t, setT] = useState(() => useStore.getState().timeMs);
  useEffect(() => {
    let last = 0, timer = 0;
    const push = () => {
      last = performance.now();
      timer = 0;
      setT(useStore.getState().timeMs);
    };
    const unsub = useStore.subscribe((s) => s.timeMs, () => {
      const wait = 1000 / hz - (performance.now() - last);
      if (wait <= 0) push();
      else if (!timer) timer = window.setTimeout(push, wait);
    });
    return () => { unsub(); clearTimeout(timer); };
  }, [hz]);
  return t;
}
