import { useEffect } from 'react';
import { DAY_MS, HOUR_MS } from './core/constants.ts';
import { resizePanel, setMode, setTime, togglePanel, useStore } from './state/store.ts';
import { About } from './ui/About.tsx';
import { Deck, Dock } from './ui/Dock.tsx';
import { Resizer } from './ui/Panel.tsx';
import { SitePanel } from './ui/SitePanel.tsx';
import { SkyPanorama } from './ui/SkyPanorama.tsx';
import { StatusPanel } from './ui/StatusPanel.tsx';
import { TopBar } from './ui/TopBar.tsx';
import { Viewport } from './ui/Viewport.tsx';
import { FlightView } from './ui/FlightView.tsx';

/** Advances the mission clock while playing. */
function usePlayback(): void {
  const playing = useStore((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const s = useStore.getState();
      // Clamp the frame time so a background tab does not jump days ahead on return.
      const dt = Math.min(100, now - last);
      last = now;
      setTime(s.timeMs + dt * s.speed);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const s = useStore.getState();
      const k = e.key.toLowerCase();
      if (e.code === 'Space') {
        e.preventDefault();
        useStore.setState({ playing: !s.playing });
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        useStore.setState({ playing: false });
        setTime(s.timeMs + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? DAY_MS : HOUR_MS));
      } else if (k === 'n') {
        useStore.setState({ playing: false });
        setTime(Math.round(Date.now() / 60_000) * 60_000);
      } else if (k === 'g') useStore.setState({ view3d: s.view3d === 'globe' ? 'pole' : 'globe' });
      else if (k === 'f') useStore.setState({ view3d: s.view3d === 'flight' && s.flightScale === 'earth-moon' ? 'globe' : 'flight', flightScale: 'earth-moon' });
      else if (k === 'o') useStore.setState({ view3d: s.view3d === 'flight' && s.flightScale === 'solar' ? 'globe' : 'flight', flightScale: 'solar' });
      else if (k === '1') setMode('focus');
      else if (k === '2') setMode('explore');
      else if (k === '3') setMode('control');
      else if (k === 's') togglePanel('sites');
      else if (k === 'h') togglePanel('scope');
      else if (k === 't') togglePanel('telemetry');
      else if (k === 'l') togglePanel('dock');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  const ready = useStore((s) => s.ready);
  const loadError = useStore((s) => s.loadError);
  const layout = useStore((s) => s.layout);
  usePlayback();
  useShortcuts();

  if (loadError) {
    return (
      <div className="splash">
        <h1>CELESTE could not start</h1>
        <p>{loadError}</p>
        <button className="btn primary" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="splash">
        <div className="spinner" />
        <p>Loading site catalogue and terrain horizons…</p>
      </div>
    );
  }
  const { open } = layout;
  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        {open.sites && (
          <>
            <div className="side" style={{ width: layout.sitesW }}><SitePanel /></div>
            <Resizer dir="x" value={layout.sitesW} onChange={(v) => resizePanel('sitesW', v)} label="Site register" />
          </>
        )}
        <main className="center">
          <Viewport />
          <FlightView />
          {open.scope && (
            <>
              <Resizer dir="y" invert value={layout.scopeH} onChange={(v) => resizePanel('scopeH', v)} label="Horizon scope" />
              <div className="under" style={{ height: layout.scopeH }}><SkyPanorama /></div>
            </>
          )}
        </main>
        {open.telemetry && (
          <>
            <Resizer dir="x" invert value={layout.teleW} onChange={(v) => resizePanel('teleW', v)} label="Telemetry" />
            <div className="side" style={{ width: layout.teleW }}><StatusPanel /></div>
          </>
        )}
      </div>
      {open.dock && (
        <>
          <Resizer dir="y" invert value={layout.dockH} onChange={(v) => resizePanel('dockH', v)} label="Console" />
          <div className="dockwrap" style={{ height: layout.dockH }}><Dock /></div>
        </>
      )}
      <Deck />
      <About />
    </div>
  );
}
