// Bottom console: timeline, comparison table, event reports and the landing-date finder on
// one display. The transport deck (time, playback, speed) is the rail under it and stays
// visible when the console itself is hidden.
import { DAY_MS, HOUR_MS, SYNODIC_MONTH_DAYS } from '../core/constants.ts';
import { DSN_STATIONS } from '../core/ephemeris.ts';
import { csvRow, downloadText, fmtUtc, fromInputValue, toInputValue } from '../lib/format.ts';
import { useThrottledTime } from '../state/live.ts';
import { analysisKey, type Dock as DockTab, MAX_TIME_MS, MIN_TIME_MS, setTime, setViewSpan, SPEEDS, togglePanel, useStore } from '../state/store.ts';
import { ComparePanel } from './ComparePanel.tsx';
import { EventsPanel } from './EventsPanel.tsx';
import { FinderPanel } from './FinderPanel.tsx';
import { DownloadIcon, PauseIcon, PlayIcon } from './icons.tsx';
import { PanelHead } from './Panel.tsx';
import { Timeline } from './Timeline.tsx';

const TABS: { id: DockTab; label: string; hint: string }[] = [
  { id: 'timeline', label: 'Timeline', hint: 'Sunlight, Earth and DSN windows for every compared site' },
  { id: 'compare', label: 'Compare sites', hint: 'Mission metrics side by side' },
  { id: 'events', label: 'Event reports', hint: 'Every sunlight interval and DSN pass, exportable as CSV' },
  { id: 'finder', label: 'Date finder', hint: 'Which landing dates give the best mission?' },
];

const RANGES = [
  { label: '3 d', days: 3 },
  { label: 'Lunar day', days: SYNODIC_MONTH_DAYS },
  { label: '3 mo', days: 91 },
  { label: '1 yr', days: 365 },
];

function exportSeries(): void {
  const s = useStore.getState();
  const site = s.sites.find((x) => x.id === s.selectedId);
  const an = site && s.analyses[analysisKey(site.id, s.heightIdx)];
  if (!site || !an) return;
  const se = an.series;
  const i0 = Math.max(0, Math.ceil((s.viewStartMs - se.t0Ms) / se.stepMs));
  const i1 = Math.min(se.count - 1, Math.floor((s.viewEndMs - se.t0Ms) / se.stepMs));
  const lines = [
    csvRow(['CELESTE time series', site.name, `lat ${site.lat}`, `lon ${site.lon}`, `terrain: ${site.terrainLabel}`]),
    csvRow(['utc', 'sun_elevation_deg', 'sun_azimuth_deg', 'sun_above_skyline_deg', 'sun_disk_visible_fraction', 'direct_irradiance_w_m2', 'earth_elevation_deg', 'earth_azimuth_deg', 'earth_above_skyline_deg', ...DSN_STATIONS.map((d) => `dsn_${d.name.toLowerCase()}`)]),
  ];
  for (let i = i0; i <= i1; i++) {
    lines.push(csvRow([
      fmtUtc(se.t0Ms + i * se.stepMs), se.sunEl[i].toFixed(3), se.sunAz[i].toFixed(2), se.sunClear[i].toFixed(3), se.sunFrac[i].toFixed(3), se.irradiance[i].toFixed(1),
      se.earthEl[i].toFixed(3), se.earthAz[i].toFixed(2), se.earthClear[i].toFixed(3), ...DSN_STATIONS.map((_, k) => (se.stationMask[i] & (1 << k) ? 1 : 0)),
    ]));
  }
  downloadText(`celeste-series-${site.id}-${fmtUtc(s.viewStartMs).slice(0, 10)}.csv`, lines.join('\n'));
}

/** Transport deck: step keys, play, speed and the mission clock. */
export function Deck() {
  const t = useThrottledTime(8);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const nudge = (ms: number) => { useStore.setState({ playing: false }); setTime(useStore.getState().timeMs + ms); };

  return (
    <div className="rail deck">
      <div className="keys steps" role="group" aria-label="Step the mission clock">
        <button className="btn far" onClick={() => nudge(-DAY_MS)} title="Back one day (Shift + Left)">−1 d</button>
        <button className="btn" onClick={() => nudge(-HOUR_MS)} title="Back one hour (Left)">−1 h</button>
        <button className={`btn play ${playing ? 'on' : ''}`} onClick={() => useStore.setState({ playing: !playing })} title="Play / pause (Space)" aria-pressed={playing}>
          {playing ? <PauseIcon /> : <PlayIcon />}
          {playing ? 'Pause' : 'Play'}
        </button>
        <button className="btn" onClick={() => nudge(HOUR_MS)} title="Forward one hour (Right)">+1 h</button>
        <button className="btn far" onClick={() => nudge(DAY_MS)} title="Forward one day (Shift + Right)">+1 d</button>
      </div>
      <div className="keys">
        <span className="deck-label">Speed</span>
        <select value={speed} onChange={(e) => useStore.setState({ speed: Number(e.target.value) })} aria-label="Playback speed" title="Simulated time per second">
          {SPEEDS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      <div className="spacer" />
      <button className="btn" onClick={() => { useStore.setState({ playing: false }); setTime(Math.round(Date.now() / 60_000) * 60_000); }} title="Jump to the present (N)">Now</button>
      <label className="led" title="Mission clock, UTC. Type a date or use the picker.">
          <input
            type="datetime-local"
            value={toInputValue(t)}
            min={toInputValue(MIN_TIME_MS)}
            max={toInputValue(MAX_TIME_MS)}
            onChange={(e) => { const ms = fromInputValue(e.target.value); if (ms !== null) { useStore.setState({ playing: false }); setTime(ms); } }}
            aria-label="Date and time, UTC"
          />
          <span>UTC</span>
      </label>
    </div>
  );
}

export function Dock() {
  const tab = useStore((s) => s.dock);
  return (
    <section className="panel dock">
      <PanelHead code="C4" title="Console" onClose={() => togglePanel('dock')}>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={t.id === tab} className={t.id === tab ? 'on' : ''} title={t.hint} onClick={() => useStore.setState({ dock: t.id })}>{t.label}</button>
          ))}
        </nav>
        <div className="dock-tools">
          {tab !== 'compare' && (
            <div className="seg" role="group" aria-label="Timeline span">
              <span className="seg-label">Span</span>
              {RANGES.map((r) => <button key={r.label} onClick={() => setViewSpan(r.days)}>{r.label}</button>)}
            </div>
          )}
          {tab === 'timeline' && <button className="btn small" onClick={exportSeries} title="Export the selected site's time series for the visible window"><DownloadIcon />CSV</button>}
        </div>
      </PanelHead>
      <div className="dock-body">
        {tab === 'timeline' && <Timeline />}
        {tab === 'compare' && <ComparePanel />}
        {tab === 'events' && <EventsPanel />}
        {tab === 'finder' && <FinderPanel />}
      </div>
    </section>
  );
}
