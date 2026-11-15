// The 3D viewport. Two views share one renderer:
//   globe : the whole Moon in the Moon-fixed frame, lit by the real Sun direction, with the
//           Earth drawn at its true distance and size.
//   pole  : LOLA south-polar terrain (80 S to the pole) with shadows ray-marched on the GPU.
// Rendering is on demand: a frame is drawn only when the camera, the time or the data changes.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEG, EARTH_RADIUS_KM, MOON_RADIUS_KM, RAD } from '../core/constants.ts';
import type { PolarDem } from '../core/dem.ts';
import { EARTH, SUN } from '../core/ephemeris.ts';
import { COPY_FRAG, EARTH_FRAG, FULLSCREEN_VERT, GLOBE_FRAG, GLOBE_VERT, MARKER_FRAG, MARKER_VERT, SHADOW_FRAG, TERRAIN_FRAG, TERRAIN_VERT } from './shaders.ts';

export type SceneMode = 'globe' | 'pole';

export interface SceneSite {
  id: string;
  name: string;
  lat: number;
  lon: number;
  groundHeightM: number;
  color: string;
  role: 'selected' | 'pinned' | 'other';
}

export interface SceneCallbacks {
  onSelect(id: string): void;
  onPick(lat: number, lon: number): void;
  onHover(id: string | null): void;
}

const EXAGGERATION = 3;
const SUN_COLOR = 0xffab2e;
const EARTH_COLOR = 0x56c4ff;
/** Coarse shadow map used while the Sun is jumping or moving fast. */
const SHADOW_COARSE_SIZE = 256;

/** Render budget for a terrain grid of a given size. */
interface TerrainSpec {
  /** Fine shadow map resolution (pixels across the 608 km map). */
  shadow: number;
  /** The fine shadow map is refreshed one band per frame (see stepShadows). */
  bands: number;
  /** Resolution of the mission-illumination accumulation. */
  accum: number;
  /** Mesh segments per side. Relief finer than the mesh still shows through per-pixel normals. */
  seg: number;
  /** Sun motion per frame (rad) above which the coarse map takes over: keeps the banded map under 1.5 deg stale. */
  fastRad: number;
}

function terrainSpec(demSize: number, maxTexture: number): TerrainSpec {
  const make = (shadow: number, bands: number, accum: number, seg: number): TerrainSpec => ({ shadow: Math.min(shadow, maxTexture), bands, accum, seg, fastRad: (1.5 * DEG) / bands });
  if (demSize >= 7000) return make(4096, 48, 1024, 1520); // 80 m grid: 148 m shadow texels, 400 m mesh
  if (demSize >= 3500) return make(2048, 32, 1024, 950);
  return make(1024, 24, 512, 475);
}

/** A flat grid in the XY plane (positions only: heights and normals come from the height texture). */
function gridGeometry(size: number, seg: number): THREE.BufferGeometry {
  const n = seg + 1, half = size / 2, step = size / seg;
  const pos = new Float32Array(n * n * 3);
  for (let j = 0, o = 0; j < n; j++) {
    for (let i = 0; i < n; i++, o += 3) {
      pos[o] = -half + i * step;
      pos[o + 1] = half - j * step;
    }
  }
  const index = new Uint32Array(seg * seg * 6);
  for (let j = 0, o = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++, o += 6) {
      const a = j * n + i, b = a + n, c = b + 1, d = a + 1;
      index[o] = a; index[o + 1] = b; index[o + 2] = d;
      index[o + 3] = b; index[o + 4] = c; index[o + 5] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}

interface Label { el: HTMLDivElement; kind: 'site' | 'body'; w: number; rank: number }

/** Stereographic map position (km) of a latitude/longitude near the south pole. */
function mapKm(lat: number, lon: number): [number, number] {
  const rho = 2 * MOON_RADIUS_KM * Math.tan(((90 + lat) * DEG) / 2);
  return [rho * Math.sin(lon * DEG), rho * Math.cos(lon * DEG)];
}

/** Moon-fixed direction -> direction in polar map space (x = 90E, y = 0E, z = up) at a map point. */
function localDirection(xKm: number, yKm: number, d: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const rho = Math.max(Math.hypot(xKm, yKm), 1e-4);
  const colat = 2 * Math.atan(rho / (2 * MOON_RADIUS_KM));
  const lon = Math.atan2(xKm, yKm);
  const sl = -Math.cos(colat), cl = Math.sin(colat);
  const ux = cl * Math.cos(lon), uy = cl * Math.sin(lon), uz = sl;
  const ex = -Math.sin(lon), ey = Math.cos(lon);
  // north = up x east
  const nx = uy * 0 - uz * ey, ny = uz * ex - ux * 0, nz = ux * ey - uy * ex;
  const sE = d.x * ex + d.y * ey, sN = d.x * nx + d.y * ny + d.z * nz, sU = d.x * ux + d.y * uy + d.z * uz;
  return out.set(sE * Math.cos(lon) + sN * Math.sin(lon), -sE * Math.sin(lon) + sN * Math.cos(lon), sU);
}

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.07, 'rgba(255,244,214,1)');
  grad.addColorStop(0.1, 'rgba(255,196,84,0.55)');
  grad.addColorStop(0.3, 'rgba(255,170,40,0.14)');
  grad.addColorStop(1, 'rgba(255,170,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeArrow(color: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), mat);
  shaft.name = 'shaft';
  const tip = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 14), mat);
  tip.name = 'tip';
  g.add(shaft, tip);
  return g;
}

