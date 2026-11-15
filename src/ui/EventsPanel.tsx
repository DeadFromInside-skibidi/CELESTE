// Event reports for the selected site, in the spirit of GMAT's EclipseLocator and
// ContactLocator: every sunlight/darkness interval and every DSN pass in the timeline window,
// with start, stop and duration, exportable as CSV.
import { useMemo, useState } from 'react';
import type { Intervals } from '../core/analysis.ts';
import { DSN_STATIONS } from '../core/ephemeris.ts';
import { csvRow, downloadText, fmtDuration, fmtUtc } from '../lib/format.ts';
import { analysisKey, setTime, useStore } from '../state/store.ts';
import { DownloadIcon } from './icons.tsx';

interface EventRow { kind: string; cls: string; startMs: number; endMs: number; openStart: boolean; openEnd: boolean }

const MAX_ROWS = 300;

function clip(iv: Intervals, a: number, b: number, kind: string, cls: string, out: EventRow[]): void {
  for (let i = 0; i < iv.length; i += 2) {
    if (iv[i + 1] <= a || iv[i] >= b) continue;
    out.push({ kind, cls, startMs: Math.max(iv[i], a), endMs: Math.min(iv[i + 1], b), openStart: iv[i] < a, openEnd: iv[i + 1] > b });
  }
}

/** Gaps between intervals inside [a, b]. */
function complement(iv: Intervals, a: number, b: number): Intervals {
  const out: number[] = [];
  let cursor = a;
  for (let i = 0; i < iv.length; i += 2) {
    if (iv[i + 1] <= a) continue;
    if (iv[i] >= b) break;
    if (iv[i] > cursor) out.push(cursor, iv[i]);
    cursor = Math.max(cursor, iv[i + 1]);
  }
  if (cursor < b) out.push(cursor, b);
  return Float64Array.from(out);
}

function toCsv(title: string, site: string, rows: EventRow[]): string {
  return [
    csvRow([title]),
    csvRow(['Site', site]),
    '',
    csvRow(['Event', 'Start (UTC)', 'Stop (UTC)', 'Duration (s)', 'Duration', 'Truncated by report window']),
    ...rows.map((r) => csvRow([r.kind, fmtUtc(r.startMs, true), fmtUtc(r.endMs, true), Math.round((r.endMs - r.startMs) / 1000), fmtDuration(r.endMs - r.startMs), r.openStart || r.openEnd ? 'yes' : 'no'])),
  ].join('\n');
}

function Report({ title, rows, summary, onExport }: { title: string; rows: EventRow[]; summary: string; onExport(): void }) {
  return (
    <div className="report">
      <div className="report-head">
        <div>
          <h4>{title}</h4>
          <span>{summary}</span>
        </div>
        <button className="btn small" onClick={onExport} disabled={!rows.length}><DownloadIcon />CSV</button>
      </div>
      <div className="table-scroll">
        <table className="events">
          <thead><tr><th>Event</th><th>Start (UTC)</th><th>Stop (UTC)</th><th className="r">Duration</th></tr></thead>
          <tbody>
            {rows.slice(0, MAX_ROWS).map((r, i) => (
              <tr key={i} onClick={() => { useStore.setState({ playing: false }); setTime(r.startMs, { keepView: true }); }} title="Move the cursor to the start of this event">
                <td><i className={`dot ${r.cls}`} />{r.kind}</td>
                <td className="mono">{r.openStart ? '≤ ' : ''}{fmtUtc(r.startMs)}</td>
                <td className="mono">{r.openEnd ? '≥ ' : ''}{fmtUtc(r.endMs)}</td>
                <td className="mono r">{fmtDuration(r.endMs - r.startMs)}</td>
              </tr>
            ))}
            {!rows.length && <tr className="none"><td colSpan={4}>No events in this window.</td></tr>}
            {rows.length > MAX_ROWS && <tr className="none"><td colSpan={4}>Showing the first {MAX_ROWS} of {rows.length}. Zoom the timeline in, or export the CSV for the full list.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function EventsPanel() {
  const site = useStore((s) => s.sites.find((x) => x.id === s.selectedId));
  const an = useStore((s) => (site ? s.analyses[analysisKey(site.id, s.heightIdx)] : undefined));
  const a = useStore((s) => s.viewStartMs);
  const b = useStore((s) => s.viewEndMs);
  const [stations, setStations] = useState<boolean[]>(DSN_STATIONS.map(() => true));

  const light = useMemo(() => {
    if (!an) return [];
    const rows: EventRow[] = [];
    clip(an.lit, a, b, 'Sunlit', 'sun', rows);
    clip(complement(an.lit, a, b), a, b, 'Dark', 'off', rows);
    return rows.sort((x, y) => x.startMs - y.startMs);
  }, [an, a, b]);

  const contacts = useMemo(() => {
    if (!an) return [];
    const rows: EventRow[] = [];
    DSN_STATIONS.forEach((st, k) => { if (stations[k]) clip(an.stations[k], a, b, st.name, 'dsn', rows); });
    return rows.sort((x, y) => x.startMs - y.startMs);
  }, [an, a, b, stations]);

  if (!site) return null;
  if (!an) return <div className="dock-empty">Analysing {site.name}…</div>;

  const dark = light.filter((r) => r.kind === 'Dark');
  const darkTotal = dark.reduce((s, r) => s + r.endMs - r.startMs, 0);
  const darkMax = dark.reduce((s, r) => Math.max(s, r.endMs - r.startMs), 0);
  const contactTotal = contacts.reduce((s, r) => s + r.endMs - r.startMs, 0);
  const stamp = `${site.id}-${fmtUtc(a).slice(0, 10)}_${fmtUtc(b).slice(0, 10)}`;

  return (
    <div className="events-panel">
      <div className="dock-note">
        <span><b>{site.name}</b> · report window {fmtUtc(a)} to {fmtUtc(b)} UTC (the timeline view). Click a row to jump there.</span>
        <div className="seg" role="group" aria-label="Stations in the contact report">
          {DSN_STATIONS.map((st, k) => (
            <button key={st.id} className={stations[k] ? 'on' : ''} onClick={() => setStations((v) => v.map((x, i) => (i === k ? !x : x)))} aria-pressed={stations[k]}>{st.name}</button>
          ))}
        </div>
      </div>
      <div className="reports">
        <Report
          title="Illumination report"
          rows={light}
          summary={dark.length ? `${dark.length} dark interval${dark.length > 1 ? 's' : ''} · total ${fmtDuration(darkTotal)} · longest ${fmtDuration(darkMax)}` : 'Continuous sunlight in this window'}
          onExport={() => downloadText(`celeste-illumination-${stamp}.csv`, toCsv('CELESTE illumination report (terrain eclipse intervals)', site.name, light))}
        />
        <Report
          title="DSN contact report"
          rows={contacts}
          summary={contacts.length ? `${contacts.length} pass${contacts.length > 1 ? 'es' : ''} · total ${fmtDuration(contactTotal)}` : 'No DSN contact in this window'}
          onExport={() => downloadText(`celeste-dsn-contacts-${stamp}.csv`, toCsv('CELESTE DSN contact report (two-way geometric line of sight)', site.name, contacts))}
        />
      </div>
    </div>
  );
}
