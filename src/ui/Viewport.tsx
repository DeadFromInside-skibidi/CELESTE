// The stage for site analysis: the Moon globe and the south-polar terrain, with the heads-up
// display and view controls drawn over them. (The Earth-to-Moon flight view is FlightView.tsx.)
import { useEffect, useRef, useState } from 'react';
import { Vector3 } from 'three';
import { DAY_MS } from '../core/constants.ts';
import { moonFixedBodies, SUN } from '../core/ephemeris.ts';
import { loadPolarDem, TERRAIN_TIERS, type TerrainTier } from '../core/polardem.ts';
import { MoonScene, type SceneSite } from '../gl/MoonScene.ts';
import { fmtLat, fmtLon } from '../lib/format.ts';
import { bodiesAt } from '../state/live.ts';
import { TERRAIN_BASE_URL } from '../state/sites.ts';
import { addCustomSite, type AppState, LANE_COLORS, selectSite, useStore } from '../state/store.ts';
import { Hud, HudGauge } from './Hud.tsx';

function sceneSites(s: AppState): SceneSite[] {
  const compared = [s.selectedId, ...s.pinnedIds.filter((id) => id !== s.selectedId)];
  return s.sites.map((site) => {
    const k = compared.indexOf(site.id);
    return {
      id: site.id, name: site.name, lat: site.lat, lon: site.lon, groundHeightM: site.groundHeightM,
      color: k >= 0 ? LANE_COLORS[k % LANE_COLORS.length] : '#93a1bd',
      role: k === 0 ? 'selected' : k > 0 ? 'pinned' : 'other',
    };
  });
}

type TierId = TerrainTier['id'];
const savedTier = (): TierId | null => {
  try {
    const v = localStorage.getItem('celeste.terrain');
    return TERRAIN_TIERS.some((t) => t.id === v) ? (v as TierId) : null;
  } catch {
    return null;
  }
};

function Toggle({ label, on, set, disabled, title }: { label: string; on: boolean; set: (v: boolean) => void; disabled?: boolean; title?: string }) {
  return (
    <label className={disabled ? 'disabled' : ''} title={title}>
      {label}
      <button className="tgl" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => set(!on)} />
    </label>
  );
}

/** The three stage views. Shared by this stage and the flight stage. */
export function ViewSwitch({ onMap }: { onMap?: () => void }) {
  const view3d = useStore((s) => s.view3d);
  return (
    <div className="seg" role="group" aria-label="3D view">
      <button className={view3d === 'globe' ? 'on' : ''} onClick={() => useStore.setState({ view3d: 'globe' })} title="The whole Moon, lit by the real Sun direction (G)">Globe</button>
      <button className={view3d === 'pole' ? 'on' : ''} onClick={() => useStore.setState({ view3d: 'pole' })} title="LOLA terrain from 80° S to the pole with ray-marched shadows (G)">Polar terrain</button>
      <button className={view3d === 'flight' ? 'on' : ''} onClick={() => useStore.setState({ view3d: 'flight', flightScale: 'earth-moon' })} title="Earth-to-Moon flights: every lunar mission from launch pad to landing site (F)">Earth-Moon flight</button>
      {onMap && view3d === 'pole' && <button onClick={onMap} title="Look straight down: a 2D map of the pole">2D map</button>}
    </div>
  );
}

