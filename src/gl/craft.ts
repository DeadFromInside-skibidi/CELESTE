// Launch vehicles and spacecraft for the flight view.
//
// Two kinds of model, and the UI always says which one is on screen:
//   'nasa'   a model published by NASA (github.com/nasa/NASA-3D-Resources), loaded from
//            public/models and scaled to the real size of the hardware: Saturn V, Apollo Lunar
//            Module, Lunar Reconnaissance Orbiter, Clementine, LADEE;
//   'built'  built here from the vehicle's published dimensions (rockets.ts, spacecraft.ts):
//            the right size, proportions, staging and layout, without surface detail.
//
// Every model is in scene kilometres with its long axis along +Y (nose up) and its base at y = 0.
import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { M } from './parts.ts';
import { buildRocket, type Exhaust, vehicleFor } from './rockets.ts';
import { apolloCsm, designFor, NASA_LM } from './spacecraft.ts';

export type { Exhaust };
export type ModelSource = 'nasa' | 'built';

export interface Craft {
  object: THREE.Object3D;
  /** Longest dimension of what is on screen now, km. */
  lengthKm: number;
  /** Its extent along its own axis, km, when that is not the longest dimension (a satellite with wide solar wings). */
  heightKm?: number;
  source: ModelSource;
  /** What it is, for the HUD. */
  label: string;
}
export interface Launcher extends Craft {
  /** Height at which the spacecraft rides once the fairing is gone, km; null when the model includes it. */
  payloadY: number | null;
  /** Seconds after liftoff at which the payload fairing separates. */
  fairingDrop: number;
  /** Sets the vehicle to `t` seconds after liftoff. Returns the engines that are firing. */
  update(t: number, burn: boolean): Exhaust[];
  /** The stage doing the work at that moment. */
  stageName(t: number): string;
  /** NASA model only: re-aims the planes that cut away separated stages. Call once it is placed. */
  sync?(): void;
}
export interface Spacecraft extends Craft {
  /** 'surface' is what stands on the Moon after landing (the lander alone); 'cruise' is what flew there. */
  setMode(mode: 'cruise' | 'surface'): void;
  hasSurfaceModel: boolean;
  /** The surface model replaces the cruise one from the start of the descent, or only at rest. */
  surfaceFrom: 'descent' | 'surface';
}

// ---------------------------------------------------------------------------------------------
// NASA models
// ---------------------------------------------------------------------------------------------
let gltf: GLTFLoader | null = null;
const cache = new Map<string, Promise<THREE.Object3D>>();

function loadGlb(base: string, file: string): Promise<THREE.Object3D> {
  if (!gltf) {
    gltf = new GLTFLoader();
    gltf.setDRACOLoader(new DRACOLoader().setDecoderPath(`${base}draco/`));
  }
  let p = cache.get(file);
  if (!p) {
    p = gltf.loadAsync(`${base}models/${file}`).then((g) => g.scene);
    cache.set(file, p);
    p.catch(() => cache.delete(file));
  }
  return p.then((scene) => scene.clone(true));
}

/** Scales a loaded model so that `axis` spans `metres`, stands it on y = 0 and centres it. */
function fit(model: THREE.Object3D, metres: number, axis: 'x' | 'y' | 'max'): { object: THREE.Object3D; lengthKm: number; heightKm: number } {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
  const span = axis === 'max' ? Math.max(size.x, size.y, size.z) : size[axis];
  const k = (metres * M) / span;
  model.position.set(-centre.x, -box.min.y, -centre.z);
  const holder = new THREE.Group();
  holder.add(model);
  holder.scale.setScalar(k);
  return { object: holder, lengthKm: Math.max(size.x, size.y, size.z) * k, heightKm: size.y * k };
}

/** Wraps a model built in metres: base on y = 0, scaled to kilometres. */
function wrap(model: THREE.Object3D): { object: THREE.Object3D; lengthKm: number; heightKm: number } {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  model.position.y -= box.min.y;
  const holder = new THREE.Group();
  holder.add(model);
  holder.scale.setScalar(M);
  return { object: holder, lengthKm: Math.max(size.x, size.y, size.z) * M, heightKm: size.y * M };
}

