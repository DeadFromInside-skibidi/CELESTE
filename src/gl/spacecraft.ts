// Spacecraft built from published dimensions, for the lunar missions that have no NASA 3D
// model. Like the launch vehicles in rockets.ts these are dimensionally faithful models (overall
// size, body shape, number and span of solar arrays, antennas, legs), not replicas.
//
// Every builder works in metres with +Y up and the base at y = 0. A lander can have two
// configurations: `cruise` (what flies to the Moon) and `surface` (what is left standing there).
import * as THREE from 'three';
import { ball, bell, box, C, dish, lathe, legs, mat, panel, strut, tube } from './parts.ts';

export interface SpacecraftDesign {
  /** What is on screen, for the HUD. */
  label: string;
  /** A NASA model file to use instead, with the size to scale it to (m) and along which axis. */
  nasa?: { file: string; metres: number; axis: 'x' | 'y' | 'max'; label: string };
  /** Apollo: a command and service module, with the NASA lunar module docked to it when it flew. */
  apollo?: { lm: boolean; lands: boolean };
  cruise(): THREE.Group;
  surface?(): THREE.Group;
}

const G = () => new THREE.Group();
const foil = mat(C.gold, 'foil'), white = mat(C.white), alu = mat(C.alu, 'metal'), grey = mat(C.grey, 'metal'), dark = mat(C.dgrey, 'matte'), black = mat(C.black, 'matte');
/** Thin antenna or boom. */
const rod = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, d = 0.02) => strut(ax, ay, az, bx, by, bz, d, grey);
const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T => { o.position.set(x, y, z); return o; };
const tilt = <T extends THREE.Object3D>(o: T, rx: number, ry = 0, rz = 0): T => { o.rotation.set(rx, ry, rz); return o; };
/** A pair (or one) of solar wings along X, centred at height `y`. */
function wings(g: THREE.Group, n: 1 | 2, half: number, len: number, wid: number, y: number): void {
  for (const s of n === 2 ? [-1, 1] : [1]) {
    g.add(panel(len, wid, s * (half + 0.15 + len / 2), y, 0));
    g.add(rod(s * half, y, 0, s * (half + 0.15), y, 0, 0.05));
  }
}

