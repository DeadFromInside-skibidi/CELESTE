// Methods, data sources, validation, limits and challenge coverage: everything a reviewer
// needs to trust (or challenge) a number on screen.
import { useEffect } from 'react';
import { DSN_ELEVATION_MASK_DEG } from '../core/analysis.ts';
import { RESOURCES } from '../lib/links.ts';
import { ANALYSIS_STEP_MS, useStore } from '../state/store.ts';
import { CloseIcon } from './icons.tsx';

const COVERAGE: [string, string][] = [
  ['Site selection and comparison', 'Curated catalogue (Artemis III regions, polar science sites, CLPS and commercial landers, ISRO / JAXA / CNSA missions, Apollo), custom coordinates by form or by double-clicking the Moon, and up to five sites side by side in the timeline, the Compare table and the Date finder.'],
  ['Date and time flexibility', 'Any date from 1960 to 2100 on the mission clock; step, scrub or play from 10 minutes to 5 days per second; timeline spans from three days to a year; the Date finder scores every possible landing date.'],
  ['Sun and Earth relative to the horizon', 'Horizon scope: a 360° panorama of the real terrain skyline with both bodies, their tracks, and each disk against the skyline at true scale. Countdown to the next sunrise, sunset, Earthrise or Earthset on the viewport at all times.'],
  ['Power and communication', 'Solar elevation angle, visible fraction of the solar disk, direct irradiance, array output and mission energy for three array geometries; Earth visibility and two-way line of sight to the three Deep Space Network complexes; duration of sunlight and longest darkness per mission.'],
  ['Multiple visualisations', '3D globe with the day/night line and the Earth-visibility limit; 3D south-polar terrain with ray-marched shadows; a top-down 2D map; a mission-illumination map; horizon panorama; timeline; tables.'],
  ['Temporal dynamics', 'Animated playback in every view; timeline lanes for sunlight, Earth and DSN; event reports listing every dark interval and every DSN pass with CSV export.'],
  ['All skill levels', 'Three layouts: Focus (the view and the timeline), Explore (plain-language briefing and "Here versus Earth" comparisons) and Mission control (every readout). Every panel can be hidden or resized.'],
  ['No atmosphere', 'No refraction term anywhere: the horizon is the terrain, or the edge of the sphere where there is no terrain data.'],
  ['Real topography', 'Skylines traced over NASA LOLA elevation grids; steep rims and permanently shadowed floors come out of the data (try Shackleton crater floor).'],
  ['Libration and orbital variation', "The IAU lunar rotation model carries the librations; Earth's monthly loop in the sky is visible in the horizon scope and decides Earth visibility near the pole."],
  ['Why small changes matter', 'The mission-illumination map shows sunlit share changing from near 100% to 0% within a few kilometres; the mast switch shows what eight more metres of height buys; the Date finder shows the same site swinging with the season.'],
];