/** Gives a model its own materials, cut by `planes` (world space). */
function clipBy(model: THREE.Object3D, planes: THREE.Plane[]): void {
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const own = (m: THREE.Material) => { const c = m.clone(); c.clippingPlanes = planes; c.side = THREE.DoubleSide; return c; };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
  });
}

/**
 * NASA's Saturn V is a single mesh, so its stages cannot be detached. They are cut away
 * instead: clipping planes hide what has separated, and a second copy of the model, clipped to
 * just that stage, falls behind.
 */
function saturnV(model: THREE.Object3D, copy: THREE.Object3D): Launcher {
  const H = 110.6, LES = 100.9; // m: overall height; base of the launch escape tower
  const STAGES = [
    { name: 'S-IC first stage', top: 42.1, drop: 162, engines: [[0, 0], [3.3, 3.3], [-3.3, 3.3], [3.3, -3.3], [-3.3, -3.3]], r: 1.85 },
    { name: 'S-II second stage', top: 67.0, drop: 520, engines: [[0, 0], [1.9, 1.9], [-1.9, 1.9], [1.9, -1.9], [-1.9, -1.9]], r: 1.0 },
    { name: 'S-IVB third stage', top: H, drop: Infinity, engines: [[0, 0]], r: 1.0 },
  ];
  const root = new THREE.Group(), main = new THREE.Group(), debris = new THREE.Group();
  const a = fit(model, H, 'y'), b = fit(copy, H, 'y');
  main.add(a.object);
  debris.add(b.object);
  root.add(main, debris);
  const planes = [new THREE.Plane(), new THREE.Plane(), new THREE.Plane(), new THREE.Plane()];
  const local = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Plane(new THREE.Vector3(0, -1, 0), H * M), new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)];
  clipBy(a.object, [planes[0], planes[1]]);
  clipBy(b.object, [planes[2], planes[3]]);
  const craft: Launcher = {
    object: root, lengthKm: H * M, source: 'nasa', label: 'Saturn V · NASA 3D model, 110.6 m', payloadY: null, fairingDrop: 195,
    stageName: (t) => (STAGES.find((s) => t < s.drop) ?? STAGES[2]).name,
    update(t, burn) {
      const i = STAGES.findIndex((s) => t < s.drop), stage = STAGES[i];
      const base = i === 0 ? 0 : STAGES[i - 1].top, top = t >= 195 ? LES : H;
      main.position.y = -base * M;
      local[0].constant = -base * M;
      local[1].constant = top * M;
      // The stage that has just gone.
      const gone = i > 0 ? STAGES[i - 1] : null, tau = gone ? t - gone.drop : -1;
      debris.visible = !!gone && tau < 45;
      if (gone && debris.visible) {
        debris.position.set(0.02 * tau * tau * M, (-base - 5 * tau - 0.9 * tau * tau) * M, 0);
        local[2].constant = -(i > 1 ? STAGES[i - 2].top : 0) * M;
        local[3].constant = gone.top * M;
      }
      craft.lengthKm = (top - base) * M;
      return burn && t >= 0 ? stage.engines.map(([x, z]) => ({ x: x * M, y: 0, z: z * M, r: stage.r * M })) : [];
    },
    sync() {
      root.updateWorldMatrix(true, true);
      planes[0].copy(local[0]).applyMatrix4(main.matrixWorld);
      planes[1].copy(local[1]).applyMatrix4(main.matrixWorld);
      planes[2].copy(local[2]).applyMatrix4(debris.matrixWorld);
      planes[3].copy(local[3]).applyMatrix4(debris.matrixWorld);
    },
  };
  craft.update(-1, false);
  return craft;
}

