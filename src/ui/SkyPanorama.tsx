// Local horizon panorama: the terrain skyline around the selected site with the Sun and the
// Earth where they actually are, their tracks over the mission window, and two "telescope"
// insets that show each disk against the skyline at true angular scale.
import { useEffect, useRef, useState } from 'react';
import { type Instant, newInstant } from '../core/analysis.ts';
import { DAY_MS, DEG } from '../core/constants.ts';
import { maskAt } from '../core/horizon.ts';
import { compass, fmtDeg } from '../lib/format.ts';
import { instantAt } from '../state/live.ts';
import { QUALITY_LABEL, type Site } from '../state/sites.ts';
import { analysisKey, togglePanel, useStore } from '../state/store.ts';
import { PanelHead } from './Panel.tsx';
import { COLORS, FONT_MONO, FONT_UI, niceStep, RGB, setupCanvas } from './canvas.ts';

const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

interface View { centerAz: number; hover: { x: number; y: number } | null }

function drawEarthDisk(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, inst: Instant): void {
  // Phase: lit fraction follows the Sun-Earth separation on the site's sky.
  const dAz = wrap180(inst.sunAz - inst.earthAz) * Math.cos(inst.earthEl * DEG);
  const dEl = inst.sunEl - inst.earthEl;
  const cosPsi = Math.sin(inst.sunEl * DEG) * Math.sin(inst.earthEl * DEG) + Math.cos(inst.sunEl * DEG) * Math.cos(inst.earthEl * DEG) * Math.cos((inst.sunAz - inst.earthAz) * DEG);
  const psi = Math.acos(Math.max(-1, Math.min(1, cosPsi)));
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = '#0b2140';
  ctx.fill();
  ctx.rotate(-Math.atan2(dEl, dAz));
  ctx.beginPath();
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
  const a = Math.max(0.001, r * Math.abs(Math.cos(psi)));
  if (psi > Math.PI / 2) ctx.ellipse(0, 0, a, r, 0, Math.PI / 2, (3 * Math.PI) / 2, false);
  else ctx.ellipse(0, 0, a, r, 0, Math.PI / 2, -Math.PI / 2, true);
  ctx.closePath();
  const g = ctx.createRadialGradient(r * 0.3, -r * 0.2, r * 0.1, 0, 0, r);
  g.addColorStop(0, '#9be0ff');
  g.addColorStop(1, '#2f8fe0');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

function drawSunDisk(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, glow: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, glow);
  g.addColorStop(0, 'rgba(255,190,84,0.42)');
  g.addColorStop(1, `rgba(${RGB.sun},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, glow, 0, Math.PI * 2);
  ctx.fill();
  const d = ctx.createRadialGradient(x, y, 0, x, y, r);
  d.addColorStop(0, '#fffbe8');
  d.addColorStop(0.75, '#ffd26a');
  d.addColorStop(1, COLORS.sun);
  ctx.fillStyle = d;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, view: View, scratch: Instant): void {
  const s = useStore.getState();
  ctx.clearRect(0, 0, w, h);
  const site = s.sites.find((x) => x.id === s.selectedId);
  if (!site) return;
  const mask = site.masks[s.heightIdx];
  const inst = instantAt(site, s.heightIdx, s.timeMs, scratch);
  const an = s.analyses[analysisKey(site.id, s.heightIdx)];

  // ---- Layout -------------------------------------------------------------------------
  const lens = Math.max(56, Math.min(132, Math.floor((h - 16) / 2)));
  const showLens = w > 520;
  const x0 = 38, y0 = 8;
  const pw = w - x0 - (showLens ? lens + 18 : 8), ph = h - y0 - 22;
  if (pw < 60 || ph < 40) return;

  // ---- Tracks over the mission window ---------------------------------------------------
  let i0 = 0, i1 = -1, stride = 1;
  if (an) {
    const se = an.series;
    i0 = Math.max(0, Math.round((s.timeMs - se.t0Ms) / se.stepMs));
    i1 = Math.min(se.count - 1, Math.round((s.timeMs + s.missionDays * DAY_MS - se.t0Ms) / se.stepMs));
    stride = Math.max(1, Math.floor((i1 - i0) / 500));
  }

  // ---- Vertical range: stable for a given site and mission window -------------------------
  let mMin = 0, mMax = 0;
  if (mask) {
    mMin = Infinity; mMax = -Infinity;
    for (let i = 0; i < mask.length; i += 2) { if (mask[i] < mMin) mMin = mask[i]; if (mask[i] > mMax) mMax = mask[i]; }
  }
  let sunMax = inst.sunEl, earthMax = inst.earthEl;
  if (an) for (let i = i0; i <= i1; i += stride) { if (an.series.sunEl[i] > sunMax) sunMax = an.series.sunEl[i]; if (an.series.earthEl[i] > earthMax) earthMax = an.series.earthEl[i]; }
  const lo = Math.max(-14, Math.floor(Math.min(mMin, 0) - 1.5));
  let hi = Math.max(mMax + 1.5, 6, sunMax + 1.5, earthMax > lo ? earthMax + 1.5 : -99);
  hi = hi > 30 ? Math.min(90, Math.ceil(hi / 10) * 10) : Math.ceil(hi / 2) * 2;

  const xOf = (az: number) => x0 + ((wrap180(az - view.centerAz) + 180) / 360) * pw;
  const yOf = (el: number) => y0 + ((hi - el) / (hi - lo)) * ph;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, pw, ph);
  ctx.clip();

  // Sky
  const sky = ctx.createLinearGradient(0, y0, 0, y0 + ph);
  sky.addColorStop(0, '#04070c');
  sky.addColorStop(1, '#0c1626');
  ctx.fillStyle = sky;
  ctx.fillRect(x0, y0, pw, ph);

  // Stars (fixed in azimuth/elevation so they pan with the view).
  let seed = 97;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  ctx.fillStyle = '#aebbd6';
  for (let i = 0; i < 150; i++) {
    const az = rnd() * 360, el = lo + rnd() * (hi - lo), a = 0.15 + rnd() * 0.5;
    ctx.globalAlpha = a;
    ctx.fillRect(xOf(az), yOf(el), 1.2, 1.2);
  }
  ctx.globalAlpha = 1;

  // Elevation grid
  const eStep = niceStep(hi - lo, Math.max(3, Math.floor(ph / 34)));
  ctx.lineWidth = 1;
  for (let e = Math.ceil(lo / eStep) * eStep; e <= hi + 1e-6; e += eStep) {
    const y = Math.round(yOf(e)) + 0.5;
    ctx.strokeStyle = Math.abs(e) < 1e-9 ? `rgba(${RGB.text},0.5)` : `rgba(${RGB.grid},0.12)`;
    ctx.setLineDash(Math.abs(e) < 1e-9 ? [4, 4] : []);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + pw, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // Azimuth grid
  for (let a = 0; a < 360; a += 30) {
    const x = Math.round(xOf(a)) + 0.5;
    ctx.strokeStyle = a % 90 === 0 ? `rgba(${RGB.grid},0.2)` : `rgba(${RGB.grid},0.08)`;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y0 + ph);
    ctx.stroke();
  }

  const track = (az: Float32Array, el: Float32Array, color: string, alpha: number, dashed: boolean) => {
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1.6;
    ctx.setLineDash(dashed ? [2, 5] : []);
    ctx.beginPath();
    let px = NaN;
    for (let i = i0; i <= i1; i += stride) {
      const x = xOf(az[i]), y = yOf(el[i]);
      if (Number.isNaN(px) || Math.abs(x - px) > pw / 2) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      px = x;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  };
  const dayDots = (az: Float32Array, el: Float32Array, color: string) => {
    if (!an) return;
    const per = Math.round(DAY_MS / an.series.stepMs);
    ctx.fillStyle = color;
    for (let i = i0 + per; i <= i1; i += per) {
      ctx.beginPath();
      ctx.arc(xOf(az[i]), yOf(el[i]), 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const sunX = xOf(inst.sunAz), sunY = yOf(inst.sunEl), earthX = xOf(inst.earthAz), earthY = yOf(inst.earthEl);
  if (an) {
    track(an.series.sunAz, an.series.sunEl, COLORS.sun, 0.75, false);
    track(an.series.earthAz, an.series.earthEl, COLORS.earth, 0.75, false);
    dayDots(an.series.sunAz, an.series.sunEl, COLORS.sun);
  }
  drawSunDisk(ctx, sunX, sunY, 5.5, 26);
  drawEarthDisk(ctx, earthX, earthY, 7, inst);

  // Terrain silhouette
  ctx.beginPath();
  ctx.moveTo(x0, y0 + ph);
  for (let px = 0; px <= pw; px += 1) {
    const az = view.centerAz - 180 + (px / pw) * 360;
    ctx.lineTo(x0 + px, yOf(maskAt(mask, az)));
  }
  ctx.lineTo(x0 + pw, y0 + ph);
  ctx.closePath();
  const ground = ctx.createLinearGradient(0, yOf(Math.max(mMax, 0)), 0, y0 + ph);
  ground.addColorStop(0, '#2b3547');
  ground.addColorStop(1, '#0d131d');
  ctx.fillStyle = ground;
  ctx.fill();
  ctx.beginPath();
  for (let px = 0; px <= pw; px += 1) {
    const az = view.centerAz - 180 + (px / pw) * 360;
    const y = yOf(maskAt(mask, az));
    if (px === 0) ctx.moveTo(x0, y);
    else ctx.lineTo(x0 + px, y);
  }
  ctx.strokeStyle = '#c9c6b8';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // What is behind the terrain, drawn faintly so hidden bodies can still be located.
  if (an) {
    track(an.series.sunAz, an.series.sunEl, COLORS.sun, 0.22, true);
    track(an.series.earthAz, an.series.earthEl, COLORS.earth, 0.22, true);
  }
  const ghost = (x: number, y: number, r: number, color: string, hidden: boolean) => {
    if (!hidden) return;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.75;
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  };
  ghost(sunX, sunY, 6.5, COLORS.sun, inst.sunFrac < 0.999);
  ghost(earthX, earthY, 8, COLORS.earth, inst.earthFrac < 0.999);

  // Body labels (or an edge marker when a body is far below the plotted range).
  const tag = (x: number, y: number, text: string, color: string, below: boolean) => {
    ctx.font = `600 11px ${FONT_UI}`;
    const tw = ctx.measureText(text).width;
    const tx = Math.min(x0 + pw - tw - 6, Math.max(x0 + 6, x - tw / 2));
    const ty = below ? y0 + ph - 8 : Math.max(y0 + 14, y - 14);
    ctx.fillStyle = 'rgba(6,10,17,0.8)';
    ctx.fillRect(tx - 4, ty - 11, tw + 8, 15);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, tx, ty);
    if (below) {
      ctx.beginPath();
      ctx.moveTo(x - 5, y0 + ph - 26);
      ctx.lineTo(x + 5, y0 + ph - 26);
      ctx.lineTo(x, y0 + ph - 20);
      ctx.closePath();
      ctx.fill();
    }
  };
  tag(sunX, sunY, `Sun ${fmtDeg(inst.sunEl)}`, COLORS.sun, inst.sunEl < lo);
  tag(earthX, earthY, `Earth ${fmtDeg(inst.earthEl)}`, COLORS.earth, inst.earthEl < lo);

  // Hover read-out
  if (view.hover && view.hover.x >= x0 && view.hover.x <= x0 + pw && view.hover.y >= y0 && view.hover.y <= y0 + ph) {
    const az = (((view.centerAz - 180 + ((view.hover.x - x0) / pw) * 360) % 360) + 360) % 360;
    const el = hi - ((view.hover.y - y0) / ph) * (hi - lo);
    ctx.strokeStyle = `rgba(${RGB.text},0.25)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(view.hover.x) + 0.5, y0);
    ctx.lineTo(Math.round(view.hover.x) + 0.5, y0 + ph);
    ctx.stroke();
    const text = `az ${az.toFixed(1)}° ${compass(az)}   el ${fmtDeg(el, 1)}   skyline ${fmtDeg(maskAt(mask, az), 2)}`;
    ctx.font = `500 11px ${FONT_MONO}`;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(6,10,17,0.88)';
    ctx.fillRect(x0 + 6, y0 + 6, tw + 12, 18);
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x0 + 12, y0 + 15.5);
  }
  ctx.restore();

  // ---- Axes ------------------------------------------------------------------------------
  ctx.strokeStyle = COLORS.line2;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, pw - 1, ph - 1);
  ctx.font = `500 10px ${FONT_MONO}`;
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let e = Math.ceil(lo / eStep) * eStep; e <= hi + 1e-6; e += eStep) ctx.fillText(`${e > 0 ? '+' : e < 0 ? '−' : ''}${Math.abs(e)}°`, x0 - 6, yOf(e));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const NAMES: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  for (let a = 0; a < 360; a += pw < 420 ? 90 : 30) {
    const x = xOf(a);
    if (x < x0 + 8 || x > x0 + pw - 8) continue;
    const major = a % 90 === 0;
    ctx.fillStyle = major ? COLORS.text : COLORS.faint;
    ctx.font = major ? `700 11px ${FONT_UI}` : `500 10px ${FONT_MONO}`;
    ctx.fillText(major ? NAMES[a] : `${a}°`, x, y0 + ph + 6);
  }

  // ---- Telescope insets ------------------------------------------------------------------
  if (showLens) {
    const lx = x0 + pw + 12;
    const inset = (top: number, color: string, bodyAz: number, bodyEl: number, radius: number, halfFov: number, frac: number, title: string, body: (cx: number, cy: number, r: number) => void) => {
      const size = lens, cx = lx + size / 2, cy = top + size / 2, scale = size / 2 / halfFov;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(lx, top, size, size, 8);
      ctx.clip();
      ctx.fillStyle = '#05070c';
      ctx.fillRect(lx, top, size, size);
      body(cx, cy, radius * scale);
      const azScale = 1 / Math.max(0.05, Math.cos(bodyEl * DEG));
      const yAt = (px: number) => cy - (maskAt(mask, bodyAz + ((px - cx) / scale) * azScale) - bodyEl) * scale;
      ctx.beginPath();
      ctx.moveTo(lx, top + size);
      for (let px = lx; px <= lx + size; px++) ctx.lineTo(px, yAt(px));
      ctx.lineTo(lx + size, top + size);
      ctx.closePath();
      ctx.fillStyle = '#1b2231';
      ctx.fill();
      ctx.beginPath();
      for (let px = lx; px <= lx + size; px++) (px === lx ? ctx.moveTo(px, yAt(px)) : ctx.lineTo(px, yAt(px)));
      ctx.strokeStyle = '#c9c6b8';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // Outline of the full disk, including the part behind terrain.
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(cx, cy, radius * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      // Caption
      ctx.fillStyle = 'rgba(5,7,12,0.72)';
      ctx.fillRect(lx, top, size, 18);
      ctx.font = `700 10px ${FONT_UI}`;
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      if (size >= 84) ctx.fillText(title, lx + 7, top + 9.5);
      ctx.font = `600 10px ${FONT_MONO}`;
      ctx.textAlign = 'right';
      ctx.fillStyle = COLORS.text;
      ctx.fillText(`${Math.round(frac * 100)}%`, lx + size - 7, top + 9.5);
      ctx.restore();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(lx + 0.5, top + 0.5, size - 1, size - 1, 8);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    inset(y0, COLORS.sun, inst.sunAz, inst.sunEl, inst.sunRadius, 0.85, inst.sunFrac, 'SUN', (cx, cy, r) => drawSunDisk(ctx, cx, cy, r, r * 2.4));
    inset(y0 + lens + 8, COLORS.earth, inst.earthAz, inst.earthEl, inst.earthRadius, 2.4, inst.earthFrac, 'EARTH', (cx, cy, r) => drawEarthDisk(ctx, cx, cy, r, inst));
  }
}

function defaultCenter(site: Site | undefined): number {
  if (!site) return 0;
  const s = useStore.getState();
  const inst = instantAt(site, s.heightIdx, s.timeMs);
  // Open on the Earth when it is anywhere near the skyline; otherwise on north.
  return inst.earthEl > -12 ? inst.earthAz : 0;
}

export function SkyPanorama() {
  const ref = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ centerAz: 0, hover: null });
  const handle = useRef<{ schedule(): void } | null>(null);
  const selectedId = useStore((s) => s.selectedId);
  const site = useStore((s) => s.sites.find((x) => x.id === s.selectedId));
  const [, bump] = useState(0);

  useEffect(() => {
    const canvas = ref.current!;
    const scratch = newInstant();
    const h = setupCanvas(canvas, (ctx, w, hh) => draw(ctx, w, hh, view.current, scratch));
    handle.current = h;
    const unsub = useStore.subscribe(h.schedule);
    let drag: { x: number; az: number } | null = null;
    const pos = (ev: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
    const down = (ev: PointerEvent) => { drag = { x: ev.clientX, az: view.current.centerAz }; canvas.setPointerCapture(ev.pointerId); };
    const move = (ev: PointerEvent) => {
      if (drag) {
        const pw = Math.max(100, canvas.clientWidth - 170);
        view.current.centerAz = (((drag.az - ((ev.clientX - drag.x) / pw) * 360) % 360) + 360) % 360;
        view.current.hover = null;
      } else {
        view.current.hover = pos(ev);
      }
      h.schedule();
    };
    const up = () => { drag = null; };
    const leave = () => { view.current.hover = null; h.schedule(); };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', leave);
    return () => {
      unsub();
      h.dispose();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('pointerleave', leave);
    };
  }, []);

  // Re-centre when a different site is selected.
  useEffect(() => {
    view.current.centerAz = defaultCenter(useStore.getState().sites.find((x) => x.id === selectedId));
    handle.current?.schedule();
  }, [selectedId]);

  const center = (what: 'north' | 'sun' | 'earth') => {
    const s = useStore.getState();
    const st = s.sites.find((x) => x.id === s.selectedId);
    if (!st) return;
    const inst = instantAt(st, s.heightIdx, s.timeMs);
    view.current.centerAz = what === 'north' ? 0 : what === 'sun' ? inst.sunAz : inst.earthAz;
    handle.current?.schedule();
    bump((n) => n + 1);
  };

  return (
    <section className="panel pano">
      <PanelHead code="H2" title="Local horizon scope" note={site ? <span className={`badge q-${site.quality}`} title={site.terrainLabel}>{QUALITY_LABEL[site.quality]}</span> : undefined} onClose={() => togglePanel('scope')}>
        <div className="seg" role="group" aria-label="Centre the panorama on">
          <span className="seg-label">Centre</span>
          <button onClick={() => center('north')}>North</button>
          <button onClick={() => center('sun')}><i className="dot sun" />Sun</button>
          <button onClick={() => center('earth')}><i className="dot earth" />Earth</button>
        </div>
      </PanelHead>
      <div className="canvas-wrap">
        <canvas ref={ref} className="fill grab" aria-label="Panorama of the local horizon with the Sun and Earth" />
      </div>
    </section>
  );
}
