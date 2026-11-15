# CELESTE · Lunar Landing Site Navigator
## Technical Documentation & Mission Planning System Reference

**NASA Space Apps Challenge 2026 · Lunar Landing Site Navigator**  
*Document Version: 1.0.0 · Classification: Public / Open Science · Repository: Offline Static Bundle*

---

## 1. Executive Summary & Challenge Context

### 1.1 The Challenge
Future lunar exploration under NASA’s Commercial Lunar Payload Services (CLPS) initiative, the Artemis program, and international partner agencies places unprecedented emphasis on the Moon’s south polar region. Due to the presence of volatile water ice cold-trapped in permanently shadowed regions (PSRs), south polar craters represent high-priority targets for both science and resource utilization.

However, the lunar south pole presents extreme operational constraints:
- **Grazing Solar Angles:** The Sun never rises more than ~1.5° above the mean horizontal plane, casting extensive, dynamic shadows over rugged topography.
- **Topographic Occlusion:** A crater rim just a few kilometres away can plunge a lander into weeks of darkness, terminating solar power generation.
- **Libration & Earth Visibility:** Because the Moon wobbles relative to Earth by ~6.5° in latitude and longitude, Earth appears to trace an oval loop near the horizon rather than rising or setting in a conventional sense. Depending on local ridge elevation, this libration loop can periodically drop Earth below the skyline, cutting off direct-to-Earth (DTE) communications.
- **Agile Replanning Needs:** In real flight programs, launch slips and hardware revisions are common. When a launch slips by days or weeks, the surface illumination and communication profile changes completely. Mission planners must rapidly evaluate alternative landing sites or alternative dates at the same site without navigating disjointed raw datasets.

### 1.2 The CELESTE Solution
**CELESTE** is an intuitive, real-time, browser-based mission navigator designed for mission planners, science and engineering teams, educators, and the public. It bridges the gap between raw ephemeris data (JPL Horizons) and topographic archives (NASA LOLA) by translating complex orbital and terrain mathematics into clear, interactive, side-by-side visualizations.

CELESTE operates **100% offline and client-side**:
- Zero server backend, zero API keys, and zero cloud latency.
- Ray-marches real LOLA topography out to 350 km across 1,440 radial rays without atmospheric refraction.
- Reconstructs continuous, physically grounded trajectories for all **104 catalogued lunar missions** launched since 1959.
- Validated against NASA/JPL Horizons to within **0.0045° worst-case error** on celestial coordinates.

---

## 2. Challenge Objectives: Where & How They Are Covered

| Challenge Objective | Where in CELESTE | How It Is Solved & Scientific Grounding |
|---|---|---|
| **1. Interactive Site Selection & Comparison** | `Site Register` (left drawer), 3D globe click, `Compare Sites` dock tab | **39 curated landing sites** covering the 13 Artemis III candidate regions, South Pole scientific targets, commercial CLPS landers, international missions (ISRO, CNSA, JAXA), and Apollo. Double-clicking the 3D Moon or manual coordinate entry allows custom sites anywhere. The comparison matrix evaluates up to **5 sites side-by-side** on illumination %, longest darkness (hours), Earth visibility %, and DSN contact %. |
| **2. Date & Time Flexibility + Date Finder** | Timeline scrubber, TopBar LED clock, `Date Finder` dock tab | Full temporal range from **1960 to 2100**. Scrub, step, or animate playback from 10 min/s to 5 days/s. The **Automated Date Finder** sweeps all 365 days of a lunar year, scoring each date on continuous sunlight and concurrent Earth visibility to rank viable landing windows when schedules shift. |
| **3. Sun & Earth Horizon Skyline Visualization** | `Horizon Scope` panel, 3D HUD telemetry chips | A **360° terrain panorama** traced from 1,440 rays over LOLA elevation grids. Renders the true angular diameter of the Sun (0.53°) and Earth (1.9°) against local peaks and crater walls. Dotted tracks show past and future motion. Live HUD chips continuously display **countdown timers to the next sunrise, sunset, earthrise, or earthset**. |
| **4. Power & Communication Assessment** | `StatusPanel` (right rail), `Mission Control` mode, HUD chips | Computes solar elevation angle, visible fraction of the solar disk (accounting for partial ridge occultation), direct beam irradiance ($W/m^2$), and cumulative mission energy ($kWh$). Models **three array geometries** (vertical mast, horizontal deck, sun-tracking tilted). Computes geometric line-of-sight to NASA’s three **Deep Space Network (DSN)** complexes (Goldstone, Madrid, Canberra). |
| **5. Multiple Visualization Approaches** | Central 3D Viewport (`Globe`, `Polar Terrain`, `2D Map`, `Flight`, `Orrery`) | **3D Selenocentric Globe** with day/night terminator; **LOLA 80m South Polar Terrain** with live GPU ray-marched shadows; **2D Top-Down Polar Map**; **Mission-Illumination Map** revealing micro-topographic sensitivity; **3D & 2D Earth-to-Moon Flight Trajectory Simulator** with cinematic chase cameras; **Heliocentric Solar System Orrery**. |
| **6. Temporal Dynamics & Event Reporting** | Bottom timeline lanes, `Event Reports` dock tab, CSV export | Interactive multi-track timeline lanes showing sunlight, Earth visibility, and DSN contact across windows from 3 days to 1 year. The **Event Reporting engine** automatically compiles discrete logs of all dark periods and ground station passes with start time, end time, and duration, exportable to **standard CSV** for GMAT/STK workflows. |
| **7. Accessibility Across Skill Levels** | Top console mode switch (`Focus 1`, `Explore 2`, `Control 3`) | **Focus Mode (`1`):** Clean 3D view and timeline with heads-up countdowns for presentations and executive review. <br>**Explore Mode (`2`):** Educational interface with plain-language briefs and "Here vs Earth" physical comparisons. <br>**Mission Control Mode (`3`):** Engineering dashboard exposing all instrumentation, raw numbers, DSN pass schedules, and provenance. |

