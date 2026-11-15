// Heads-up display over the 3D view: the three answers the challenge asks for (Sun, Earth,
// link) with their countdowns, and a thin-line elevation gauge. It is part of the viewport, so
// it stays on screen in every layout, including Focus.
import { DSN_STATIONS } from '../core/ephemeris.ts';
import { countdown, spanEndOf, sunStatus } from '../lib/describe.ts';
import { fmtDeg } from '../lib/format.ts';
import { instantAt, useThrottledTime } from '../state/live.ts';
import { analysisKey, useStore } from '../state/store.ts';

const RANGE = 6; // gauge spans -6 .. +6 degrees relative to the skyline
const GH = 176, GW = 74, PAD = 18;

function Gauge({ sun, earth }: { sun: number; earth: number }) {
  const y = (v: number) => PAD + ((RANGE - Math.max(-RANGE, Math.min(RANGE, v))) / (2 * RANGE)) * (GH - 2 * PAD);
  const ticks = [];
  for (let v = -RANGE; v <= RANGE; v++) {
    const major = v % 2 === 0;
    ticks.push(<line key={v} x1={GW / 2 - (major ? 7 : 4)} x2={GW / 2 + (major ? 7 : 4)} y1={y(v)} y2={y(v)} className={v === 0 ? 'zero' : ''} />);
  }
  const out = (v: number) => Math.abs(v) > RANGE;
  return (
    <svg className="hud-gauge" width={GW} height={GH + 30} viewBox={`0 0 ${GW} ${GH + 30}`} role="img" aria-label={`Sun ${fmtDeg(sun, 1)} and Earth ${fmtDeg(earth, 1)} relative to the terrain skyline`}>
      <line x1={GW / 2} x2={GW / 2} y1={PAD} y2={GH - PAD} className="spine" />
      {ticks}
      <text x={GW / 2} y={y(RANGE) - 5} className="t" textAnchor="middle">+{RANGE}°</text>
      <text x={GW / 2} y={y(-RANGE) + 12} className="t" textAnchor="middle">−{RANGE}°</text>
      <text x={GW / 2} y={GH + 10} className="cap" textAnchor="middle">ABOVE</text>
      <text x={GW / 2} y={GH + 21} className="cap" textAnchor="middle">SKYLINE</text>
      {/* Sun marker points in from the left, Earth from the right. */}
      <g transform={`translate(${GW / 2 - 10}, ${y(sun)})`} className={`m sun ${out(sun) ? 'out' : ''}`}>
        <path d="M0 0l-9 -5v10z" />
        <text x={-13} y={3.5} textAnchor="end">S</text>
      </g>
      <g transform={`translate(${GW / 2 + 10}, ${y(earth)})`} className={`m earth ${out(earth) ? 'out' : ''}`}>
        <path d="M0 0l9 -5v10z" />
        <text x={13} y={3.5}>E</text>
      </g>
    </svg>
  );
}

export function Hud() {
  const site = useStore((s) => s.sites.find((x) => x.id === s.selectedId));
  const heightIdx = useStore((s) => s.heightIdx);
  const an = useStore((s) => (site ? s.analyses[analysisKey(site.id, s.heightIdx)] : undefined));
  const t = useThrottledTime(8);
  if (!site) return null;
  const inst = instantAt(site, heightIdx, t);
  const end = spanEndOf(an);
  const sun = sunStatus(inst);
  const earthUp = inst.earthClear > 0;
  const linked = inst.stationMask !== 0;
  const rel = (v: number) => `${fmtDeg(Math.abs(v), 1, false)} ${v < 0 ? 'below' : 'above'} skyline`;

  return (
      <div className="hud-status" role="status" aria-label={`Status at ${site.name}`}>
        <div className={`chip sun ${inst.sunFrac > 0 ? 'on' : ''}`}>
          <i />
          <div>
            <small>Sun · {sun.label}</small>
            <b>{rel(inst.sunClear)}</b>
            <span>{countdown(an?.lit, t, end, 'Sunset', 'Sunrise', 'Never reaches this site')}</span>
          </div>
        </div>
        <div className={`chip earth ${earthUp ? 'on' : ''}`}>
          <i />
          <div>
            <small>Earth · {earthUp ? 'In view' : 'Hidden'}</small>
            <b>{rel(inst.earthClear)}</b>
            <span>{countdown(an?.earth, t, end, 'Earthset', 'Earthrise', 'Never rises here')}</span>
          </div>
        </div>
        <div className={`chip dsn ${linked ? 'on' : ''}`}>
          <i />
          <div>
            <small>Direct-to-Earth link</small>
            <b className="sig">
              {DSN_STATIONS.map((st, k) => <em key={st.id} className={inst.stationMask & (1 << k) ? 'on' : ''} title={`${st.name} (${st.antenna})`}>{st.id}</em>)}
            </b>
            <span>{countdown(an?.dsn, t, end, 'Loss of signal', 'Next contact', 'No direct link from here')}</span>
          </div>
        </div>
      </div>
  );
}

/** Thin-line gauge: how far the Sun and the Earth sit above or below the terrain skyline. */
export function HudGauge() {
  const site = useStore((s) => s.sites.find((x) => x.id === s.selectedId));
  const heightIdx = useStore((s) => s.heightIdx);
  const t = useThrottledTime(8);
  if (!site) return null;
  const inst = instantAt(site, heightIdx, t);
  return <Gauge sun={inst.sunClear} earth={inst.earthClear} />;
}