/** Camera offset that frames the whole polar map (map units: 100 km). */
const POLE_OVERVIEW = new THREE.Vector3(0.25, -2.7, 2.1);
/** Half-width of the polar map in map units, with a small margin: the orbit centre stays inside it. */
const POLE_LIMIT = 3.1;
const UP_Y = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
function placeArrow(g: THREE.Group, origin: THREE.Vector3, dir: THREE.Vector3, length: number, radius: number): void {
  const q = new THREE.Quaternion().setFromUnitVectors(UP_Y, dir);
  const shaft = g.getObjectByName('shaft')!, tip = g.getObjectByName('tip')!;
  const tipLen = radius * 7;
  shaft.scale.set(radius, Math.max(1e-4, length - tipLen), radius);
  shaft.position.copy(origin).addScaledVector(dir, (length - tipLen) / 2);
  shaft.quaternion.copy(q);
  tip.scale.set(radius * 2.6, tipLen, radius * 2.6);
  tip.position.copy(origin).addScaledVector(dir, length - tipLen / 2);
  tip.quaternion.copy(q);
}

export class MoonScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 1, 0.01, 8000);
  private controls: OrbitControls;
  private globeGroup = new THREE.Group();
  private poleGroup = new THREE.Group();
  private mode: SceneMode = 'globe';
  private saved: Record<SceneMode, { pos: THREE.Vector3; target: THREE.Vector3 } | null> = { globe: null, pole: null };

  private globeMat: THREE.ShaderMaterial;
  private earthMesh: THREE.Mesh;
  private earthMat: THREE.ShaderMaterial;
  private sunSprite: THREE.Sprite;
  private globeMarkers: THREE.Points;
  private poleMarkers: THREE.Points;
  private markerMat: THREE.ShaderMaterial;
  private sunArrow = makeArrow(SUN_COLOR);
  private earthArrow = makeArrow(EARTH_COLOR);

  private terrainMat: THREE.ShaderMaterial | null = null;
  private shadowMat: THREE.ShaderMaterial | null = null;
  private shadowRT: THREE.WebGLRenderTarget | null = null;
  private accumRT: THREE.WebGLRenderTarget | null = null;
  private copyMat: THREE.ShaderMaterial | null = null;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private dem: PolarDem | null = null;
  private spec: TerrainSpec = terrainSpec(0, 4096);
  private terrainMesh: THREE.Mesh | null = null;
  private heightTex: THREE.DataTexture | null = null;
  private termRing: THREE.Line;
  private earthRing: THREE.Line;
  private coarseRT: THREE.WebGLRenderTarget | null = null;
  private accumShadowRT: THREE.WebGLRenderTarget | null = null;
  private lastSun = new THREE.Vector3(9, 9, 9);
  private coarseSun = new THREE.Vector3(9, 9, 9);
  private band = 0;
  private bandsSinceJump = 0;
  private bandsSinceMove = 0;
  private fineReady = false;
  private accumQueue: THREE.Vector3[] = [];
  private accumTotal = 0;
  private accumActive = false;
  /** Called with 0..1 while a mission-average illumination map is being accumulated. */
  onAccumProgress: ((fraction: number) => void) | null = null;

  /** Shared by the globe and terrain materials: 1 = draw the coordinate grid. */
  private gridUniform = { value: 1 };
  private sunDir = new THREE.Vector3(1, 0, 0);
  private earthDir = new THREE.Vector3(1, 0, 0);
  private earthPos = new THREE.Vector3(221, 0, 0);
  private sites: SceneSite[] = [];
  private hoverId: string | null = null;
  private labels = new Map<string, Label>();
  private dirty = true;
  private raf = 0;
  private tween: { t0: number; dur: number; fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; spherical: boolean } | null = null;
  private width = 1;
  private height = 1;
  private down: { x: number; y: number } | null = null;
  private disposed = false;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  private canvas: HTMLCanvasElement;
  private overlay: HTMLElement;
  private gizmo: HTMLCanvasElement;
  private cb: SceneCallbacks;

  constructor(canvas: HTMLCanvasElement, overlay: HTMLElement, gizmo: HTMLCanvasElement, cb: SceneCallbacks, textureBase: string) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.gizmo = gizmo;
    this.cb = cb;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x05070b, 1);

    this.camera.up.set(0, 0, 1);
    this.camera.position.set(1.0, -1.3, -3.55);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.zoomSpeed = 0.9;
    // Blender-style: middle-drag orbits too, Shift+drag pans (where panning is enabled).
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    this.controls.addEventListener('start', () => { this.tween = null; });

    // --- Globe ---------------------------------------------------------------------------
    const loader = new THREE.TextureLoader();
    const prep = (t: THREE.Texture, srgb: boolean) => {
      t.wrapS = THREE.RepeatWrapping;
      t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      this.dirty = true;
      return t;
    };
    const grey = new THREE.DataTexture(new Uint8Array([120, 120, 124, 255]), 1, 1);
    grey.colorSpace = THREE.SRGBColorSpace;
    grey.needsUpdate = true;
    const flat = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
    flat.needsUpdate = true;
    this.globeMat = new THREE.ShaderMaterial({
      vertexShader: GLOBE_VERT,
      fragmentShader: GLOBE_FRAG,
      uniforms: {
        albedoMap: { value: grey }, normalMap: { value: flat }, hasNormal: { value: 0 },
        sunDir: { value: this.sunDir }, earthDir: { value: this.earthDir }, camPos: { value: this.camera.position },
        gridOn: this.gridUniform,
      },
    });
    // A small albedo map shows at once; the largest one this GPU can hold replaces it.
    const maxTex = this.renderer.capabilities.maxTextureSize;
    loader.load(`${textureBase}moon_albedo_1k.webp`, (lo) => {
      this.globeMat.uniforms.albedoMap.value = prep(lo, true);
      const use = (hi: THREE.Texture) => { this.globeMat.uniforms.albedoMap.value = prep(hi, true); lo.dispose(); };
      const load4k = () => loader.load(`${textureBase}moon_albedo_4k.webp`, use);
      if (maxTex >= 8192) loader.load(`${textureBase}moon_albedo_8k.webp`, use, undefined, load4k);
      else load4k();
    });
    // Relief normals at the native resolution of the LOLA 16 px/deg global grid.
    loader.load(`${textureBase}${maxTex >= 5760 ? 'moon_normal_6k.webp' : 'moon_normal_4k.webp'}`, (n) => {
      this.globeMat.uniforms.normalMap.value = prep(n, false);
      this.globeMat.uniforms.hasNormal.value = 1;
    });
    this.globeGroup.add(new THREE.Mesh(new THREE.SphereGeometry(1, 160, 80).rotateX(Math.PI / 2), this.globeMat));

    this.earthMat = new THREE.ShaderMaterial({ vertexShader: GLOBE_VERT, fragmentShader: EARTH_FRAG, uniforms: { sunDir: { value: this.sunDir } } });
    this.earthMesh = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS_KM / MOON_RADIUS_KM, 48, 24), this.earthMat);
    this.globeGroup.add(this.earthMesh);

    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
    this.sunSprite.scale.setScalar(330);
    this.globeGroup.add(this.sunSprite);

    const circle = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 361 }, (_, i) => new THREE.Vector3(Math.cos(i * DEG), Math.sin(i * DEG), 0)));
    const ringMat = (color: number) => new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 });
    this.termRing = new THREE.Line(circle, ringMat(SUN_COLOR));
    this.earthRing = new THREE.Line(circle, ringMat(EARTH_COLOR));
    this.globeGroup.add(this.termRing, this.earthRing);

    // Stars: deterministic so the sky does not reshuffle between sessions.
    {
      const n = 2600, pos = new Float32Array(n * 3);
      let seed = 1234567;
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      for (let i = 0; i < n; i++) {
        const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
        pos.set([r * Math.cos(a) * 6000, r * Math.sin(a) * 6000, z * 6000], i * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9fb2d6, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false }));
      stars.frustumCulled = false;
      this.globeGroup.add(stars);
    }

    this.markerMat = new THREE.ShaderMaterial({
      vertexShader: MARKER_VERT, fragmentShader: MARKER_FRAG, transparent: true, depthWrite: false,
      uniforms: { pixelRatio: { value: this.renderer.getPixelRatio() } },
    });
    this.globeMarkers = new THREE.Points(new THREE.BufferGeometry(), this.markerMat);
    this.poleMarkers = new THREE.Points(new THREE.BufferGeometry(), this.markerMat);
    this.globeMarkers.frustumCulled = this.poleMarkers.frustumCulled = false;
    this.globeMarkers.renderOrder = this.poleMarkers.renderOrder = 5;
    this.globeGroup.add(this.globeMarkers);
    this.poleGroup.add(this.poleMarkers);

    this.scene.add(this.globeGroup, this.poleGroup, this.sunArrow, this.earthArrow);
    this.poleGroup.visible = false;

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.applyMode();

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('dblclick', this.onDoubleClick);
    gizmo.addEventListener('click', this.onGizmoClick);
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

  /** Moon-fixed state record (see core/ephemeris.ts). */
  setBodies(state: Float64Array): void {
    this.sunDir.set(state[SUN], state[SUN + 1], state[SUN + 2]).normalize();
    this.earthPos.set(state[EARTH], state[EARTH + 1], state[EARTH + 2]).divideScalar(MOON_RADIUS_KM);
    this.earthDir.copy(this.earthPos).normalize();
    this.earthMesh.position.copy(this.earthPos);
    this.sunSprite.position.copy(this.sunDir).multiplyScalar(3500);
    // Terminator: where the Sun's centre is on the ideal horizon. Earth limit: the same for
    // Earth's centre, a small circle shifted toward Earth by the lunar parallax (1 / distance).
    const place = (ring: THREE.Line, dir: THREE.Vector3, cosOffset: number) => {
      const r = Math.sqrt(1 - cosOffset * cosOffset) * 1.0025;
      ring.quaternion.setFromUnitVectors(Z_AXIS, dir);
      ring.scale.set(r, r, 1);
      ring.position.copy(dir).multiplyScalar(cosOffset * 1.0025);
    };
    place(this.termRing, this.sunDir, 0);
    place(this.earthRing, this.earthDir, 1 / this.earthPos.length());
    this.updateArrows();
    this.dirty = true;
  }

  setSites(sites: SceneSite[]): void {
    this.sites = sites;
    this.rebuildMarkers();
    this.updateArrows();
    this.syncLabels();
    this.dirty = true;
  }

  setMode(mode: SceneMode): void {
    if (mode === this.mode) return;
    this.saved[this.mode] = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
    this.mode = mode;
    this.tween = null;
    this.applyMode();
  }

  get currentMode(): SceneMode {
    return this.mode;
  }

  /** Installs (or replaces) the south-polar elevation grid shown in the terrain view. */
  setPolarDem(dem: PolarDem): void {
    if (this.dem === dem) return;
    this.disposeTerrain();
    this.dem = dem;
    this.buildTerrain(dem);
    this.rebuildMarkers();
    this.updateArrows();
    this.dirty = true;
  }

  /** Largest square texture this GPU accepts: decides which terrain grids can be shown. */
  get maxTextureSize(): number {
    return this.renderer.capabilities.maxTextureSize;
  }

  /** Shows or hides the day/night terminator and the Earth-visibility limit on the globe. */
  setLimits(on: boolean): void {
    this.termRing.visible = this.earthRing.visible = on;
    this.dirty = true;
  }

  /** Looks straight down at the polar map: a 2D map view. */
  topDown(): void {
    if (this.mode !== 'pole') return;
    const toTarget = this.controls.target.clone();
    toTarget.x = Math.max(-POLE_LIMIT, Math.min(POLE_LIMIT, toTarget.x));
    toTarget.y = Math.max(-POLE_LIMIT, Math.min(POLE_LIMIT, toTarget.y));
    const dist = Math.min(8, Math.max(1.2, this.camera.position.distanceTo(this.controls.target)));
    const toPos = toTarget.clone().add(new THREE.Vector3(0, -dist * 0.004, dist));
    this.tween = { t0: performance.now(), dur: 650, fromPos: this.camera.position.clone(), toPos, fromTarget: this.controls.target.clone(), toTarget, spherical: false };
  }

  /** Smoothly brings a site to the centre of the view. */
  focus(site: SceneSite, immediate = false): void {
    let toPos: THREE.Vector3, toTarget: THREE.Vector3;
    if (this.mode === 'globe') {
      const n = this.siteNormal(site, new THREE.Vector3());
      const e = new THREE.Vector3(Math.cos(site.lon * DEG), Math.sin(site.lon * DEG), 0);
      const tangent = e.addScaledVector(n, -e.dot(n));
      if (tangent.lengthSq() > 1e-6) n.addScaledVector(tangent.normalize(), 0.36).normalize();
      const dist = Math.min(Math.max(this.camera.position.length(), 2.4), 3.9);
      toPos = n.multiplyScalar(dist);
      toTarget = new THREE.Vector3();
    } else {
      const offset = this.camera.position.clone().sub(this.controls.target);
      if (this.inPolarMap(site)) {
        toTarget = this.sitePolePosition(site, new THREE.Vector3());
        if (offset.length() > 2.4) offset.setLength(2.4);
      } else {
        // The site is not on this map (it lies north of 80 S): show the whole polar cap
        // instead of aiming at a point thousands of kilometres off the edge.
        toTarget = new THREE.Vector3();
        offset.copy(POLE_OVERVIEW);
      }
      toPos = toTarget.clone().add(offset);
    }
    if (immediate) {
      this.camera.position.copy(toPos);
      this.controls.target.copy(toTarget);
      this.dirty = true;
      return;
    }
    this.tween = { t0: performance.now(), dur: 750, fromPos: this.camera.position.clone(), toPos, fromTarget: this.controls.target.clone(), toTarget, spherical: this.mode === 'globe' };
  }

  /**
   * Shows the fraction of time each terrain cell is sunlit across a set of Sun directions
   * (polar view). Pass null to return to live shadows.
   */
  setAccumulation(sunDirections: THREE.Vector3[] | null): void {
    if (!sunDirections || !this.terrainMat || !this.accumRT) {
      this.accumActive = false;
      this.accumQueue = [];
      if (this.terrainMat && this.shadowRT && this.coarseRT) {
        this.terrainMat.uniforms.shadowMap.value = (this.fineReady ? this.shadowRT : this.coarseRT).texture;
        this.terrainMat.uniforms.accumulate.value = 0;
      }
      this.dirty = true;
      return;
    }
    this.accumQueue = sunDirections.slice();
    this.accumTotal = sunDirections.length;
    this.accumActive = true;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.accumRT);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.setClearColor(0x05070b, 1);
    this.renderer.setRenderTarget(prev);
    this.dirty = true;
  }

  /** Shows or hides the latitude/longitude grid in both views. */
  setGrid(on: boolean): void {
    this.gridUniform.value = on ? 1 : 0;
    this.dirty = true;
  }

  get supportsAccumulation(): boolean {
    return !!this.accumRT;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('dblclick', this.onDoubleClick);
    this.gizmo.removeEventListener('click', this.onGizmoClick);
    this.controls.dispose();
    for (const l of this.labels.values()) l.el.remove();
    this.labels.clear();
    this.shadowRT?.dispose();
    this.coarseRT?.dispose();
    this.accumShadowRT?.dispose();
    this.accumRT?.dispose();
    this.renderer.dispose();
  }

  // -------------------------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------------------------
  private applyMode(): void {
    const globe = this.mode === 'globe';
    this.globeGroup.visible = globe;
    this.poleGroup.visible = !globe;
    this.controls.enablePan = !globe;
    this.controls.minDistance = globe ? 1.2 : 0.12;
    this.controls.maxDistance = globe ? 9 : 10;
    this.controls.maxPolarAngle = globe ? Math.PI : Math.PI * 0.49;
    // Restore this view's last camera (for its viewing angle and zoom), unless it was left
    // somewhere unusable.
    const s = this.saved[this.mode];
    const usable = !!s && (globe || (Math.abs(s.target.x) <= POLE_LIMIT && Math.abs(s.target.y) <= POLE_LIMIT));
    if (s && usable) {
      this.camera.position.copy(s.pos);
      this.controls.target.copy(s.target);
    } else if (globe) {
      this.camera.position.set(1.0, -1.3, -3.55);
      this.controls.target.set(0, 0, 0);
    } else {
      this.controls.target.set(0, 0, 0);
      this.camera.position.copy(POLE_OVERVIEW);
    }
    // Then centre on whatever is selected now: the selection may have changed in the other view.
    const sel = this.sites.find((x) => x.role === 'selected');
    if (sel) this.focus(sel, true);
    this.updateArrows();
    this.syncLabels();
    this.dirty = true;
  }

  private siteNormal(site: SceneSite, out: THREE.Vector3): THREE.Vector3 {
    const lat = site.lat * DEG, lon = site.lon * DEG;
    return out.set(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
  }

  private sitePolePosition(site: SceneSite, out: THREE.Vector3): THREE.Vector3 {
    const [x, y] = mapKm(site.lat, site.lon);
    return out.set(x / 100, y / 100, ((site.groundHeightM / 1000) * EXAGGERATION) / 100);
  }

  private inPolarMap(site: SceneSite): boolean {
    return site.lat < -80.2;
  }

  private rebuildMarkers(): void {
    const build = (points: THREE.Points, sites: SceneSite[], place: (s: SceneSite, v: THREE.Vector3) => void) => {
      const n = sites.length;
      const pos = new Float32Array(n * 3), size = new Float32Array(n), tint = new Float32Array(n * 3), ring = new Float32Array(n);
      const c = new THREE.Color(), v = new THREE.Vector3();
      // Draw the selected site last so it sits on top.
      const order = [...sites].sort((a, b) => (a.role === 'selected' ? 1 : 0) - (b.role === 'selected' ? 1 : 0));
      order.forEach((s, i) => {
        place(s, v);
        pos.set([v.x, v.y, v.z], i * 3);
        size[i] = s.role === 'selected' ? 30 : s.role === 'pinned' ? 17 : s.id === this.hoverId ? 17 : 12;
        ring[i] = s.role === 'selected' ? 1 : s.role === 'pinned' ? 2 : 0;
        c.set(s.role === 'other' ? (s.id === this.hoverId ? '#ffffff' : '#d8dde6') : s.color);
        tint.set([c.r, c.g, c.b], i * 3);
      });
      points.geometry.dispose();
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('size', new THREE.BufferAttribute(size, 1));
      g.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
      g.setAttribute('ring', new THREE.BufferAttribute(ring, 1));
      points.geometry = g;
    };
    build(this.globeMarkers, this.sites, (s, v) => this.siteNormal(s, v).multiplyScalar(1.003));
    build(this.poleMarkers, this.sites.filter((s) => this.inPolarMap(s)), (s, v) => { this.sitePolePosition(s, v); v.z += 0.004; });
  }

  private updateArrows(): void {
    const sel = this.sites.find((s) => s.role === 'selected');
    const show = !!sel && (this.mode === 'globe' || (this.inPolarMap(sel) && !!this.dem));
    this.sunArrow.visible = this.earthArrow.visible = show;
    if (!sel || !show) return;
    if (this.mode === 'globe') {
      const origin = this.siteNormal(sel, new THREE.Vector3());
      const toEarth = this.tmp.copy(this.earthPos).sub(origin).normalize();
      origin.multiplyScalar(1.002);
      placeArrow(this.sunArrow, origin, this.sunDir, 0.34, 0.0032);
      placeArrow(this.earthArrow, origin, toEarth, 0.34, 0.0032);
    } else {
      const origin = this.sitePolePosition(sel, new THREE.Vector3());
      const [x, y] = mapKm(sel.lat, sel.lon);
      const s = localDirection(x, y, this.sunDir, new THREE.Vector3());
      s.z *= EXAGGERATION;
      const e = localDirection(x, y, this.earthDir, new THREE.Vector3());
      e.z *= EXAGGERATION;
      origin.z += 0.006;
      placeArrow(this.sunArrow, origin, s.normalize(), 0.42, 0.0045);
      placeArrow(this.earthArrow, origin, e.normalize(), 0.42, 0.0045);
    }
  }

  private disposeTerrain(): void {
    if (this.terrainMesh) {
      this.poleGroup.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      this.terrainMesh = null;
    }
    this.heightTex?.dispose();
    this.heightTex = null;
    for (const rt of [this.shadowRT, this.coarseRT, this.accumShadowRT, this.accumRT]) rt?.dispose();
    this.shadowRT = this.coarseRT = this.accumShadowRT = this.accumRT = null;
    for (const m of [this.terrainMat, this.shadowMat, this.copyMat]) m?.dispose();
    this.terrainMat = this.shadowMat = this.copyMat = null;
    this.accumActive = false;
    this.accumQueue = [];
    this.fineReady = false;
    this.band = this.bandsSinceJump = this.bandsSinceMove = 0;
    this.lastSun.set(9, 9, 9);
  }

  private buildTerrain(dem: PolarDem): void {
    const n = dem.size;
    const halfKm = (n * dem.metersPerPixel) / 2000;
    const texelKm = dem.metersPerPixel / 1000;
    const spec = terrainSpec(n, this.renderer.capabilities.maxTextureSize);
    this.spec = spec;
    // Level 0 in km, then a max-filtered mip chain for the shadow march.
    const levels: { data: Float32Array; width: number; height: number }[] = [];
    const base = new Float32Array(n * n);
    const src = dem.data, scale = dem.scale / 1000;
    for (let i = 0; i < base.length; i++) base[i] = src[i] * scale;
    levels.push({ data: base, width: n, height: n });
    while (levels.length < 9 && levels[levels.length - 1].width > 8) {
      const p = levels[levels.length - 1];
      const w = Math.floor(p.width / 2), h = Math.floor(p.height / 2);
      const d = new Float32Array(w * h);
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const o = 2 * j * p.width + 2 * i;
          d[j * w + i] = Math.max(p.data[o], p.data[o + 1], p.data[o + p.width], p.data[o + p.width + 1]);
        }
      }
      levels.push({ data: d, width: w, height: h });
    }
    const floatLinear = this.renderer.extensions.has('OES_texture_float_linear');
    let tex: THREE.DataTexture;
    if (floatLinear) {
      tex = new THREE.DataTexture(base, n, n, THREE.RedFormat, THREE.FloatType);
      tex.mipmaps = levels as unknown as typeof tex.mipmaps;
    } else {
      const half = (a: Float32Array) => { const o = new Uint16Array(a.length); for (let i = 0; i < a.length; i++) o[i] = THREE.DataUtils.toHalfFloat(a[i]); return o; };
      tex = new THREE.DataTexture(half(base), n, n, THREE.RedFormat, THREE.HalfFloatType);
      tex.mipmaps = levels.map((l) => ({ data: half(l.data), width: l.width, height: l.height })) as unknown as typeof tex.mipmaps;
    }
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearMipmapNearestFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.heightTex = tex;

    const rtOpts = { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.shadowRT = new THREE.WebGLRenderTarget(spec.shadow, spec.shadow, rtOpts);
    this.coarseRT = new THREE.WebGLRenderTarget(SHADOW_COARSE_SIZE, SHADOW_COARSE_SIZE, rtOpts);
    if (this.renderer.extensions.has('EXT_color_buffer_float') || this.renderer.extensions.has('EXT_color_buffer_half_float')) {
      this.accumShadowRT = new THREE.WebGLRenderTarget(spec.accum, spec.accum, rtOpts);
      this.accumRT = new THREE.WebGLRenderTarget(spec.accum, spec.accum, { ...rtOpts, type: THREE.HalfFloatType });
    }
    const shared = { heightMap: { value: tex }, sunDir: { value: this.sunDir }, halfKm: { value: halfKm }, texelKm: { value: texelKm } };
    this.shadowMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT, fragmentShader: SHADOW_FRAG, depthTest: false, depthWrite: false,
      uniforms: { ...shared, sunDir: { value: new THREE.Vector3(1, 0, 0) }, observerKm: { value: 0.002 } },
    });
    this.copyMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT, fragmentShader: COPY_FRAG, depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      uniforms: { src: { value: (this.accumShadowRT ?? this.shadowRT).texture }, weight: { value: 1 } },
    });
    this.terrainMat = new THREE.ShaderMaterial({
      vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG,
      uniforms: { ...shared, shadowMap: { value: this.shadowRT.texture }, exaggeration: { value: EXAGGERATION }, accumulate: { value: 0 }, gridOn: this.gridUniform },
    });
    const mesh = new THREE.Mesh(gridGeometry((2 * halfKm) / 100, spec.seg), this.terrainMat);
    mesh.frustumCulled = false;
    this.terrainMesh = mesh;
    this.poleGroup.add(mesh);
  }

  /** Marches the shadow shader into a target: the whole map, or one horizontal band of it. */
  private renderShadow(target: THREE.WebGLRenderTarget, dir: THREE.Vector3, band = -1): void {
    if (!this.shadowMat) return;
    (this.shadowMat.uniforms.sunDir.value as THREE.Vector3).copy(dir);
    this.quad.material = this.shadowMat;
    if (band >= 0) {
      const h = Math.ceil(target.height / this.spec.bands);
      target.scissor.set(0, band * h, target.width, h);
      target.scissorTest = true;
    } else {
      target.scissorTest = false;
    }
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
    this.renderer.setRenderTarget(prev);
  }

  /**
   * Keeps the terrain shadows in step with the Sun at a bounded cost per frame.
   *
   * A full march of the fine shadow map costs hundreds of millions of texture samples, too
   * many to repeat every frame. So the fine map is refreshed one thin band per frame: exact
   * whenever the Sun is still, and at most 1.5 degrees behind during slow playback. When the
   * Sun jumps or moves faster than that allows (a date change, scrubbing, fast playback) a
   * small coarse map is marched in full instead, and the fine map takes over again once a
   * complete cycle of bands has caught up.
   */
  private stepShadows(): void {
    if (this.mode !== 'pole' || !this.terrainMat || !this.shadowRT || !this.coarseRT) return;
    if (this.accumActive && this.accumRT && this.accumShadowRT && this.copyMat) {
      if (this.accumQueue.length) {
        // One reduced-resolution pass per frame keeps the view interactive while the map converges.
        this.renderShadow(this.accumShadowRT, this.accumQueue.pop()!);
        const autoClear = this.renderer.autoClear;
        this.renderer.autoClear = false;
        this.copyMat.uniforms.weight.value = 1 / this.accumTotal;
        this.quad.material = this.copyMat;
        this.renderer.setRenderTarget(this.accumRT);
        this.renderer.render(this.quadScene, this.quadCam);
        this.renderer.setRenderTarget(null);
        this.renderer.autoClear = autoClear;
        this.terrainMat.uniforms.shadowMap.value = this.accumRT.texture;
        this.terrainMat.uniforms.accumulate.value = 1;
        this.onAccumProgress?.(1 - this.accumQueue.length / this.accumTotal);
        this.dirty = true;
      }
      return;
    }

    const moved = this.lastSun.angleTo(this.sunDir);
    this.lastSun.copy(this.sunDir);
    const useMap = (rt: THREE.WebGLRenderTarget) => { this.terrainMat!.uniforms.shadowMap.value = rt.texture; };

    if (moved > this.spec.fastRad) {
      this.renderShadow(this.coarseRT, this.sunDir);
      this.coarseSun.copy(this.sunDir);
      useMap(this.coarseRT);
      this.fineReady = false;
      this.bandsSinceJump = 0;
      this.bandsSinceMove = 0;
      this.dirty = true; // start refining on the next frame even if the clock is paused
      return;
    }
    if (moved > 1e-7) this.bandsSinceMove = 0;
    if (this.fineReady && this.bandsSinceMove >= this.spec.bands) return; // fine map is exact

    this.renderShadow(this.shadowRT, this.sunDir, this.band);
    this.band = (this.band + 1) % this.spec.bands;
    this.bandsSinceJump++;
    this.bandsSinceMove++;
    if (!this.fineReady) {
      if (this.bandsSinceJump >= this.spec.bands) {
        this.fineReady = true;
        useMap(this.shadowRT);
      } else if (this.coarseSun.angleTo(this.sunDir) > 3.5e-4) {
        // Still showing the coarse map: keep it honest while the fine one catches up.
        this.renderShadow(this.coarseRT, this.sunDir);
        this.coarseSun.copy(this.sunDir);
      }
    }
    if (!this.fineReady || this.bandsSinceMove < this.spec.bands) this.dirty = true;
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.tween) {
      const tw = this.tween;
      const u = Math.min(1, (performance.now() - tw.t0) / tw.dur);
      const k = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      if (tw.spherical) {
        // Interpolate direction and distance separately so the camera arcs around the globe.
        const a = this.tmp.copy(tw.fromPos).normalize(), b = this.tmp2.copy(tw.toPos).normalize();
        const ang = a.angleTo(b);
        const dist = tw.fromPos.length() + (tw.toPos.length() - tw.fromPos.length()) * k;
        if (ang > 1e-4) {
          const s = Math.sin(ang);
          a.multiplyScalar(Math.sin((1 - k) * ang) / s).addScaledVector(b, Math.sin(k * ang) / s);
        }
        this.camera.position.copy(a.normalize().multiplyScalar(dist));
      } else {
        this.camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
      }
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
      if (u >= 1) this.tween = null;
      this.dirty = true;
    }
    if (this.mode === 'globe') {
      const d = this.camera.position.length();
      this.controls.rotateSpeed = Math.min(0.75, Math.max(0.06, (d - 1) * 0.42));
    } else {
      this.controls.rotateSpeed = 0.6;
      // Panning cannot carry the view off the map: slide the camera back with its target.
      const t = this.controls.target;
      const cx = Math.max(-POLE_LIMIT, Math.min(POLE_LIMIT, t.x)), cy = Math.max(-POLE_LIMIT, Math.min(POLE_LIMIT, t.y));
      if (cx !== t.x || cy !== t.y) {
        this.camera.position.x += cx - t.x;
        this.camera.position.y += cy - t.y;
        t.x = cx;
        t.y = cy;
      }
    }
    const moved = this.controls.update();
    if (this.accumActive && this.accumQueue.length) this.dirty = true;
    if (!moved && !this.dirty) return;
    this.dirty = false;
    this.stepShadows();
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
    this.drawGizmo();
  };

  // --- Labels -----------------------------------------------------------------------------
  private syncLabels(): void {
    const want: { id: string; text: string; kind: 'site' | 'body'; cls: string; color?: string; rank: number }[] = [];
    if (this.mode === 'globe' || this.mode === 'pole') {
      for (const s of this.sites) {
        if (s.role === 'other' && s.id !== this.hoverId) continue;
        if (this.mode === 'pole' && !this.inPolarMap(s)) continue;
        want.push({ id: s.id, text: s.name, kind: 'site', cls: s.role, color: s.role === 'other' ? undefined : s.color, rank: s.role === 'selected' ? 0 : s.role === 'pinned' ? 1 : 2 });
      }
    }
    if (this.mode === 'globe') {
      want.push({ id: '__sun', text: 'Sun', kind: 'body', cls: 'sun', rank: 3 });
      want.push({ id: '__earth', text: 'Earth', kind: 'body', cls: 'earth', rank: 3 });
    }
    want.sort((a, b) => a.rank - b.rank);
    const old = this.labels;
    // Rebuild in priority order (Map iteration order = placement order in updateLabels).
    this.labels = new Map();
    for (const w of want) {
      let l = old.get(w.id);
      if (!l) {
        l = { el: document.createElement('div'), kind: w.kind, w: 0, rank: w.rank };
        this.overlay.appendChild(l.el);
      }
      old.delete(w.id);
      const cls = `scene-label ${w.cls}`;
      if (l.el.className !== cls || l.el.textContent !== w.text) l.w = 0;
      l.el.className = cls;
      l.el.textContent = w.text;
      l.el.style.setProperty('--c', w.color ?? '');
      l.rank = w.rank;
      this.labels.set(w.id, l);
    }
    for (const l of old.values()) l.el.remove();
    this.dirty = true;
  }

  private updateLabels(): void {
    const v = this.tmp, cam = this.camera.position;
    // Higher-priority labels are placed first; later ones step aside if they would overlap.
    const placed: { x: number; y: number; w: number }[] = [];
    const H = 19;
    for (const [id, l] of this.labels) {
      let visible = true;
      if (id === '__sun') v.copy(this.sunSprite.position);
      else if (id === '__earth') v.copy(this.earthPos);
      else {
        const s = this.sites.find((x) => x.id === id);
        if (!s) continue;
        if (this.mode === 'globe') {
          this.siteNormal(s, v);
          visible = this.tmp2.copy(cam).sub(v).dot(v) > 0.02;
        } else {
          this.sitePolePosition(s, v);
        }
      }
      if (l.kind === 'body' && this.mode === 'globe') {
        // Hidden when the Moon is in the way: closest approach of the sight line to the centre.
        const dir = this.tmp2.copy(v).sub(cam).normalize();
        const along = -cam.dot(dir);
        if (along > 0 && cam.lengthSq() - along * along < 1) visible = false;
      }
      v.project(this.camera);
      if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) visible = false;
      l.el.style.display = visible ? '' : 'none';
      if (!visible) continue;
      if (!l.w) l.w = l.el.offsetWidth || 60;
      const px = (v.x * 0.5 + 0.5) * this.width, py = (-v.y * 0.5 + 0.5) * this.height;
      let x = l.kind === 'body' ? px - l.w / 2 : px + (l.rank === 0 ? 20 : 13);
      let y = l.kind === 'body' ? py - 34 : py - 15;
      const hits = (yy: number) => placed.some((p) => x < p.x + p.w + 4 && x + l.w + 4 > p.x && Math.abs(yy - p.y) < H);
      if (hits(y)) {
        for (const dy of [H, -H, 2 * H, -2 * H, 3 * H, -3 * H]) {
          if (!hits(y + dy)) { y += dy; break; }
        }
      }
      x = Math.max(4, Math.min(this.width - l.w - 4, x));
      placed.push({ x, y, w: l.w });
      l.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }

  // --- Axis gizmo (Blender-style) -------------------------------------------------------------
  private gizmoAxes(): { label: string; color: string; v: THREE.Vector3; positive: boolean }[] {
    const g = this.mode === 'globe';
    return [
      { label: 'X', color: '#ff5d73', v: new THREE.Vector3(1, 0, 0), positive: true },
      { label: 'Y', color: '#3ddc97', v: new THREE.Vector3(0, 1, 0), positive: true },
      { label: g ? 'N' : 'Z', color: '#4cc2ff', v: new THREE.Vector3(0, 0, 1), positive: true },
      { label: '', color: '#ff5d73', v: new THREE.Vector3(-1, 0, 0), positive: false },
      { label: '', color: '#3ddc97', v: new THREE.Vector3(0, -1, 0), positive: false },
      { label: g ? 'S' : '', color: '#4cc2ff', v: new THREE.Vector3(0, 0, -1), positive: false },
    ];
  }

  private gizmoProjected(): { label: string; color: string; x: number; y: number; z: number; positive: boolean; v: THREE.Vector3 }[] {
    const size = this.gizmo.clientWidth || 84;
    const r = size / 2 - 13;
    const inv = this.camera.matrixWorldInverse;
    return this.gizmoAxes().map((a) => {
      const p = a.v.clone().transformDirection(inv);
      return { ...a, x: size / 2 + p.x * r, y: size / 2 - p.y * r, z: p.z };
    });
  }

  private drawGizmo(): void {
    const c = this.gizmo;
    const size = c.clientWidth || 84;
    const dpr = Math.min(window.devicePixelRatio, 2);
    if (c.width !== size * dpr) { c.width = size * dpr; c.height = size * dpr; }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    const pts = this.gizmoProjected().sort((a, b) => a.z - b.z);
    for (const p of pts) {
      const fade = 0.55 + 0.45 * ((p.z + 1) / 2);
      g.globalAlpha = fade;
      if (p.positive) {
        g.strokeStyle = p.color;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(size / 2, size / 2);
        g.lineTo(p.x, p.y);
        g.stroke();
      }
      g.beginPath();
      g.arc(p.x, p.y, p.positive ? 8.5 : 6, 0, Math.PI * 2);
      if (p.positive) {
        g.fillStyle = p.color;
        g.fill();
      } else {
        g.fillStyle = '#0e131b';
        g.fill();
        g.strokeStyle = p.color;
        g.lineWidth = 1.5;
        g.stroke();
      }
      if (p.label) {
        g.fillStyle = p.positive ? '#0a0d13' : p.color;
        g.font = '700 10px "Titillium Web", system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(p.label, p.x, p.y + 0.5);
      }
    }
    g.globalAlpha = 1;
  }

  private onGizmoClick = (ev: MouseEvent): void => {
    const rect = this.gizmo.getBoundingClientRect();
    const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    const hit = this.gizmoProjected().sort((a, b) => b.z - a.z).find((p) => Math.hypot(p.x - x, p.y - y) < 10);
    if (!hit) return;
    const dist = this.camera.position.distanceTo(this.controls.target);
    const dir = hit.v.clone();
    // Looking exactly along the up axis is degenerate for an orbit camera: lean a hair off it.
    if (Math.abs(dir.z) > 0.99) dir.set(0, -0.02, dir.z).normalize();
    if (this.mode === 'pole' && dir.z < 0.05) dir.z = 0.12;
    const toPos = this.controls.target.clone().addScaledVector(dir.normalize(), dist);
    this.tween = { t0: performance.now(), dur: 600, fromPos: this.camera.position.clone(), toPos, fromTarget: this.controls.target.clone(), toTarget: this.controls.target.clone(), spherical: this.mode === 'globe' };
  };

  // --- Pointer interaction ----------------------------------------------------------------
  private siteAt(clientX: number, clientY: number): SceneSite | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    let best: SceneSite | null = null, bestD = 13;
    const v = this.tmp, cam = this.camera.position;
    for (const s of this.sites) {
      if (this.mode === 'globe') {
        this.siteNormal(s, v);
        if (this.tmp2.copy(cam).sub(v).dot(v) <= 0) continue;
      } else {
        if (!this.inPolarMap(s)) continue;
        this.sitePolePosition(s, v);
      }
      v.project(this.camera);
      if (v.z > 1) continue;
      const d = Math.hypot((v.x * 0.5 + 0.5) * this.width - x, (-v.y * 0.5 + 0.5) * this.height - y);
      const bias = s.role === 'selected' ? 3 : 0;
      if (d - bias < bestD) { bestD = d - bias; best = s; }
    }
    return best;
  }

  /** Latitude/longitude under a screen point, or null if the pointer is off the surface. */
  private surfaceAt(clientX: number, clientY: number): { lat: number; lon: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    if (this.mode === 'globe') {
      const b = o.dot(d), c = o.lengthSq() - 1, disc = b * b - c;
      if (disc < 0) return null;
      const t = -b - Math.sqrt(disc);
      if (t < 0) return null;
      const p = o.clone().addScaledVector(d, t);
      return { lat: Math.asin(Math.max(-1, Math.min(1, p.z))) * RAD, lon: Math.atan2(p.y, p.x) * RAD };
    }
    if (!this.dem || Math.abs(d.z) < 1e-6) return null;
    // Intersect the height field: start on the z = 0 plane and refine against the terrain.
    let z = 0, x = 0, y = 0;
    for (let k = 0; k < 6; k++) {
      const t = (z - o.z) / d.z;
      if (t < 0) return null;
      x = (o.x + d.x * t) * 100;
      y = (o.y + d.y * t) * 100;
      const half = this.dem.size / 2, px = this.dem.metersPerPixel / 1000;
      const h = this.dem.heightAtPixel(x / px + half - 0.5, half - 0.5 - y / px);
      if (!Number.isFinite(h)) return null;
      z = ((h / 1000) * EXAGGERATION) / 100;
    }
    const rho = Math.hypot(x, y);
    return { lat: -90 + 2 * Math.atan(rho / (2 * MOON_RADIUS_KM)) * RAD, lon: Math.atan2(x, y) * RAD };
  }

  private onPointerDown = (ev: PointerEvent): void => {
    this.down = { x: ev.clientX, y: ev.clientY };
  };

  private onPointerMove = (ev: PointerEvent): void => {
    if (ev.buttons) return;
    const s = this.siteAt(ev.clientX, ev.clientY);
    const id = s?.id ?? null;
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.canvas.style.cursor = id ? 'pointer' : '';
      this.cb.onHover(id);
      this.rebuildMarkers();
      this.syncLabels();
    }
  };

  private onPointerUp = (ev: PointerEvent): void => {
    const d = this.down;
    this.down = null;
    if (!d || Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 4 || ev.button !== 0) return;
    const s = this.siteAt(ev.clientX, ev.clientY);
    if (s) this.cb.onSelect(s.id);
  };

  private onPointerLeave = (): void => {
    if (this.hoverId) {
      this.hoverId = null;
      this.cb.onHover(null);
      this.rebuildMarkers();
      this.syncLabels();
    }
  };

  private onDoubleClick = (ev: MouseEvent): void => {
    if (this.siteAt(ev.clientX, ev.clientY)) return;
    const p = this.surfaceAt(ev.clientX, ev.clientY);
    if (p) this.cb.onPick(p.lat, p.lon);
  };
}
