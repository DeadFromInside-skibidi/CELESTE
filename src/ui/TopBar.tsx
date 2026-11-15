// Top rail of the console: brand, layout modes, panel switches and mission settings.
// The live Sun / Earth / DSN status sits on the viewport itself (see Viewport.tsx), where it
// stays visible in every layout.
import { useState } from 'react';
import { OBSERVER_HEIGHTS_M } from '../data/sites.ts';
import { MODES, type PanelId, setHeightIdx, setMissionDays, setMode, togglePanel, useStore } from '../state/store.ts';
import { InfoIcon, LinkIcon, Logo } from './icons.tsx';

const PANELS: { id: PanelId; label: string; key: string }[] = [
  { id: 'sites', label: 'Sites', key: 'S' },
  { id: 'scope', label: 'Horizon', key: 'H' },
  { id: 'telemetry', label: 'Telemetry', key: 'T' },
  { id: 'dock', label: 'Timeline', key: 'L' },
];

export function TopBar() {
  const missionDays = useStore((s) => s.missionDays);
  const heightIdx = useStore((s) => s.heightIdx);
  const busy = useStore((s) => s.busy);
  const layout = useStore((s) => s.layout);
  const [copied, setCopied] = useState(false);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be denied; the address bar already holds the same link.
    }
  };
  const tall = heightIdx === OBSERVER_HEIGHTS_M.length - 1;

  return (
    <header className="rail top">
      <div className="brand">
        <Logo />
        <div>
          <strong>CELESTE</strong>
          <span>Lunar Site Navigator</span>
        </div>
      </div>
      <div className="stripes" aria-hidden="true"><i /><i /><i /><i /></div>

      <div className="rail-group">
        <span className="rail-label">Mode</span>
        <div className="seg" role="group" aria-label="Layout mode">
          {MODES.map((m) => (
            <button key={m.id} className={layout.mode === m.id ? 'on' : ''} aria-pressed={layout.mode === m.id} title={m.hint} onClick={() => setMode(m.id)}>{m.label}</button>
          ))}
        </div>
      </div>

      <div className="rail-group">
        <span className="rail-label">Panels</span>
        <div className="lampkeys" role="group" aria-label="Show or hide panels">
          {PANELS.map((p) => (
            <button key={p.id} className={layout.open[p.id] ? 'on' : ''} aria-pressed={layout.open[p.id]} title={`Show or hide the ${p.label.toLowerCase()} panel (${p.key})`} onClick={() => togglePanel(p.id)}>
              <i />{p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rail-spacer" />

      <div className="rail-group">
        <label className="field" title="Length of the surface mission that starts at the cursor time. Comparison metrics cover this window.">
          <span>Mission</span>
          <input type="number" min={1} max={120} value={missionDays} onChange={(e) => setMissionDays(Math.round(Number(e.target.value)) || 1)} />
          <span>days</span>
        </label>
        <button
          className={`bat ${tall ? 'up' : ''}`}
          role="switch"
          aria-checked={tall}
          aria-label={`Mast height ${OBSERVER_HEIGHTS_M[heightIdx]} metres`}
          title="Height of the solar array / antenna above the ground. A taller mast sees over nearby terrain: try it on a ridge site. Click to switch."
          onClick={() => setHeightIdx((heightIdx + 1) % OBSERVER_HEIGHTS_M.length)}
        >
          <span className="bat-body" />
          <span className="bat-text"><small>MAST</small><b>{OBSERVER_HEIGHTS_M[heightIdx]} M</b></span>
        </button>
      </div>

      <div className="rail-group tight">
        {busy && (
          <div className="busy" role="status">
            <div className="busy-bar"><i style={{ width: `${Math.round(busy.fraction * 100)}%` }} /></div>
            <span>{busy.label}</span>
          </div>
        )}
        <button className="btn" onClick={share} title="Copy a link to exactly this site, date, comparison and layout"><LinkIcon /><span>{copied ? 'Copied' : 'Share'}</span></button>
        <button className="btn" onClick={() => useStore.setState({ aboutOpen: true })} title="How the numbers are computed, data sources, validation and challenge coverage"><InfoIcon /><span>Methods</span></button>
      </div>
    </header>
  );
}