---

## 3. Scientific Methodology & Physics Engine

### 3.1 Ephemeris & Coordinate Frames
- **Lunar Frame of Reference:** CELESTE uses the Moon-fixed selenocentric coordinate system defined by the International Astronomical Union (IAU). The lunar equator defines the $X\text{–}Y$ plane, with $+X$ directed toward the mean Earth-facing sub-Earth point and $+Z$ along the lunar rotation axis.
- **Celestial Ephemeris:** Solar and terrestrial vectors are derived from high-precision planetary ephemeris tables computed via `astronomy-engine`, interpolating 30-minute nodes using cubic Hermite splines.
- **JPL Horizons Validation:** Validated against NASA/JPL Horizons System (DE441 ephemeris) across 6 surface sites and 1,620 sample points spanning 2026 to 2027. Worst-case deviation on both elevation and azimuth is less than **0.0045°** (the solar disk is 0.53° wide).

### 3.2 Topographic Ray Marching & Horizon Tracing
- **No Atmospheric Refraction:** Unlike Earth, the Moon has no atmosphere; light travels along straight Euclidean vectors. The apparent horizon is formed strictly by local topographic relief and the spherical curvature of the Moon.
- **Radial Ray Marching:** For any landing site, CELESTE casts 1,440 rays ($0.25^\circ$ azimuthal resolution) radially outward to a horizon cutoff distance of $350\text{ km}$.
- **Curvature Correction:** For a ray point at surface distance $s$ from an observer at radius $R_0 = R_{\text{moon}} + h_{\text{ground}} + h_{\text{mast}}$, the elevation angle $\theta$ above the local horizontal tangent plane is:
  $$\tan \theta = \frac{(R_{\text{moon}} + h(s)) \cos(s / R_{\text{moon}}) - R_0}{(R_{\text{moon}} + h(s)) \sin(s / R_{\text{moon}})}$$
  The maximum $\theta$ encountered along each ray defines the horizon skyline altitude $\theta_{\text{sky}}(\text{az})$.
- **LOLA DEM Products Used:**
  - `LDEM_80S_80M` (80 m/px, 80° S to 90° S)
  - `LDEM_85S_40M` (40 m/px, 85° S to 90° S insets)
  - `LDEM_875S_20M` (20 m/px, 87.5° S to 90° S insets)
  - `LDEM_16` (1.9 km global cylindrical grid for non-polar reference sites)

### 3.3 Solar Power Calculation
Direct solar beam irradiance $S_0 \approx 1361\text{ W/m}^2$. The effective power $P(t)$ generated by a solar array of area $A$ and conversion efficiency $\eta$ is:
$$P(t) = S_0 \cdot f_{\text{vis}}(t) \cdot \eta \cdot A \cdot \max(0, \cos \phi(t))$$
Where:
- $f_{\text{vis}}(t) \in [0, 1]$ is the geometric fraction of the solar disk unoccluded by the terrain skyline.
- $\phi(t)$ is the angle of incidence between the solar vector and the array surface normal:
  - **Vertical Mast Array:** $\cos \phi = \cos(\text{elev}_{\odot}) \cdot \cos(\text{az}_{\odot} - \text{az}_{\text{normal}})$, or omnidirectional cylindrical capture $\cos(\text{elev}_{\odot})$.
  - **Horizontal Deck Array:** $\cos \phi = \sin(\text{elev}_{\odot})$.
  - **Sun-Tracking Array:** $\cos \phi = 1.0$ whenever $f_{\text{vis}} > 0$.

### 3.4 Deep Space Network (DSN) Line-of-Sight
Geometric visibility is calculated for the three NASA DSN ground stations:
1. **Goldstone (DSS-14):** 35.426° N, 116.890° W
2. **Madrid (DSS-63):** 40.431° N, 4.248° W
3. **Canberra (DSS-43):** 35.401° S, 148.981° E