// ---------------------------------------------------------------------------------------------
// USSR
// ---------------------------------------------------------------------------------------------
/** Luna 1 and 2: a sealed sphere with antennas and a magnetometer boom. */
function lunaSphere(): THREE.Group {
  const g = G();
  g.add(ball(1.2, 0, 0.6, 0, alu));
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; g.add(rod(Math.cos(a) * 0.4, 1.05, Math.sin(a) * 0.4, Math.cos(a) * 1.1, 2.0, Math.sin(a) * 1.1)); }
  g.add(rod(0, 1.2, 0, 0, 2.3, 0, 0.04), tube(0.35, 0.35, 0.12, 0.54, dark, 24).rotateX(Math.PI / 2));
  return g;
}
/** Luna 3: a cylinder with domed ends, solar cells around it, the camera port on top. */
function luna3(): THREE.Group {
  const g = G();
  g.add(tube(0.95, 0.95, 0.7, 0.3, mat(C.cell, 'cell'), 32), ball(0.95, 0, 0.3, 0, alu, 0.62), ball(0.95, 0, 1.0, 0, alu, 0.62), tube(1.2, 1.2, 0.06, 0.62, alu, 32));
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; g.add(rod(Math.cos(a) * 0.45, 1.0, Math.sin(a) * 0.45, Math.cos(a) * 0.9, 1.9, Math.sin(a) * 0.9)); }
  return g;
}
/** Ye-6 (Luna 4 to 9, 13): a cruise stage with the landing capsule on top. */
function lunaE6(top: 'capsule' | 'orbiter'): THREE.Group {
  const g = G();
  g.add(bell(0.7, 0.6, 0), tube(1.0, 1.0, 0.5, 0.55, alu, 28), ball(0.95, 0, 1.3, 0, alu), tube(0.8, 0.6, 0.5, 1.6, alu, 24));
  g.add(at(tube(0.32, 0.32, 0.9, 0, alu, 14), 0.62, 0.7, 0), at(tube(0.32, 0.32, 0.9, 0, alu, 14), -0.62, 0.7, 0));
  if (top === 'capsule') g.add(ball(0.58, 0, 2.4, 0, mat(C.lgrey)), tube(0.62, 0.62, 0.1, 2.1, dark, 24));
  else g.add(tube(0.75, 0.75, 1.2, 2.1, alu, 24), ball(0.75, 0, 3.3, 0, alu, 0.5), rod(0.3, 3.3, 0, 1.3, 3.9, 0), rod(-0.3, 3.3, 0, -1.3, 3.9, 0));
  return g;
}
/** Luna 9 and 13 on the surface: the capsule with its four petals open and antennas up. */
function lunaCapsule(): THREE.Group {
  const g = G();
  g.add(ball(0.58, 0, 0.26, 0, mat(C.lgrey), 0.9));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    g.add(tilt(at(box(0.36, 0.02, 0.3, 0, 0, 0, alu), Math.cos(a) * 0.42, 0.06, Math.sin(a) * 0.42), 0, -a, 0));
    g.add(rod(Math.cos(a) * 0.18, 0.5, Math.sin(a) * 0.18, Math.cos(a) * 0.4, 1.15, Math.sin(a) * 0.4, 0.012));
  }
  return g;
}
/** Zond 3 (3MV): a pressurised cylinder with two solar wings and a fixed dish. */
function zond3(): THREE.Group {
  const g = G();
  g.add(bell(0.6, 0.5, 0), tube(1.1, 1.1, 2.4, 0.5, alu, 28), ball(1.1, 0, 2.9, 0, alu, 0.5));
  wings(g, 2, 0.55, 1.6, 1.3, 1.7);
  g.add(tilt(at(dish(1.9), 0, 1.7, 0.75), Math.PI / 2));
  return g;
}
/** Ye-8 (Luna 15 to 24): the four-tank descent stage, with a rover, a return rocket or an orbiter module on it. */
function lunaYe8(top: 'rover' | 'return' | 'orbiter', landed: boolean): THREE.Group {
  const g = G(), h = 0.75;
  if (top !== 'orbiter' || landed) g.add(legs(4, 4.0, 1.0, h + 0.6, grey));
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; g.add(ball(0.9, Math.cos(a) * 0.72, h + 0.55, Math.sin(a) * 0.72, alu)); }
  g.add(bell(0.7, 0.7, h - 0.35), tube(1.9, 1.9, 0.3, h + 0.95, alu, 8));
  const y = h + 1.25;
  if (top === 'return') g.add(ball(0.9, 0, y + 0.5, 0, alu), tube(0.6, 0.5, 0.7, y + 0.9, alu, 20), ball(0.5, 0, y + 1.85, 0, mat(C.dgrey)), rod(0.9, y, 0, 1.5, y + 1.6, 0, 0.05));
  else {
    // Lunokhod: a pressurised tub on eight wheels with its lid (the solar array) open.
    g.add(lathe([[0.75, y + 0.3], [1.08, y + 0.85], [1.08, y + 0.95]], alu, 28), tilt(at(tube(2.15, 2.15, 0.04, 0, mat(C.cell, 'cell'), 28), 0, y + 1.35, -0.85), -0.9));
    if (top === 'rover') for (const s of [-1, 1]) for (let k = 0; k < 4; k++) g.add(tilt(at(tube(0.51, 0.51, 0.2, -0.1, dark, 16), s * 0.95, y + 0.26, -0.9 + k * 0.6), 0, 0, Math.PI / 2));
    g.add(rod(0.5, y + 0.9, 0.6, 0.9, y + 1.9, 0.9, 0.03));
  }
  return g;
}
/** Zond 5 to 8 (Soyuz 7K-L1): descent capsule, instrument module, two solar wings, a dish. */
function zondL1(): THREE.Group {
  const g = G();
  g.add(bell(0.9, 0.6, 0), tube(2.72, 2.72, 0.5, 0.55, white, 32), tube(2.72, 2.2, 1.8, 1.05, white, 32), tube(2.2, 2.2, 0.25, 2.85, dark, 32));
  g.add(lathe([[1.1, 3.1], [1.08, 3.9], [0.85, 4.75], [0.45, 5.2], [0, 5.3]], mat(C.dgrey), 32));
  wings(g, 2, 1.36, 3.4, 1.9, 1.5);
  g.add(tilt(at(dish(0.9), 0.9, 3.4, 1.2), 0.9));
  return g;
}

