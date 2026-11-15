// Timeline: one lane per compared site (sunlight / Earth in view / DSN contact), plus the
// elevation of the Sun and Earth above the local skyline for the selected site.
// Drag to scrub, wheel to zoom about the pointer, right-drag (or Shift+drag) to pan.
import { useEffect, useRef } from 'react';
import type { SiteAnalysis } from '../core/analysis.ts';
import { DAY_MS, HOUR_MS, SYNODIC_MONTH_DAYS } from '../core/constants.ts';
import { fmtDayMonth, fmtDeg, fmtMonth, fmtTime, fmtUtc } from '../lib/format.ts';
import { analysisKey, comparedSites, LANE_COLORS, setTime, setView, setViewSpan, useStore } from '../state/store.ts';
import { COLORS, FONT_MONO, FONT_UI, niceStep, RGB, setupCanvas } from './canvas.ts';

const AXIS_H = 24;
const LANE_H = 31;
const BAND_H = 7;

const TICK_STEPS = [HOUR_MS, 3 * HOUR_MS, 6 * HOUR_MS, 12 * HOUR_MS, DAY_MS, 2 * DAY_MS, 5 * DAY_MS, 10 * DAY_MS];

interface Hover { x: number; y: number }

let hazard: CanvasPattern | null = null;

/** 45-degree orange stripes, tiled. */
function hazardPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 12;
  const g = tile.getContext('2d')!;
  g.strokeStyle = COLORS.mission;
  g.lineWidth = 3;
  for (const o of [-12, 0, 12]) {
    g.beginPath();
    g.moveTo(o - 2, 14);
    g.lineTo(o + 14, -2);
    g.stroke();
  }
  return ctx.createPattern(tile, 'repeat');
}

function gutter(w: number): number {
  return w < 640 ? 92 : 156;
}

