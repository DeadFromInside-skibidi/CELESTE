// Side-by-side comparison of the selected and pinned sites for the mission window.
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { windowMetrics, type WindowMetrics } from '../core/analysis.ts';
import { DAY_MS } from '../core/constants.ts';
import { DSN_STATIONS } from '../core/ephemeris.ts';
import { csvRow, downloadText, fmtDeg, fmtHours, fmtNumber, fmtPct, fmtUtc } from '../lib/format.ts';
import { windowPower } from '../lib/power.ts';
import { instantAt, useThrottledTime } from '../state/live.ts';
import { analysisKey, comparedSites, LANE_COLORS, selectSite, useStore } from '../state/store.ts';
import { DownloadIcon } from './icons.tsx';

interface RowDef {
  label: string;
  hint: string;
  value(m: WindowMetrics, p: { meanW: number; energyKwh: number }): number;
  format(v: number): string;
  /** Which direction is better, for highlighting the leader. */
  better: 'high' | 'low' | 'none';
  bar?: 'sun' | 'earth' | 'dsn' | 'both';
}

const ROWS: RowDef[] = [
  { label: 'Sunlight', hint: 'Share of the mission with any part of the Sun above the skyline', value: (m) => m.litPct, format: (v) => fmtPct(v, 1), better: 'high', bar: 'sun' },
  { label: 'Illumination', hint: 'Average visible fraction of the solar disk over the mission', value: (m) => m.illuminationPct, format: (v) => fmtPct(v, 1), better: 'high', bar: 'sun' },
  { label: 'Longest dark', hint: 'Longest continuous stretch with no direct sunlight: sizes the battery and survival heaters', value: (m) => m.longestDarkH, format: fmtHours, better: 'low' },
  { label: 'Longest lit', hint: 'Longest continuous stretch with direct sunlight', value: (m) => m.longestLitH, format: fmtHours, better: 'high' },
  { label: 'Earth in view', hint: "Share of the mission with Earth's centre above the skyline", value: (m) => m.earthPct, format: (v) => fmtPct(v, 1), better: 'high', bar: 'earth' },
  { label: 'DSN contact', hint: 'Share of the mission with two-way line of sight to at least one DSN complex', value: (m) => m.dsnPct, format: (v) => fmtPct(v, 1), better: 'high', bar: 'dsn' },
  { label: 'Longest gap', hint: 'Longest continuous stretch with no DSN complex in view', value: (m) => m.longestOutageH, format: fmtHours, better: 'low' },
  { label: 'Sun + DSN', hint: 'Share of the mission with sunlight and a DSN link at the same time', value: (m) => m.bothPct, format: (v) => fmtPct(v, 1), better: 'high', bar: 'both' },
  { label: 'Peak Sun', hint: 'Highest the Sun gets above the ideal horizon during the mission', value: (m) => m.sunElMax, format: (v) => fmtDeg(v, 1), better: 'none' },
  { label: 'Mean power', hint: 'Average electrical output of the array configured in the Solar power card', value: (_, p) => p.meanW, format: (v) => `${fmtNumber(v)} W`, better: 'high' },
  { label: 'Energy', hint: 'Energy generated over the mission by that array', value: (_, p) => p.energyKwh, format: (v) => `${fmtNumber(v, v < 100 ? 1 : 0)} kWh`, better: 'high' },
];