// ---------------------------------------------------------------------------------------------
// United States, robotic, 1958-1968
// ---------------------------------------------------------------------------------------------
function pioneer4(): THREE.Group {
  const g = G();
  g.add(lathe([[0.115, 0], [0.115, 0.05], [0.02, 0.5], [0, 0.51]], mat(C.gold, 'foil'), 24), rod(0, 0.5, 0, 0, 0.62, 0, 0.008));
  for (const y of [0.12, 0.24, 0.36]) g.add(tube(0.2 - y * 0.37, 0.2 - y * 0.37, 0.025, y, white, 24, true));
  return g;
}
/** Ranger: hexagonal bus, two solar wings, a dish underneath; Block II carried a landing capsule, Block III a camera tower. */
function ranger(block: 1 | 2 | 3): THREE.Group {
  const g = G();
  g.add(tilt(at(dish(1.2), 0, 0.22, 0), Math.PI), tube(1.5, 1.5, 0.45, 0.3, alu, 6));
  wings(g, 2, 0.7, block === 3 ? 1.55 : 1.8, 0.75, 0.52);
  if (block === 1) for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; g.add(rod(Math.cos(a) * 0.7, 0.75, Math.sin(a) * 0.7, 0, 3.6, 0, 0.035)); }
  else if (block === 2) g.add(tube(0.9, 0.5, 1.3, 0.75, alu, 12), ball(0.65, 0, 2.5, 0, mat(C.cream)), rod(0, 2.8, 0, 0, 3.1, 0));
  else g.add(lathe([[0.68, 0.75], [0.34, 2.6], [0.34, 3.2], [0.2, 3.45]], mat(C.alu, 'metal'), 24), box(0.5, 0.5, 0.05, 0, 2.2, 0.47, black), rod(0, 3.45, 0, 0, 3.6, 0));
  return g;
}
/** Surveyor: a tripod frame, vernier engines, and a mast carrying the solar panel and the flat antenna. */
function surveyor(): THREE.Group {
  const g = G();
  g.add(legs(3, 4.3, 0.5, 1.0, grey, Math.PI / 6));
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + Math.PI / 6, b = ((i + 1) / 3) * Math.PI * 2 + Math.PI / 6; g.add(rod(Math.cos(a) * 0.55, 1.0, Math.sin(a) * 0.55, Math.cos(b) * 0.55, 1.0, Math.sin(b) * 0.55, 0.04), rod(Math.cos(a) * 0.55, 1.0, Math.sin(a) * 0.55, 0, 1.75, 0, 0.035)); }
  g.add(box(0.5, 0.6, 0.4, 0.45, 1.25, 0.1, white), box(0.5, 0.6, 0.4, -0.45, 1.25, -0.1, white), ball(0.5, 0, 0.75, 0, alu), bell(0.3, 0.3, 0.3));
  g.add(rod(0, 1.7, 0, 0, 2.85, 0, 0.07), tilt(at(panel(1.0, 0.9, 0, 0, 0), 0.5, 2.75, 0), -0.5, 0.3), tilt(at(box(0.97, 0.97, 0.03, 0, 0, 0, mat(C.lgrey, 'metal')), -0.5, 2.6, 0), 0.4, -0.2));
  g.add(rod(0.5, 1.2, 0.35, 1.3, 1.7, 0.9, 0.02), rod(-0.5, 1.2, -0.35, -1.3, 1.7, -0.9, 0.02));
  return g;
}
/** Lunar Orbiter: a truncated cone with four solar paddles, a dish on one boom and an omni antenna on another. */
function lunarOrbiter(): THREE.Group {
  const g = G();
  g.add(bell(0.5, 0.45, 0), tube(1.4, 1.4, 0.12, 0.42, alu, 32));
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; g.add(tilt(at(box(0.92, 0.02, 0.92, 0, 0, 0, mat(C.cell, 'cell')), Math.cos(a) * 1.1, 0.46, Math.sin(a) * 1.1), 0, -a + Math.PI / 4)); }
  g.add(lathe([[0.7, 0.54], [0.38, 1.6], [0.3, 1.68]], mat(C.alu, 'foil'), 32), ball(0.5, 0.28, 0.85, 0, alu), ball(0.5, -0.28, 0.85, 0, alu), box(0.6, 0.5, 0.5, 0, 0.85, 0.4, mat(C.lgrey)));
  g.add(rod(0.7, 0.5, 0, 1.75, 0.5, 0, 0.04), tilt(at(dish(0.92), 1.95, 0.5, 0), 0, 0, -Math.PI / 2), rod(-0.7, 0.5, 0, -2.6, 0.5, 0, 0.03));
  return g;
}
/** Spin-stabilised drum (Explorer, Hiten, Lunar Prospector): cells around the side, optional paddles and booms. */
function drum(o: { d: number; h: number; sides?: number; paddles?: number; paddleL?: number; booms?: number; boomL?: number; motor?: boolean; top?: 'cone' | 'flat' }): THREE.Group {
  const g = G(), y = o.motor ? o.d * 0.35 : 0;
  if (o.motor) g.add(bell(o.d * 0.4, o.d * 0.4, 0));
  g.add(tube(o.d, o.d, o.h, y, mat(C.cell, 'cell'), o.sides ?? 32), tube(o.d * 0.98, o.d * 0.98, 0.03, y + o.h, alu, o.sides ?? 32));
  if (o.top === 'cone') g.add(lathe([[o.d * 0.3, y + o.h], [o.d * 0.1, y + o.h + o.d * 0.35]], alu, 20));
  g.add(rod(0, y + o.h, 0, 0, y + o.h + o.d * 0.6, 0));
  for (let i = 0; i < (o.paddles ?? 0); i++) {
    const a = (i / o.paddles!) * Math.PI * 2, L = o.paddleL ?? o.d, r = o.d / 2 + 0.25 + L / 2;
    g.add(tilt(at(box(L, 0.02, L * 0.75, 0, 0, 0, mat(C.cell, 'cell')), Math.cos(a) * r, y + o.h / 2, Math.sin(a) * r), 0.5, -a));
    g.add(rod(Math.cos(a) * o.d / 2, y + o.h / 2, Math.sin(a) * o.d / 2, Math.cos(a) * (o.d / 2 + 0.25), y + o.h / 2, Math.sin(a) * (o.d / 2 + 0.25), 0.03));
  }
  for (let i = 0; i < (o.booms ?? 0); i++) {
    const a = (i / o.booms!) * Math.PI * 2 + 0.5, L = o.boomL ?? 2;
    g.add(rod(Math.cos(a) * o.d / 2, y + o.h * 0.5, Math.sin(a) * o.d / 2, Math.cos(a) * (o.d / 2 + L), y + o.h * 0.5, Math.sin(a) * (o.d / 2 + L), 0.035));
    g.add(box(0.14, 0.14, 0.14, Math.cos(a) * (o.d / 2 + L), y + o.h * 0.5, Math.sin(a) * (o.d / 2 + L), foil));
  }
  return g;
}