A station is flagged as linked when:
1. The line-of-sight vector from the lunar lander to the Earth station clears the lunar terrain horizon at the landing site: $\text{elev}_{\text{Earth}} > \theta_{\text{sky}}(\text{az}_{\text{Earth}})$.
2. The lunar lander is above the local horizon of the DSN ground station on Earth: $\text{elev}_{\text{lander}} \ge 6.0^\circ$ (standard DSN operational horizon limit).

---

## 4. Comprehensive Feature Catalogue

### 4.1 Multi-Mode Workspace & Navigation
- **Console Rails & Putty Aesthetic:** Hardware-console frame with tactile buttons, printed-label equipment headers, and hazard-orange focus indicators.
- **Dock Resizer System:** Fully adjustable panel splitters with persistent layout memory across sessions.
- **Global Keyboard Shortcuts:**
  - `1`, `2`, `3`: Preset modes (Focus, Explore, Mission Control)
  - `Space`: Play / Pause clock playback
  - `ArrowLeft` / `ArrowRight`: Step clock backward/forward by 1 hour (Shift for 1 day)
  - `N`: Reset clock to current real-world time (Now)
  - `G`: Toggle 3D Globe vs South Polar Terrain
  - `F`: Open Earth-to-Moon Flight Trajectory View
  - `O`: Open Heliocentric Solar System Orrery View
  - `S`, `H`, `T`, `L`: Toggle Sites, Horizon Scope, Telemetry, and Console Dock panels

### 4.2 Polar Topography & Mission Illumination Heatmap
- **GPU Ray-Marched Shadows:** Evaluates shadows in a custom GLSL fragment shader against a 4096² height map, creating exact, real-time terminator movement across peaks and crater rims.
- **Mission Illumination Map:** Accumulates lighting samples over the selected mission window into a high-contrast heatmap, clearly delineating peaks of eternal light (PELs) from permanently shadowed regions (PSRs).
- **Mast Height Switch:** Instant comparison between a 2-metre surface deck and an 8–10 metre communications mast, visualizing shadow clearance gains.

### 4.3 Flight Dynamics Simulator: 104 Historical Missions
- **Universal Catalogue:** Contains all 104 lunar missions ever attempted from Luna 1 (1959) to Artemis I, SLIM, and CLPS Odysseus / Blue Ghost.
- **7-Phase Continuous Patched Conics:**
  1. *On the Pad:* Earth launch pad coordinates with NASA GIBS Landsat imagery.
  2. *Ascent:* Atmospheric boost phase with multi-stage separation and flame plumes.
  3. *Parking Orbit:* Low-Earth orbit checkout.
  4. *Translunar Coast:* Hyperbolic insertion trajectory across cislunar space.
  5. *Lunar Orbit:* Selenocentric capture orbit.
  6. *Descent:* Powered braking and pitch-up maneuver.
  7. *On the Surface:* Touchdown on Moon Trek LROC WAC high-res surface tiles.
- **3D Aerospace Hangar:** Incorporates official NASA 3D models (Saturn V, Apollo Lunar Module, LRO, Clementine, LADEE) and dimensional procedural models (SLS, Falcon 9, R-7, Vikram, Nova-C).
- **Cinematic Chase Camera:** Smooth vehicle tracking with phase-aware camera directing, allowing 360° user rotation and zoom.

---

## 5. Automated Validation & Quality Assurance

CELESTE maintains a strict automated test suite verifying physical laws, mathematical limits, and visual rendering consistency:

```bash
npm run typecheck    # 0 TypeScript compilation errors
npm run test         # 43 automated checks across 4 test suites (100% pass)
npm run build        # Static production build in dist/
node tools/qa-hangar.mjs    # Validates all 3D vehicle models (0 console errors)
node tools/qa-flight.mjs    # Validates 104-mission flight views (0 console errors)
node tools/qa-screens.mjs   # Smoke test of all UI layouts (0 console errors)
```

### 5.1 Physical Ground-Truth Sanity Checks
1. **Apollo 11 (Tranquility Base):** Receives sunlight exactly ~50.1% of the lunar month; Earth elevation is stable at ~58° (never sets).
2. **Chang'e 4 (Von Kármán Crater, Lunar Far Side):** Earth elevation is permanently negative (-48°); Earth visibility is strictly 0.00%, proving relay necessity.
3. **Shackleton Crater Floor (South Pole PSR):** Direct solar illumination is strictly 0.00% across all 455-day test sweeps, validating cold-trap physics.

---

## 6. Installation & Deployment Guide

### Prerequisites
- Node.js v22.18 or newer
- Modern web browser with WebGL 2.0 support (Chrome, Edge, Firefox, Safari)

### Quick Start
```bash
git clone <repository-url>
cd "nasa space apps"
npm install
npm run dev          # Starts local dev server at http://localhost:5173
```

### Building for Offline / Static Production
```bash
npm run build        # Emits optimized production bundle into dist/
npm run preview      # Previews the production static build locally
```
The resulting `dist/` directory is completely standalone and can be hosted on GitHub Pages, AWS S3, Cloudflare Pages, or run directly from a USB stick in mission control rooms without internet connectivity.

---

*Authored for NASA Space Apps Challenge 2026 by the CELESTE Engineering Team.*