function drawBand(ctx: CanvasRenderingContext2D, x0: number, pw: number, y: number, rgb: string, value: (px: number) => number): void {
  ctx.fillStyle = COLORS.track;
  ctx.fillRect(x0, y, pw, BAND_H);
  let runStart = 0, runQ = -1;
  const flush = (end: number) => {
    if (runQ > 0) {
      ctx.fillStyle = `rgba(${rgb},${(0.16 + 0.84 * (runQ / 8)).toFixed(3)})`;
      ctx.fillRect(x0 + runStart, y, end - runStart, BAND_H);
    }
  };
  for (let px = 0; px < pw; px++) {
    const v = value(px);
    const q = v <= 0 ? 0 : Math.max(1, Math.round(v * 8));
    if (q !== runQ) {
      flush(px);
      runStart = px;
      runQ = q;
    }
  }
  flush(pw);
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, hover: Hover | null): void {
  const s = useStore.getState();
  ctx.clearRect(0, 0, w, h);
  const sites = comparedSites(s);
  const x0 = gutter(w), pw = Math.max(10, w - x0 - 12);
  const vs = s.viewStartMs, ve = s.viewEndMs, span = ve - vs;
  const xOf = (t: number) => x0 + ((t - vs) / span) * pw;
  const lanesTop = AXIS_H;
  const plotTop = lanesTop + sites.length * LANE_H + 8;
  const plotH = h - plotTop - 6;
  const bottom = plotH > 44 ? plotTop + plotH : lanesTop + sites.length * LANE_H;

  // ---- Cursor tag bounds for collision-free axis rendering ----
  const cx = xOf(s.timeMs);
  const curLabel = fmtUtc(s.timeMs).slice(5);
  ctx.font = `600 10px ${FONT_MONO}`;
  const curLw = ctx.measureText(curLabel).width + 12;
  const curLx = Math.min(x0 + pw - curLw, Math.max(x0, cx - curLw / 2));
  const curVisible = cx >= x0 - 1 && cx <= x0 + pw + 1;

  // ---- Time axis ----------------------------------------------------------------------
  ctx.font = `500 10px ${FONT_MONO}`;
  ctx.textBaseline = 'middle';
  const pxPerMs = pw / span;
  const monthly = 10 * DAY_MS * pxPerMs < 64;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, 0, pw, h);
  ctx.clip();
  const tick = (t: number, label: string, strong: boolean) => {
    const x = Math.round(xOf(t)) + 0.5;
    ctx.strokeStyle = strong ? `rgba(${RGB.grid},0.24)` : `rgba(${RGB.grid},0.09)`;
    ctx.beginPath();
    ctx.moveTo(x, AXIS_H - 5);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    const tw = ctx.measureText(label).width;
    if (curVisible && x + 4 + tw >= curLx - 4 && x + 4 <= curLx + curLw + 4) return;
    ctx.fillStyle = strong ? COLORS.text : COLORS.muted;
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 4, 11);
  };
  if (monthly) {
    const d = new Date(vs);
    let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    while (t <= ve) {
      if (t >= vs - 31 * DAY_MS) tick(t, fmtMonth(t), new Date(t).getUTCMonth() === 0);
      const n = new Date(t);
      t = Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1);
    }
  } else {
    const step = TICK_STEPS.find((st) => st * pxPerMs >= 74) ?? 10 * DAY_MS;
    for (let t = Math.ceil(vs / step) * step; t <= ve; t += step) {
      const midnight = t % DAY_MS === 0;
      tick(t, step >= DAY_MS || midnight ? fmtDayMonth(t) : fmtTime(t), midnight && step < DAY_MS);
    }
  }
  ctx.restore();

  // ---- Lanes --------------------------------------------------------------------------
  const columns = (an: SiteAnalysis) => {
    const se = an.series;
    const idx = (px: number) => (vs + (px / pw) * span - se.t0Ms) / se.stepMs;
    return (px: number, f: (i: number) => number): number => {
      let a = Math.floor(idx(px)), b = Math.floor(idx(px + 1));
      if (b < 0 || a > se.count - 1) return 0;
      a = Math.max(0, a);
      b = Math.min(se.count - 1, Math.max(a, b));
      let sum = 0;
      for (let i = a; i <= b; i++) sum += f(i);
      return sum / (b - a + 1);
    };
  };

  sites.forEach((site, k) => {
    const y = lanesTop + k * LANE_H;
    const an = s.analyses[analysisKey(site.id, s.heightIdx)];
    const color = LANE_COLORS[k % LANE_COLORS.length];
    // Label
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(8, y + 9, 4, LANE_H - 14, 2);
    ctx.fill();
    ctx.font = `${k === 0 ? 600 : 500} 12px ${FONT_UI}`;
    ctx.fillStyle = k === 0 ? COLORS.text : '#c9c6b8';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let name = site.name;
    const maxW = x0 - 30;
    if (ctx.measureText(name).width > maxW) {
      while (name.length > 3 && ctx.measureText(name + '…').width > maxW) name = name.slice(0, -1);
      name += '…';
    }
    ctx.fillText(name, 19, y + LANE_H / 2 + 1);

    const by = y + 3;
    if (!an) {
      ctx.fillStyle = COLORS.track;
      ctx.fillRect(x0, by, pw, LANE_H - 6);
      ctx.fillStyle = COLORS.faint;
      ctx.font = `500 11px ${FONT_UI}`;
      ctx.fillText(site.pending ? 'Tracing terrain horizon…' : 'Computing…', x0 + 10, y + LANE_H / 2 + 1);
      return;
    }
    const col = columns(an);
    const se = an.series;
    drawBand(ctx, x0, pw, by, RGB.sun, (px) => col(px, (i) => se.sunFrac[i]));
    drawBand(ctx, x0, pw, by + BAND_H + 2, RGB.earth, (px) => col(px, (i) => (se.earthClear[i] > 0 ? 1 : 0)));
    drawBand(ctx, x0, pw, by + 2 * (BAND_H + 2), RGB.dsn, (px) => col(px, (i) => (se.stationMask[i] ? 1 : 0)));
  });

  // ---- Elevation above the skyline (selected site) --------------------------------------
  const sel = sites[0];
  const selAn = sel ? s.analyses[analysisKey(sel.id, s.heightIdx)] : undefined;
  let yOf: ((v: number) => number) | null = null;
  if (plotH > 44 && selAn) {
    const se = selAn.series;
    const col = columns(selAn);
    const sun = new Float32Array(pw), earth = new Float32Array(pw);
    let lo = Infinity, hi = -Infinity;
    for (let px = 0; px < pw; px++) {
      sun[px] = col(px, (i) => se.sunClear[i]);
      earth[px] = col(px, (i) => se.earthClear[i]);
      lo = Math.min(lo, sun[px], earth[px]);
      hi = Math.max(hi, sun[px], earth[px]);
    }
    lo = Math.max(-16, Math.min(-1, Math.floor(lo - 0.5)));
    hi = Math.max(2, Math.ceil(hi + 0.5));
    const y = (v: number) => plotTop + ((hi - v) / (hi - lo)) * plotH;
    yOf = y;
    ctx.fillStyle = COLORS.plot;
    ctx.fillRect(x0, plotTop, pw, plotH);
    const step = niceStep(hi - lo, Math.max(2, Math.floor(plotH / 26)));
    ctx.font = `500 10px ${FONT_MONO}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-6; v += step) {
      const yy = Math.round(y(v)) + 0.5;
      const zero = Math.abs(v) < 1e-9;
      ctx.strokeStyle = zero ? `rgba(${RGB.text},0.45)` : `rgba(${RGB.grid},0.1)`;
      ctx.beginPath();
      ctx.moveTo(x0, yy);
      ctx.lineTo(x0 + pw, yy);
      ctx.stroke();
      ctx.fillStyle = zero ? COLORS.text : COLORS.muted;
      ctx.fillText(zero ? (x0 > 120 ? 'skyline' : '0°') : `${v > 0 ? '+' : '−'}${Math.abs(v)}°`, x0 - 7, yy);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, plotTop, pw, plotH);
    ctx.clip();
    const curve = (data: Float32Array, stroke: string, fill: string) => {
      const zeroY = y(0);
      ctx.beginPath();
      ctx.moveTo(x0, zeroY);
      for (let px = 0; px < pw; px++) ctx.lineTo(x0 + px + 0.5, Math.min(zeroY, y(data[px])));
      ctx.lineTo(x0 + pw, zeroY);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.beginPath();
      for (let px = 0; px < pw; px++) (px === 0 ? ctx.moveTo(x0 + 0.5, y(data[0])) : ctx.lineTo(x0 + px + 0.5, y(data[px])));
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
    };
    curve(earth, COLORS.earth, `rgba(${RGB.earth},0.1)`);
    curve(sun, COLORS.sun, `rgba(${RGB.sun},0.14)`);
    ctx.restore();
    // Legend in the gutter beside the plot (bands above, curves here).
    if (x0 > 120 && plotH > 46) {
      const items: [string, string][] = [[COLORS.sun, 'Sun'], [COLORS.earth, 'Earth'], [COLORS.dsn, 'DSN contact'], [COLORS.mission, 'Mission']];
      ctx.font = `500 10.5px ${FONT_UI}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const gap = Math.min(16, (plotH - 6) / items.length);
      items.forEach(([c, label], i) => {
        const yy = plotTop + 9 + i * gap;
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.roundRect(10, yy - 3, 10, 6, 2);
        ctx.fill();
        ctx.fillStyle = COLORS.muted;
        ctx.fillText(label, 26, yy + 0.5);
      });
    }
  }

  // ---- Mission window and cursor ----------------------------------------------------------
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, 0, pw, h);
  ctx.clip();
  const mx = xOf(s.timeMs + s.missionDays * DAY_MS);
  ctx.fillStyle = `rgba(${RGB.mission},0.07)`;
  ctx.fillRect(cx, lanesTop, mx - cx, bottom - lanesTop);
  // Hazard striping marks the mission window without hiding the bands under it.
  hazard ??= hazardPattern(ctx);
  if (hazard) {
    ctx.globalAlpha = 0.13;
    ctx.fillStyle = hazard;
    ctx.fillRect(cx, lanesTop, mx - cx, bottom - lanesTop);
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = `rgba(${RGB.mission},0.8)`;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(Math.round(mx) + 0.5, lanesTop);
  ctx.lineTo(Math.round(mx) + 0.5, bottom);
  ctx.stroke();
  ctx.setLineDash([]);
  if (mx - cx > 78 && plotH > 44) {
    ctx.font = `600 10px ${FONT_UI}`;
    ctx.fillStyle = COLORS.mission;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${s.missionDays}-day mission`, mx - 5, bottom - 5);
  }
  // Real-world "now"
  const nowX = xOf(Date.now());
  if (nowX > x0 && nowX < x0 + pw) {
    ctx.fillStyle = COLORS.faint;
    ctx.beginPath();
    ctx.moveTo(nowX - 4, AXIS_H - 6);
    ctx.lineTo(nowX + 4, AXIS_H - 6);
    ctx.lineTo(nowX, AXIS_H);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = COLORS.text;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, AXIS_H - 2);
  ctx.lineTo(cx, bottom);
  ctx.stroke();
  ctx.restore();
  // Cursor flag
  if (curVisible) {
    ctx.fillStyle = COLORS.text;
    ctx.beginPath();
    ctx.roundRect(curLx, 2, curLw, 17, 4);
    ctx.fill();
    ctx.fillStyle = COLORS.bg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(curLabel, curLx + curLw / 2, 11);
  }

  // ---- Hover read-out -----------------------------------------------------------------
  if (hover && hover.x >= x0 && hover.x <= x0 + pw && hover.y > AXIS_H) {
    const t = vs + ((hover.x - x0) / pw) * span;
    ctx.strokeStyle = `rgba(${RGB.text},0.3)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(hover.x) + 0.5, AXIS_H);
    ctx.lineTo(Math.round(hover.x) + 0.5, bottom);
    ctx.stroke();
    let text = fmtUtc(t);
    if (selAn) {
      const i = Math.round((t - selAn.series.t0Ms) / selAn.series.stepMs);
      if (i >= 0 && i < selAn.series.count) {
        text += `   Sun ${fmtDeg(selAn.series.sunClear[i], 1)}   Earth ${fmtDeg(selAn.series.earthClear[i], 1)}`;
        if (yOf) {
          for (const [v, c] of [[selAn.series.sunClear[i], COLORS.sun], [selAn.series.earthClear[i], COLORS.earth]] as const) {
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(hover.x, yOf(v), 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
    ctx.font = `500 11px ${FONT_MONO}`;
    const tw = ctx.measureText(text).width + 14;
    const tx = hover.x + 12 + tw > x0 + pw ? hover.x - 12 - tw : hover.x + 12;
    const ty = Math.min(bottom - 22, Math.max(AXIS_H + 4, hover.y - 10));
    ctx.fillStyle = 'rgba(8,13,22,0.95)';
    ctx.strokeStyle = COLORS.line2;
    ctx.beginPath();
    ctx.roundRect(tx, ty, tw, 20, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, tx + 7, ty + 10.5);
  }
}

export function Timeline() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    let hover: Hover | null = null;
    const h = setupCanvas(canvas, (ctx, w, hh) => draw(ctx, w, hh, hover));
    const unsub = useStore.subscribe(h.schedule);
    let mode: 'scrub' | 'pan' | null = null;
    let panFrom = { x: 0, vs: 0, ve: 0 };

    const geom = () => {
      const x0 = gutter(canvas.clientWidth);
      return { x0, pw: Math.max(10, canvas.clientWidth - x0 - 12) };
    };
    const timeAt = (clientX: number) => {
      const { x0, pw } = geom();
      const s = useStore.getState();
      const x = clientX - canvas.getBoundingClientRect().left;
      return s.viewStartMs + (Math.min(pw, Math.max(0, x - x0)) / pw) * (s.viewEndMs - s.viewStartMs);
    };
    const down = (ev: PointerEvent) => {
      const s = useStore.getState();
      canvas.setPointerCapture(ev.pointerId);
      if (ev.button !== 0 || ev.shiftKey) {
        mode = 'pan';
        panFrom = { x: ev.clientX, vs: s.viewStartMs, ve: s.viewEndMs };
      } else {
        mode = 'scrub';
        useStore.setState({ playing: false });
        setTime(timeAt(ev.clientX), { keepView: true });
      }
    };
    const move = (ev: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      hover = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      if (mode === 'scrub') setTime(timeAt(ev.clientX), { keepView: true });
      else if (mode === 'pan') {
        const { pw } = geom();
        const dt = ((ev.clientX - panFrom.x) / pw) * (panFrom.ve - panFrom.vs);
        setView(panFrom.vs - dt, panFrom.ve - dt);
      }
      h.schedule();
    };
    const up = () => { mode = null; };
    const leave = () => { hover = null; h.schedule(); };
    const wheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const s = useStore.getState();
      const span = s.viewEndMs - s.viewStartMs;
      if (ev.shiftKey || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
        const dt = ((ev.deltaX || ev.deltaY) / 600) * span;
        setView(s.viewStartMs + dt, s.viewEndMs + dt);
        return;
      }
      const t = timeAt(ev.clientX);
      const factor = Math.exp(Math.max(-1, Math.min(1, ev.deltaY / 400)));
      const next = Math.max(6 * HOUR_MS, span * factor);
      const f = (t - s.viewStartMs) / span;
      setView(t - f * next, t + (1 - f) * next);
    };
    const dbl = () => setViewSpan(SYNODIC_MONTH_DAYS);
    const menu = (ev: Event) => ev.preventDefault();
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('dblclick', dbl);
    canvas.addEventListener('contextmenu', menu);
    return () => {
      unsub();
      h.dispose();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('dblclick', dbl);
      canvas.removeEventListener('contextmenu', menu);
    };
  }, []);

  return (
    <div className="canvas-wrap timeline">
      <canvas ref={ref} className="fill scrub" aria-label="Timeline of sunlight, Earth visibility and DSN contact for the compared sites" />
    </div>
  );
}