export function ComparePanel() {
  // Select only what the table needs: the cursor time changes every frame during playback.
  const state = useStore(useShallow((s) => ({
    sites: s.sites, selectedId: s.selectedId, pinnedIds: s.pinnedIds, heightIdx: s.heightIdx, missionDays: s.missionDays,
    arrayType: s.arrayType, arrayAreaM2: s.arrayAreaM2, arrayEfficiency: s.arrayEfficiency, analyses: s.analyses,
  })));
  const t = useThrottledTime(4);
  const sites = comparedSites(state);
  const bucket = Math.floor(t / 600_000) * 600_000;
  const { heightIdx, missionDays, arrayType, arrayAreaM2, arrayEfficiency, analyses } = state;

  const cols = useMemo(() => sites.map((site) => {
    const an = analyses[analysisKey(site.id, heightIdx)];
    if (!an) return null;
    const a = bucket, b = bucket + missionDays * DAY_MS;
    return { m: windowMetrics(an, a, b), p: windowPower(an.series, a, b, arrayType, arrayAreaM2, arrayEfficiency) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [sites.map((s) => s.id).join('|'), analyses, heightIdx, bucket, missionDays, arrayType, arrayAreaM2, arrayEfficiency]);

  // Leader per metric (only when the compared sites actually differ).
  const best = ROWS.map((r) => {
    const finite = cols.map((c) => (c ? r.value(c.m, c.p) : NaN)).filter(Number.isFinite);
    if (r.better === 'none' || finite.length < 2 || Math.max(...finite) - Math.min(...finite) < 1e-6) return NaN;
    return r.better === 'high' ? Math.max(...finite) : Math.min(...finite);
  });

  const exportCsv = () => {
    const lines = [
      csvRow(['CELESTE site comparison']),
      csvRow(['Mission start (UTC)', fmtUtc(bucket)]),
      csvRow(['Mission length (days)', missionDays]),
      '',
      csvRow(['Metric', ...sites.map((s) => s.name)]),
      csvRow(['Latitude (deg)', ...sites.map((s) => s.lat)]),
      csvRow(['East longitude (deg)', ...sites.map((s) => s.lon)]),
      ...ROWS.map((r) => csvRow([r.label, ...cols.map((c) => (c ? r.format(r.value(c.m, c.p)).replace('−', '-') : ''))])),
    ];
    downloadText(`celeste-comparison-${fmtUtc(bucket).slice(0, 10)}.csv`, lines.join('\n'));
  };

  return (
    <div className="compare">
      <div className="dock-note">
        <span><b>{missionDays}-day</b> mission from <b>{fmtUtc(bucket)} UTC</b> · pin up to four more sites to compare</span>
        <button className="btn small" onClick={exportCsv}><DownloadIcon />CSV</button>
      </div>
      <div className="table-scroll">
        <table className="cmp">
          <thead>
            <tr>
              <th>Site</th>
              <th title="Sun, Earth and DSN state at the cursor time">Now</th>
              {ROWS.map((r) => <th key={r.label} title={r.hint}>{r.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {sites.map((s, k) => {
              const i = instantAt(s, heightIdx, t);
              const st = DSN_STATIONS.filter((_, j) => i.stationMask & (1 << j)).map((x) => x.name).join(', ');
              const c = cols[k];
              return (
                <tr key={s.id}>
                  <th>
                    <button className="th-site" onClick={() => selectSite(s.id)} title="Make this the selected site">
                      <i className="lane-chip" style={{ background: LANE_COLORS[k % LANE_COLORS.length] }} />
                      <span>{s.name}</span>
                    </button>
                  </th>
                  <td className="now-cell">
                    <i className={`dot sun ${i.sunFrac > 0 ? '' : 'off'}`} title={`Sun ${fmtDeg(i.sunClear, 1)} relative to the skyline`} />
                    <i className={`dot earth ${i.earthClear > 0 ? '' : 'off'}`} title={`Earth ${fmtDeg(i.earthClear, 1)} relative to the skyline`} />
                    <i className={`dot dsn ${st ? '' : 'off'}`} title={st ? `DSN contact via ${st}` : 'No DSN contact'} />
                  </td>
                  {ROWS.map((r, j) => {
                    const v = c ? r.value(c.m, c.p) : NaN;
                    return (
                      <td key={r.label} className={Number.isFinite(v) && v === best[j] ? 'best' : ''}>
                        {Number.isFinite(v) ? (
                          <>
                            <span className="val">{r.format(v)}</span>
                            {r.bar && <span className="cell-bar"><i className={r.bar} style={{ width: `${Math.max(0, Math.min(100, v))}%` }} /></span>}
                          </>
                        ) : <span className="val muted">…</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