// ---------------------------------------------------------------------------------------------
// Three-axis box spacecraft and cubesats
// ---------------------------------------------------------------------------------------------
function boxSat(o: { w: number; h: number; d: number; wings?: 0 | 1 | 2; wingL?: number; wingW?: number; dishD?: number; dishOn?: 'top' | 'side'; body?: THREE.Material; engine?: number }): THREE.Group {
  const g = G(), y0 = o.engine ? o.engine * 0.9 : 0;
  if (o.engine) g.add(bell(o.engine, o.engine, 0));
  g.add(box(o.w, o.h, o.d, 0, y0 + o.h / 2, 0, o.body ?? foil));
  if (o.wings) wings(g, o.wings, o.w / 2, o.wingL ?? o.w * 2, o.wingW ?? o.h * 0.7, y0 + o.h / 2);
  if (o.dishD) {
    if (o.dishOn === 'side') g.add(tilt(at(dish(o.dishD), 0, y0 + o.h * 0.55, o.d / 2 + o.dishD * 0.25), Math.PI / 2));
    else g.add(at(dish(o.dishD), 0, y0 + o.h + o.dishD * 0.3, 0), rod(0, y0 + o.h, 0, 0, y0 + o.h + o.dishD * 0.12, 0, 0.06));
  }
  return g;
}
/** 6U or 12U cubesat with its deployed solar panels. */
function cubesat(units: 6 | 12): THREE.Group {
  const g = G(), [w, h, d] = units === 6 ? [0.226, 0.366, 0.1] : [0.34, 0.64, 0.34];
  g.add(box(w, h, d, 0, h / 2, 0, mat(C.dgrey, 'metal')));
  wings(g, 2, w / 2, units === 6 ? 0.55 : 0.75, h * 0.85, h / 2);
  g.add(rod(0, h, 0, 0, h + 0.12, 0, 0.012));
  return g;
}
/** LCROSS: the shepherding spacecraft still attached to its spent Centaur upper stage. */
function lcross(): THREE.Group {
  const g = G();
  g.add(bell(1.2, 1.9, 0), tube(3.05, 3.05, 10.6, 1.9, white, 40), tube(3.05, 2.6, 0.7, 12.5, white, 40), tube(2.6, 2.6, 1.2, 13.2, foil, 6));
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; if (i % 2 === 0) g.add(tilt(at(panel(1.0, 1.0, 0, 0, 0), Math.cos(a) * 1.35, 13.8, Math.sin(a) * 1.35), 0, -a + Math.PI / 2)); }
  g.add(at(dish(0.6), 0, 14.7, 0));
  return g;
}

