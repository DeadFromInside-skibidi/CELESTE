// Telemetry panel: the selected site at the cursor time and over the mission that starts
// there. Two depths: a plain-language briefing, or every readout. Sections fold away.
import { type ReactNode, useMemo, useState } from 'react';
import { DSN_ELEVATION_MASK_DEG, type SiteSeries, windowMetrics } from '../core/analysis.ts';
import { DAY_MS } from '../core/constants.ts';
import { DSN_STATIONS } from '../core/ephemeris.ts';
import { OBSERVER_HEIGHTS_M } from '../data/sites.ts';
import { briefing, contrasts, countdown, spanEndOf, sunStatus } from '../lib/describe.ts';
import { compass, fmtDate, fmtDeg, fmtHours, fmtLat, fmtLon, fmtNumber, fmtPct } from '../lib/format.ts';
import { horizonsUrl, RESOURCES } from '../lib/links.ts';
import { missionForSite } from '../core/missions.ts';
import { ARRAY_TYPES, type ArrayType, arrayPowerW, pointingFactor, windowPower } from '../lib/power.ts';
import { instantAt, useThrottledTime } from '../state/live.ts';
import { QUALITY_LABEL } from '../state/sites.ts';
import { analysisKey, selectMission, setDetail, setTime, showDock, toggleFolded, togglePanel, useStore } from '../state/store.ts';
import { PanelHead } from './Panel.tsx';

function Module({ id, title, tag, tone, children }: { id: string; title: string; tag?: ReactNode; tone?: string; children: ReactNode }) {
  const folded = useStore((s) => !!s.layout.folded[id]);
  return (
    <section className={`module ${tone ?? ''} ${folded ? 'folded' : ''}`}>
      <button className="module-head" onClick={() => toggleFolded(id)} aria-expanded={!folded} title={folded ? 'Show this section' : 'Fold this section away'}>
        <i className="mk" />
        <span>{title}</span>
        {tag}
        <i className="chev" />
      </button>
      {!folded && <div className="module-body">{children}</div>}
    </section>
  );
}

function Row({ k, v, title }: { k: string; v: ReactNode; title?: string }) {
  return (
    <div className="kv" title={title}>
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}

function Meter({ label, pct, tone, detail }: { label: string; pct: number; tone: 'sun' | 'earth' | 'dsn' | 'both'; detail?: string }) {
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <b>{fmtPct(pct, pct > 0 && pct < 10 ? 1 : 0)}</b>
      </div>
      <div className="meter-track"><i className={tone} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
      {detail && <div className="meter-detail">{detail}</div>}
    </div>
  );
}

const GAUGE_BARS = 28;

/** Relative array output across the mission window, one bar per equal slice of time (0..1 each). */
function powerProfile(series: SiteSeries, aMs: number, bMs: number, type: ArrayType): number[] {
  const out: number[] = [];
  const peak = 1420; // W/m^2: just above the perihelion solar constant
  for (let k = 0; k < GAUGE_BARS; k++) {
    const i0 = Math.max(0, Math.round((aMs + ((bMs - aMs) * k) / GAUGE_BARS - series.t0Ms) / series.stepMs));
    const i1 = Math.min(series.count - 1, Math.round((aMs + ((bMs - aMs) * (k + 1)) / GAUGE_BARS - series.t0Ms) / series.stepMs));
    let sum = 0, n = 0;
    for (let i = i0; i < Math.max(i1, i0 + 1) && i < series.count; i++) {
      sum += series.irradiance[i] * pointingFactor(type, series.sunEl[i]);
      n++;
    }
    out.push(n ? Math.min(1, sum / n / peak) : 0);
  }
  return out;
}