export function About() {
  const open = useStore((s) => s.aboutOpen);
  const close = () => useStore.setState({ aboutOpen: false });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Methods and data" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Methods, data and validation</h2>
          <button className="icon-btn" onClick={close} aria-label="Close"><CloseIcon /></button>
        </header>
        <div className="modal-body">
          <section>
            <h3>What CELESTE answers</h3>
            <p>For a landing site and a date: where are the Sun and the Earth relative to the real terrain horizon, how long until that changes, and how does a mission starting then compare with other sites or other dates.</p>
          </section>

          <section>
            <h3>How each number is computed</h3>
            <dl>
              <dt>Sun and Earth positions</dt>
              <dd>Analytic ephemerides (VSOP87 for the Sun, the NAO/Brown lunar theory for the Moon) via the open-source <a href="https://github.com/cosinekitty/astronomy" target="_blank" rel="noreferrer">astronomy-engine</a>, with light-time and aberration applied to the Sun.</dd>
              <dt>Lunar orientation</dt>
              <dd>IAU rotation model of the Moon (pole, prime meridian and periodic terms), which carries the physical librations. Positions are rotated into the Moon-fixed Mean-Earth / Polar-Axis frame used by LOLA cartography.</dd>
              <dt>Elevation and azimuth</dt>
              <dd>Taken from the site itself, not the Moon's centre, so lunar parallax of the Earth (up to 0.26°) is included. There is no refraction term: the Moon has no atmosphere.</dd>
              <dt>Terrain skyline</dt>
              <dd>For each site, 1,440 rays (every 0.25° of azimuth) are marched out to 350 km over LOLA elevation grids, keeping the highest elevation angle with the Moon's curvature handled exactly. The finest grid available is used nearest the site, where terrain moves the skyline most. In this build that is 20 m/px within 10 km for sites inside 87.5° S, 40 m/px within 30 km for sites inside 85° S, 80 m/px out to 60 km (to 80° S), and 240 m/px beyond; the pipeline also takes NASA's wider 40 m grid and its 10 m grid when they have been downloaded. Each site's panel lists the grids behind its own skyline. Sites away from the pole use the global 1.9 km grid. Custom polar points are traced in your browser on the 80 m grid.</dd>
              <dt>Sunlight</dt>
              <dd>The fraction of the solar disk above the skyline, integrated in 15 vertical strips so notches and peaks narrower than the disk count. "Sunlit" means any part of the disk is visible.</dd>
              <dt>Earth and DSN</dt>
              <dd>"Earth in view" means Earth's centre is above the skyline. A DSN contact additionally requires the Moon to be at least {DSN_ELEVATION_MASK_DEG}° above the horizon of the Goldstone, Madrid or Canberra 70 m antenna (WGS-84 positions, Earth rotation from sidereal time, precession and nutation). This is geometric line of sight, not a link budget.</dd>
              <dt>Windows and countdowns</dt>
              <dd>Each site is swept for 455 days at {ANALYSIS_STEP_MS / 60000}-minute steps in a background worker; every rise, set and contact edge is then refined by bisection to under a second.</dd>
              <dt>Solar power</dt>
              <dd>1361 W/m² scaled by Sun distance and visible disk fraction, times the cosine factor of the chosen array geometry, area and efficiency. Direct beam only.</dd>
              <dt>3D terrain</dt>
              <dd>The polar view renders the LOLA 80 m grid (7600 × 7600 samples, 80° S to the pole) with per-pixel relief and shadows marched through the height field on the GPU, including the Moon's curvature. Coarser grids can be chosen under View options.</dd>
            </dl>
          </section>

          <section>
            <h3>Validation</h3>
            <ul>
              <li><b>JPL Horizons.</b> Sun and Earth azimuth and elevation from six lunar surface sites, 1,620 samples from January 2026 to June 2027, agree with NASA/JPL Horizons (DE441, same lunar frame) to within <b>0.0045°</b> worst case. The Sun's disk is 0.53° wide. The Telemetry panel links to Horizons' own answer for the site and time on screen, so any reading can be checked on the spot.</li>
              <li><b>LOLA georeferencing.</b> The elevation pipeline checks itself against known relief (Shackleton floor, Malapert, Mons Mouton, Cabeus) in three independent LOLA products before any horizon is traced, and gives −5,255 m at the Chang'e 6 site where the LROC team published −5,256 m.</li>
              <li><b>Illumination ranking.</b> Ridge and rim sites come out far ahead of crater floors, the ordering found by the LOLA illumination studies these sites were selected from (Mazarico et al. 2011). The percentages themselves have not been compared point by point.</li>
              <li><b>Physical sanity.</b> Automated tests check that Apollo 11 is sunlit half the time with Earth always up, that Chang'e 4 never sees Earth, and that the floor of Shackleton never sees either.</li>
            </ul>
            <p className="fine">These checks run with <code>npm test</code>; the Horizons reference file can be regenerated with <code>npm run data:horizons</code>.</p>
          </section>

          <section>
            <h3>Challenge coverage</h3>
            <table className="cover">
              <tbody>
                {COVERAGE.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}
              </tbody>
            </table>
          </section>

          <section>
            <h3>Known limits</h3>
            <ul>
              <li>Region sites are analysed at the highest cell, on the finest grid covering the area, within 4 km of the region centre. On ridges, position matters at the scale of the grid itself: on Connecting Ridge, picking the crest on the 80 m grid instead of the 20 m grid lowered the 2026 mean illumination from 88% to 77%. Treat percentages as indicative for the region, exact for the stated point and grid.</li>
              <li>Terrain smaller than the grid under the lander (boulders, the lander's own shadow) is not resolved. LOLA's polar grids are themselves partly interpolated between laser tracks.</li>
              <li>Sites outside the south-polar grids use a 1.9 km grid: regional relief only. Custom sites north of 80° S use an ideal sphere and are labelled as such.</li>
              <li>Events shorter than the {ANALYSIS_STEP_MS / 60000}-minute sweep step can be missed.</li>
              <li>Eclipses of the Sun by the Earth (lunar eclipses) are not modelled.</li>
              <li>The 3D shadows are a visual aid; reported numbers always come from the skyline analysis.</li>
              <li>There is no thermal model: sunlight and darkness durations are given, temperatures are not.</li>
            </ul>
          </section>

          <section>
            <h3>Data and resources</h3>
            <ul>
              <li>Lunar Orbiter Laser Altimeter gridded elevation (LDEM_875S_20M, LDEM_85S_40M, LDEM_80S_80M, LDEM_75S_240M, LDEM_16), NASA PDS Geosciences Node. This is the topography behind <a href={RESOURCES.quickmap.url} target="_blank" rel="noreferrer">LROC QuickMap</a> and <a href={RESOURCES.moontrek.url} target="_blank" rel="noreferrer">NASA Moon Trek</a>, used here directly.</li>
              <li><a href={RESOURCES.horizons.url} target="_blank" rel="noreferrer">JPL Horizons System</a>: the independent reference every Sun and Earth angle is validated against.</li>
              <li>High-Resolution LOLA Topography for Lunar South Pole Sites, NASA GSFC PGDA (Barker et al. 2021): site list and georeferencing.</li>
              <li>LROC WAC colour mosaic from NASA's Scientific Visualization Studio CGI Moon Kit (globe texture).</li>
              <li>Landing coordinates: NASA NSSDCA and the LROC team. DSN antenna coordinates: DSN 810-005.</li>
              <li><a href={RESOURCES.csa.url} target="_blank" rel="noreferrer">Canadian Space Agency Moon exploration portal</a>: background on current and planned lunar missions, including Canada's Artemis contributions.</li>
            </ul>
          </section>

          <section>
            <h3>Keyboard</h3>
            <p className="keys"><kbd>Space</kbd> play / pause <kbd>←</kbd><kbd>→</kbd> one hour <kbd>Shift</kbd>+<kbd>←</kbd><kbd>→</kbd> one day <kbd>N</kbd> now <kbd>G</kbd> globe / terrain <kbd>F</kbd> flight <kbd>O</kbd> solar orbit</p>
            <p className="keys" style={{ marginTop: 8 }}><kbd>1</kbd> focus <kbd>2</kbd> explore <kbd>3</kbd> mission control <kbd>S</kbd> sites <kbd>H</kbd> horizon <kbd>T</kbd> telemetry <kbd>L</kbd> timeline</p>
          </section>
        </div>
      </div>
    </div>
  );
}
