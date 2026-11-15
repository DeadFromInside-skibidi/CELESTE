// The stage for Earth-to-Moon flights: every lunar mission from its launch pad to the Moon, in
// the Earth-Moon system or the Sun-Earth-Moon system, in 3D or as a plan, with cameras that
// can ride along with the vehicle. (The site-analysis stage is Viewport.tsx.)
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Flight } from '../core/flight.ts';
import { hasFlownTrajectory, landedIntact, loadFlightForMission, missionById, MISSIONS, type Mission, surfaceTime } from '../core/missions.ts';
import { cinematicPace, type CraftInfo, type FlightCam, type FlightReadout, FlightScene, SOLAR_SUN_BOOST, SOLAR_SYSTEM_BOOST } from '../gl/FlightScene.ts';
import { fmtNumber } from '../lib/format.ts';
import { selectMission, selectSite, setTime, useStore } from '../state/store.ts';
import { CloseIcon, PlayIcon } from './icons.tsx';
import { ViewSwitch } from './Viewport.tsx';

type Filter = 'all' | 'crewed' | 'landers' | 'orbiters' | 'flybys' | 'impacts';
const FILTERS: { id: Filter; label: string; test: (m: Mission) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'crewed', label: 'Crewed', test: (m) => /crewed/i.test(m.kind) },
  { id: 'landers', label: 'Landers', test: (m) => m.category === 'lander' || m.category === 'sample-return' || (m.category === 'crewed' && !!m.surface) },
  { id: 'orbiters', label: 'Orbiters', test: (m) => m.category === 'orbiter' },
  { id: 'flybys', label: 'Fly-bys', test: (m) => m.category === 'flyby' },
  { id: 'impacts', label: 'Impactors', test: (m) => m.category === 'impact' },
];
const CAMS: { id: FlightCam; label: string; hint: string }[] = [
  { id: 'overview', label: 'Overview', hint: 'The whole system' },
  { id: 'earth', label: 'Earth', hint: 'Centred on Earth' },
  { id: 'moon', label: 'Moon', hint: 'Centred on the Moon' },
  { id: 'chase', label: 'Follow', hint: 'Rides with the vehicle: drag to swing around it, scroll to move in or out' },
  { id: 'cinematic', label: 'Cinematic', hint: 'Rides with the vehicle and picks a shot for each phase of the flight; you can still drag and scroll' },
];

/** What happened, in a few words, for the mission list. */
function outcome(m: Mission): string {
  if (m.surface) return landedIntact(m) ? (m.category === 'crewed' ? 'Crewed landing' : m.category === 'sample-return' ? 'Landed, samples returned' : 'Landed') : m.category === 'impact' ? 'Impact' : 'Lost on landing';
  if (m.attempted) return 'Did not reach its goal';
  return m.category === 'orbiter' ? 'Orbiter' : m.category === 'crewed' ? 'Crewed orbit' : m.category === 'flyby' ? 'Fly-by' : m.kind;
}

/** Time since liftoff as T+ d hh:mm:ss. */
function fmtMet(s: number): string {
  const a = Math.abs(Math.round(s)), d = Math.floor(a / 86400), h = Math.floor((a % 86400) / 3600), m = Math.floor((a % 3600) / 60), sec = a % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return `T${s < 0 ? '−' : '+'}${d ? `${d}d ` : ''}${p(h)}:${p(m)}:${p(sec)}`;
}
const fmtKm = (km: number) => (km < 100 ? km.toFixed(1) : fmtNumber(Math.round(km)));

