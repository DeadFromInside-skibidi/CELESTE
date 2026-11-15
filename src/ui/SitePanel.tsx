// Left-hand panel: the site catalogue, search, comparison pins and custom coordinates.
import { useMemo, useState } from 'react';
import { GROUPS } from '../data/sites.ts';
import { fmtLat, fmtLon } from '../lib/format.ts';
import { instantAt, useThrottledTime } from '../state/live.ts';
import type { Site } from '../state/sites.ts';
import { addCustomSite, LANE_COLORS, MAX_PINNED, removeCustomSite, selectSite, togglePanel, togglePin, useStore } from '../state/store.ts';
import { PanelHead } from './Panel.tsx';
import { PinIcon, PlusIcon, SearchIcon, TrashIcon } from './icons.tsx';

function CustomForm({ onDone }: { onDone(): void }) {
  const [name, setName] = useState('');
  const [lat, setLat] = useState('-89.9');
  const [lon, setLon] = useState('0');
  const la = Number(lat), lo = Number(lon);
  const valid = lat.trim() !== '' && lon.trim() !== '' && Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 360;
  return (
    <form
      className="custom-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        addCustomSite(name || `${fmtLat(la, 2)} ${fmtLon(lo > 180 ? lo - 360 : lo, 2)}`, la, lo);
        onDone();
      }}
    >
      <label className="full">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" maxLength={40} /></label>
      <label>Latitude °<input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" aria-invalid={!valid} /></label>
      <label>East longitude °<input value={lon} onChange={(e) => setLon(e.target.value)} inputMode="decimal" aria-invalid={!valid} /></label>
      <p className="fine full">North and east positive (south and west negative). South of 80° S the terrain skyline is traced from LOLA data; elsewhere an ideal sphere is used.</p>
      <button type="submit" className="btn primary full" disabled={!valid}>Add site</button>
    </form>
  );
}

function SiteRow({ site, selected, pinned, color, lit, earth, canPin }: { site: Site; selected: boolean; pinned: boolean; color: string | null; lit: boolean; earth: boolean; canPin: boolean }) {
  return (
    <li className={`site-row ${selected ? 'selected' : ''}`} onMouseEnter={() => useStore.setState({ hoverId: site.id })} onMouseLeave={() => useStore.setState({ hoverId: null })}>
      <button className="site-main" onClick={() => selectSite(site.id)} aria-current={selected}>
        <i className="lane-chip" style={{ background: color ?? 'transparent' }} />
        <span className="site-text">
          <span className="site-name">{site.name}</span>
          <span className="site-coords">{fmtLat(site.lat, 2)} · {fmtLon(site.lon, 2)}</span>
        </span>
        <span className="site-now" aria-label={`${lit ? 'sunlit' : 'dark'}, Earth ${earth ? 'in view' : 'hidden'}`}>
          <i className={`dot sun ${lit ? '' : 'off'}`} title={lit ? 'Sunlit now' : 'In shadow now'} />
          <i className={`dot earth ${earth ? '' : 'off'}`} title={earth ? 'Earth in view now' : 'Earth hidden now'} />
        </span>
      </button>
      {site.group === 'custom' && (
        <button className="icon-btn" title="Delete this custom site" onClick={() => removeCustomSite(site.id)}><TrashIcon /></button>
      )}
      <button
        className={`icon-btn pin ${pinned ? 'on' : ''}`}
        title={selected ? 'The selected site is always part of the comparison' : pinned ? 'Remove from comparison' : canPin ? 'Add to comparison' : `Comparison is full (${MAX_PINNED} sites)`}
        disabled={selected || (!pinned && !canPin)}
        onClick={() => togglePin(site.id)}
        aria-pressed={pinned}
      >
        <PinIcon />
      </button>
    </li>
  );
}

export function SitePanel() {
  const sites = useStore((s) => s.sites);
  const selectedId = useStore((s) => s.selectedId);
  const pinnedIds = useStore((s) => s.pinnedIds);
  const heightIdx = useStore((s) => s.heightIdx);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const t = useThrottledTime(2);

  const now = useMemo(() => {
    const m = new Map<string, { lit: boolean; earth: boolean }>();
    for (const s of sites) {
      const i = instantAt(s, heightIdx, t);
      m.set(s.id, { lit: i.sunFrac > 0, earth: i.earthClear > 0 });
    }
    return m;
  }, [sites, heightIdx, t]);

  const compared = [selectedId, ...pinnedIds.filter((id) => id !== selectedId)];
  const q = query.trim().toLowerCase();
  const visible = q ? sites.filter((s) => s.name.toLowerCase().includes(q)) : sites;
  const canPin = pinnedIds.length < MAX_PINNED;

  return (
    <aside className="panel sites">
      <PanelHead code="S1" title="Sites" note={String(sites.length).padStart(2, '0')} onClose={() => togglePanel('sites')}>
        <button className={`btn small ${adding ? 'on' : ''}`} onClick={() => setAdding((v) => !v)} title="Add a site from latitude and longitude"><PlusIcon />Add</button>
      </PanelHead>
      {adding && <CustomForm onDone={() => setAdding(false)} />}
      <div className="search">
        <SearchIcon />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sites" aria-label="Search sites" />
      </div>
      <div className="site-scroll">
        {GROUPS.map((g) => {
          const list = visible.filter((s) => s.group === g.id);
          if (!list.length) return null;
          return (
            <section key={g.id}>
              <h3 title={g.hint}>{g.label}</h3>
              <ul>
                {list.map((s) => {
                  const k = compared.indexOf(s.id);
                  const n = now.get(s.id);
                  return <SiteRow key={s.id} site={s} selected={s.id === selectedId} pinned={pinnedIds.includes(s.id)} color={k >= 0 ? LANE_COLORS[k % LANE_COLORS.length] : null} lit={!!n?.lit} earth={!!n?.earth} canPin={canPin} />;
                })}
              </ul>
            </section>
          );
        })}
        {!visible.length && <p className="empty">No site matches “{query}”.</p>}
      </div>
      <footer className="panel-foot">
        <span><i className="dot sun" /> Sunlit</span>
        <span><i className="dot earth" /> Earth up</span>
        <span><PinIcon /> Compare</span>
      </footer>
    </aside>
  );
}
