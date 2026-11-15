// The flight view: a spacecraft's journey from its launch pad on Earth to the Moon.
//
// Scene units are kilometres in the Earth-centred ecliptic frame of J2000. The range of scales
// is extreme (a 9 m lander, 384,000 km from Earth, 150 million km from the Sun), so:
//   - everything is drawn relative to a floating origin (the body or spacecraft the camera is
//     attached to), computed in double precision each frame;
//   - the depth buffer is logarithmic;
//   - the ground near the launch pad and the landing site is drawn by separate, finely gridded
//     patches that carry real imagery (Landsat on Earth, LROC on the Moon), because a sphere
//     coarse enough to draw a whole planet sags hundreds of metres between its vertices.
//
// Two kinds of camera. Overview, Earth and Moon orbit a fixed point. Follow and Cinematic ride
// with the vehicle on a rig whose "up" is the local vertical: the horizon stays level, the user
// can swing around the vehicle and zoom at any time, and in Cinematic a director also picks a
// shot for each phase of the flight.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DAY_MS, DEG, EARTH_RADIUS_KM, MOON_RADIUS_KM, SUN_RADIUS_KM } from '../core/constants.ts';
import { earthAxes, type Flight, moonAxes, moonEcl, type Phase, phaseAt, type PhaseId, sunEcl, surfacePoint } from '../core/flight.ts';
import { landedIntact, landingImagery, launchImagery, type Mission, type SiteImagery } from '../core/missions.ts';
import { buildLauncher, buildSpacecraft, type Craft, type Exhaust, type Launcher, type ModelSource, type Spacecraft } from './craft.ts';

export type FlightScale = 'earth-moon' | 'solar';
export type FlightCam = 'overview' | 'chase' | 'earth' | 'moon' | 'cinematic';
export interface FlightViewState { scale: FlightScale; flat: boolean; cam: FlightCam }

/** Numbers for the HUD, refreshed on every time step. */
export interface FlightReadout {
  phase: Phase;
  /** Height above the nearer body's reference surface. */
  altitudeKm: number;
  body: 'Earth' | 'Moon';
  /** Speed relative to that body's centre. */
  speedKmS: number;
  earthKm: number;
  moonKm: number;
  /** How much the craft is enlarged to stay visible (1 = true size). */
  enlarged: number;
  /** Seconds since liftoff (negative before it). */
  metS: number;
}
export interface CraftInfo { label: string; source: ModelSource; stage: string | null }

/** In the Sun-Earth-Moon view the whole Earth-Moon system is drawn this many times larger. */
export const SOLAR_SYSTEM_BOOST = 80;
export const SOLAR_SUN_BOOST = 14;
const MIN_CRAFT_PX = 30;
const LUNAR: PhaseId[] = ['lunar-orbit', 'descent', 'surface', 'flyby'];
/** The coarse globes sit this far below the true surface, so the site patches always win the depth test. */
const EARTH_SINK_KM = 0.12, MOON_SINK_KM = 0.03;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const ATMOS_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN;
varying vec3 vV;
varying vec3 vW;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const ATMOS_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 sunDir;
varying vec3 vN;
varying vec3 vV;
varying vec3 vW;
void main() {
  #include <logdepthbuf_fragment>
  float rim = pow(1.0 - abs(dot(vN, vV)), 2.6);
  float day = smoothstep(-0.25, 0.35, dot(vW, sunDir));
  gl_FragColor = vec4(vec3(0.32, 0.58, 1.0) * rim * (0.08 + 0.92 * day) * 1.5, 1.0);
}`;

// The sky as seen from inside the atmosphere: blue overhead, paler toward the horizon, fading
// to black with height. Drawn around the camera, behind everything.
const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
}`;
const SKY_FRAG = /* glsl */ `
uniform vec3 up;
uniform vec3 sunDir;
uniform float air;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float mu = dot(d, up), sunUp = dot(sunDir, up);
  float day = smoothstep(-0.12, 0.18, sunUp);
  float haze = pow(1.0 - clamp(mu, 0.0, 1.0), 4.0);
  vec3 col = mix(vec3(0.05, 0.16, 0.48), vec3(0.42, 0.60, 0.86), haze);
  // A low Sun warms the horizon on its own side of the sky.
  vec3 flatD = normalize(d - up * mu + 1e-5), flatS = normalize(sunDir - up * sunUp + 1e-5);
  float low = (1.0 - smoothstep(0.0, 0.3, sunUp)) * haze * max(0.0, dot(flatD, flatS));
  col = mix(col, vec3(0.90, 0.42, 0.16), low * 0.7);
  col += vec3(1.0, 0.85, 0.6) * pow(max(dot(d, sunDir), 0.0), 220.0);
  gl_FragColor = vec4(col * air * day * smoothstep(-0.2, 0.02, mu), 1.0);
  #include <colorspace_fragment>
}`;