// ---------------------------------------------------------------------------------------------
// Landers
// ---------------------------------------------------------------------------------------------
function lander(o: { w: number; h: number; legs: number; span: number; sides?: number; body?: THREE.Material; deckPanel?: boolean; sidePanels?: boolean; rover?: boolean; mast?: number; engine?: number }): THREE.Group {
  const g = G(), clear = Math.max(0.35, o.h * 0.22), e = o.engine ?? o.w * 0.3;
  g.add(legs(o.legs, o.span, o.w * 0.48, clear + o.h * 0.55, grey, o.legs === 4 ? Math.PI / 4 : 0));
  g.add(bell(e, clear * 0.95, 0.04), tube(o.w, o.w, o.h, clear, o.body ?? foil, o.sides ?? 8), tube(o.w * 0.94, o.w * 0.94, 0.04, clear + o.h, alu, o.sides ?? 8));
  const top = clear + o.h;
  if (o.deckPanel) g.add(at(box(o.w * 0.62, 0.03, o.w * 0.62, 0, 0, 0, mat(C.cell, 'cell')), 0, top + 0.06, 0));
  if (o.sidePanels) for (const s of [-1, 1]) g.add(panel(o.w * 0.9, o.h * 0.9, 0, clear + o.h / 2, s * (o.w / 2 + 0.04)));
  if (o.mast) g.add(rod(o.w * 0.3, top, o.w * 0.2, o.w * 0.3, top + o.mast, o.w * 0.2, 0.05), at(dish(o.w * 0.22), o.w * 0.3, top + o.mast + 0.05, o.w * 0.2));
  if (o.rover) {
    // A six-wheeled rover riding on the top deck.
    g.add(box(1.0, 0.45, 0.75, 0, top + 0.55, 0, foil), panel(1.5, 0.9, 0, top + 0.82, 0).rotateX(Math.PI / 2));
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) g.add(tilt(at(tube(0.3, 0.3, 0.12, -0.06, dark, 14), s * 0.56, top + 0.16, -0.42 + k * 0.42), 0, 0, Math.PI / 2));
    g.add(rod(0.3, top + 0.8, 0.2, 0.3, top + 1.5, 0.2, 0.04));
  }
  return g;
}
/** SLIM: a box that lands on its side on five crushable feet. */
function slim(): THREE.Group {
  const g = G();
  g.add(box(2.7, 1.7, 2.4, 0, 1.15, 0, foil), panel(2.5, 2.2, 0, 2.02, 0).rotateX(Math.PI / 2));
  for (const [x, z] of [[-1.1, -0.9], [1.1, -0.9], [-1.1, 0.9], [1.1, 0.9], [0, 0]]) g.add(ball(0.32, x, 0.16, z, mat(C.lgrey, 'metal')));
  g.add(at(bell(0.45, 0.4, 0), 0.5, 0.0, 0), at(bell(0.45, 0.4, 0), -0.5, 0.0, 0));
  return g;
}
/** An orbiter or propulsion module with a lander riding on top (Chandrayaan 2 and 3, Chang'e 5 and 6). */
function stack(lower: THREE.Group, lowerTop: number, upper: THREE.Group): THREE.Group {
  const g = G();
  g.add(lower, at(upper, 0, lowerTop, 0));
  return g;
}
const vikram = () => lander({ w: 2.3, h: 1.1, legs: 4, span: 3.6, sides: 4, sidePanels: true, mast: 0.5 });
const changeLander = (rover: boolean) => lander({ w: 3.0, h: 1.3, legs: 4, span: 4.8, sides: 8, rover, mast: rover ? 0 : 0.9, sidePanels: !rover });
/** Chang'e 5 and 6 lander with the ascent vehicle on its deck. */
function changeAscent(): THREE.Group {
  const g = changeLander(false);
  g.add(box(1.3, 0.9, 1.3, 0, 2.25, 0, foil), bell(0.4, 0.35, 1.5));
  return g;
}

