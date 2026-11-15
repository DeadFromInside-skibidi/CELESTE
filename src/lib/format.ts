// Formatting helpers. All times are shown in UTC, as mission timelines conventionally are.

import { DAY_MS, HOUR_MS } from '../core/constants.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** 2026-11-14 12:05 */
export function fmtUtc(ms: number, seconds = false): string {
  const d = new Date(ms);
  const base = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return seconds ? `${base}:${pad(d.getUTCSeconds())}` : base;
}

/** 14 Nov 2026 */
export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** 14 Nov */
export function fmtDayMonth(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function fmtMonth(ms: number): string {
  const d = new Date(ms);
  return d.getUTCMonth() === 0 ? `${MONTHS[0]} ${d.getUTCFullYear()}` : MONTHS[d.getUTCMonth()];
}

export function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Value for <input type="datetime-local"> representing a UTC instant. */
export function toInputValue(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function fromInputValue(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Number.isFinite(ms) ? ms : null;
}

/** 3 d 04 h · 5 h 12 m · 42 m */
export function fmtDuration(ms: number): string {
  const a = Math.abs(ms);
  if (a >= DAY_MS) {
    const d = Math.floor(a / DAY_MS);
    const h = Math.floor((a - d * DAY_MS) / HOUR_MS);
    return `${d} d ${pad(h)} h`;
  }
  if (a >= HOUR_MS) {
    const h = Math.floor(a / HOUR_MS);
    const m = Math.floor((a - h * HOUR_MS) / 60_000);
    return `${h} h ${pad(m)} m`;
  }
  return `${Math.max(0, Math.round(a / 60_000))} m`;
}

/** Hours as a compact duration: 0.4 h -> "24 m", 30 h -> "1 d 06 h". */
export function fmtHours(h: number): string {
  return fmtDuration(h * HOUR_MS);
}

export function fmtDeg(v: number, digits = 2, signed = true): string {
  if (!Number.isFinite(v)) return '--';
  const s = Math.abs(v).toFixed(digits);
  const sign = v < 0 ? '−' : signed ? '+' : '';
  return `${sign}${s}°`;
}

export function fmtPct(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return '--';
  return `${v.toFixed(digits)}%`;
}

export function fmtLat(lat: number, digits = 3): string {
  return `${Math.abs(lat).toFixed(digits)}° ${lat < 0 ? 'S' : 'N'}`;
}

export function fmtLon(lon: number, digits = 3): string {
  return `${Math.abs(lon).toFixed(digits)}° ${lon < 0 ? 'W' : 'E'}`;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compass(azDeg: number): string {
  return COMPASS[Math.round((((azDeg % 360) + 360) % 360) / 22.5) % 16];
}

export function fmtNumber(v: number, digits = 0): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Triggers a client-side file download. */
export function downloadText(filename: string, text: string, mime = 'text/csv'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csvRow(cells: (string | number)[]): string {
  return cells.map((c) => (typeof c === 'number' ? String(c) : /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',');
}