export function FlightView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<FlightScene | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  /** Clock and speed to give back when the user leaves the flight view. */
  const restore = useRef<{ timeMs: number; speed: number } | null>(null);

  const view3d = useStore((s) => s.view3d);
  const missionId = useStore((s) => s.missionId);
  const flightScale = useStore((s) => s.flightScale);
  const flight2d = useStore((s) => s.flight2d);
  const flightCam = useStore((s) => s.flightCam);
  const playing = useStore((s) => s.playing);

  const [flight, setFlight] = useState<Flight | null>(null);
  const [readout, setReadout] = useState<FlightReadout | null>(null);
  const [craft, setCraft] = useState<CraftInfo | null>(null);
  const [ground, setGround] = useState<{ pad: string[]; site: string[] }>({ pad: [], site: [] });
  const [picker, setPicker] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [glError, setGlError] = useState<string | null>(null);

  const active = view3d === 'flight';
  const mission: Mission = useMemo(() => missionById(missionId) ?? MISSIONS[0], [missionId]);

  // Scene lifetime
  useEffect(() => {
    let scene: FlightScene;
    try {
      scene = new FlightScene(canvasRef.current!, overlayRef.current!, import.meta.env.BASE_URL);
    } catch (e) {
      setGlError(e instanceof Error ? e.message : 'WebGL is not available');
      return;
    }
    sceneRef.current = scene;
    scene.onCraft = setCraft;
    scene.onGround = setGround;
    const s = useStore.getState();
    scene.setTime(s.timeMs);
    scene.setView({ scale: s.flightScale, flat: s.flight2d, cam: s.flightCam });
    const ro = new ResizeObserver(() => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (r && r.width > 2 && r.height > 2) scene.resize(r.width, r.height);
    });
    ro.observe(wrapRef.current!);
    return () => {
      ro.disconnect();
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // The mission's flight. The clock moves to its launch unless it is already inside the flight.
  useEffect(() => {
    let cancelled = false;
    setFlight(null);
    void loadFlightForMission(mission).then((f) => {
      if (cancelled) return;
      setFlight(f);
      sceneRef.current?.setMission(mission, f);
      const s = useStore.getState();
      if (s.view3d === 'flight' && (s.timeMs < f.startMs || s.timeMs > f.endMs)) {
        useStore.setState({ playing: false });
        setTime(f.launchMs);
      }
    });
    return () => { cancelled = true; };
  }, [mission]);

  // Entering the flight view moves the mission clock to the flight; leaving gives it back.
  useEffect(() => {
    const s = useStore.getState();
    if (active) {
      if (!restore.current) restore.current = { timeMs: s.timeMs, speed: s.speed };
      if (flight && (s.timeMs < flight.startMs || s.timeMs > flight.endMs)) {
        useStore.setState({ playing: false });
        setTime(flight.launchMs);
      }
      const r = wrapRef.current?.getBoundingClientRect();
      if (r && r.width > 2 && r.height > 2) sceneRef.current?.resize(r.width, r.height);
    } else if (restore.current) {
      useStore.setState({ playing: false, speed: restore.current.speed });
      setTime(restore.current.timeMs);
      restore.current = null;
    }
  }, [active, flight]);

  useEffect(() => { sceneRef.current?.setView({ scale: flightScale, flat: flight2d, cam: flightCam }); }, [flightScale, flight2d, flightCam]);
  useEffect(() => { sceneRef.current?.setPlaying(playing); }, [playing]);

  // Clock -> scene; and in the cinematic view the flight sets its own pace.
  useEffect(() => {
    const apply = (t: number) => {
      const scene = sceneRef.current, st = useStore.getState();
      if (!scene || st.view3d !== 'flight') return;
      scene.setTime(t);
      if (scene.readout) setReadout({ ...scene.readout });
      if (!st.playing || st.flightCam !== 'cinematic' || st.flight2d || !flight) return;
      if (t >= flight.endMs) { useStore.setState({ playing: false }); return; }
      const pace = cinematicPace(flight, t);
      if (pace.done) useStore.setState({ playing: false });
      else if (pace.jumpToMs && t < pace.jumpToMs) setTime(pace.jumpToMs);
      else if (Math.abs(st.speed - pace.speed) > 0.01) useStore.setState({ speed: pace.speed });
    };
    apply(useStore.getState().timeMs);
    return useStore.subscribe((s) => s.timeMs, apply);
  }, [flight, active]);

  const pause = () => useStore.setState({ playing: false });
  const setCam = (cam: FlightCam) => {
    const riding = cam === 'chase' || cam === 'cinematic';
    // The cameras that ride with the vehicle work at true scale, in 3D.
    useStore.setState(riding ? { flightCam: cam, flightScale: 'earth-moon', flight2d: false } : { flightCam: cam });
  };
  /** Plays the whole flight from just before liftoff, with the cinematic camera. */
  const watch = () => {
    if (!flight) return;
    sceneRef.current?.recentre();
    useStore.setState({ flightScale: 'earth-moon', flight2d: false, flightCam: 'cinematic', playing: false });
    setTime(flight.launchMs - 10_000);
    useStore.setState({ playing: true, speed: 1 });
  };
  const choose = (m: Mission) => {
    pause();
    setPicker(false);
    // A new mission starts at its launch (set once its flight is known).
    setTime(Date.parse(m.launchUtc ?? `${m.launchDate}T12:00:00Z`));
    selectMission(m.id);
  };
  const openSite = () => {
    if (!mission.siteId) return;
    selectSite(mission.siteId);
    useStore.setState({ view3d: 'globe' });
  };

  // Phase bar: every phase gets the same width (a coast of days and a nine-minute ascent are
  // equally worth reaching); click or drag to move through the flight.
  const phases = flight?.phases ?? [];
  const scrub = (clientX: number) => {
    const el = barRef.current;
    if (!el || !phases.length) return;
    const r = el.getBoundingClientRect();
    const u = Math.min(0.99999, Math.max(0, (clientX - r.left) / r.width)) * phases.length;
    const ph = phases[Math.floor(u)];
    pause();
    setTime(ph.startMs + (u - Math.floor(u)) * (ph.endMs - ph.startMs));
  };

  const listed = useMemo(() => {
    const q = search.trim().toLowerCase(), test = FILTERS.find((f) => f.id === filter)!.test;
    const hits = MISSIONS.filter((m) => test(m) && (!q || `${m.name} ${m.vehicle} ${m.nation} ${m.launchDate} ${m.launchSite.name} ${m.kind}`.toLowerCase().includes(q)));
    const groups = new Map<string, Mission[]>();
    for (const m of hits) { const d = `${m.launchDate.slice(0, 3)}0s`; groups.set(d, [...(groups.get(d) ?? []), m]); }
    return { count: hits.length, groups: [...groups] };
  }, [search, filter]);

  useEffect(() => {
    if (!picker) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPicker(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picker]);

  const solar = flightScale === 'solar';
  const riding = !flight2d && (flightCam === 'chase' || flightCam === 'cinematic');
  const landing = surfaceTime(mission);
  const now = readout?.phase;
  const notes: string[] = [];
  if (flight) notes.push(flight.kind === 'flown' ? 'Trajectory: flown, from JPL Horizons (ascent to the first data point reconstructed)' : 'Trajectory: reconstructed from the launch site, dates and landing site; it shows the shape and timing of the flight, not the flown path');
  if (flight?.launchTimeEstimated) notes.push('launch time of day estimated');
  if (landing?.estimated) notes.push('time of day at the surface not on record, shown as 12:00 UTC');
  if (solar) notes.push(`Earth-Moon system drawn ×${SOLAR_SYSTEM_BOOST}, Sun ×${SOLAR_SUN_BOOST}`);
  if (readout && readout.enlarged > 1.5) notes.push(`vehicle drawn ×${readout.enlarged >= 100 ? fmtNumber(Math.round(readout.enlarged)) : readout.enlarged.toFixed(1)} to stay visible`);

  return (
    <section className={`stage flight ${active ? '' : 'off'}`} ref={wrapRef}>
      <canvas ref={canvasRef} className={`fill ${riding ? 'grab' : ''}`} aria-label="3D view of the flight from Earth to the Moon" />
      <div className="scene-overlay" ref={overlayRef} />

      <div className="hud-top">
        <div className="hud-id">
          <b>{solar ? 'Sun · Earth · Moon' : 'Earth to Moon'}</b>
          <span>{flight2d ? 'Plan view from the ecliptic north' : 'Ecliptic frame · true positions'} · {mission.nation}</span>
          <ViewSwitch />
        </div>

        <div className="flight-mission">
          <button className="mission-key" onClick={() => setPicker(true)} title={`Choose from all ${MISSIONS.length} missions launched toward the Moon`} aria-haspopup="dialog">
            <small>Mission · {MISSIONS.length} on file</small>
            <b>{mission.name}</b>
            <span>{mission.launchDate} · {mission.vehicle} · {mission.launchSite.name.split(',')[0]}</span>
          </button>
          <button className="btn primary" onClick={watch} disabled={!flight} title="Play the whole flight, from the launch pad to the Moon, with the cinematic camera">
            <PlayIcon /> Watch flight
          </button>
          {mission.siteId && <button className="btn" onClick={openSite} title="Open where this mission landed in the site analysis">Landing site</button>}
        </div>

        <div className="hud-view">
          <div className="seg" role="group" aria-label="What to show">
            <button className={!solar ? 'on' : ''} onClick={() => useStore.setState({ flightScale: 'earth-moon' })} title="The Moon in orbit around Earth, at true scale (F)">Earth–Moon</button>
            <button className={solar ? 'on' : ''} onClick={() => useStore.setState({ flightScale: 'solar', flightCam: riding ? 'overview' : flightCam })} title="The Moon around Earth and Earth around the Sun (O)">Sun–Earth–Moon</button>
          </div>
          <div className="seg" role="group" aria-label="Projection">
            <button className={!flight2d ? 'on' : ''} onClick={() => useStore.setState({ flight2d: false })} title="Free 3D view">3D</button>
            <button className={flight2d ? 'on' : ''} onClick={() => useStore.setState({ flight2d: true })} title="Plan view, looking down on the orbits">2D</button>
          </div>
          <div className="seg" role="group" aria-label="Camera">
            {CAMS.map((c) => (
              <button key={c.id} className={flightCam === c.id ? 'on' : ''} disabled={flight2d && c.id === 'cinematic'} onClick={() => setCam(c.id)} title={c.hint}>{c.label}</button>
            ))}
          </div>
          {riding && <button className="btn small" onClick={() => sceneRef.current?.recentre()} title="Put the camera back on its standard shot">Reset camera</button>}
        </div>
      </div>

      <div className="flight-foot">
        {readout && now && (
          <div className="flight-read">
            <div className="chip on phase"><i /><div><small>Phase · {fmtMet(readout.metS)}</small><b>{now.label}</b><span>{craft?.stage ?? (flight?.kind === 'flown' ? 'JPL Horizons' : 'Reconstructed')}</span></div></div>
            <div className="chip"><i /><div><small>Speed</small><b>{readout.speedKmS.toFixed(2)} km/s</b><span>relative to {readout.body}</span></div></div>
            <div className="chip"><i /><div><small>Altitude</small><b>{fmtKm(readout.altitudeKm)} km</b><span>above {readout.body}</span></div></div>
            <div className="chip earth on"><i /><div><small>From Earth</small><b>{fmtNumber(Math.round(readout.earthKm))} km</b><span>centre to craft</span></div></div>
            <div className="chip"><i /><div><small>From the Moon</small><b>{fmtNumber(Math.round(readout.moonKm))} km</b><span>centre to craft</span></div></div>
            {craft && (
              <div className="chip model" title={`${craft.label}${ground.pad.length ? `\nGround at the launch site: ${ground.pad.join('; ')}` : ''}${ground.site.length ? `\nGround at the lunar site: ${ground.site.join('; ')}` : ''}`}>
                <i /><div><small>{craft.source === 'nasa' ? 'NASA 3D model' : 'Built to dimensions'}</small><b>{craft.label.split(' · ')[0]}</b><span>{craft.label.split(' · ').slice(1).join(' · ') || ' '}</span></div>
              </div>
            )}
          </div>
        )}
        {phases.length > 0 && (
          <div
            className="phase-bar" ref={barRef} role="slider" aria-label="Position in the flight" aria-valuetext={now?.label ?? ''} tabIndex={0}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrub(e.clientX); }}
            onPointerMove={(e) => { if (e.buttons & 1) scrub(e.clientX); }}
            onKeyDown={(e) => {
              const i = phases.indexOf(now ?? phases[0]);
              if (e.key === 'ArrowRight' && i < phases.length - 1) { e.stopPropagation(); pause(); setTime(phases[i + 1].startMs); }
              if (e.key === 'ArrowLeft' && i > 0) { e.stopPropagation(); pause(); setTime(phases[i - 1].startMs); }
            }}
          >
            {phases.map((ph) => {
              const t = useStore.getState().timeMs;
              const done = readout ? Math.min(1, Math.max(0, (t - ph.startMs) / Math.max(1, ph.endMs - ph.startMs))) : 0;
              return (
                <div key={ph.id + ph.startMs} className={`phase ${ph === now ? 'now' : ''}`} title={`${ph.label}: click or drag to move through it`}>
                  <i style={{ width: `${done * 100}%` }} />
                  <span>{ph.label}</span>
                </div>
              );
            })}
          </div>
        )}
        {notes.length > 0 && <p className="flight-notes">{notes.join(' · ')}</p>}
      </div>

      <div className="viewport-hint">
        {riding ? 'Drag: swing around the vehicle · scroll: move in or out · space: play / pause' : flight2d ? 'Drag: pan · scroll: zoom' : 'Drag: orbit · right-drag: pan · scroll: zoom'}
      </div>
      {mission.note && <div className="viewport-msg subtle flight-note">{mission.note}</div>}
      {glError && <div className="viewport-msg error">3D view unavailable: {glError}.</div>}

      {picker && (
        <div className="modal-backdrop" onClick={() => setPicker(false)}>
          <div className="modal missions" role="dialog" aria-modal="true" aria-label="Missions to the Moon" onClick={(e) => e.stopPropagation()}>
            <header>
              <h2>Missions to the Moon · {MISSIONS.length} launched, 1959 to {MISSIONS[MISSIONS.length - 1].launchDate.slice(0, 4)}</h2>
              <button className="icon-btn" onClick={() => setPicker(false)} aria-label="Close"><CloseIcon /></button>
            </header>
            <div className="missions-tools">
              <label className="search">
                <input type="search" placeholder="Name, launch vehicle, country, year, launch site" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus aria-label="Search missions" />
              </label>
              <div className="seg" role="group" aria-label="Kind of mission">
                {FILTERS.map((f) => <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>{f.label}</button>)}
              </div>
              <span className="missions-count">{listed.count} shown</span>
            </div>
            <div className="missions-list">
              {listed.groups.map(([decade, list]) => (
                <section key={decade}>
                  <h3>{decade}</h3>
                  {list.map((m) => (
                    <button key={m.id} className={`mission-row ${m.id === missionId ? 'selected' : ''}`} onClick={() => choose(m)} title={m.note ?? m.kind}>
                      <span className="mr-date">{m.launchDate}</span>
                      <span className="mr-name">{m.name}</span>
                      <span className="mr-who">{m.nation}</span>
                      <span className="mr-rocket">{m.vehicle} · {m.launchSite.name.split(',')[0]}</span>
                      <span className="mr-end">{outcome(m)}</span>
                      <span className="mr-tags">
                        {hasFlownTrajectory(m) && <em title="The flown trajectory, from JPL Horizons">JPL path</em>}
                        {m.siteId && <em className="site" title="Its landing site is in the site analysis">Site</em>}
                      </span>
                    </button>
                  ))}
                </section>
              ))}
              {listed.count === 0 && <p className="empty">No mission matches.</p>}
            </div>
            <p className="missions-foot">
              Mission list, launch dates and landing coordinates: NASA NSSDCA. Trajectories marked “JPL path” are the flown ones; every other flight is reconstructed from the launch site, the dates and the landing site.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