// ---------------------------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------------------------
/** The launch vehicle that stands on the pad and flies the ascent. */
export async function buildLauncher(vehicleClass: string, vehicleName: string, base: string): Promise<Launcher> {
  if (vehicleClass === 'saturn-v') {
    try {
      const [model, copy] = await Promise.all([loadGlb(base, 'saturn-v.glb'), loadGlb(base, 'saturn-v.glb')]);
      return saturnV(model, copy);
    } catch {
      // Model file unavailable: fall through to the version built from dimensions.
    }
  }
  const v = vehicleFor(vehicleName, vehicleClass);
  const r = buildRocket(v);
  const craft: Launcher = {
    object: r.object, lengthKm: r.lengthKm, source: 'built', label: `${v.name} · built to published dimensions, ${v.h} m`, payloadY: r.payloadY, fairingDrop: r.fairingDrop,
    stageName: r.stageName,
    update(t, burn) {
      const firing = r.update(t, burn);
      craft.lengthKm = r.lengthKm;
      craft.payloadY = r.payloadY;
      return firing;
    },
  };
  return craft;
}

/** The spacecraft that flies on to the Moon once the launch vehicle has done its job. */
export async function buildSpacecraft(m: { id: string; name: string; category: string; hasSurface: boolean }, base: string): Promise<Spacecraft> {
  const design = designFor(m);
  type Config = { object: THREE.Object3D; lengthKm: number; heightKm: number; source: ModelSource; label: string };
  let cruise: Config | null = null, surface: Config | null = null;

  if (design.apollo) {
    // Command and service module built to dimensions; NASA's lunar module docked nose to nose.
    const csm = wrap(apolloCsm());
    const g = new THREE.Group();
    g.add(csm.object);
    let length = csm.lengthKm, label = design.label;
    if (design.apollo.lm) {
      try {
        const lm = fit(await loadGlb(base, NASA_LM.file), NASA_LM.metres, NASA_LM.axis);
        const dock = new THREE.Group();
        dock.add(lm.object);
        dock.rotation.x = Math.PI;
        dock.position.y = csm.heightKm + lm.heightKm;
        g.add(dock);
        length = csm.heightKm + lm.heightKm;
        label = 'Apollo command and service module (built to dimensions) with the Lunar Module (NASA 3D model) docked';
        if (design.apollo.lands) {
          const alone = fit(await loadGlb(base, NASA_LM.file), NASA_LM.metres, NASA_LM.axis);
          surface = { object: alone.object, lengthKm: alone.lengthKm, heightKm: alone.heightKm, source: 'nasa', label: NASA_LM.label };
        }
      } catch {
        // Lunar module file unavailable: the command and service module flies alone.
      }
    }
    cruise = { object: g, lengthKm: length, heightKm: length, source: 'built', label };
  } else if (design.nasa) {
    try {
      const f = fit(await loadGlb(base, design.nasa.file), design.nasa.metres, design.nasa.axis);
      cruise = { object: f.object, lengthKm: f.lengthKm, heightKm: f.heightKm, source: 'nasa', label: design.nasa.label };
    } catch {
      // Model file unavailable: use the version built from dimensions below.
    }
  }
  if (!cruise) {
    const w = wrap(design.cruise());
    cruise = { object: w.object, lengthKm: w.lengthKm, heightKm: w.heightKm, source: 'built', label: `${design.label} · built to published dimensions` };
  }
  if (!surface && design.surface) {
    const w = wrap(design.surface());
    surface = { object: w.object, lengthKm: w.lengthKm, heightKm: w.heightKm, source: 'built', label: `${design.label} · built to published dimensions` };
  }

  const root = new THREE.Group();
  root.add(cruise.object);
  if (surface) root.add(surface.object);
  const craft: Spacecraft = {
    object: root, lengthKm: cruise.lengthKm, source: cruise.source, label: cruise.label, hasSurfaceModel: !!surface,
    surfaceFrom: /^luna-(9|13)$/.test(m.id) ? 'surface' : 'descent',
    setMode(mode) {
      const c = mode === 'surface' && surface ? surface : cruise!;
      cruise!.object.visible = c === cruise;
      if (surface) surface.object.visible = c === surface;
      craft.lengthKm = c.lengthKm;
      craft.heightKm = c.heightKm;
      craft.source = c.source;
      craft.label = c.label;
    },
  };
  craft.setMode('cruise');
  return craft;
}