function glowTexture(inner: string, mid: string, outer: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.08, mid);
  grad.addColorStop(0.3, outer);
  grad.addColorStop(1, 'rgba(255,170,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Body-fixed axes (columns x, y, z in the ecliptic frame) -> object orientation. */
function orient(obj: THREE.Object3D, axes: Float64Array, m = new THREE.Matrix4()): void {
  m.set(axes[0], axes[3], axes[6], 0, axes[1], axes[4], axes[7], 0, axes[2], axes[5], axes[8], 0, 0, 0, 0, 1);
  obj.quaternion.setFromRotationMatrix(m);
}

/**
 * How fast the cinematic view should run at a given moment, in simulated seconds per real
 * second, and whether to skip ahead (long stretches of repeated orbits are jumped, not played).
 */
export function cinematicPace(flight: Flight, utcMs: number): { speed: number; jumpToMs?: number; done?: boolean } {
  const ph = phaseAt(flight, utcMs);
  const dur = (ph.endMs - ph.startMs) / 1000, into = (utcMs - ph.startMs) / 1000;
  switch (ph.id) {
    case 'pad': return utcMs < flight.launchMs - 12e3 ? { speed: 1, jumpToMs: flight.launchMs - 10e3 } : { speed: 1 };
    case 'ascent': return { speed: (utcMs - flight.launchMs) / 1000 < 600 ? 12 : Math.max(30, (dur - 600) / 12) };
    case 'earth-orbit': return dur > 4 * 3600 && utcMs < ph.endMs - 50 * 60e3 ? { speed: 240, jumpToMs: ph.endMs - 45 * 60e3 } : { speed: Math.min(400, Math.max(60, dur / 12)) };
    // The injection burn and the separation of the spacecraft are worth watching; the coast is not.
    case 'transfer': return flight.kind === 'reconstructed' && into < 760 ? { speed: 30 } : { speed: Math.max(600, dur / 26) };
    case 'cruise': return { speed: Math.max(600, dur / 14) };
    case 'flyby': return { speed: 1500 };
    case 'lunar-orbit': return dur > 9 * 3600 && utcMs < ph.endMs - 2.6 * 3600e3 ? { speed: 600, jumpToMs: ph.endMs - 2.5 * 3600e3 } : { speed: Math.min(900, Math.max(120, dur / 12)) };
    case 'descent': return { speed: 20 };
    default: return into > 20 * 60 ? { speed: 60, done: true } : { speed: 60 };
  }
}

// ---------------------------------------------------------------------------------------------
// Ground imagery around a site
// ---------------------------------------------------------------------------------------------
/** Unit vector, in body-fixed axes, of the point `x` km east and `y` km north of a site. */
function offsetDir(lat0: number, lon0: number, x: number, y: number, R: number, out: number[]): void {
  const rho = Math.hypot(x, y) / R, az = Math.atan2(x, y);
  const s0 = Math.sin(lat0 * DEG), c0 = Math.cos(lat0 * DEG);
  const sl = Math.max(-1, Math.min(1, s0 * Math.cos(rho) + c0 * Math.sin(rho) * Math.cos(az)));
  const lon = lon0 * DEG + Math.atan2(Math.sin(az) * Math.sin(rho) * c0, Math.cos(rho) - s0 * sl);
  const cl = Math.sqrt(1 - sl * sl);
  out[0] = cl * Math.cos(lon); out[1] = cl * Math.sin(lon); out[2] = sl;
}

/**
 * Nested patches of ground around one site, finest in the middle. A child of the body's globe,
 * so it turns with it; its vertices are stored relative to the site itself, which keeps them
 * exact when the camera is a few metres away.
 */
class SitePatches {
  private group = new THREE.Group();
  private levels: { mesh: THREE.Mesh; halfKm: number; ready: boolean }[] = [];
  readonly sources: string[];

  constructor(parent: THREE.Object3D, R: number, site: SiteImagery, url: (file: string) => string, loader: THREE.TextureLoader, anisotropy: number, tint: number, onLoad: () => void) {
    const centre: number[] = [0, 0, 0], d: number[] = [0, 0, 0];
    offsetDir(site.lat, site.lon, 0, 0, R, centre);
    this.group.position.set(centre[0] * R, centre[1] * R, centre[2] * R);
    parent.add(this.group);
    const sorted = [...site.levels].sort((a, b) => b.halfKm - a.halfKm);
    this.sources = [...new Set(sorted.map((l) => l.source))];
    const N = 96;
    sorted.forEach((lv, k) => {
      // Coarser patches sit a little lower so that the finer one on top of them is the one seen.
      const rank = sorted.length - 1 - k, sink = rank === 0 ? 0 : rank === 1 ? R * 1e-6 * 2 : R * 1e-6 * 6;
      const pos = new Float32Array((N + 1) * (N + 1) * 3), nor = new Float32Array(pos.length), uv = new Float32Array((N + 1) * (N + 1) * 2);
      for (let j = 0, p = 0, q = 0; j <= N; j++) for (let i = 0; i <= N; i++, p += 3, q += 2) {
        offsetDir(site.lat, site.lon, (i / N * 2 - 1) * lv.halfKm, (j / N * 2 - 1) * lv.halfKm, R, d);
        for (let c = 0; c < 3; c++) { pos[p + c] = (R - sink) * d[c] - R * centre[c]; nor[p + c] = d[c]; }
        uv[q] = i / N; uv[q + 1] = j / N;
      }
      const idx = new Uint16Array(N * N * 6);
      for (let j = 0, t = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, e = c + 1;
        idx[t++] = a; idx[t++] = b; idx[t++] = c; idx[t++] = b; idx[t++] = e; idx[t++] = c;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      // Blended over the globe (the imagery fades out at its edge) but sorted with the opaque
      // objects, so that the vehicle standing on it is drawn against it correctly.
      const material = new THREE.MeshStandardMaterial({ color: tint, roughness: 1, metalness: 0, transparent: false, blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
      const mesh = new THREE.Mesh(geo, material);
      mesh.renderOrder = 1 + k;
      mesh.visible = false;
      mesh.frustumCulled = false;
      const level = { mesh, halfKm: lv.halfKm, ready: false };
      this.levels.push(level);
      this.group.add(mesh);
      loader.load(url(lv.file), (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = anisotropy;
        material.map = t;
        material.needsUpdate = true;
        level.ready = true;
        onLoad();
      });
    });
  }

  /** Shows the patches that are worth drawing from `distKm` away. */
  show(distKm: number, enabled: boolean): void {
    for (const l of this.levels) l.mesh.visible = enabled && l.ready && distKm < l.halfKm * 45;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const l of this.levels) {
      l.mesh.geometry.dispose();
      const m = l.mesh.material as THREE.MeshStandardMaterial;
      m.map?.dispose();
      m.dispose();
    }
  }
}

interface Label { el: HTMLDivElement; pos: THREE.Vector3; visible: boolean; rank: number }

export class FlightScene {
  private renderer: THREE.WebGLRenderer;
  private canvas: HTMLCanvasElement;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 1e-5, 4e10);
  private controls: OrbitControls;
  private loader = new THREE.TextureLoader();
  private earth: THREE.Mesh;
  private atmosphere: THREE.Mesh;
  private atmosUniforms = { sunDir: { value: new THREE.Vector3(1, 0, 0) } };
  private sky: THREE.Mesh;
  private skyUniforms = { up: { value: new THREE.Vector3(0, 0, 1) }, sunDir: { value: new THREE.Vector3(1, 0, 0) }, air: { value: 0 } };
  private moon: THREE.Mesh;
  private sun: THREE.Mesh;
  private sunGlow: THREE.Sprite;
  private sunLight = new THREE.DirectionalLight(0xffffff, 3.2);
  private ambient = new THREE.AmbientLight(0x8fa3c8, 0.07);
  private stars: THREE.Points;
  private moonOrbit = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x8f9bb0, transparent: true, opacity: 0.5 }));
  private earthOrbit = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x56c4ff, transparent: true, opacity: 0.55 }));
  private pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x8a93a3, transparent: true, opacity: 0.5 }));
  private flownLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff7a45, transparent: true }));
  private craftGroup = new THREE.Group();
  private plumes: THREE.Mesh[] = [];
  private plumeGlow: THREE.Sprite;
  private launcher: Launcher | null = null;
  private spacecraft: Spacecraft | null = null;
  private padPatches: SitePatches | null = null;
  private sitePatches: SitePatches | null = null;
  private labels = new Map<string, Label>();

  private mission: Mission | null = null;
  private flight: Flight | null = null;
  private view: FlightViewState = { scale: 'earth-moon', flat: false, cam: 'overview' };
  private timeMs = 0;
  private playing = false;
  private moonOrbitAt = NaN;
  private earthOrbitAt = NaN;
  private loadToken = 0;
  /** When the spacecraft leaves its launch vehicle. */
  private sepMs = Infinity;
  private tliMs = Infinity;

  // Double-precision state for the current instant (km, Earth-centred ecliptic).
  private craftPos = new Float64Array(3);
  private moonPos = new Float64Array(3);
  private sunPos = new Float64Array(3);
  private origin = new Float64Array(3);
  private eAxes = new Float64Array(9);
  private mAxes = new Float64Array(9);
  private tmpA = new Float64Array(3);
  private tmpB = new Float64Array(3);
  private up = new THREE.Vector3(0, 0, 1);
  private prograde = new THREE.Vector3(1, 0, 0);
  private forward = new THREE.Vector3(1, 0, 0);
  private nose = new THREE.Vector3(0, 0, 1);
  private phase: Phase | null = null;
  private exhaust: Exhaust[] = [];
  private onLauncher = true;
  private boost = 1;

  // The follow rig: a frame that eases after the vehicle's local frame, and a shot within it.
  private rigQ = new THREE.Quaternion();
  private rigUp = new THREE.Vector3(0, 0, 1);
  private rigFresh = true;
  private shot = { az: 0.6, el: 0.2, dist: 1, aim: 0 };
  private user = { az: 0, el: 0, zoom: 1 };
  private drag: { id: number; x: number; y: number } | null = null;
  private clock = 0;
  private lastFrame = 0;

  private width = 1;
  private height = 1;
  private dirty = true;
  private raf = 0;
  private disposed = false;
  private base: string;
  private lastCraftKey = '';
  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private m4 = new THREE.Matrix4();

  readout: FlightReadout | null = null;
  /** Called with what is on screen whenever the model or the working stage changes. */
  onCraft: ((info: CraftInfo | null) => void) | null = null;
  /** Called once the imagery under the launch pad and the landing site is known. */
  onGround: ((sources: { pad: string[]; site: string[] }) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, overlay: HTMLElement, base: string) {
    this.base = base;
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x020306, 1);
    this.renderer.localClippingEnabled = true; // separated stages of the NASA Saturn V are cut away
    this.camera.up.set(0, 0, 1);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });

    const maxTex = this.renderer.capabilities.maxTextureSize;
    const prep = (t: THREE.Texture) => { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy()); this.dirty = true; return t; };
    const stepUp = (mat: THREE.MeshStandardMaterial, small: string, large: string[]) => {
      this.loader.load(`${base}textures/${small}`, (lo) => {
        mat.map = prep(lo);
        mat.needsUpdate = true;
        const tryNext = (i: number) => { if (i < large.length) this.loader.load(`${base}textures/${large[i]}`, (hi) => { mat.map = prep(hi); mat.needsUpdate = true; lo.dispose(); }, undefined, () => tryNext(i + 1)); };
        tryNext(0);
      });
    };

    // Earth: NASA Blue Marble on a sphere, turned to its real orientation for the instant shown.
    const earthMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    stepUp(earthMat, 'earth_1k.webp', maxTex >= 8192 ? ['earth_8k.webp', 'earth_4k.webp'] : ['earth_4k.webp']);
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS_KM - EARTH_SINK_KM, 192, 96).rotateX(Math.PI / 2), earthMat);
    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS_KM * 1.025, 96, 48).rotateX(Math.PI / 2), new THREE.ShaderMaterial({
      vertexShader: ATMOS_VERT, fragmentShader: ATMOS_FRAG, uniforms: this.atmosUniforms, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.skyUniforms, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }));
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;

    // Moon: LROC albedo with LOLA relief, in its real orientation (librations included).
    const moonMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    stepUp(moonMat, 'moon_albedo_1k.webp', maxTex >= 8192 ? ['moon_albedo_8k.webp', 'moon_albedo_4k.webp'] : ['moon_albedo_4k.webp']);
    this.loader.load(`${base}textures/moon_normal_4k.webp`, (n) => {
      n.wrapS = THREE.RepeatWrapping;
      n.offset.set(0.5, 0); // the relief map starts at 0 deg E, the albedo map is centred on it
      moonMat.normalMap = n;
      moonMat.normalScale.set(1.4, 1.4);
      moonMat.needsUpdate = true;
      this.dirty = true;
    });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(MOON_RADIUS_KM - MOON_SINK_KM, 128, 64).rotateX(Math.PI / 2), moonMat);

    this.sun = new THREE.Mesh(new THREE.SphereGeometry(SUN_RADIUS_KM, 32, 16), new THREE.MeshBasicMaterial({ color: 0xfff3c4 }));
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,255,255,1)', 'rgba(255,240,200,0.9)', 'rgba(255,180,60,0.16)'), depthWrite: false, depthTest: false, transparent: true, blending: THREE.AdditiveBlending }));
    this.sunGlow.renderOrder = -2;

    // Stars: fixed directions, drawn around the camera so they never show parallax.
    {
      const n = 3200, pos = new Float32Array(n * 3);
      let seed = 987654321;
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      for (let i = 0; i < n; i++) {
        const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
        pos.set([r * Math.cos(a) * 2e10, r * Math.sin(a) * 2e10, z * 2e10], i * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xa9b8d8, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.6, depthWrite: false, depthTest: false }));
      this.stars.renderOrder = -3;
      this.stars.frustumCulled = false;
    }

    // Engine exhaust: a pool of cones, one per firing engine, and a glow at their root.
    const plumeGeo = new THREE.ConeGeometry(1, 1, 18, 1, true).translate(0, -0.5, 0);
    for (let i = 0; i < 16; i++) {
      const p = new THREE.Mesh(plumeGeo, new THREE.MeshBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      p.visible = false;
      this.plumes.push(p);
      this.craftGroup.add(p);
    }
    this.plumeGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,255,255,1)', 'rgba(255,230,180,0.85)', 'rgba(255,150,60,0.22)'), depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
    this.plumeGlow.visible = false;
    this.craftGroup.add(this.plumeGlow);

    for (const l of [this.moonOrbit, this.earthOrbit, this.pathLine, this.flownLine]) l.frustumCulled = false;
    this.flownLine.renderOrder = 2;

    this.scene.add(this.stars, this.sunGlow, this.sky, this.sun, this.earth, this.atmosphere, this.moon, this.moonOrbit, this.earthOrbit, this.pathLine, this.flownLine, this.craftGroup, this.sunLight, this.sunLight.target, this.ambient);

    // Labels, most important first: when two would overlap, the later one gives way.
    for (const [id, cls, text] of [['craft', 'craft', ''], ['pad', 'place', ''], ['site', 'place', ''], ['moon', 'body', 'Moon'], ['earth', 'earth', 'Earth'], ['sun', 'sun', 'Sun']] as const) {
      const el = document.createElement('div');
      el.className = `scene-label flight-label ${cls}`;
      el.textContent = text;
      overlay.appendChild(el);
      this.labels.set(id, { el, pos: new THREE.Vector3(), visible: false, rank: this.labels.size });
    }
    this.raf = requestAnimationFrame(this.loop);
  }

  // -------------------------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------------------------
  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  /** Shows a mission: its trajectory, its launch vehicle, its spacecraft and the ground at both ends. */
  setMission(mission: Mission, flight: Flight): void {
    this.mission = mission;
    this.flight = flight;
    const pos = new THREE.BufferAttribute(flight.path, 3);
    for (const line of [this.pathLine, this.flownLine]) {
      line.geometry.dispose();
      line.geometry = new THREE.BufferGeometry();
      line.geometry.setAttribute('position', pos);
    }
    this.labels.get('craft')!.el.textContent = mission.name;
    this.labels.get('pad')!.el.textContent = mission.launchSite.name.split(',')[0];
    this.labels.get('site')!.el.textContent = mission.surface ? (landedIntact(mission) ? 'Landing site' : 'Impact site') : '';

    // The spacecraft leaves its launch vehicle after the burn that sends it to the Moon; on a
    // mission that first loops around Earth for days, soon after reaching orbit instead. A JPL
    // trajectory begins at that separation by definition.
    const transfer = flight.phases.find((p) => p.id === 'transfer'), orbit = flight.phases.find((p) => p.id === 'earth-orbit');
    this.tliMs = flight.kind === 'reconstructed' && transfer ? transfer.startMs : Infinity;
    this.sepMs = !transfer ? Infinity : flight.kind === 'flown' ? transfer.startMs : orbit && orbit.endMs - orbit.startMs > 3 * 3600e3 ? orbit.startMs + 40 * 60e3 : transfer.startMs + 600e3;

    // Ground imagery at the launch pad and at the landing site.
    this.padPatches?.dispose();
    this.sitePatches?.dispose();
    const anisotropy = this.renderer.capabilities.getMaxAnisotropy(), url = (f: string) => `${this.base}sites/${f}`, loaded = () => { this.dirty = true; };
    const pad = launchImagery(mission), site = landingImagery(mission);
    this.padPatches = pad ? new SitePatches(this.earth, EARTH_RADIUS_KM, pad, url, this.loader, anisotropy, 0xffffff, loaded) : null;
    this.sitePatches = site ? new SitePatches(this.moon, MOON_RADIUS_KM, site, url, this.loader, anisotropy, 0xc9c9c9, loaded) : null;
    this.onGround?.({ pad: this.padPatches?.sources ?? [], site: this.sitePatches?.sources ?? [] });

    // Models load asynchronously; a newer mission selection cancels an older load.
    const token = ++this.loadToken;
    for (const c of [this.launcher, this.spacecraft]) if (c) this.craftGroup.remove(c.object);
    this.launcher = this.spacecraft = null;
    this.lastCraftKey = '';
    this.onCraft?.(null);
    void Promise.all([
      buildLauncher(mission.vehicleClass, mission.vehicle, this.base),
      buildSpacecraft({ id: mission.id, name: mission.name, category: mission.category, hasSurface: !!mission.surface }, this.base),
    ]).then(([launcher, spacecraft]) => {
      if (token !== this.loadToken || this.disposed) return;
      this.launcher = launcher;
      this.spacecraft = spacecraft;
      this.craftGroup.add(launcher.object, spacecraft.object);
      this.update();
      this.resetCamera();
    });
    this.user = { az: 0, el: 0, zoom: 1 };
    this.update();
    this.resetCamera();
  }

  setTime(utcMs: number): void {
    // A jump in time (a click on the phase bar) cuts to the new shot instead of flying to it.
    if (Math.abs(utcMs - this.timeMs) > 3600e3 && !this.playing) this.rigFresh = true;
    this.timeMs = utcMs;
    this.update();
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
  }

  setView(view: FlightViewState): void {
    const was = this.view;
    const changed = view.scale !== was.scale || view.flat !== was.flat || view.cam !== was.cam;
    this.view = { ...view };
    if (!changed) return;
    // Going between Follow and Cinematic keeps the camera where it is.
    const stay = !view.flat && !was.flat && view.scale === was.scale && this.riding(was) && this.riding(view);
    this.update();
    if (!stay) this.resetCamera();
    this.applyControlLimits();
    this.dirty = true;
  }

  /** Puts the follow camera back on its standard shot. */
  recentre(): void {
    this.user = { az: 0, el: 0, zoom: 1 };
    this.rigFresh = true;
    this.dirty = true;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.padPatches?.dispose();
    this.sitePatches?.dispose();
    for (const l of this.labels.values()) l.el.remove();
    this.renderer.dispose();
  }

  // -------------------------------------------------------------------------------------------
  // Per-instant state
  // -------------------------------------------------------------------------------------------
  private get k(): number {
    return this.view.scale === 'solar' ? SOLAR_SYSTEM_BOOST : 1;
  }

  /** True for the cameras that ride with the vehicle. */
  private riding(view: FlightViewState = this.view): boolean {
    return !view.flat && (view.cam === 'chase' || view.cam === 'cinematic');
  }

  /** Which body the spacecraft is "at" for altitude, speed and camera framing. */
  private atMoon(): boolean {
    return !!this.phase && LUNAR.includes(this.phase.id);
  }

  private currentCraft(): Craft | null {
    return this.onLauncher ? this.launcher : this.spacecraft;
  }

  /** Recomputes where everything is at this.timeMs. */
  private update(): void {
    const t = this.timeMs, f = this.flight;
    moonEcl(t, this.moonPos);
    sunEcl(t, this.sunPos);
    earthAxes(t, this.eAxes);
    moonAxes(t, this.mAxes);
    if (f) {
      f.position(t, this.craftPos);
      this.phase = phaseAt(f, t);
      // Local frame at the spacecraft: up, direction of travel and the horizontal across-track.
      const moonFrame = this.atMoon();
      const dt = 1000;
      f.position(t - dt, this.tmpA);
      f.position(t + dt, this.tmpB);
      let vx = (this.tmpB[0] - this.tmpA[0]) / 2, vy = (this.tmpB[1] - this.tmpA[1]) / 2, vz = (this.tmpB[2] - this.tmpA[2]) / 2; // km/s
      let cx = this.craftPos[0], cy = this.craftPos[1], cz = this.craftPos[2];
      if (moonFrame) {
        moonEcl(t - dt, this.tmpA);
        moonEcl(t + dt, this.tmpB);
        vx -= (this.tmpB[0] - this.tmpA[0]) / 2; vy -= (this.tmpB[1] - this.tmpA[1]) / 2; vz -= (this.tmpB[2] - this.tmpA[2]) / 2;
        cx -= this.moonPos[0]; cy -= this.moonPos[1]; cz -= this.moonPos[2];
      }
      this.up.set(cx, cy, cz).normalize();
      const speed = Math.hypot(vx, vy, vz);
      if (speed > 0.02) this.prograde.set(vx, vy, vz).normalize();
      else {
        // At rest on a surface: "forward" is east, the way the ground itself is moving.
        const ax = moonFrame ? this.mAxes : this.eAxes;
        this.prograde.set(ax[6], ax[7], ax[8]).cross(this.up).normalize();
      }
      // Horizontal direction of travel. Kept from the last instant when the flight is vertical.
      this.v.copy(this.prograde).addScaledVector(this.up, -this.prograde.dot(this.up));
      if (this.v.lengthSq() > 0.01) this.forward.copy(this.v).normalize();
      else this.forward.addScaledVector(this.up, -this.forward.dot(this.up)).normalize();
      const earthKm = Math.hypot(this.craftPos[0], this.craftPos[1], this.craftPos[2]);
      const moonKm = Math.hypot(this.craftPos[0] - this.moonPos[0], this.craftPos[1] - this.moonPos[1], this.craftPos[2] - this.moonPos[2]);
      // Attitude: nose up on the pad, pitching over into the direction of flight; engine-first
      // then upright for a landing.
      const ph = this.phase, s = Math.min(1, Math.max(0, (t - ph.startMs) / Math.max(1, ph.endMs - ph.startMs)));
      if (ph.id === 'pad' || ph.id === 'surface') this.nose.copy(this.up);
      else if (ph.id === 'ascent') this.nose.copy(this.up).lerp(this.prograde, THREE.MathUtils.smoothstep(s, 0.03, 0.85)).normalize();
      else if (ph.id === 'descent') this.nose.copy(this.prograde).negate().lerp(this.up, THREE.MathUtils.smoothstep(s, 0.1, 0.95)).normalize();
      else this.nose.copy(this.prograde);
      const metS = (t - f.launchMs) / 1000;
      this.readout = {
        phase: ph, body: moonFrame ? 'Moon' : 'Earth', speedKmS: ph.id === 'pad' || ph.id === 'surface' ? 0 : speed,
        altitudeKm: Math.max(0, moonFrame ? moonKm - MOON_RADIUS_KM : earthKm - EARTH_RADIUS_KM), earthKm, moonKm, enlarged: this.boost, metS,
      };

      // What is flying: the launch vehicle with the spacecraft on top, then the spacecraft alone.
      const L = this.launcher, S = this.spacecraft;
      this.onLauncher = t < this.sepMs;
      this.exhaust = [];
      if (L && S) {
        const burning = (ph.id === 'ascent' && metS < 546) || (t >= this.tliMs && t < this.tliMs + 350e3);
        L.object.visible = this.onLauncher;
        if (this.onLauncher) {
          this.exhaust = L.update(metS, burning);
          // Once the fairing has gone the spacecraft is seen riding on the last stage.
          S.object.visible = L.payloadY !== null && metS >= L.fairingDrop;
          S.setMode('cruise');
          S.object.position.y = L.payloadY ?? 0;
        } else {
          const down = ph.id === 'surface' || (ph.id === 'descent' && S.surfaceFrom === 'descent');
          S.setMode(down && S.hasSurfaceModel ? 'surface' : 'cruise');
          S.object.position.y = 0;
          // Nothing is left standing where a spacecraft hit the surface.
          S.object.visible = !(ph.id === 'surface' && this.mission && !landedIntact(this.mission));
          if (ph.id === 'descent') this.exhaust = [{ x: 0, y: 0, z: 0, r: S.lengthKm * 0.07 }];
        }
      }
    }
    // Orbit lines are rebuilt as the clock moves away from the span they cover.
    if (!(Math.abs(t - this.moonOrbitAt) < 0.5 * DAY_MS)) {
      const n = 340, pts = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { moonEcl(t + ((i / (n - 1)) * 28 - 14) * DAY_MS, this.tmpA); pts.set(this.tmpA, i * 3); }
      this.moonOrbit.geometry.dispose();
      this.moonOrbit.geometry = new THREE.BufferGeometry();
      this.moonOrbit.geometry.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      this.moonOrbitAt = t;
    }
    if (!(Math.abs(t - this.earthOrbitAt) < 20 * DAY_MS)) {
      const n = 368, pts = new Float32Array(n * 3);
      // Earth relative to the Sun over a year around now.
      for (let i = 0; i < n; i++) { sunEcl(t + (i - 183) * DAY_MS, this.tmpA); pts.set([-this.tmpA[0], -this.tmpA[1], -this.tmpA[2]], i * 3); }
      this.earthOrbit.geometry.dispose();
      this.earthOrbit.geometry = new THREE.BufferGeometry();
      this.earthOrbit.geometry.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      this.earthOrbitAt = t;
    }
    if (f) {
      // Highlight the part of the path already flown.
      let lo = 0, hi = f.pathTimes.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (f.pathTimes[mid] <= t) lo = mid; else hi = mid - 1; }
      this.flownLine.geometry.setDrawRange(0, t < f.pathTimes[0] ? 0 : lo + 1);
    }
    this.dirty = true;
  }

  /** Display position (km) of the point the camera is attached to. */
  private anchor(out: Float64Array): Float64Array {
    const k = this.k, cam = this.view.cam;
    if (cam === 'chase' || cam === 'cinematic') { out[0] = this.craftPos[0] * k; out[1] = this.craftPos[1] * k; out[2] = this.craftPos[2] * k; }
    else if (cam === 'moon') { out[0] = this.moonPos[0] * k; out[1] = this.moonPos[1] * k; out[2] = this.moonPos[2] * k; }
    else if (cam === 'earth') out.fill(0);
    else if (this.view.scale === 'solar') out.set(this.sunPos);
    else { out[0] = this.moonPos[0] / 2; out[1] = this.moonPos[1] / 2; out[2] = this.moonPos[2] / 2; }
    return out;
  }

  /** Puts every object where it belongs relative to the floating origin. */
  private place(): void {
    const k = this.k, o = this.anchor(this.origin), cam = this.camera.position;
    const rel = (x: number, y: number, z: number, target: THREE.Vector3) => target.set(x - o[0], y - o[1], z - o[2]);
    rel(0, 0, 0, this.earth.position);
    this.atmosphere.position.copy(this.earth.position);
    this.earth.scale.setScalar(k);
    this.atmosphere.scale.setScalar(k);
    orient(this.earth, this.eAxes, this.m4);
    this.atmosphere.quaternion.copy(this.earth.quaternion);
    rel(this.moonPos[0] * k, this.moonPos[1] * k, this.moonPos[2] * k, this.moon.position);
    this.moon.scale.setScalar(k);
    orient(this.moon, this.mAxes, this.m4);
    rel(this.sunPos[0], this.sunPos[1], this.sunPos[2], this.sun.position);
    this.sun.scale.setScalar(this.view.scale === 'solar' ? SOLAR_SUN_BOOST : 1);
    this.sunGlow.position.copy(this.sun.position);
    this.sunGlow.scale.setScalar(SUN_RADIUS_KM * (this.view.scale === 'solar' ? SOLAR_SUN_BOOST * 9 : 34));
    const sunDir = this.v.set(this.sunPos[0], this.sunPos[1], this.sunPos[2]).normalize();
    this.sunLight.position.copy(sunDir);
    this.atmosUniforms.sunDir.value.copy(sunDir);
    this.skyUniforms.sunDir.value.copy(sunDir);
    for (const line of [this.moonOrbit, this.pathLine, this.flownLine]) { line.position.copy(this.earth.position); line.scale.setScalar(k); }
    this.earthOrbit.position.copy(this.sun.position);
    this.earthOrbit.visible = this.view.scale === 'solar';
    this.stars.position.copy(cam);
    this.sky.position.copy(cam);

    // The sky, from the camera's height in Earth's atmosphere; stars fade as it brightens.
    const camAlt = this.v2.copy(cam).sub(this.earth.position).length() - EARTH_RADIUS_KM;
    const air = k === 1 ? Math.exp(-Math.max(0, camAlt) / 9) : 0;
    this.skyUniforms.air.value = air;
    this.skyUniforms.up.value.copy(this.v2).normalize();
    this.sky.visible = air > 0.002;
    const lit = air * THREE.MathUtils.smoothstep(sunDir.dot(this.skyUniforms.up.value), -0.12, 0.18);
    (this.stars.material as THREE.PointsMaterial).opacity = 0.6 * (1 - lit);

    // Ground imagery, when the camera is near enough for it to matter.
    const m = this.mission;
    if (m) {
      surfacePoint(this.eAxes, EARTH_RADIUS_KM, m.launchSite.lat, m.launchSite.lon, this.tmpA);
      this.padPatches?.show(this.v2.set(this.tmpA[0] - o[0], this.tmpA[1] - o[1], this.tmpA[2] - o[2]).distanceTo(cam), k === 1);
      if (m.surface) {
        surfacePoint(this.mAxes, MOON_RADIUS_KM, m.surface.lat, m.surface.lon, this.tmpA);
        this.sitePatches?.show(this.v2.set(this.moonPos[0] + this.tmpA[0] - o[0], this.moonPos[1] + this.tmpA[1] - o[1], this.moonPos[2] + this.tmpA[2] - o[2]).distanceTo(cam), k === 1);
      }
    }

    // Spacecraft: true size when the camera is close, enlarged just enough to stay visible when not.
    rel(this.craftPos[0] * k, this.craftPos[1] * k, this.craftPos[2] * k, this.craftGroup.position);
    const craft = this.currentCraft();
    const stage = this.onLauncher && this.launcher && this.readout ? this.launcher.stageName(this.readout.metS) : null;
    const craftKey = craft ? `${craft.label}|${craft.source}|${stage}` : '';
    if (craftKey !== this.lastCraftKey) {
      this.lastCraftKey = craftKey;
      this.onCraft?.(craft ? { label: craft.label, source: craft.source, stage } : null);
    }
    this.craftGroup.visible = !!this.flight && !!craft;
    let camDist = Infinity;
    if (craft) {
      camDist = cam.distanceTo(this.craftGroup.position);
      const px = (craft.lengthKm / Math.max(1e-9, camDist)) / (2 * Math.tan((this.camera.fov * Math.PI) / 360)) * this.height;
      this.boost = Math.max(1, MIN_CRAFT_PX / Math.max(1e-9, px));
      this.craftGroup.scale.setScalar(this.boost);
      this.craftGroup.quaternion.setFromUnitVectors(Y_AXIS, this.nose);
      if (this.readout) this.readout.enlarged = this.boost;
      // Exhaust: long and narrow in the air, wide and faint in vacuum.
      const alt = this.readout?.altitudeKm ?? 0, thin = this.atMoon() ? 1 : THREE.MathUtils.smoothstep(alt, 8, 90);
      const flick = 0.92 + 0.08 * Math.sin(this.clock * 47) + 0.05 * Math.sin(this.clock * 113);
      let rSum = 0, yMin = 0;
      this.plumes.forEach((p, i) => {
        const e = this.exhaust[i];
        p.visible = !!e;
        if (!e) return;
        const len = e.r * (26 - 12 * thin) * flick, wide = e.r * (1.5 + 5 * thin);
        p.position.set(e.x, e.y, e.z);
        p.scale.set(wide, len, wide);
        (p.material as THREE.MeshBasicMaterial).opacity = 0.62 - 0.42 * thin;
        rSum += e.r;
        yMin = Math.min(yMin, e.y);
      });
      this.plumeGlow.visible = this.exhaust.length > 0;
      if (this.plumeGlow.visible) {
        this.plumeGlow.position.set(0, yMin - rSum * 1.2, 0);
        this.plumeGlow.scale.setScalar(rSum * (9 - 4 * thin) * flick);
        (this.plumeGlow.material as THREE.SpriteMaterial).opacity = 0.9 - 0.5 * thin;
      }
    }
    // Up close the trajectory line would run straight through the vehicle: fade it out there.
    const near = craft && this.riding() ? THREE.MathUtils.smoothstep(camDist, craft.lengthKm * this.boost * 40, craft.lengthKm * this.boost * 400) : 1;
    (this.pathLine.material as THREE.LineBasicMaterial).opacity = 0.5 * near;
    (this.flownLine.material as THREE.LineBasicMaterial).opacity = near;
    // A close camera on the night side still needs to see the vehicle, like a floodlit pad.
    const dark = craft && this.riding() && (this.readout?.altitudeKm ?? 1e9) < 2000 ? 1 - THREE.MathUtils.smoothstep(sunDir.dot(this.up), -0.15, 0.1) : 0;
    this.ambient.intensity = 0.07 + 0.38 * dark;

    // Labels
    const set = (id: string, x: number, y: number, z: number, show: boolean) => { const l = this.labels.get(id)!; rel(x, y, z, l.pos); l.visible = show; };
    const px = (radiusKm: number, centre: THREE.Vector3) => (radiusKm / Math.max(1e-9, centre.distanceTo(cam))) / Math.tan((this.camera.fov * Math.PI) / 360) * (this.height / 2);
    const earthPx = px(EARTH_RADIUS_KM * k, this.earth.position), moonPx = px(MOON_RADIUS_KM * k, this.moon.position);
    // A body is named while it is small on screen; its places once it is large enough to show them.
    set('earth', 0, 0, 0, earthPx < this.height * 0.45);
    set('moon', this.moonPos[0] * k, this.moonPos[1] * k, this.moonPos[2] * k, moonPx < this.height * 0.45);
    set('sun', this.sunPos[0], this.sunPos[1], this.sunPos[2], this.view.scale === 'solar');
    set('craft', this.craftPos[0] * k, this.craftPos[1] * k, this.craftPos[2] * k, !!this.flight);
    if (m) {
      surfacePoint(this.eAxes, EARTH_RADIUS_KM * k, m.launchSite.lat, m.launchSite.lon, this.tmpA);
      set('pad', this.tmpA[0], this.tmpA[1], this.tmpA[2], earthPx > 34);
      if (m.surface) {
        surfacePoint(this.mAxes, MOON_RADIUS_KM * k, m.surface.lat, m.surface.lon, this.tmpA);
        set('site', this.moonPos[0] * k + this.tmpA[0], this.moonPos[1] * k + this.tmpA[1], this.moonPos[2] * k + this.tmpA[2], moonPx > 34);
      } else this.labels.get('site')!.visible = false;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Cameras
  // -------------------------------------------------------------------------------------------
  private applyControlLimits(): void {
    const { cam, flat } = this.view;
    this.controls.enabled = !this.riding();
    this.controls.enableRotate = !flat;
    this.controls.enablePan = !(cam === 'chase' || cam === 'cinematic');
    this.controls.minPolarAngle = flat ? 1e-4 : 0;
    this.controls.maxPolarAngle = flat ? 1e-4 : Math.PI;
    const k = this.k, craft = this.currentCraft();
    this.controls.minDistance = cam === 'chase' || cam === 'cinematic' ? (craft ? craft.lengthKm * 1.4 : 0.01) : cam === 'earth' ? EARTH_RADIUS_KM * k * 1.02 : cam === 'moon' ? MOON_RADIUS_KM * k * 1.02 : 2000;
    this.controls.maxDistance = this.view.scale === 'solar' ? 3e9 : 6e6;
  }

  /** Frames the current view from its standard position. */
  private resetCamera(): void {
    const { cam, flat, scale } = this.view;
    this.rigFresh = true;
    this.applyControlLimits();
    this.dirty = true;
    if (this.riding()) return; // the rig places the camera every frame
    const k = this.k;
    const moonDist = Math.hypot(this.moonPos[0], this.moonPos[1], this.moonPos[2]);
    let dist: number;
    const dir = this.v.set(0.16, -0.78, 0.6);
    if (cam === 'chase' || cam === 'cinematic') dist = Math.max(40, (this.currentCraft()?.lengthKm ?? 0.05) * 600); // plan view centred on the craft
    else if (cam === 'earth') dist = EARTH_RADIUS_KM * k * 3.4;
    else if (cam === 'moon') { dist = MOON_RADIUS_KM * k * 4.2; dir.set(-this.moonPos[0], -this.moonPos[1], moonDist * 0.35); }
    else dist = scale === 'solar' ? 4.6e8 : moonDist * 1.5;
    if (flat) dir.set(0, -1e-4, 1);
    this.camera.up.set(0, 0, 1);
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(dir.normalize()).multiplyScalar(dist);
    this.controls.update();
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.riding() || e.button === 2) return;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    this.canvas.setPointerCapture(e.pointerId);
  };
  private onPointerMove = (e: PointerEvent): void => {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    this.user.az -= (e.clientX - this.drag.x) * 0.006;
    this.user.el += (e.clientY - this.drag.y) * 0.005;
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
    this.dirty = true;
  };
  private onPointerUp = (e: PointerEvent): void => {
    if (this.drag && e.pointerId === this.drag.id) this.drag = null;
  };
  private onWheel = (e: WheelEvent): void => {
    if (!this.riding()) return;
    e.preventDefault();
    this.user.zoom = Math.min(2e5, Math.max(0.2, this.user.zoom * Math.exp(e.deltaY * 0.0012)));
    this.dirty = true;
  };

  /** Azimuth and elevation, in the rig's frame, of a direction given in the scene. */
  private aimAlong(dir: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, back: THREE.Vector3): { az: number; el: number } {
    return { az: Math.atan2(dir.dot(right), dir.dot(back)), el: Math.asin(Math.max(-1, Math.min(1, dir.dot(up)))) };
  }

  /**
   * The director: where the camera should sit for this moment of the flight. Azimuth is
   * measured from directly behind the vehicle, elevation from the local horizontal.
   */
  private direct(len: number, right: THREE.Vector3, up: THREE.Vector3, back: THREE.Vector3): { az: number; el: number; dist: number } {
    const ph = this.phase!, r = this.readout!;
    const s = Math.min(1, Math.max(0, (this.timeMs - ph.startMs) / Math.max(1, ph.endMs - ph.startMs)));
    const ease = THREE.MathUtils.smoothstep, into = (this.timeMs - ph.startMs) / 1000;
    if (this.view.cam !== 'cinematic') return { az: 0.6, el: 0.22, dist: len * 4.5 };
    switch (ph.id) {
      // Low and in front of the pad, looking up at the vehicle.
      case 'pad': return { az: 2.45, el: -0.1, dist: len * 2.5 };
      // Swings round behind as the vehicle pitches over, and pulls back to take in the staging.
      case 'ascent': { const a = Math.min(1, r.metS / 540); return { az: 2.45 - 1.75 * ease(a, 0.02, 0.4), el: -0.1 + 0.42 * ease(a, 0.0, 0.5), dist: len * (2.6 + 7 * ease(a, 0.03, 0.6)) }; }
      // Above and behind, Earth filling the frame below.
      case 'earth-orbit': return { az: 0.55, el: 0.5, dist: len * 6.5 };
      case 'transfer': case 'cruise': {
        if (ph.id === 'transfer' && into < 760 && this.flight!.kind === 'reconstructed') return { az: 0.7, el: 0.36, dist: len * 7 };
        // Outbound: first from beyond the craft looking back at Earth, then from behind it
        // looking ahead to the Moon. Homebound: looking ahead to Earth.
        const toMoon = ph.id === 'transfer' && s > 0.5;
        const body = this.v3.set(toMoon ? this.moonPos[0] - this.craftPos[0] : -this.craftPos[0], toMoon ? this.moonPos[1] - this.craftPos[1] : -this.craftPos[1], toMoon ? this.moonPos[2] - this.craftPos[2] : -this.craftPos[2]).normalize();
        const d = body.negate().applyAxisAngle(up, 0.3).addScaledVector(up, 0.12).normalize();
        return { ...this.aimAlong(d, right, up, back), dist: len * 9 };
      }
      case 'flyby': case 'lunar-orbit': return { az: 0.6, el: 0.5, dist: len * 7 };
      // Comes round to the front and down to the surface as the lander settles.
      case 'descent': return { az: 0.7 + 1.6 * ease(s, 0.2, 0.95), el: 0.42 - 0.3 * ease(s, 0.3, 1), dist: len * (9 - 3.5 * ease(s, 0.3, 1)) };
      // On the surface: a slow walk around the lander.
      default: return { az: 2.3 + this.clock * 0.1, el: 0.14, dist: len * 5.5 };
    }
  }

  /** The follow rig: eases the frame, the shot and the aim point, then places the camera. */
  private ride(dtReal: number): void {
    const craft = this.currentCraft();
    if (!craft || !this.phase || !this.readout) return;
    // Target frame: right, up (local vertical) and back (against the direction of travel).
    const fwd = this.forward, right = this.v.crossVectors(fwd, this.up).normalize(), back = this.v2.copy(fwd).negate();
    this.m4.makeBasis(right, this.up, back);
    this.q.setFromRotationMatrix(this.m4);
    const rate = this.playing ? 2.2 : 9, a = this.rigFresh ? 1 : 1 - Math.exp(-dtReal * rate);
    this.rigQ.slerp(this.q, a);
    right.set(1, 0, 0).applyQuaternion(this.rigQ);
    const up = this.rigUp.set(0, 1, 0).applyQuaternion(this.rigQ);
    back.set(0, 0, 1).applyQuaternion(this.rigQ);

    const len = craft.lengthKm * this.boost;
    const want = this.direct(len, right, up, back);
    const aim = (craft.heightKm ?? craft.lengthKm) * this.boost * 0.5;
    if (this.rigFresh) { this.shot.az = want.az; this.shot.el = want.el; this.shot.dist = want.dist; this.shot.aim = aim; }
    else {
      const b = 1 - Math.exp(-dtReal * (this.playing ? 1.5 : 7));
      this.shot.az += Math.atan2(Math.sin(want.az - this.shot.az), Math.cos(want.az - this.shot.az)) * b;
      this.shot.el += (want.el - this.shot.el) * b;
      this.shot.dist = Math.exp(Math.log(this.shot.dist) + (Math.log(want.dist) - Math.log(this.shot.dist)) * b);
      this.shot.aim += (aim - this.shot.aim) * b;
    }
    this.rigFresh = false;
    this.user.el = Math.max(-1.5 - this.shot.el, Math.min(1.5 - this.shot.el, this.user.el));
    const az = this.shot.az + this.user.az, el = Math.max(-1.5, Math.min(1.5, this.shot.el + this.user.el));
    const dist = Math.max(len * 1.2, this.shot.dist * this.user.zoom);
    const target = this.controls.target.copy(this.nose).multiplyScalar(this.shot.aim);
    const cam = this.camera.position.copy(target)
      .addScaledVector(back, dist * Math.cos(el) * Math.cos(az))
      .addScaledVector(right, dist * Math.cos(el) * Math.sin(az))
      .addScaledVector(up, dist * Math.sin(el));
    // Keep the camera above the ground of whichever body it is next to.
    if (this.k === 1) for (const [bx, by, bz, R] of [[0, 0, 0, EARTH_RADIUS_KM], [this.moonPos[0], this.moonPos[1], this.moonPos[2], MOON_RADIUS_KM]] as const) {
      const cx = bx - this.craftPos[0], cy = by - this.craftPos[1], cz = bz - this.craftPos[2];
      const dx = cam.x - cx, dy = cam.y - cy, dz = cam.z - cz, r = Math.hypot(dx, dy, dz), floor = R + 0.004;
      if (r < floor) { const kf = floor / r; cam.set(cx + dx * kf, cy + dy * kf, cz + dz * kf); }
    }
    this.camera.up.copy(up);
    this.camera.lookAt(target);
  }

  private loop = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dtReal = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.playing) this.clock += dtReal;
    let moved = false;
    if (this.riding() && this.flight) { this.ride(dtReal); moved = true; }
    else moved = this.controls.update();
    if (!moved && !this.dirty) return;
    this.dirty = false;
    this.place();
    this.launcher?.sync?.();
    this.renderer.render(this.scene, this.camera);
    this.drawLabels();
    // The enlargement depends on the camera distance, which place() has just used: settle it.
    if (this.currentCraft() && Math.abs(this.boost - this.craftGroup.scale.x) > 1e-6) this.dirty = true;
  };

  private drawLabels(): void {
    const cam = this.camera.position, k = this.k;
    const hidden = (p: THREE.Vector3, centre: THREE.Vector3, radius: number) => {
      // Is the segment camera -> p blocked by a sphere?
      const dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z, len = Math.hypot(dx, dy, dz);
      const t = ((centre.x - cam.x) * dx + (centre.y - cam.y) * dy + (centre.z - cam.z) * dz) / (len * len);
      if (t <= 0 || t >= 0.999) return false;
      return Math.hypot(cam.x + dx * t - centre.x, cam.y + dy * t - centre.y, cam.z + dz * t - centre.z) < radius * 0.995;
    };
    const placed: { x: number; y: number; w: number }[] = [];
    for (const [id, l] of this.labels) {
      let show = l.visible && l.el.textContent !== '';
      if (show && id !== 'earth' && id !== 'pad' && hidden(l.pos, this.earth.position, EARTH_RADIUS_KM * k)) show = false;
      if (show && id !== 'moon' && id !== 'site' && hidden(l.pos, this.moon.position, MOON_RADIUS_KM * k)) show = false;
      // A place on the far side of its own body is hidden too.
      if (show && id === 'pad' && this.v.copy(l.pos).sub(this.earth.position).dot(this.v2.copy(cam).sub(l.pos)) < 0) show = false;
      if (show && id === 'site' && this.v.copy(l.pos).sub(this.moon.position).dot(this.v2.copy(cam).sub(l.pos)) < 0) show = false;
      let x = 0, y = 0;
      if (show) {
        this.v.copy(l.pos).project(this.camera);
        if (this.v.z > 1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) show = false;
        x = (this.v.x * 0.5 + 0.5) * this.width + 12;
        y = (-this.v.y * 0.5 + 0.5) * this.height - 8;
      }
      // Labels are visited in order of importance; one that would sit on an earlier one gives way.
      const w = 8 + (l.el.textContent?.length ?? 0) * 7.5;
      if (show && placed.some((p) => Math.abs(p.y - y) < 18 && x < p.x + p.w && p.x < x + w)) show = false;
      if (show) placed.push({ x, y, w });
      l.el.style.display = show ? '' : 'none';
      if (show) l.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }
}