// ---------------------------------------------------------------------------------------------
// Crewed
// ---------------------------------------------------------------------------------------------
/** Apollo command and service module, 11.0 m long and 3.9 m across; the docking probe is at the top. */
export function apolloCsm(): THREE.Group {
  const g = G(), steel = mat(C.steel, 'metal');
  g.add(bell(2.5, 2.8, 0, mat(C.dgrey, 'metal')), tube(3.91, 3.91, 4.5, 2.8, steel, 40), tube(3.6, 3.91, 0.25, 2.55, steel, 40));
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; g.add(box(0.25, 0.25, 0.25, Math.cos(a) * 2.0, 6.3, Math.sin(a) * 2.0, white)); }
  for (let i = 0; i < 6; i += 2) { const a = (i / 6) * Math.PI * 2; g.add(tilt(at(box(1.5, 3.4, 0.02, 0, 0, 0, white), Math.cos(a) * 1.965, 5.0, Math.sin(a) * 1.965), 0, -a + Math.PI / 2)); }
  g.add(lathe([[1.955, 7.3], [1.955, 7.45], [0.55, 10.5], [0.4, 10.75], [0, 10.75]], mat(C.steel, 'foil'), 40), tube(0.5, 0.2, 0.3, 10.75, grey, 16));
  // High-gain antenna: four small dishes on a boom at the base.
  g.add(rod(1.4, 3.0, 1.4, 2.3, 2.4, 2.3, 0.06));
  for (const [dx, dz] of [[0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]]) g.add(tilt(at(dish(0.6), 2.3 + dx, 2.3, 2.3 + dz), Math.PI));
  return g;
}
/** Orion with its European Service Module: 5.0 m capsule, four solar wings spanning 19 m. */
function orion(): THREE.Group {
  const g = G();
  g.add(bell(1.1, 1.6, 0, mat(C.dgrey, 'metal')), tube(4.1, 4.1, 2.9, 1.5, mat(C.lgrey), 40), tube(4.1, 5.02, 0.9, 4.4, mat(C.lgrey), 40));
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.add(at(bell(0.3, 0.35, 0), Math.cos(a) * 1.55, 1.2, Math.sin(a) * 1.55)); }
  g.add(lathe([[2.51, 5.3], [2.51, 5.45], [0.9, 8.3], [0.75, 8.6], [0, 8.6]], mat(C.steel, 'foil'), 40));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4, h = new THREE.Group();
    h.add(panel(7.0, 1.95, 2.05 + 0.4 + 3.5, 0, 0), rod(2.05, 0, 0, 2.45, 0, 0, 0.08));
    h.position.y = 2.4;
    h.rotation.set(0, a, 0);
    h.children[0].rotation.x = Math.PI / 2;
    g.add(h);
  }
  return g;
}

// ---------------------------------------------------------------------------------------------
// Which design flies which mission
// ---------------------------------------------------------------------------------------------
const NASA_LM = { file: 'apollo-lm.glb', metres: 9.4, axis: 'x' as const, label: 'Apollo Lunar Module · NASA 3D model, 9.4 m across the legs' };

