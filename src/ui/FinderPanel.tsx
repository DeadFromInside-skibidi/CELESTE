// Landing-date finder: for every possible landing date in the timeline window, how good is
// a mission of the chosen length that starts then? One curve per compared site, and the best
// non-overlapping landing dates for the selected site.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SiteAnalysis } from '../core/analysis.ts';
import { DAY_MS } from '../core/constants.ts';
import { fmtDate, fmtDayMonth, fmtMonth, fmtPct, fmtUtc } from '../lib/format.ts';
import { analysisKey, comparedSites, LANE_COLORS, setTime, useStore } from '../state/store.ts';
import { COLORS, FONT_MONO, FONT_UI, RGB, setupCanvas } from './canvas.ts';

type Metric = 'sun' | 'dsn' | 'both';
const METRICS: { id: Metric; label: string; hint: string }[] = [
  { id: 'sun', label: 'Sunlight', hint: 'Share of the mission with direct sunlight' },
  { id: 'dsn', label: 'DSN contact', hint: 'Share of the mission with a DSN complex in view' },
  { id: 'both', label: 'Sunlight + DSN', hint: 'Share of the mission with both at once' },
];

// Prefix sums per analysis, so any window average is two lookups.
const prefixCache = new WeakMap<SiteAnalysis, Record<Metric, Float64Array>>();
function prefixes(an: SiteAnalysis): Record<Metric, Float64Array> {
  let p = prefixCache.get(an);
  if (p) return p;
  const n = an.series.count;
  const sun = new Float64Array(n + 1), dsn = new Float64Array(n + 1), both = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const l = an.series.sunFrac[i] > 0 ? 1 : 0, d = an.series.stationMask[i] ? 1 : 0;
    sun[i + 1] = sun[i] + l;
    dsn[i + 1] = dsn[i] + d;
    both[i + 1] = both[i] + (l & d);
  }
  p = { sun, dsn, both };
  prefixCache.set(an, p);
  return p;
}

/** Score (0..100) of a mission of `m` samples starting at sample i. */
function score(p: Float64Array, i: number, m: number): number {
  return (100 * (p[i + m] - p[i])) / m;
}

interface Best { startMs: number; score: number }

