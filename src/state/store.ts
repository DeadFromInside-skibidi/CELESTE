// Application state. One store; canvases subscribe to it directly so that scrubbing and
// playback never go through React reconciliation.
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { SiteAnalysis } from '../core/analysis.ts';
import { DAY_MS, HOUR_MS } from '../core/constants.ts';
import { wrapLon } from '../core/topo.ts';
import { OBSERVER_HEIGHTS_M } from '../data/sites.ts';
import type { ArrayType } from '../lib/power.ts';
import type { AnalyzeResponse, HorizonResponse, WorkerRequest, WorkerResponse } from '../workers/protocol.ts';
import { TERRAIN_TIERS } from '../core/polardem.ts';
import { loadCatalogue, makeCustomSite, type Site, TERRAIN_BASE_URL } from './sites.ts';

export type Dock = 'timeline' | 'compare' | 'events' | 'finder';
export type View3d = 'globe' | 'pole' | 'flight';
/** What the flight view frames: the Earth-Moon system at true scale, or the Sun-Earth-Moon system. */
export type FlightScale = 'earth-moon' | 'solar';
/** Camera in the flight view. 'chase' orbits freely around the spacecraft; 'cinematic' is directed. */
export type FlightCam = 'overview' | 'chase' | 'earth' | 'moon' | 'cinematic';

/** Sampling step of the long site sweeps. Window edges are refined to under a second afterwards. */
export const ANALYSIS_STEP_MS = 10 * 60_000;
const RANGE_BEFORE_MS = 45 * DAY_MS;
const RANGE_SPAN_MS = 455 * DAY_MS;
export const MAX_PINNED = 4;
export const MIN_TIME_MS = Date.UTC(1958, 0, 1); // before Luna 1, the first lunar launch
export const MAX_TIME_MS = Date.UTC(2100, 0, 1);

/** Colours assigned to compared sites, in order. Kept clear of Sun amber, Earth blue, DSN green and mission orange. */
export const LANE_COLORS = ['#f1ecdc', '#b9a2ff', '#ff8fc7', '#c8d85a', '#c99a6b'];

export const SPEEDS = [
  { label: '10 s/s', value: 10 },
  { label: '1 min/s', value: 60 },
  { label: '10 min/s', value: 600 },
  { label: '1 h/s', value: 3600 },
  { label: '6 h/s', value: 21600 },
  { label: '1 day/s', value: 86400 },
  { label: '5 days/s', value: 432000 },
];

export interface Busy { label: string; fraction: number }

// ---------------------------------------------------------------------------------------------
// Workspace layout: which panels are open, how big they are, and how much detail they show.
// ---------------------------------------------------------------------------------------------
export type PanelId = 'sites' | 'telemetry' | 'scope' | 'dock';
export type LayoutMode = 'focus' | 'explore' | 'control';
export type Detail = 'brief' | 'full';

export interface Layout {
  /** Preset the layout was last set from; null once the user has changed panels by hand. */
  mode: LayoutMode | null;
  open: Record<PanelId, boolean>;
  sitesW: number;
  teleW: number;
  scopeH: number;
  dockH: number;
  /** Telemetry depth: 'brief' for a plain-language briefing, 'full' for every readout. */
  detail: Detail;
  /** Telemetry modules the user has folded away. */
  folded: Record<string, boolean>;
}

export const MODES: { id: LayoutMode; label: string; hint: string }[] = [
  { id: 'focus', label: 'Focus', hint: 'The 3D view and the timeline, nothing else (1)' },
  { id: 'explore', label: 'Explore', hint: 'A guided view in plain language: for learning and quick looks (2)' },
  { id: 'control', label: 'Mission control', hint: 'Every panel and every number: for planning (3)' },
];

const PRESETS: Record<LayoutMode, Pick<Layout, 'open' | 'detail'> & { dock?: Dock }> = {
  focus: { open: { sites: false, telemetry: false, scope: false, dock: true }, detail: 'brief', dock: 'timeline' },
  explore: { open: { sites: true, telemetry: true, scope: true, dock: true }, detail: 'brief', dock: 'timeline' },
  control: { open: { sites: true, telemetry: true, scope: true, dock: true }, detail: 'full' },
};

