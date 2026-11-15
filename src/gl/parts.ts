// Building blocks for the launch vehicles and spacecraft that have no published 3D model and
// are therefore built here from their published dimensions. Everything is in metres with +Y
// up; the finished model is scaled to scene kilometres by its builder.
import * as THREE from 'three';

/** Metres -> scene kilometres. */
export const M = 0.001;

export const C = {
  white: 0xf0efe9,
  cream: 0xe3dfd0,
  lgrey: 0xc2c5c7,
  grey: 0x8f949b,
  dgrey: 0x4a4e55,
  black: 0x18191c,
  steel: 0xb9bec6,
  alu: 0xd2d5d8,
  foam: 0xc96a2a, // spray-on foam insulation
  copper: 0xa8683a,
  gold: 0xc8983a, // multilayer insulation
  kapton: 0x9a6a22,
  cell: 0x14234a, // solar cells
  teal: 0x2f8a96,
  sovgreen: 0x7c8571,
  red: 0xb23a2c,
  blue: 0x2c5fa8,
} as const;

const cache = new Map<string, THREE.MeshStandardMaterial>();
/** A shared material. `kind` picks the surface finish. */
export function mat(color: number, kind: 'paint' | 'metal' | 'foil' | 'matte' | 'cell' = 'paint'): THREE.MeshStandardMaterial {
  const key = `${color}|${kind}`;
  let m = cache.get(key);
  if (!m) {
    // The scene has no environment map, so strongly metallic surfaces would render almost black.
    const [roughness, metalness] = kind === 'metal' ? [0.38, 0.32] : kind === 'foil' ? [0.42, 0.28] : kind === 'matte' ? [0.9, 0] : kind === 'cell' ? [0.3, 0.3] : [0.55, 0.06];
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness, side: THREE.DoubleSide });
    cache.set(key, m);
  }
  return m;
}

/** Frustum with its base at height `y`: diameter `d1` at the bottom, `d2` at the top. */
export function tube(d1: number, d2: number, l: number, y: number, material: THREE.Material, seg = 40, open = false): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(d2 / 2, d1 / 2, l, seg, 1, open), material);
  m.position.y = y + l / 2;
  return m;
}

/** Surface of revolution from [radius, height] points. `half` builds one half-shell (for fairings). */
export function lathe(profile: [number, number][], material: THREE.Material, seg = 40, half: 0 | 1 | 2 = 0): THREE.Mesh {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y));
  const geo = half ? new THREE.LatheGeometry(pts, seg / 2, half === 1 ? 0 : Math.PI, Math.PI) : new THREE.LatheGeometry(pts, seg);
  return new THREE.Mesh(geo, material);
}

/** Profile of a tangent-ogive nose of base diameter `d` and length `l`, from height `y` up. */
export function ogiveProfile(d: number, l: number, y: number, blunt = 0.06, n = 14): [number, number][] {
  const r = d / 2, rho = (r * r + l * l) / (2 * r);
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * (1 - blunt), x = s * l;
    out.push([Math.sqrt(Math.max(0, rho * rho - x * x)) + r - rho, y + x]);
  }
  out.push([0, y + l * (1 - blunt * 0.6)]);
  return out;
}
export function ogive(d: number, l: number, y: number, material: THREE.Material, blunt = 0.06): THREE.Mesh {
  return lathe(ogiveProfile(d, l, y, blunt), material);
}

/** Engine nozzle: exit plane (diameter `d`) at height `y`, throat `l` above it. */
export function bell(d: number, l: number, y: number, material: THREE.Material = mat(C.dgrey, 'metal')): THREE.Mesh {
  // Wide at the exit, narrowing quickly toward the throat.
  const prof: [number, number][] = [];
  for (let i = 0; i <= 8; i++) { const s = i / 8; prof.push([(d / 2) * (1 - 0.78 * Math.pow(s, 0.55)), y + s * l]); }
  return lathe(prof, material, 20);
}

export function box(w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

export function ball(d: number, x: number, y: number, z: number, material: THREE.Material, squash = 1): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(d / 2, 24, 16), material);
  m.position.set(x, y, z);
  m.scale.y = squash;
  return m;
}

const UP = new THREE.Vector3(0, 1, 0);
/** A thin rod between two points. */
export function strut(ax: number, ay: number, az: number, bx: number, by: number, bz: number, d: number, material: THREE.Material): THREE.Mesh {
  const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, len, 6), material);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, b.sub(a).normalize());
  return m;
}

/** Open lattice between two rings (interstage trusses on Soviet launchers). */
export function truss(d1: number, d2: number, l: number, y: number, material: THREE.Material, n = 12): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const p = (a: number, r: number) => [Math.cos(a) * r, Math.sin(a) * r] as const;
    const [x0, z0] = p(a0, d1 / 2), [x1, z1] = p(a1, d2 / 2), [x2, z2] = p(a1, d1 / 2), [x3, z3] = p(a0, d2 / 2);
    g.add(strut(x0, y, z0, x1, y + l, z1, 0.07, material), strut(x2, y, z2, x3, y + l, z3, 0.07, material));
  }
  g.add(tube(d1, d1, 0.12, y, material, 32, true), tube(d2, d2, 0.12, y + l - 0.12, material, 32, true));
  return g;
}

/** Solar array: a flat panel in the X-Y plane, cells on both faces being close enough at this scale. */
export function panel(w: number, h: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, Math.max(0.015, Math.min(w, h) * 0.02)), mat(C.cell, 'cell'));
  m.position.set(x, y, z);
  return m;
}

/** Parabolic dish opening toward +Y, its rim at height `y`. */
export function dish(d: number, y = 0, material: THREE.Material = mat(C.white)): THREE.Group {
  const g = new THREE.Group();
  const depth = d * 0.18, pts: [number, number][] = [];
  for (let i = 0; i <= 8; i++) { const s = i / 8; pts.push([(d / 2) * s, y - depth + depth * s * s]); }
  g.add(lathe(pts, material, 28));
  g.add(strut(0, y - depth, 0, 0, y + d * 0.22, 0, d * 0.03, mat(C.grey, 'metal')));
  return g;
}

/** Shears a mesh sideways so that its top leans by `dx`, `dz` (slanted booster noses). */
export function lean(mesh: THREE.Mesh, y0: number, l: number, dx: number, dz: number): THREE.Mesh {
  const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const s = Math.max(0, (pos.getY(i) + mesh.position.y - y0) / l);
    pos.setX(i, pos.getX(i) + dx * s);
    pos.setZ(i, pos.getZ(i) + dz * s);
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  return mesh;
}

/** Landing legs: `n` struts from the body out to footpads on the ground (y = 0). */
export function legs(n: number, span: number, bodyR: number, top: number, material: THREE.Material, phase = Math.PI / 4): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + phase, c = Math.cos(a), s = Math.sin(a);
    const fx = c * span / 2, fz = s * span / 2;
    g.add(strut(c * bodyR, top, s * bodyR, fx, 0.06, fz, span * 0.022, material));
    g.add(strut(c * bodyR, top * 0.35, s * bodyR, fx, 0.06, fz, span * 0.016, material));
    g.add(tube(span * 0.09, span * 0.09, 0.05, 0, material, 12).translateX(fx).translateZ(fz));
  }
  return g;
}