export function designFor(m: { id: string; name: string; category: string; hasSurface: boolean }): SpacecraftDesign {
  const id = m.id, n = Number(/-(\d+)/.exec(id)?.[1] ?? 0);
  const d = (label: string, cruise: () => THREE.Group, surface?: () => THREE.Group): SpacecraftDesign => ({ label, cruise, surface });

  if (id.startsWith('apollo-')) return { label: n === 8 ? 'Apollo command and service module, 11.0 m' : 'Apollo command and service module with the lunar module docked', apollo: { lm: n !== 8, lands: m.hasSurface }, cruise: apolloCsm };
  if (id === 'artemis-1') return d('Orion with the European Service Module, 19 m across the solar wings', orion);
  if (id === 'lunar-reconnaissance-orbiter') return { ...d('Lunar Reconnaissance Orbiter', () => boxSat({ w: 1.5, h: 2.6, d: 1.8, wings: 1, wingL: 4.3, wingW: 3.2, dishD: 0.75 })), nasa: { file: 'lro.glb', metres: 6, axis: 'max', label: 'Lunar Reconnaissance Orbiter · NASA 3D model, about 6 m' } };
  if (id === 'clementine') return { ...d('Clementine', () => boxSat({ w: 1.14, h: 1.88, d: 1.14, wings: 2, wingL: 1.8, wingW: 1.2, dishD: 1.1, engine: 0.4 })), nasa: { file: 'clementine.glb', metres: 1.88, axis: 'max', label: 'Clementine · NASA 3D model' } };
  if (id.includes('ladee')) return { ...d('LADEE', () => drum({ d: 1.85, h: 2.1, sides: 8, motor: true })), nasa: { file: 'ladee.glb', metres: 2.37, axis: 'max', label: 'LADEE · NASA 3D model, 2.37 m tall' } };

  if (id === 'luna-1' || id === 'luna-2') return d(`${m.name} · sealed sphere, 1.2 m, with antennas`, lunaSphere);
  if (id === 'luna-3') return d('Luna 3 · 1.3 m cylinder with solar cells', luna3);
  if (id === 'zond-3') return d('Zond 3 (3MV) · 3.3 m probe with two solar wings', zond3);
  if (/^zond-[5-8]$/.test(id)) return d(`${m.name} · Soyuz 7K-L1, 5 m long`, zondL1);
  if (id.startsWith('luna-') && n >= 4 && n <= 14) {
    const orbiter = [10, 11, 12, 14].includes(n);
    return d(`${m.name} · Ye-6 ${orbiter ? 'orbiter' : 'cruise stage and landing capsule'}, 2.7 m tall`, () => lunaE6(orbiter ? 'orbiter' : 'capsule'), n === 9 || n === 13 ? lunaCapsule : undefined);
  }
  if (id.startsWith('luna-') && n >= 15 && n <= 24) {
    const top = n === 17 || n === 21 ? 'rover' : n === 19 || n === 22 ? 'orbiter' : 'return';
    return d(`${m.name} · Ye-8 ${top === 'rover' ? 'lander carrying a Lunokhod rover' : top === 'orbiter' ? 'orbiter' : 'lander with a sample-return rocket'}, 4 m across`, () => lunaYe8(top, false), top === 'orbiter' ? undefined : () => lunaYe8(top, true));
  }
  if (id === 'luna-25') return d('Luna 25 · four-legged lander, about 3 m', () => lander({ w: 1.7, h: 1.3, legs: 4, span: 3.0, sides: 8, sidePanels: true, mast: 0.6 }));
  if (id === 'pioneer-4') return d('Pioneer 4 · 51 cm gold-washed cone', pioneer4);
  if (id.startsWith('ranger-')) return d(`${m.name} · Block ${n <= 2 ? 'I' : n <= 5 ? 'II' : 'III'}, 3.6 m tall, 4.6 m across the wings`, () => ranger(n <= 2 ? 1 : n <= 5 ? 2 : 3));
  if (id.startsWith('surveyor-')) return d(`${m.name} · 3 m tall on a 4.3 m tripod`, surveyor);
  if (id.startsWith('lunar-orbiter-')) return d(`${m.name} · 1.7 m tall, 3.7 m across the solar paddles`, lunarOrbiter);
  if (/^explorer-3[35]/.test(id)) return d(`${m.name.split(' (')[0]} · 71 cm octagonal drum with four solar paddles`, () => drum({ d: 0.71, h: 0.25, sides: 8, paddles: 4, paddleL: 0.65, booms: 2, boomL: 1.8, motor: true }));
  if (id.startsWith('explorer-49')) return d('Explorer 49 · 92 cm drum with four solar paddles (its 229 m antennas are not drawn)', () => drum({ d: 0.92, h: 0.79, paddles: 4, paddleL: 0.8, motor: true }));
  if (id === 'hiten') return d('Hiten · 1.4 m spin-stabilised drum', () => drum({ d: 1.4, h: 0.8, motor: true, top: 'cone' }));
  if (id === 'lunar-prospector') return d('Lunar Prospector · 1.4 m drum with three 2.5 m booms', () => drum({ d: 1.37, h: 1.28, booms: 3, boomL: 2.5 }));
  if (id.startsWith('asiasat')) return d('AsiaSat 3 / HGS-1 · HS-601HP communications satellite, 26 m across', () => boxSat({ w: 2.5, h: 3.4, d: 2.5, wings: 2, wingL: 11, wingW: 2.4, dishD: 2.2, dishOn: 'side', engine: 0.7 }));
  if (id === 'smart-1') return d('SMART-1 · 1 m cube, 14 m across the solar wings', () => boxSat({ w: 1.0, h: 1.0, d: 1.0, wings: 2, wingL: 6.2, wingW: 0.95, engine: 0.3 }));
  if (id === 'kaguya-selene') return d('Kaguya (SELENE) · 2.1 x 2.1 x 4.8 m with one solar wing', () => boxSat({ w: 2.1, h: 4.8, d: 2.1, wings: 1, wingL: 6.5, wingW: 3.0, dishD: 1.3, dishOn: 'side', engine: 0.6 }));
  if (id === 'change-1' || id === 'change-2') return d(`${m.name} · 2.0 x 1.7 x 2.2 m bus, 18 m across the solar wings`, () => boxSat({ w: 2.0, h: 2.2, d: 1.72, wings: 2, wingL: 7.7, wingW: 1.7, dishD: 0.6, engine: 0.5 }));
  if (id === 'chandrayaan-1') return d('Chandrayaan-1 · 1.5 m cube with one solar panel', () => boxSat({ w: 1.5, h: 1.5, d: 1.5, wings: 1, wingL: 2.15, wingW: 1.8, dishD: 0.7, dishOn: 'side', engine: 0.4 }));
  if (id === 'lcross') return d('LCROSS with its Centaur upper stage, 14.5 m', lcross);
  if (id.includes('grail')) return d('GRAIL · one of the twin 1.1 m spacecraft', () => boxSat({ w: 1.09, h: 0.95, d: 0.76, wings: 2, wingL: 1.0, wingW: 0.75, body: white, engine: 0.2 }));
  if (id === 'change-3' || id === 'change-4') return d(`${m.name} · four-legged lander carrying the Yutu rover`, () => changeLander(true));
  if (id === 'change-5-test-vehicle') return d("Chang'e 5-T1 · service module with the return capsule", () => { const g = boxSat({ w: 2.0, h: 2.2, d: 1.72, wings: 2, wingL: 5.0, wingW: 1.7, engine: 0.5 }); g.add(lathe([[0.62, 2.65], [0.3, 3.55], [0, 3.6]], mat(C.dgrey), 28)); return g; });
  if (id === 'change-5' || id === 'change-6') return d(`${m.name} · orbiter, return capsule, lander and ascent vehicle stacked`, () => stack((() => { const g = G(); g.add(bell(0.9, 0.9, 0), tube(2.8, 2.8, 2.4, 0.9, foil, 28)); wings(g, 2, 1.4, 4.2, 1.9, 2.1); return g; })(), 3.3, changeAscent()), changeAscent);
  if (id.startsWith('queqiao')) return d(`${m.name} · relay satellite with a 4.2 m dish`, () => boxSat({ w: 1.4, h: id === 'queqiao' ? 0.85 : 1.6, d: 1.4, wings: 2, wingL: 2.4, wingW: 1.2, dishD: 4.2, engine: 0.3 }));
  if (id === 'beresheet') return d('Beresheet · 1.5 m tall, 2.3 m across the legs', () => lander({ w: 1.6, h: 0.9, legs: 4, span: 2.3, sides: 16, deckPanel: true }));
  if (id === 'chandrayaan-2') return d('Chandrayaan-2 · orbiter with the Vikram lander on top', () => stack(boxSat({ w: 3.2, h: 2.1, d: 2.6, wings: 1, wingL: 3.2, wingW: 1.9, engine: 0.5 }), 2.55, vikram()), vikram);
  if (id === 'chandrayaan-3') return d('Chandrayaan-3 · propulsion module with the Vikram lander on top', () => stack(boxSat({ w: 1.9, h: 1.9, d: 1.9, wings: 1, wingL: 2.2, wingW: 1.7, engine: 0.45 }), 2.3, vikram()), vikram);
  if (id === 'capstone') return d('CAPSTONE · 12U cubesat, 64 cm tall', () => cubesat(12));
  if (id.includes('danuri')) return d('Danuri · 2.1 x 1.8 x 2.3 m with two solar wings', () => boxSat({ w: 1.82, h: 2.29, d: 2.14, wings: 2, wingL: 2.3, wingW: 1.9, dishD: 1.0, engine: 0.4 }));
  if (['lunah-map', 'lunar-ice-cube', 'lunar-infrared-imaging-lunir', 'omotenashi', 'equuleus', 'lunar-flashlight'].includes(id)) return d(`${m.name} · 6U cubesat, 37 cm tall`, () => cubesat(6));
  if (id === 'hakuto-r-m1' || id === 'resilience-m2') return d(`${m.name} · 2.3 m tall, 2.6 m across the legs`, () => lander({ w: 1.6, h: 1.5, legs: 4, span: 2.6, sides: 8, sidePanels: true, deckPanel: true }));
  if (id === 'slim') return d('SLIM · 2.4 m tall, 2.7 m long', slim);
  if (id.startsWith('peregrine')) return d('Peregrine · 1.9 m tall, 2.5 m wide', () => lander({ w: 2.2, h: 1.2, legs: 4, span: 3.4, sides: 8, deckPanel: true }));
  if (id.startsWith('intuitive-machines')) return d('Nova-C · hexagonal lander, 4.3 m tall, 1.6 m wide, six legs', () => lander({ w: 1.6, h: 3.4, legs: 6, span: 4.6, sides: 6, sidePanels: true, deckPanel: true }));
  if (id.startsWith('blue-ghost')) return d('Blue Ghost · 2 m tall, 3.5 m wide', () => lander({ w: 2.6, h: 1.2, legs: 4, span: 3.5, sides: 8, deckPanel: true, mast: 0.6 }));
  if (id === 'lunar-trailblazer') return d('Lunar Trailblazer · small orbiter, 3.5 m across the solar wings', () => boxSat({ w: 0.9, h: 1.0, d: 0.7, wings: 2, wingL: 1.1, wingW: 0.8, body: mat(C.dgrey, 'metal') }));

  if (m.hasSurface && m.category !== 'impact') return d(`${m.name} · lander`, () => lander({ w: 2, h: 1.2, legs: 4, span: 3.4 }));
  return d(`${m.name} · ${m.category === 'orbiter' ? 'orbiter' : 'probe'}`, () => boxSat({ w: 1.4, h: 1.6, d: 1.4, wings: 2, wingL: 2.2, wingW: 1.2, dishD: 0.8 }));
}
export { NASA_LM };