function bestDates(an: SiteAnalysis, metric: Metric, missionDays: number, aMs: number, bMs: number): Best[] {
  const se = an.series, p = prefixes(an)[metric];
  const m = Math.max(1, Math.round((missionDays * DAY_MS) / se.stepMs));
  const i0 = Math.max(0, Math.ceil((aMs - se.t0Ms) / se.stepMs));
  const i1 = Math.min(se.count - m, Math.floor((bMs - se.t0Ms) / se.stepMs));
  const taken: number[] = [];
  const out: Best[] = [];
  for (let k = 0; k < 3; k++) {
    let bi = -1, bs = -1;
    for (let i = i0; i <= i1; i += 3) {
      if (taken.some((t) => Math.abs(t - i) < m)) continue;
      const s = score(p, i, m);
      if (s > bs + 1e-9) { bs = s; bi = i; }
    }
    if (bi < 0) break;
    taken.push(bi);
    out.push({ startMs: se.t0Ms + bi * se.stepMs, score: bs });
  }
  return out;
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, metric: Metric, hoverX: number | null): void {
  const s = useStore.getState();
  ctx.clearRect(0, 0, w, h);
  const sites = comparedSites(s);
  const x0 = 44, y0 = 10, pw = w - x0 - 12, ph = h - y0 - 24;
  if (pw < 40 || ph < 30) return;
  const vs = s.viewStartMs, ve = s.viewEndMs, span = ve - vs;
  const xOf = (t: number) => x0 + ((t - vs) / span) * pw;
  const yOf = (v: number) => y0 + (1 - v / 100) * ph;

  ctx.fillStyle = COLORS.plot;
  ctx.fillRect(x0, y0, pw, ph);
  ctx.font = `500 10px ${FONT_MONO}`;
  ctx.textBaseline = 'middle';
  for (const v of [0, 25, 50, 75, 100]) {
    const y = Math.round(yOf(v)) + 0.5;
    ctx.strokeStyle = `rgba(${RGB.grid},0.12)`;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + pw, y);
    ctx.stroke();
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'right';
    ctx.fillText(`${v}%`, x0 - 7, y);
  }
  // Time ticks
  const pxPerDay = (pw / span) * DAY_MS;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  if (pxPerDay * 10 < 64) {
    const d = new Date(vs);
    let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    while (t <= ve) {
      if (t >= vs) { ctx.fillStyle = COLORS.muted; ctx.fillText(fmtMonth(t), xOf(t) + 3, y0 + ph + 6); ctx.fillRect(Math.round(xOf(t)), y0 + ph, 1, 5); }
      const n = new Date(t);
      t = Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1);
    }
  } else {
    const step = [1, 2, 5, 10].find((d) => d * pxPerDay >= 64) ?? 10;
    for (let t = Math.ceil(vs / (step * DAY_MS)) * step * DAY_MS; t <= ve; t += step * DAY_MS) {
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(fmtDayMonth(t), xOf(t) + 3, y0 + ph + 6);
      ctx.fillRect(Math.round(xOf(t)), y0 + ph, 1, 5);
    }
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, pw, ph);
  ctx.clip();
  // Draw the selected site last so its line is on top.
  for (let k = sites.length - 1; k >= 0; k--) {
    const an = s.analyses[analysisKey(sites[k].id, s.heightIdx)];
    if (!an) continue;
    const se = an.series, p = prefixes(an)[metric];
    const m = Math.max(1, Math.round((s.missionDays * DAY_MS) / se.stepMs));
    ctx.beginPath();
    let started = false;
    for (let px = 0; px <= pw; px++) {
      const i = Math.round((vs + (px / pw) * span - se.t0Ms) / se.stepMs);
      if (i < 0 || i + m > se.count) { started = false; continue; }
      const y = yOf(score(p, i, m));
      if (started) ctx.lineTo(x0 + px, y);
      else { ctx.moveTo(x0 + px, y); started = true; }
    }
    ctx.strokeStyle = LANE_COLORS[k % LANE_COLORS.length];
    ctx.lineWidth = k === 0 ? 2 : 1.4;
    ctx.globalAlpha = k === 0 ? 1 : 0.8;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // Cursor (current landing date)
  const cx = xOf(s.timeMs);
  ctx.strokeStyle = COLORS.text;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, y0);
  ctx.lineTo(cx, y0 + ph);
  ctx.stroke();
  ctx.restore();

  if (hoverX !== null && hoverX >= x0 && hoverX <= x0 + pw) {
    const t = vs + ((hoverX - x0) / pw) * span;
    ctx.strokeStyle = `rgba(${RGB.text},0.3)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(hoverX) + 0.5, y0);
    ctx.lineTo(Math.round(hoverX) + 0.5, y0 + ph);
    ctx.stroke();
    const lines: { text: string; color: string }[] = [{ text: `Land ${fmtUtc(t)}`, color: COLORS.text }];
    sites.forEach((site, k) => {
      const an = s.analyses[analysisKey(site.id, s.heightIdx)];
      if (!an) return;
      const se = an.series, m = Math.max(1, Math.round((s.missionDays * DAY_MS) / se.stepMs));
      const i = Math.round((t - se.t0Ms) / se.stepMs);
      if (i < 0 || i + m > se.count) return;
      lines.push({ text: `${fmtPct(score(prefixes(an)[metric], i, m), 1).padStart(6)}  ${site.name}`, color: LANE_COLORS[k % LANE_COLORS.length] });
    });
    ctx.font = `500 11px ${FONT_MONO}`;
    const tw = Math.max(...lines.map((l) => ctx.measureText(l.text).width)) + 16;
    const th = lines.length * 15 + 9;
    const tx = hoverX + 12 + tw > x0 + pw ? hoverX - 12 - tw : hoverX + 12;
    ctx.fillStyle = 'rgba(8,13,22,0.95)';
    ctx.strokeStyle = COLORS.line2;
    ctx.beginPath();
    ctx.roundRect(tx, y0 + 6, tw, th, 6);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => {
      ctx.fillStyle = l.color;
      ctx.font = i === 0 ? `600 11px ${FONT_UI}` : `500 11px ${FONT_MONO}`;
      ctx.fillText(l.text, tx + 8, y0 + 11 + i * 15);
    });
  }
}

export function FinderPanel() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [metric, setMetric] = useState<Metric>('both');
  const metricRef = useRef(metric);
  metricRef.current = metric;
  const handle = useRef<{ schedule(): void } | null>(null);
  const site = useStore((s) => s.sites.find((x) => x.id === s.selectedId));
  const an = useStore((s) => (site ? s.analyses[analysisKey(site.id, s.heightIdx)] : undefined));
  const missionDays = useStore((s) => s.missionDays);
  const a = useStore((s) => s.viewStartMs);
  const b = useStore((s) => s.viewEndMs);

  useEffect(() => {
    const canvas = ref.current!;
    let hoverX: number | null = null;
    const h = setupCanvas(canvas, (ctx, w, hh) => draw(ctx, w, hh, metricRef.current, hoverX));
    handle.current = h;
    const unsub = useStore.subscribe(h.schedule);
    const timeAt = (clientX: number) => {
      const s = useStore.getState();
      const x = clientX - canvas.getBoundingClientRect().left;
      const pw = canvas.clientWidth - 44 - 12;
      return s.viewStartMs + (Math.min(pw, Math.max(0, x - 44)) / pw) * (s.viewEndMs - s.viewStartMs);
    };
    let dragging = false;
    const down = (ev: PointerEvent) => { dragging = true; canvas.setPointerCapture(ev.pointerId); useStore.setState({ playing: false }); setTime(timeAt(ev.clientX), { keepView: true }); };
    const move = (ev: PointerEvent) => {
      hoverX = ev.clientX - canvas.getBoundingClientRect().left;
      if (dragging) setTime(timeAt(ev.clientX), { keepView: true });
      h.schedule();
    };
    const up = () => { dragging = false; };
    const leave = () => { hoverX = null; h.schedule(); };
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

  useEffect(() => { handle.current?.schedule(); }, [metric]);

  const best = useMemo(() => (an ? bestDates(an, metric, missionDays, a, b) : []), [an, metric, missionDays, a, b]);

  return (
    <div className="finder">
      <div className="finder-chart">
        <div className="dock-note">
          <span>Score of a <b>{missionDays}-day</b> mission by landing date. Click to land there.</span>
          <div className="seg" role="group" aria-label="Score">
            {METRICS.map((m) => <button key={m.id} className={m.id === metric ? 'on' : ''} title={m.hint} onClick={() => setMetric(m.id)}>{m.label}</button>)}
          </div>
        </div>
        <div className="canvas-wrap"><canvas ref={ref} className="fill scrub" aria-label="Mission score against landing date" /></div>
      </div>
      <div className="finder-best">
        <h4>Best landing dates</h4>
        <span className="fine">{site?.name} · {METRICS.find((m) => m.id === metric)!.label.toLowerCase()} · non-overlapping</span>
        <ol>
          {best.map((x, i) => (
            <li key={i}>
              <button onClick={() => { useStore.setState({ playing: false }); setTime(x.startMs, { keepView: true }); }}>
                <span className="rank"><i>{i + 1}</i></span>
                <span className="when"><b>{fmtDate(x.startMs)}</b><em>{fmtUtc(x.startMs).slice(11)} UTC</em></span>
                <span className="score">{fmtPct(x.score, 1)}</span>
              </button>
            </li>
          ))}
          {!best.length && <li className="fine">{an ? 'The window is shorter than the mission.' : 'Analysing…'}</li>}
        </ol>
      </div>
    </div>
  );
}