export const LAYOUT_LIMITS = { sitesW: [200, 440], teleW: [270, 520], scopeH: [130, 460], dockH: [150, 560] } as const;

const DEFAULT_LAYOUT: Layout = { mode: 'explore', ...PRESETS.explore, open: { ...PRESETS.explore.open }, sitesW: 252, teleW: 330, scopeH: 200, dockH: 236, folded: {} };

function loadLayout(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem('celeste.layout') ?? 'null') as Partial<Layout> | null;
    if (saved && saved.open) return { ...DEFAULT_LAYOUT, ...saved, open: { ...DEFAULT_LAYOUT.open, ...saved.open }, folded: { ...saved.folded } };
  } catch {
    // Unreadable or unavailable storage: fall through to the default layout.
  }
  return DEFAULT_LAYOUT;
}

export interface AppState {
  ready: boolean;
  loadError: string | null;
  sites: Site[];
  selectedId: string;
  pinnedIds: string[];
  hoverId: string | null;
  timeMs: number;
  playing: boolean;
  /** Simulated seconds per real second. */
  speed: number;
  /** Length of the surface mission that starts at the cursor time, days. */
  missionDays: number;
  viewStartMs: number;
  viewEndMs: number;
  /** Index into OBSERVER_HEIGHTS_M. */
  heightIdx: number;
  arrayType: ArrayType;
  arrayAreaM2: number;
  arrayEfficiency: number;
  view3d: View3d;
  /** Mission shown in the flight view (id in src/data/missions.json). */
  missionId: string;
  flightScale: FlightScale;
  /** Top-down plan view instead of free 3D. */
  flight2d: boolean;
  flightCam: FlightCam;
  dock: Dock;
  layout: Layout;
  aboutOpen: boolean;
  rangeStartMs: number;
  rangeEndMs: number;
  /** Completed sweeps, keyed by analysisKey(). Cleared whenever the analysed range moves. */
  analyses: Record<string, SiteAnalysis>;
  busy: Busy | null;
}

const dayFloor = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;
const clampTime = (ms: number) => Math.min(MAX_TIME_MS, Math.max(MIN_TIME_MS, ms));

function rangeFor(timeMs: number): { rangeStartMs: number; rangeEndMs: number } {
  const rangeStartMs = dayFloor(timeMs) - RANGE_BEFORE_MS;
  return { rangeStartMs, rangeEndMs: rangeStartMs + RANGE_SPAN_MS };
}

const now = Math.round(Date.now() / 60_000) * 60_000;

export const useStore = create<AppState>()(
  subscribeWithSelector((): AppState => ({
    ready: false,
    loadError: null,
    sites: [],
    selectedId: 'connecting-ridge',
    pinnedIds: ['malapert-massif', 'haworth'],
    hoverId: null,
    timeMs: now,
    playing: false,
    speed: 21600,
    missionDays: 14,
    viewStartMs: now - 3 * DAY_MS,
    viewEndMs: now + 30 * DAY_MS,
    heightIdx: 0,
    arrayType: 'vertical',
    arrayAreaM2: 4,
    arrayEfficiency: 0.3,
    view3d: 'globe',
    missionId: 'apollo-11',
    flightScale: 'earth-moon',
    flight2d: false,
    flightCam: 'overview',
    dock: 'timeline',
    layout: loadLayout(),
    aboutOpen: false,
    ...rangeFor(now),
    analyses: {},
    busy: null,
  })),
);

const set = useStore.setState;
const get = useStore.getState;

export const analysisKey = (siteId: string, heightIdx: number) => `${siteId}|${heightIdx}`;

export function siteById(id: string): Site | undefined {
  return get().sites.find((s) => s.id === id);
}

/** The selected site followed by the pinned ones (no duplicates): the comparison set. */
export function comparedSites(state: Pick<AppState, 'sites' | 'selectedId' | 'pinnedIds'>): Site[] {
  const ids = [state.selectedId, ...state.pinnedIds.filter((id) => id !== state.selectedId)];
  return ids.map((id) => state.sites.find((s) => s.id === id)).filter((s): s is Site => !!s);
}

// ---------------------------------------------------------------------------------------------
// Worker plumbing
// ---------------------------------------------------------------------------------------------
const worker = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' });
let nextId = 1;
const waiting = new Map<number, (res: WorkerResponse) => void>();
const inFlight = new Set<string>();

worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
  const msg = ev.data;
  if (msg.type === 'progress') {
    set({ busy: msg.fraction >= 1 ? null : { label: msg.label, fraction: msg.fraction } });
    return;
  }
  const cb = waiting.get(msg.id);
  waiting.delete(msg.id);
  cb?.(msg);
};

function request<T extends WorkerResponse>(req: WorkerRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    waiting.set(req.id, (res) => (res.type === 'error' ? reject(new Error(res.message)) : resolve(res as T)));
    worker.postMessage(req);
  });
}

/** Requests any sweep the UI currently needs and does not have. Safe to call often. */
export function ensureAnalyses(): void {
  const s = get();
  if (!s.ready) return;
  for (const site of comparedSites(s)) {
    if (site.pending) continue;
    const key = analysisKey(site.id, s.heightIdx);
    const tag = `${key}|${s.rangeStartMs}`;
    if (s.analyses[key] || inFlight.has(tag)) continue;
    inFlight.add(tag);
    const { rangeStartMs } = s;
    request<AnalyzeResponse>({
      type: 'analyze', id: nextId++,
      lat: site.lat, lon: site.lon,
      heightM: site.groundHeightM + OBSERVER_HEIGHTS_M[s.heightIdx],
      mask: site.masks[s.heightIdx],
      startMs: s.rangeStartMs, endMs: s.rangeEndMs, stepMs: ANALYSIS_STEP_MS,
    })
      .then((res) => {
        // Drop results for a range the user has already left.
        if (get().rangeStartMs === rangeStartMs) set((st) => ({ analyses: { ...st.analyses, [key]: res.analysis } }));
      })
      .catch((e) => console.error('analysis failed', e))
      .finally(() => inFlight.delete(tag));
  }
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------
export function setTime(ms: number, opts: { keepView?: boolean } = {}): void {
  const s = get();
  const timeMs = clampTime(ms);
  const patch: Partial<AppState> = { timeMs };
  const missionMs = s.missionDays * DAY_MS;
  if (timeMs < s.rangeStartMs + DAY_MS || timeMs + missionMs > s.rangeEndMs - DAY_MS) {
    Object.assign(patch, rangeFor(timeMs), { analyses: {} });
  }
  const rs = patch.rangeStartMs ?? s.rangeStartMs, re = patch.rangeEndMs ?? s.rangeEndMs;
  let vs = s.viewStartMs, ve = s.viewEndMs;
  const span = Math.min(ve - vs, re - rs);
  if (!opts.keepView && (timeMs < vs || timeMs > ve)) {
    // Bring the cursor back into view, a tenth of the way in from the left edge.
    vs = timeMs - span * 0.1;
    ve = vs + span;
  }
  if (vs < rs) { vs = rs; ve = rs + span; }
  if (ve > re) { ve = re; vs = re - span; }
  patch.viewStartMs = vs;
  patch.viewEndMs = ve;
  set(patch);
}

export function setView(startMs: number, endMs: number): void {
  const s = get();
  let span = Math.max(6 * HOUR_MS, Math.min(endMs - startMs, s.rangeEndMs - s.rangeStartMs));
  let vs = startMs;
  if (vs < s.rangeStartMs) vs = s.rangeStartMs;
  if (vs + span > s.rangeEndMs) vs = s.rangeEndMs - span;
  set({ viewStartMs: vs, viewEndMs: vs + span });
}

/** Shows `days` of timeline starting slightly before the cursor. */
export function setViewSpan(days: number): void {
  const s = get();
  const span = days * DAY_MS;
  setView(s.timeMs - span * 0.08, s.timeMs + span * 0.92);
}

export function selectSite(id: string): void {
  if (!siteById(id)) return;
  const s = get();
  const patch: Partial<AppState> = { selectedId: id };
  const site = siteById(id)!;
  // The polar terrain view only covers latitudes south of 80 S.
  if (s.view3d === 'pole' && site.lat > -80.2) patch.view3d = 'globe';
  set(patch);
}

export function togglePin(id: string): void {
  const s = get();
  if (s.pinnedIds.includes(id)) set({ pinnedIds: s.pinnedIds.filter((p) => p !== id) });
  else if (s.pinnedIds.length < MAX_PINNED) set({ pinnedIds: [...s.pinnedIds, id] });
}

export function setHeightIdx(heightIdx: number): void {
  set({ heightIdx });
}

export function setMissionDays(days: number): void {
  set({ missionDays: Math.min(120, Math.max(1, days)) });
  setTime(get().timeMs, { keepView: true });
}

// --- Layout ---------------------------------------------------------------------------------
function setLayout(patch: Partial<Layout>): void {
  set((s) => ({ layout: { ...s.layout, ...patch } }));
  try {
    localStorage.setItem('celeste.layout', JSON.stringify(get().layout));
  } catch {
    // Layout simply will not persist.
  }
}

/** Applies a layout preset. Panel sizes are kept: they are the user's. */
export function setMode(mode: LayoutMode): void {
  const p = PRESETS[mode];
  setLayout({ mode, open: { ...p.open }, detail: p.detail });
  if (p.dock) set({ dock: p.dock });
}

export function togglePanel(id: PanelId, open?: boolean): void {
  const l = get().layout;
  setLayout({ mode: null, open: { ...l.open, [id]: open ?? !l.open[id] } });
}

export function resizePanel(key: keyof typeof LAYOUT_LIMITS, value: number): void {
  const [lo, hi] = LAYOUT_LIMITS[key];
  setLayout({ [key]: Math.round(Math.min(hi, Math.max(lo, value))) });
}

export function setDetail(detail: Detail): void {
  setLayout({ detail, mode: null });
}

export function toggleFolded(id: string): void {
  const l = get().layout;
  setLayout({ folded: { ...l.folded, [id]: !l.folded[id] } });
}

/** Opens the bottom console on a given tab (used by shortcuts in other panels). */
export function showDock(tab: Dock): void {
  set({ dock: tab });
  if (!get().layout.open.dock) togglePanel('dock', true);
}

let customCounter = 1;

/** Adds a user-defined site and, inside the polar terrain model, traces its skyline in the worker. */
export function addCustomSite(name: string, lat: number, lon: number, select = true): string {
  const id = `custom-${Date.now().toString(36)}-${customCounter++}`;
  const site = makeCustomSite(id, name.trim() || `Custom ${customCounter - 1}`, Math.max(-90, Math.min(90, lat)), wrapLon(lon));
  const inPolarModel = site.lat < -80.3;
  site.pending = inPolarModel;
  set((s) => ({ sites: [...s.sites, site], ...(select ? { selectedId: id } : {}) }));
  if (inPolarModel) {
    request<HorizonResponse>({ type: 'horizon', id: nextId++, lat: site.lat, lon: site.lon, observerHeightsM: OBSERVER_HEIGHTS_M, baseUrl: new URL(TERRAIN_BASE_URL, location.href).href, tiers: [TERRAIN_TIERS[0], TERRAIN_TIERS[TERRAIN_TIERS.length - 1]] })
      .then((res) => {
        set((s) => ({
          sites: s.sites.map((x) => x.id !== id ? x : res.masks
            ? { ...x, pending: false, masks: res.masks, groundHeightM: Math.round(res.groundHeightM), quality: res.metersPerPixel <= 100 ? 'high' as const : 'medium' as const, terrainLabel: `LOLA south-polar grid at ${res.metersPerPixel} m/px, skyline traced in your browser out to 320 km${res.uncovered > 0.02 ? ` (${Math.round(res.uncovered * 100)}% of ray samples fall north of 80° S, outside the grid, and are treated as open sky)` : ''}` }
            : { ...x, pending: false }),
        }));
      })
      .catch(() => set((s) => ({ sites: s.sites.map((x) => (x.id === id ? { ...x, pending: false } : x)) })));
  }
  persistCustomSites();
  return id;
}

export function removeCustomSite(id: string): void {
  set((s) => {
    const sites = s.sites.filter((x) => x.id !== id);
    return {
      sites,
      pinnedIds: s.pinnedIds.filter((p) => p !== id),
      selectedId: s.selectedId === id ? sites[0].id : s.selectedId,
    };
  });
  persistCustomSites();
}

function persistCustomSites(): void {
  try {
    const custom = get().sites.filter((s) => s.group === 'custom').map((s) => ({ name: s.name, lat: s.lat, lon: s.lon }));
    localStorage.setItem('celeste.customSites', JSON.stringify(custom));
  } catch {
    // Storage can be unavailable (private mode); custom sites then last for the session only.
  }
}

/** Opens the flight view on a mission. */
export function selectMission(id: string): void {
  set({ missionId: id, view3d: 'flight' });
}

// ---------------------------------------------------------------------------------------------
// Shareable URL state
// ---------------------------------------------------------------------------------------------
function readHash(): Partial<Pick<AppState, 'selectedId' | 'pinnedIds' | 'timeMs' | 'missionDays' | 'heightIdx'>> {
  const out: ReturnType<typeof readHash> = {};
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  const site = p.get('site');
  if (site) out.selectedId = site;
  const pins = p.get('pin');
  if (pins !== null) out.pinnedIds = pins.split(',').filter(Boolean).slice(0, MAX_PINNED);
  const t = p.get('t');
  if (t) {
    const ms = Date.parse(t);
    if (Number.isFinite(ms)) out.timeMs = clampTime(ms);
  }
  const d = Number(p.get('days'));
  if (d >= 1 && d <= 120) out.missionDays = d;
  const h = Number(p.get('mast'));
  if (p.get('mast') !== null && h >= 0 && h < OBSERVER_HEIGHTS_M.length) out.heightIdx = h;
  return out;
}

let hashTimer = 0;
function writeHash(): void {
  clearTimeout(hashTimer);
  hashTimer = window.setTimeout(() => {
    const s = get();
    if (s.playing) return;
    const p = new URLSearchParams();
    p.set('site', s.selectedId);
    p.set('pin', s.pinnedIds.join(','));
    p.set('t', new Date(s.timeMs).toISOString().slice(0, 16) + 'Z');
    p.set('days', String(s.missionDays));
    if (s.heightIdx) p.set('mast', String(s.heightIdx));
    if (s.layout.mode) p.set('view', s.layout.mode);
    history.replaceState(null, '', `#${p.toString().replace(/%2C/g, ',').replace(/%3A/g, ':')}`);
  }, 400);
}

// ---------------------------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------------------------
export async function initStore(): Promise<void> {
  try {
    const sites = await loadCatalogue();
    set({ sites });
    try {
      const saved = JSON.parse(localStorage.getItem('celeste.customSites') ?? '[]') as { name: string; lat: number; lon: number }[];
      for (const c of saved.slice(0, 12)) if (Number.isFinite(c.lat) && Number.isFinite(c.lon)) addCustomSite(c.name, c.lat, c.lon, false);
    } catch {
      // Ignore unreadable saved sites.
    }
    const h = readHash();
    const exists = (id: string) => get().sites.some((x) => x.id === id);
    const patch: Partial<AppState> = { ready: true };
    if (h.selectedId && exists(h.selectedId)) patch.selectedId = h.selectedId;
    if (h.pinnedIds) patch.pinnedIds = h.pinnedIds.filter(exists);
    if (h.missionDays) patch.missionDays = h.missionDays;
    if (h.heightIdx !== undefined) patch.heightIdx = h.heightIdx;
    set(patch);
    const view = new URLSearchParams(location.hash.replace(/^#/, '')).get('view');
    if (view === 'focus' || view === 'explore' || view === 'control') setMode(view);
    if (h.timeMs) {
      set({ viewStartMs: h.timeMs - 3 * DAY_MS, viewEndMs: h.timeMs + 30 * DAY_MS, ...rangeFor(h.timeMs) });
      setTime(h.timeMs);
    }
    ensureAnalyses();
  } catch (e) {
    set({ loadError: e instanceof Error ? e.message : String(e) });
  }

  // Keep sweeps and the URL in step with whatever the user is looking at.
  useStore.subscribe((s) => [s.selectedId, s.pinnedIds, s.heightIdx, s.rangeStartMs, s.sites] as const, ensureAnalyses, { equalityFn: (a, b) => a.every((v, i) => v === b[i]) });
  useStore.subscribe((s) => [s.selectedId, s.pinnedIds, s.timeMs, s.missionDays, s.heightIdx, s.playing, s.layout.mode] as const, writeHash, { equalityFn: (a, b) => a.every((v, i) => v === b[i]) });
}