export function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const gizmoRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MoonScene | null>(null);
  const view3d = useStore((s) => s.view3d);
  const selected = useStore((s) => s.sites.find((x) => x.id === s.selectedId));
  const missionDays = useStore((s) => s.missionDays);
  /** Requested terrain grid; null = the finest this GPU can hold. */
  const [tierId, setTierId] = useState<TierId | null>(savedTier);
  const [shownTier, setShownTier] = useState<TerrainTier | null>(null);
  const [demState, setDemState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [average, setAverage] = useState(false);
  const [labels, setLabels] = useState(true);
  const [grid, setGrid] = useState(true);
  const [limits, setLimits] = useState(true);
  const [options, setOptions] = useState(false);
  const [progress, setProgress] = useState(1);
  const [glError, setGlError] = useState<string | null>(null);

  // Scene lifetime
  useEffect(() => {
    let scene: MoonScene;
    try {
      scene = new MoonScene(canvasRef.current!, overlayRef.current!, gizmoRef.current!, {
        onSelect: selectSite,
        onHover: (id) => useStore.setState({ hoverId: id }),
        onPick: (lat, lon) => addCustomSite(`Pin ${fmtLat(lat, 2)} ${fmtLon(lon, 2)}`, lat, lon),
      }, `${import.meta.env.BASE_URL}textures/`);
    } catch (e) {
      setGlError(e instanceof Error ? e.message : 'WebGL is not available');
      return;
    }
    sceneRef.current = scene;
    scene.onAccumProgress = setProgress;
    const st = useStore.getState();
    scene.setBodies(bodiesAt(st.timeMs));
    scene.setSites(sceneSites(st));
    const sel = sceneSites(st).find((x) => x.role === 'selected');
    if (sel) scene.focus(sel, true);

    const ro = new ResizeObserver(() => {
      const r = wrapRef.current!.getBoundingClientRect();
      if (r.width > 2 && r.height > 2) scene.resize(r.width, r.height);
    });
    ro.observe(wrapRef.current!);

    const unsubs = [
      useStore.subscribe((s) => s.timeMs, (t) => { if (useStore.getState().view3d !== 'flight') scene.setBodies(bodiesAt(t)); }),
      useStore.subscribe((s) => s.view3d, (v) => { if (v !== 'flight') scene.setBodies(bodiesAt(useStore.getState().timeMs)); }),
      useStore.subscribe((s) => [s.sites, s.selectedId, s.pinnedIds] as const, () => scene.setSites(sceneSites(useStore.getState())), { equalityFn: (a, b) => a.every((v, i) => v === b[i]) }),
      useStore.subscribe((s) => s.selectedId, () => {
        const sel2 = sceneSites(useStore.getState()).find((x) => x.role === 'selected');
        if (sel2 && (scene.currentMode === 'globe' || sel2.lat < -80.2)) scene.focus(sel2);
      }),
    ];
    return () => {
      unsubs.forEach((u) => u());
      ro.disconnect();
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => { sceneRef.current?.setGrid(grid); }, [grid, demState]);
  useEffect(() => { sceneRef.current?.setLimits(limits); }, [limits]);

  // View mode, and loading whichever terrain grid is wanted.
  const loaded = useRef<TierId | null>(null);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || view3d === 'flight') return;
    scene.setMode(view3d);
    if (view3d !== 'pole') return;
    const supported = TERRAIN_TIERS.filter((t) => t.size <= scene.maxTextureSize);
    const tier = supported.find((t) => t.id === tierId) ?? supported[0] ?? TERRAIN_TIERS[TERRAIN_TIERS.length - 1];
    if (loaded.current === tier.id) return;
    let cancelled = false;
    setDemState('loading');
    setShownTier(tier);
    loadPolarDem(TERRAIN_BASE_URL, tier)
      .then((dem) => {
        if (cancelled) return;
        scene.setPolarDem(dem);
        loaded.current = tier.id;
        setDemState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        // That grid is not available (or too big to unpack here): step down to the next one.
        const next = supported[supported.indexOf(tier) + 1];
        if (next) setTierId(next.id);
        else setDemState('error');
      });
    return () => { cancelled = true; };
  }, [view3d, tierId]);

  const chooseTier = (id: TierId) => {
    setTierId(id);
    try {
      localStorage.setItem('celeste.terrain', id);
    } catch {
      // Preference will not persist.
    }
  };

  // Mission-average illumination layer (polar view): accumulate shadow passes across the window.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || demState !== 'ready') return;
    if (view3d !== 'pole' || !average) {
      scene.setAccumulation(null);
      return;
    }
    let timer = 0;
    const run = () => {
      const s = useStore.getState();
      const n = 96, dirs: Vector3[] = [];
      const tmp = new Float64Array(6);
      for (let i = 0; i < n; i++) {
        moonFixedBodies(s.timeMs + ((i + 0.5) / n) * s.missionDays * DAY_MS, tmp);
        dirs.push(new Vector3(tmp[SUN], tmp[SUN + 1], tmp[SUN + 2]).normalize());
      }
      setProgress(0);
      scene.setAccumulation(dirs);
    };
    run();
    const unsub = useStore.subscribe((s) => s.timeMs, () => {
      clearTimeout(timer);
      timer = window.setTimeout(run, 350);
    });
    return () => { unsub(); clearTimeout(timer); };
  }, [average, view3d, demState, missionDays, shownTier]);

  const pole = view3d === 'pole';
  const polarSite = !!selected && selected.lat < -80.2;
  const canAverage = pole && demState === 'ready' && !!sceneRef.current?.supportsAccumulation;
  const maxTex = sceneRef.current?.maxTextureSize ?? 4096;

  return (
    <section className={`stage ${view3d === 'flight' ? 'off' : ''}`} ref={wrapRef}>
      <canvas ref={canvasRef} className="fill" aria-label="3D view of the Moon" />
      <div className={`scene-overlay ${labels ? '' : 'hidden'}`} ref={overlayRef} />

      <div className="hud-top">
        <div className="hud-id">
          <b>{pole ? 'South polar terrain' : 'Selenocentric plot'}</b>
          <span>{pole ? `LOLA ${shownTier?.label ?? ''} grid · vertical ×3` : 'Moon-fixed frame · live vectors'}</span>
          <ViewSwitch onMap={() => sceneRef.current?.topDown()} />
        </div>
        <Hud />
        <div className="hud-view">
          <button className={`btn small ${options ? 'on' : ''}`} aria-expanded={options} onClick={() => setOptions((v) => !v)}>View options</button>
          {options && (
            <div className="view-options">
              <Toggle label="Site labels" on={labels} set={setLabels} />
              <Toggle label="Lat / lon grid" on={grid} set={setGrid} />
              <Toggle label="Day and Earth limits" on={limits} set={setLimits} disabled={pole} title="Globe view. Amber line: day/night terminator. Blue line: sites beyond it never have Earth above the horizon right now." />
              <Toggle label="Mission light map" on={average} set={setAverage} disabled={!canAverage} title="Polar terrain view: colour each point by the share of the mission window it spends in sunlight" />
              <div className="vo-row" title="Resolution of the terrain grid in the polar view. All are the same NASA LOLA product; finer grids need more GPU memory.">
                <span>Terrain grid</span>
                <div className="seg">
                  {TERRAIN_TIERS.map((t) => (
                    <button key={t.id} className={shownTier?.id === t.id || (!shownTier && t.size <= maxTex && TERRAIN_TIERS.find((x) => x.size <= maxTex) === t) ? 'on' : ''} disabled={t.size > maxTex} onClick={() => chooseTier(t.id)}>{t.label}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <HudGauge />
      {!pole && limits && (
        <div className="hud-key">
          <span><i className="ln sun" />Day / night line</span>
          <span><i className="ln earth" />Earth-visibility limit</span>
        </div>
      )}
      {pole && average && demState === 'ready' && (
        <div className="ramp-legend">
          <span>Sunlit share · {missionDays}-day mission{progress < 1 ? ` · ${Math.round(progress * 100)}%` : ''}</span>
          <div className="ramp" />
          <div className="ramp-ticks"><span>0%</span><span>50%</span><span>100%</span></div>
        </div>
      )}
      <div className="gizmo" title={pole ? 'Map axes. X: 90° E. Y: 0° E (toward Earth). Z: up. Click an axis to look along it.' : 'Moon-fixed axes. X: toward Earth (0° E). Y: 90° E. N/S: lunar poles. Click an axis to look along it.'}>
        <canvas ref={gizmoRef} />
      </div>
      <div className="viewport-hint">
        {pole ? 'Drag: orbit · right-drag: pan · scroll: zoom · double-click: drop a site' : 'Drag: orbit · scroll: zoom · click a marker: select · double-click the surface: drop a site'}
      </div>
      {pole && demState === 'loading' && shownTier && <div className="viewport-msg">Loading LOLA {shownTier.label} terrain · about {shownTier.downloadMb} MB</div>}
      {pole && demState === 'error' && <div className="viewport-msg error">The terrain model could not be loaded. The globe view and all numbers still work.</div>}
      {pole && demState === 'ready' && !polarSite && selected && (
        <div className="viewport-msg subtle">{selected.name} is not on this map, which covers 80° S to the pole. Showing the whole polar cap: click any marker to go there.</div>
      )}
      {glError && <div className="viewport-msg error">3D view unavailable: {glError}. All analysis panels still work.</div>}
    </section>
  );
}