export function StatusPanel() {
  const site = useStore((s) => s.sites.find((x) => x.id === s.selectedId));
  const heightIdx = useStore((s) => s.heightIdx);
  const missionDays = useStore((s) => s.missionDays);
  const arrayType = useStore((s) => s.arrayType);
  const area = useStore((s) => s.arrayAreaM2);
  const eff = useStore((s) => s.arrayEfficiency);
  const detail = useStore((s) => s.layout.detail);
  const an = useStore((s) => (site ? s.analyses[analysisKey(site.id, s.heightIdx)] : undefined));
  const t = useThrottledTime(10);
  const bucket = Math.floor(t / 600_000);
  const hourBucket = Math.floor(t / 3600_000);
  const [copied, setCopied] = useState(false);

  const mission = useMemo(() => {
    if (!an) return null;
    const a = bucket * 600_000, b = a + missionDays * DAY_MS;
    return { m: windowMetrics(an, a, b), p: windowPower(an.series, a, b, arrayType, area, eff), bars: powerProfile(an.series, a, b, arrayType) };
  }, [an, bucket, missionDays, arrayType, area, eff]);
  const facts = useMemo(() => (an ? contrasts(an, hourBucket * 3600_000) : []), [an, hourBucket]);
  const missionFlight = site ? missionForSite(site.id) : undefined;

  if (!site) return <aside className="panel telemetry" />;
  const full = detail === 'full';
  const inst = instantAt(site, heightIdx, t);
  const spanEnd = spanEndOf(an);
  const sun = sunStatus(inst);
  const earthUp = inst.earthClear > 0;
  const powerNow = arrayPowerW(arrayType, inst.irradiance, inst.sunEl, area, eff);
  const inContact = DSN_STATIONS.filter((_, k) => inst.stationMask & (1 << k));
  const story = briefing(inst, mission?.m ?? null, missionDays, Math.abs(site.lat) > 80);
  const obsHeight = site.groundHeightM + OBSERVER_HEIGHTS_M[heightIdx];
  const coordText = `${site.lat.toFixed(5)}, ${site.lon.toFixed(5)}`;
  const copyCoords = async () => {
    try {
      await navigator.clipboard.writeText(coordText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable: the coordinates are on screen above.
    }
  };

  return (
    <aside className="panel telemetry">
      <PanelHead code="T3" title="Telemetry" onClose={() => togglePanel('telemetry')}>
        <div className="seg" role="group" aria-label="How much detail to show">
          <button className={!full ? 'on' : ''} onClick={() => setDetail('brief')} title="Plain-language briefing">Brief</button>
          <button className={full ? 'on' : ''} onClick={() => setDetail('full')} title="Every readout">Full</button>
        </div>
      </PanelHead>
      <div className="panel-scroll">
        <div className="ident">
          <small>Target site</small>
          <h2>{site.name}</h2>
          <div className="coords">
            {fmtLat(site.lat)} · {fmtLon(site.lon)} · {site.groundHeightM >= 0 ? '+' : '−'}{fmtNumber(Math.abs(site.groundHeightM))} m
          </div>
          <p className="blurb">{site.blurb}</p>
          <div className="badges">
            <span className={`badge q-${site.quality}`} title={site.terrainLabel}>{site.pending ? 'Tracing terrain…' : QUALITY_LABEL[site.quality]}</span>
            <span className="badge" title="Height of the solar array / antenna above the local surface">Mast {OBSERVER_HEIGHTS_M[heightIdx]} m</span>
            {site.landed && <span className="badge">Landed {fmtDate(Date.parse(site.landed))}</span>}
          </div>
          {missionFlight && (
            <div className="site-flight-row">
              <span className="sfr-meta">Mission: <b>{missionFlight.name}</b> ({missionFlight.vehicle})</span>
              <button
                className="btn small"
                onClick={() => {
                  selectMission(missionFlight.id);
                  const launchMs = missionFlight.launchUtc ? Date.parse(missionFlight.launchUtc) : Date.parse(`${missionFlight.launchDate}T12:00:00Z`);
                  setTime(launchMs);
                  useStore.setState({ view3d: 'flight' });
                }}
                title="View Earth-to-Moon flight trajectory in 3D"
              >
                Flight trajectory ↗
              </button>
            </div>
          )}
          {full && site.snappedKm > 0.05 && (
            <p className="fine">Analysed at the highest cell of the LOLA {site.snapGridM || 80} m grid, {site.snappedKm.toFixed(1)} km from the region centre ({fmtLat(site.catalogLat, 2)}, {fmtLon(site.catalogLon, 2)}).</p>
          )}
        </div>

        <Module id="notes" title="Briefing">
          <div className="notes">{story.map((line, i) => <p key={i}>{line}</p>)}</div>
        </Module>

        <Module id="mission" title={`Mission window · ${missionDays} d`}>
          {mission ? (
            <>
              <Meter label="Direct sunlight" pct={mission.m.litPct} tone="sun" detail={`Longest dark ${fmtHours(mission.m.longestDarkH)} · mean illumination ${fmtPct(mission.m.illuminationPct)}`} />
              <Meter label="Earth in view" pct={mission.m.earthPct} tone="earth" detail={`Elevation ${fmtDeg(mission.m.earthElMin, 1)} to ${fmtDeg(mission.m.earthElMax, 1)}`} />
              <Meter label="DSN contact" pct={mission.m.dsnPct} tone="dsn" detail={`Longest gap ${fmtHours(mission.m.longestOutageH)}`} />
              <Meter label="Sunlight + DSN together" pct={mission.m.bothPct} tone="both" />
              <div className="module-actions">
                <button className="btn small" onClick={() => showDock('finder')} title="Score every possible landing date">Find a better date</button>
                <button className="btn small" onClick={() => showDock('compare')} title="Compare with the pinned sites">Compare sites</button>
              </div>
            </>
          ) : (
            <div className="skeleton">Analysing {site.pending ? 'terrain' : 'the next year'}…</div>
          )}
        </Module>

        {!full && facts.length > 0 && (
          <Module id="contrast" title="Here versus Earth">
            <div className="contrast">
              <div className="contrast-head"><span /><b>This site</b><b>On Earth</b></div>
              {facts.map((f) => (
                <div key={f.label} className="contrast-row" title={f.note}>
                  <span>{f.label}</span>
                  <b>{f.moon}</b>
                  <em>{f.earth}</em>
                  <p>{f.note}</p>
                </div>
              ))}
            </div>
          </Module>
        )}

        {full && (
          <>
            <Module id="sun" title="Solar tracker" tone="tone-sun" tag={<span className={`pill ${sun.cls}`}>{sun.label}</span>}>
              <div className={`big ${inst.sunClear < 0 ? 'below' : ''}`}>
                <span className="num">{fmtDeg(Math.abs(inst.sunClear), 2, false)}</span>
                <span className="unit">{inst.sunClear < 0 ? 'below skyline' : 'above skyline'}</span>
              </div>
              <div className="next">{countdown(an?.lit, t, spanEnd, 'Sunset', 'Sunrise', 'The Sun never reaches this site')}</div>
              <div className="kvs">
                <Row k="Elevation" v={fmtDeg(inst.sunEl)} title="Solar elevation angle: the Sun's centre above the ideal (spherical) horizon. This is the number JPL Horizons reports." />
                <Row k="Azimuth" v={`${inst.sunAz.toFixed(1)}° ${compass(inst.sunAz)}`} />
                <Row k="Skyline" v={fmtDeg(inst.sunEl - inst.sunClear)} title="Elevation of the terrain in the Sun's direction" />
                <Row k="Disk visible" v={fmtPct(inst.sunFrac * 100)} />
              </div>
            </Module>

            <Module id="earth" title="Earth tracker" tone="tone-earth" tag={<span className={`pill ${earthUp ? 'ok-earth' : 'off'}`}>{earthUp ? 'In view' : 'Hidden'}</span>}>
              <div className={`big ${inst.earthClear < 0 ? 'below' : ''}`}>
                <span className="num">{fmtDeg(Math.abs(inst.earthClear), 2, false)}</span>
                <span className="unit">{inst.earthClear < 0 ? 'below skyline' : 'above skyline'}</span>
              </div>
              <div className="next">{countdown(an?.earth, t, spanEnd, 'Earthset', 'Earthrise', 'Earth never rises here')}</div>
              <div className="kvs">
                <Row k="Elevation" v={fmtDeg(inst.earthEl)} />
                <Row k="Azimuth" v={`${inst.earthAz.toFixed(1)}° ${compass(inst.earthAz)}`} />
                <Row k="Range" v={`${fmtNumber(inst.earthRangeKm)} km`} />
                <Row k="Light time" v={`${(inst.earthRangeKm / 299792.458).toFixed(2)} s`} title="One-way signal travel time to Earth's centre" />
              </div>
            </Module>

            <Module id="dsn" title="Deep Space Network" tag={<span className={`pill ${inContact.length ? 'ok-dsn' : 'off'}`}>{inContact.length ? 'Link' : 'No link'}</span>}>
              <div className="next first">{countdown(an?.dsn, t, spanEnd, 'Loss of signal', 'Next contact', 'No direct-to-Earth link')}</div>
              <div className="stations">
                {DSN_STATIONS.map((st, k) => {
                  const on = (inst.stationMask & (1 << k)) !== 0;
                  const el = inst.stationEl[k];
                  return (
                    <div key={st.id} className={`station ${on ? 'on' : ''}`} title={`${st.antenna}, 70 m antenna`}>
                      <i />
                      <span>{st.name}</span>
                      <em>{el >= DSN_ELEVATION_MASK_DEG ? (on ? `Moon ${el.toFixed(0)}° up` : 'blocked at Moon') : el > 0 ? `Moon low ${el.toFixed(0)}°` : 'Moon set'}</em>
                    </div>
                  );
                })}
              </div>
              <p className="fine">Geometric line of sight both ways: the antenna clears the lunar skyline and the Moon is {DSN_ELEVATION_MASK_DEG}° or more above the antenna's horizon. Not a link budget.</p>
              <div className="module-actions"><button className="btn small" onClick={() => showDock('events')}>Pass list</button></div>
            </Module>

            <Module id="power" title="Solar power" tone="tone-sun">
              <div className="big">
                <span className="num sm" style={{ color: powerNow > 0 ? undefined : 'var(--phos-4)' }}>{fmtNumber(powerNow)}</span>
                <span className="unit">W now</span>
              </div>
              <div className="gauge" title={`Array output across the ${missionDays}-day mission, start to end`}>
                {(mission?.bars ?? Array.from({ length: GAUGE_BARS }, () => 0)).map((v, i) => (
                  <i key={i} className={v <= 0.004 ? 'dark' : ''} style={{ height: `${Math.max(5, v * 100)}%` }} />
                ))}
              </div>
              <div className="gauge-cap"><span>Landing</span><span>Output over mission</span><span>+{missionDays} d</span></div>
              <div className="seg wide" role="group" aria-label="Solar array type">
                {ARRAY_TYPES.map((a) => (
                  <button key={a.id} className={a.id === arrayType ? 'on' : ''} title={a.hint} onClick={() => useStore.setState({ arrayType: a.id })}>{a.label}</button>
                ))}
              </div>
              <div className="inputs">
                <label>Area<input type="number" min={0.5} max={500} step={0.5} value={area} onChange={(e) => useStore.setState({ arrayAreaM2: Math.max(0.1, Number(e.target.value) || 0.1) })} />m²</label>
                <label>Eff.<input type="number" min={5} max={45} step={1} value={Math.round(eff * 100)} onChange={(e) => useStore.setState({ arrayEfficiency: Math.min(0.6, Math.max(0.01, (Number(e.target.value) || 1) / 100)) })} />%</label>
              </div>
              <div className="kvs one">
                <Row k="Direct irradiance" v={`${fmtNumber(inst.irradiance)} W/m²`} title="Solar constant scaled by Sun distance and by the visible fraction of the disk" />
                <Row k="Mission average" v={mission ? `${fmtNumber(mission.p.meanW)} W` : '…'} />
                <Row k="Mission energy" v={mission ? `${fmtNumber(mission.p.energyKwh, mission.p.energyKwh < 100 ? 1 : 0)} kWh` : '…'} />
              </div>
            </Module>
          </>
        )}

        <Module id="check" title="Cross-check with NASA tools">
          <div className="links">
            <a href={horizonsUrl('sun', site.lat, site.lon, obsHeight, t)} target="_blank" rel="noreferrer" title="Opens JPL Horizons' own answer for the Sun's azimuth and elevation from this exact point and time. Compare with Elevation and Azimuth in the Solar tracker.">
              <b>JPL Horizons · Sun from here, now</b><span>Independent azimuth and elevation</span>
            </a>
            <a href={horizonsUrl('earth', site.lat, site.lon, obsHeight, t)} target="_blank" rel="noreferrer" title="The same check for the Earth.">
              <b>JPL Horizons · Earth from here, now</b><span>Independent azimuth and elevation</span>
            </a>
            <a href={RESOURCES.quickmap.url} target="_blank" rel="noreferrer" title={RESOURCES.quickmap.note}><b>{RESOURCES.quickmap.label}</b><span>Imagery and terrain for this spot</span></a>
            <a href={RESOURCES.moontrek.url} target="_blank" rel="noreferrer" title={RESOURCES.moontrek.note}><b>{RESOURCES.moontrek.label}</b><span>3D view of the same LRO data</span></a>
          </div>
          <button className="btn small" onClick={copyCoords} title="Copy latitude, east longitude in decimal degrees for QuickMap or Moon Trek">{copied ? 'Copied' : `Copy ${coordText}`}</button>
        </Module>

        <footer className="source">
          <span>Coordinates: </span>
          {site.sourceUrl ? <a href={site.sourceUrl} target="_blank" rel="noreferrer">{site.sourceLabel}</a> : site.sourceLabel}
          <span className="fine"> {site.sourceNote}</span>
          <div className="fine">Terrain: {site.terrainLabel}.</div>
        </footer>
      </div>
    </aside>
  );
}
