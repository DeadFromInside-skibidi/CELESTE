// Launch vehicles built from published dimensions: every rocket that has flown a spacecraft
// toward the Moon and has no NASA 3D model. Each is described stage by stage (lengths and
// diameters in metres, bottom to top) so that it can come apart in flight the way the real one
// did: strap-on boosters, core stages, payload fairing, escape tower.
//
// These are dimensionally faithful models, not replicas: overall height, stage lengths,
// diameters, booster count and layout, engine count and colour scheme follow the vehicles'
// published data; surface detail (markings, plumbing, raceways) is not modelled. Staging
// times are the real ones, compressed where needed to fit the 9-minute ascent of the
// reconstructed trajectory.
import * as THREE from 'three';
import { bell, box, C, lathe, lean, M, mat, ogiveProfile, truss, tube } from './parts.ts';

type Finish = 'paint' | 'metal' | 'foil' | 'matte';
interface Sec { l: number; d: number; d2?: number; c: number; f?: Finish; truss?: boolean; bands?: [at: number, width: number, colour: number][] }
interface Eng { n: number; d: number; l: number; ring?: number; centre?: boolean }
interface Pods { n: number; d: number; l: number; c: number }
interface Stage { name: string; secs: Sec[]; eng: Eng; drop: number; inset?: number; fins?: { n: number; span: number; chord: number }; legs?: boolean; pods?: Pods }
interface Booster { name: string; slots: number; at?: number[]; d: number; l: number; nose: 'cone' | 'ogive' | 'slant' | 'r7'; c: number; f?: Finish; drop: number; y?: number; phase?: number; meet?: number }
/** `over`: how much of the top of the stack the fairing encloses; `base`: diameter it starts from. */
interface Fairing { d: number; l: number; nose: number; c: number; drop: number; boat?: number; over?: number; base?: number; las?: { l: number; d: number } }
export interface Vehicle { name: string; h: number; stages: Stage[]; boosters?: Booster[]; fairing?: Fairing; lift?: number }

const INF = Infinity;
const band = (at: number, colour: number = C.black, width = 0.5): [number, number, number] => [at, width, colour];

// ---------------------------------------------------------------------------------------------
// R-7 family (Luna, Molniya, Soyuz): a core that widens upward, four tapered strap-on blocks
// ---------------------------------------------------------------------------------------------
const r7Core = (c: number, drop: number): Stage => ({ name: 'Core stage (Blok A)', drop, eng: { n: 4, d: 0.75, l: 1.2, ring: 0.5 }, secs: [{ l: 18.6, d: 2.05, d2: 2.95, c }, { l: 8.6, d: 2.95, c }] });
const r7Blocks = (c: number): Booster => ({ name: 'Strap-on blocks B, V, G, D', slots: 4, d: 2.68, l: 19.6, nose: 'r7', c, drop: 118, meet: 2.95 });

const VEHICLES: Record<string, Vehicle> = {
  'Luna 8K72 (R-7)': {
    name: 'Luna 8K72', h: 33.5,
    boosters: [r7Blocks(C.sovgreen)],
    stages: [
      r7Core(C.sovgreen, 300),
      { name: 'Blok E', drop: INF, eng: { n: 1, d: 0.7, l: 1.0 }, secs: [{ l: 1.6, d: 2.95, d2: 2.6, c: C.grey, truss: true }, { l: 2.9, d: 2.6, c: C.lgrey }] },
    ],
    fairing: { d: 2.6, l: 2.0, nose: 1.8, c: C.lgrey, drop: 310 },
  },
  'Molniya 8K78 (R-7)': {
    name: 'Molniya 8K78', h: 43.4,
    boosters: [r7Blocks(C.sovgreen)],
    stages: [
      r7Core(C.sovgreen, 290),
      { name: 'Blok I', drop: 530, eng: { n: 4, d: 0.55, l: 0.9, ring: 0.45 }, secs: [{ l: 1.9, d: 2.95, d2: 2.66, c: C.grey, truss: true }, { l: 6.7, d: 2.66, c: C.sovgreen }] },
      { name: 'Blok L', drop: INF, eng: { n: 1, d: 0.6, l: 0.9 }, secs: [{ l: 1.2, d: 2.66, d2: 2.4, c: C.grey, truss: true }, { l: 2.2, d: 2.4, c: C.lgrey }] },
    ],
    fairing: { d: 2.7, l: 7.4, nose: 3.0, over: 3.4, base: 2.66, c: C.lgrey, drop: 305 },
  },
  'Soyuz-2.1b / Fregat': {
    name: 'Soyuz-2.1b / Fregat', h: 46.3,
    boosters: [r7Blocks(C.lgrey)],
    stages: [
      r7Core(C.lgrey, 287),
      { name: 'Blok I', drop: 525, eng: { n: 1, d: 1.1, l: 1.5 }, secs: [{ l: 1.4, d: 2.95, d2: 2.66, c: C.grey, truss: true }, { l: 6.7, d: 2.66, c: C.lgrey, bands: [band(0.5, C.dgrey, 1.2)] }] },
      { name: 'Fregat', drop: INF, eng: { n: 1, d: 0.5, l: 0.6 }, secs: [{ l: 1.5, d: 3.3, c: C.gold, f: 'foil' }] },
    ],
    fairing: { d: 4.11, l: 11.4, nose: 4.2, boat: 1.0, over: 1.5, base: 2.66, c: C.white, drop: 300 },
  },

  // ------------------------------------------------------------------------------------------
  // Proton-K: six fuel tanks around a central oxidiser tank, three stages and a Blok D
  // ------------------------------------------------------------------------------------------
  'Proton-K / Blok D': {
    name: 'Proton-K / Blok D', h: 57,
    stages: [
      { name: 'First stage', drop: 123, eng: { n: 0, d: 1.4, l: 1.6 }, pods: { n: 6, d: 1.6, l: 19.4, c: C.white }, secs: [{ l: 19.6, d: 4.1, c: C.white, bands: [band(0.78, C.dgrey, 1.6)] }, { l: 2.4, d: 4.1, c: C.grey, truss: true }] },
      { name: 'Second stage', drop: 334, eng: { n: 4, d: 1.2, l: 1.7, ring: 0.5 }, secs: [{ l: 14.0, d: 4.1, c: C.white, bands: [band(0.2, C.dgrey, 1.2)] }, { l: 1.6, d: 4.1, c: C.lgrey }] },
      { name: 'Third stage', drop: 525, eng: { n: 1, d: 1.2, l: 1.6 }, secs: [{ l: 5.0, d: 4.1, c: C.white }] },
      { name: 'Blok D', drop: INF, eng: { n: 1, d: 0.9, l: 1.2 }, secs: [{ l: 4.6, d: 3.7, c: C.lgrey }] },
    ],
    fairing: { d: 4.1, l: 13.5, nose: 4.2, over: 4.6, c: C.white, drop: 344 },
  },
  'Proton-K / Blok DM3': {
    name: 'Proton-K / Blok DM3', h: 57.2,
    stages: [
      { name: 'First stage', drop: 123, eng: { n: 0, d: 1.4, l: 1.6 }, pods: { n: 6, d: 1.6, l: 19.4, c: C.white }, secs: [{ l: 19.6, d: 4.1, c: C.white, bands: [band(0.78, C.dgrey, 1.6)] }, { l: 2.4, d: 4.1, c: C.grey, truss: true }] },
      { name: 'Second stage', drop: 334, eng: { n: 4, d: 1.2, l: 1.7, ring: 0.5 }, secs: [{ l: 14.0, d: 4.1, c: C.white }, { l: 1.6, d: 4.1, c: C.lgrey }] },
      { name: 'Third stage', drop: 525, eng: { n: 1, d: 1.2, l: 1.6 }, secs: [{ l: 5.0, d: 4.1, c: C.white }] },
      { name: 'Blok DM3', drop: INF, eng: { n: 1, d: 0.9, l: 1.2 }, secs: [{ l: 4.6, d: 3.7, c: C.lgrey }] },
    ],
    fairing: { d: 4.35, l: 13.6, nose: 4.6, boat: 0.6, over: 4.6, base: 4.1, c: C.white, drop: 344 },
  },

  // ------------------------------------------------------------------------------------------
  // United States, 1958-1973
  // ------------------------------------------------------------------------------------------
  'Juno II': {
    name: 'Juno II', h: 23.6,
    stages: [
      { name: 'Jupiter first stage', drop: 182, eng: { n: 1, d: 1.3, l: 1.7 }, secs: [{ l: 16.6, d: 2.67, c: C.white, bands: [band(0.3), band(0.62)] }] },
      { name: 'Spinning upper-stage cluster', drop: INF, eng: { n: 1, d: 0.5, l: 0.5 }, secs: [{ l: 0.6, d: 2.67, d2: 0.95, c: C.dgrey }, { l: 1.4, d: 0.95, c: C.white, bands: [band(0.5, C.black, 0.25)] }] },
    ],
    fairing: { d: 2.67, l: 6.0, nose: 4.6, over: 2.0, c: C.white, drop: 200 },
  },
  'Atlas-Agena B': {
    name: 'Atlas-Agena B', h: 30.5,
    stages: [
      { name: 'Atlas booster section', drop: 131, eng: { n: 2, d: 1.2, l: 1.6, ring: 0.62 }, secs: [{ l: 3.0, d: 3.9, d2: 3.05, c: C.steel, f: 'metal' }] },
      { name: 'Atlas sustainer', drop: 285, eng: { n: 1, d: 1.2, l: 1.8 }, secs: [{ l: 14.6, d: 3.05, c: C.steel, f: 'metal' }, { l: 3.1, d: 3.05, d2: 1.52, c: C.steel, f: 'metal' }, { l: 1.3, d: 1.52, c: C.white }] },
      { name: 'Agena B', drop: INF, eng: { n: 1, d: 0.9, l: 1.4 }, inset: 1.2, secs: [{ l: 7.1, d: 1.52, c: C.white, bands: [band(0.12, C.steel, 0.9)] }] },
    ],
    fairing: { d: 1.65, l: 2.2, nose: 1.6, boat: 0.3, c: C.white, drop: 295 },
  },
  'Atlas-Agena D': {
    name: 'Atlas-Agena D', h: 31.7,
    stages: [
      { name: 'Atlas booster section', drop: 129, eng: { n: 2, d: 1.2, l: 1.6, ring: 0.62 }, secs: [{ l: 3.0, d: 3.9, d2: 3.05, c: C.steel, f: 'metal' }] },
      { name: 'Atlas sustainer', drop: 288, eng: { n: 1, d: 1.2, l: 1.8 }, secs: [{ l: 14.6, d: 3.05, c: C.steel, f: 'metal' }, { l: 3.1, d: 3.05, d2: 1.52, c: C.steel, f: 'metal' }, { l: 1.3, d: 1.52, c: C.white }] },
      { name: 'Agena D', drop: INF, eng: { n: 1, d: 0.9, l: 1.4 }, inset: 1.2, secs: [{ l: 6.3, d: 1.52, c: C.white, bands: [band(0.12, C.steel, 0.9)] }] },
    ],
    fairing: { d: 1.65, l: 4.2, nose: 2.4, boat: 0.3, c: C.white, drop: 298 },
  },
  'Atlas-Centaur': {
    name: 'Atlas-Centaur', h: 34.4,
    stages: [
      { name: 'Atlas booster section', drop: 142, eng: { n: 2, d: 1.2, l: 1.6, ring: 0.62 }, secs: [{ l: 3.0, d: 3.9, d2: 3.05, c: C.steel, f: 'metal' }] },
      { name: 'Atlas sustainer', drop: 240, eng: { n: 1, d: 1.2, l: 1.8 }, secs: [{ l: 16.7, d: 3.05, c: C.steel, f: 'metal' }, { l: 4.0, d: 3.05, c: C.white }] },
      { name: 'Centaur D', drop: INF, eng: { n: 2, d: 1.0, l: 1.5, ring: 0.42 }, inset: 3.4, secs: [{ l: 9.1, d: 3.05, c: C.white }] },
    ],
    fairing: { d: 3.05, l: 4.0, nose: 3.0, c: C.white, drop: 200 },
  },
  'Delta E1': {
    name: 'Thor-Delta E1', h: 28.3,
    boosters: [{ name: 'Castor 1 solid motors', slots: 3, d: 0.79, l: 6.0, nose: 'cone', c: C.white, drop: 70 }],
    stages: [
      { name: 'Thor first stage', drop: 150, eng: { n: 1, d: 1.2, l: 1.5 }, secs: [{ l: 16.0, d: 2.44, c: C.white, bands: [band(0.5)] }, { l: 2.0, d: 2.44, d2: 1.4, c: C.white }] },
      { name: 'Delta E second stage', drop: 400, eng: { n: 1, d: 0.7, l: 0.9 }, secs: [{ l: 4.6, d: 1.4, c: C.white }] },
      { name: 'Solid third stage', drop: INF, eng: { n: 1, d: 0.4, l: 0.4 }, secs: [{ l: 1.2, d: 0.9, c: C.lgrey }] },
    ],
    fairing: { d: 1.65, l: 5.0, nose: 2.2, boat: 0.3, over: 1.2, base: 1.4, c: C.white, drop: 170 },
  },
  'Delta 1913': {
    name: 'Delta 1913', h: 35.4,
    boosters: [{ name: 'Castor 2 solid motors', slots: 9, d: 0.79, l: 6.3, nose: 'cone', c: C.white, drop: 95 }],
    stages: [
      { name: 'Extended long-tank Thor', drop: 228, eng: { n: 1, d: 1.2, l: 1.5 }, secs: [{ l: 21.4, d: 2.44, c: C.white, bands: [band(0.42)] }] },
      { name: 'Delta second stage', drop: 520, eng: { n: 1, d: 0.9, l: 1.2 }, secs: [{ l: 5.2, d: 2.44, c: C.white }] },
      { name: 'Solid third stage', drop: INF, eng: { n: 1, d: 0.5, l: 0.5 }, secs: [{ l: 1.4, d: 0.95, c: C.lgrey }] },
    ],
    fairing: { d: 2.44, l: 7.6, nose: 3.0, over: 1.4, c: C.white, drop: 240 },
  },
  'Titan II(23)G': {
    name: 'Titan II(23)G', h: 35.5,
    stages: [
      { name: 'Titan first stage', drop: 150, eng: { n: 2, d: 1.2, l: 1.9, ring: 0.42 }, secs: [{ l: 20.3, d: 3.05, c: C.alu, f: 'metal' }, { l: 1.4, d: 3.05, c: C.dgrey, truss: true }] },
      { name: 'Titan second stage', drop: 330, eng: { n: 1, d: 1.6, l: 2.2 }, secs: [{ l: 7.6, d: 3.05, c: C.alu, f: 'metal' }] },
      { name: 'Star 37FM kick motor', drop: INF, eng: { n: 1, d: 0.5, l: 0.6 }, secs: [{ l: 1.2, d: 1.1, c: C.white }] },
    ],
    fairing: { d: 3.05, l: 6.2, nose: 2.8, over: 1.2, c: C.white, drop: 220 },
  },
  'Athena II': {
    name: 'Athena II', h: 30.5,
    stages: [
      { name: 'Castor 120 first stage', drop: 90, eng: { n: 1, d: 1.5, l: 1.6 }, secs: [{ l: 9.0, d: 2.36, c: C.white }, { l: 1.2, d: 2.36, c: C.lgrey }] },
      { name: 'Castor 120 second stage', drop: 185, eng: { n: 1, d: 1.5, l: 1.6 }, secs: [{ l: 9.0, d: 2.36, c: C.white }, { l: 1.0, d: 2.36, c: C.lgrey }] },
      { name: 'Orbus 21D third stage', drop: 340, eng: { n: 1, d: 1.2, l: 1.3 }, secs: [{ l: 3.1, d: 2.3, c: C.white }] },
      { name: 'Orbit adjust module and trans-lunar stage', drop: INF, eng: { n: 1, d: 0.6, l: 0.6 }, secs: [{ l: 1.0, d: 2.3, c: C.lgrey }] },
    ],
    fairing: { d: 2.36, l: 6.6, nose: 2.6, over: 1.0, c: C.white, drop: 190 },
  },

  // ------------------------------------------------------------------------------------------
  // Japan, Europe
  // ------------------------------------------------------------------------------------------
  'Mu-3SII': {
    name: 'Mu-3SII', h: 27.8,
    boosters: [{ name: 'SB-735 strap-on motors', slots: 2, d: 0.735, l: 9.2, nose: 'cone', c: C.white, drop: 60 }],
    stages: [
      { name: 'M-13 first stage', drop: 75, eng: { n: 1, d: 1.1, l: 1.2 }, fins: { n: 4, span: 1.5, chord: 2.2 }, secs: [{ l: 13.4, d: 1.41, c: C.white, bands: [band(0.5, C.red, 0.6)] }] },
      { name: 'M-23 second stage', drop: 230, eng: { n: 1, d: 0.9, l: 1.0 }, secs: [{ l: 5.9, d: 1.41, c: C.white }] },
      { name: 'M-3B third stage and kick motor', drop: INF, eng: { n: 1, d: 0.6, l: 0.6 }, secs: [{ l: 2.0, d: 1.2, c: C.lgrey }] },
    ],
    fairing: { d: 1.65, l: 7.6, nose: 3.0, boat: 0.3, over: 2.0, base: 1.41, c: C.white, drop: 160 },
  },
  'H-IIA': {
    name: 'H-IIA 202', h: 53,
    boosters: [{ name: 'SRB-A solid boosters', slots: 2, d: 2.5, l: 15.1, nose: 'cone', c: C.white, drop: 125 }],
    stages: [
      { name: 'First stage', drop: 400, eng: { n: 1, d: 2.0, l: 3.0 }, secs: [{ l: 28.6, d: 4.0, c: C.foam, f: 'matte' }, { l: 4.4, d: 4.0, c: C.white }] },
      { name: 'Second stage', drop: INF, eng: { n: 1, d: 1.3, l: 2.2 }, inset: 2.4, secs: [{ l: 9.2, d: 4.0, c: C.foam, f: 'matte' }] },
    ],
    fairing: { d: 4.07, l: 12.0, nose: 5.2, c: C.white, drop: 250 },
  },
  'Ariane 5G': {
    name: 'Ariane 5G', h: 52,
    lift: 1.0,
    boosters: [{ name: 'EAP solid boosters', slots: 2, d: 3.05, l: 31.6, nose: 'slant', c: C.white, drop: 140, y: -1.0 }],
    stages: [
      { name: 'EPC cryogenic main stage', drop: 525, eng: { n: 1, d: 1.76, l: 3.0 }, secs: [{ l: 28.4, d: 5.4, c: C.cream, f: 'matte' }, { l: 1.6, d: 5.4, c: C.dgrey }] },
      { name: 'EPS storable upper stage', drop: INF, eng: { n: 1, d: 0.9, l: 1.2 }, secs: [{ l: 3.3, d: 5.4, c: C.white }] },
    ],
    fairing: { d: 5.4, l: 17.0, nose: 7.5, c: C.white, drop: 190 },
  },

  // ------------------------------------------------------------------------------------------
  // China
  // ------------------------------------------------------------------------------------------
  'Long March 3A': {
    name: 'Long March 3A', h: 52.5,
    stages: [
      { name: 'First stage', drop: 146, eng: { n: 4, d: 1.0, l: 1.5, ring: 0.5 }, fins: { n: 4, span: 1.2, chord: 2.0 }, secs: [{ l: 21.8, d: 3.35, c: C.white, bands: [band(0.9, C.blue, 0.5)] }, { l: 1.5, d: 3.35, c: C.grey, truss: true }] },
      { name: 'Second stage', drop: 265, eng: { n: 1, d: 1.5, l: 2.0 }, secs: [{ l: 9.9, d: 3.35, c: C.white }, { l: 1.4, d: 3.35, d2: 3.0, c: C.white }] },
      { name: 'Cryogenic third stage', drop: INF, eng: { n: 2, d: 0.9, l: 1.4, ring: 0.42 }, secs: [{ l: 9.0, d: 3.0, c: C.white, bands: [band(0.5, C.blue, 0.4)] }] },
    ],
    fairing: { d: 3.35, l: 8.9, nose: 3.6, boat: 0.5, c: C.white, drop: 240 },
  },
  'Long March 3B': {
    name: 'Long March 3B', h: 54.8,
    boosters: [{ name: 'Liquid strap-on boosters', slots: 4, d: 2.25, l: 15.3, nose: 'slant', c: C.white, drop: 140, phase: Math.PI / 4 }],
    stages: [
      { name: 'First stage', drop: 158, eng: { n: 4, d: 1.0, l: 1.5, ring: 0.5 }, secs: [{ l: 21.8, d: 3.35, c: C.white, bands: [band(0.9, C.blue, 0.5)] }, { l: 1.5, d: 3.35, c: C.grey, truss: true }] },
      { name: 'Second stage', drop: 345, eng: { n: 1, d: 1.5, l: 2.0 }, secs: [{ l: 9.9, d: 3.35, c: C.white }, { l: 1.4, d: 3.35, d2: 3.0, c: C.white }] },
      { name: 'Cryogenic third stage', drop: INF, eng: { n: 2, d: 0.9, l: 1.4, ring: 0.42 }, secs: [{ l: 9.0, d: 3.0, c: C.white, bands: [band(0.5, C.blue, 0.4)] }] },
    ],
    fairing: { d: 4.0, l: 11.2, nose: 4.4, boat: 1.0, c: C.white, drop: 250 },
  },
  'Long March 3C': {
    name: 'Long March 3C', h: 54.8,
    boosters: [{ name: 'Liquid strap-on boosters', slots: 2, d: 2.25, l: 15.3, nose: 'slant', c: C.white, drop: 140 }],
    stages: [
      { name: 'First stage', drop: 158, eng: { n: 4, d: 1.0, l: 1.5, ring: 0.5 }, secs: [{ l: 21.8, d: 3.35, c: C.white, bands: [band(0.9, C.blue, 0.5)] }, { l: 1.5, d: 3.35, c: C.grey, truss: true }] },
      { name: 'Second stage', drop: 345, eng: { n: 1, d: 1.5, l: 2.0 }, secs: [{ l: 9.9, d: 3.35, c: C.white }, { l: 1.4, d: 3.35, d2: 3.0, c: C.white }] },
      { name: 'Cryogenic third stage', drop: INF, eng: { n: 2, d: 0.9, l: 1.4, ring: 0.42 }, secs: [{ l: 9.0, d: 3.0, c: C.white, bands: [band(0.5, C.blue, 0.4)] }] },
    ],
    fairing: { d: 4.0, l: 11.2, nose: 4.4, boat: 1.0, c: C.white, drop: 250 },
  },
  'Long March 4C': {
    name: 'Long March 4C', h: 45.8,
    stages: [
      { name: 'First stage', drop: 150, eng: { n: 4, d: 1.0, l: 1.5, ring: 0.5 }, fins: { n: 4, span: 1.2, chord: 2.0 }, secs: [{ l: 23.2, d: 3.35, c: C.white, bands: [band(0.9, C.blue, 0.5)] }, { l: 1.5, d: 3.35, c: C.grey, truss: true }] },
      { name: 'Second stage', drop: 290, eng: { n: 1, d: 1.5, l: 2.0 }, secs: [{ l: 9.2, d: 3.35, c: C.white }, { l: 1.2, d: 3.35, d2: 2.9, c: C.white }] },
      { name: 'Restartable third stage', drop: INF, eng: { n: 2, d: 0.6, l: 0.8, ring: 0.4 }, secs: [{ l: 2.2, d: 2.9, c: C.white }] },
    ],
    fairing: { d: 3.35, l: 8.5, nose: 3.4, boat: 0.5, c: C.white, drop: 200 },
  },
  'Long March 8': {
    name: 'Long March 8', h: 50.3,
    boosters: [{ name: 'Liquid strap-on boosters', slots: 2, d: 2.25, l: 26.9, nose: 'slant', c: C.white, drop: 174 }],
    stages: [
      { name: 'First stage', drop: 180, eng: { n: 2, d: 1.4, l: 2.0, ring: 0.42 }, secs: [{ l: 23.0, d: 3.35, c: C.white, bands: [band(0.92, C.blue, 0.5)] }, { l: 3.0, d: 3.35, d2: 3.0, c: C.white }] },
      { name: 'Hydrogen second stage', drop: INF, eng: { n: 2, d: 0.9, l: 1.4, ring: 0.42 }, inset: 1.5, secs: [{ l: 12.5, d: 3.0, c: C.white }] },
    ],
    fairing: { d: 4.2, l: 13.3, nose: 5.0, boat: 1.2, c: C.white, drop: 250 },
  },
  'Long March 5': {
    name: 'Long March 5', h: 57,
    boosters: [{ name: 'Kerosene strap-on boosters', slots: 4, d: 3.35, l: 27.6, nose: 'slant', c: C.white, drop: 174, phase: Math.PI / 4 }],
    stages: [
      { name: 'Hydrogen core stage', drop: 470, eng: { n: 2, d: 1.5, l: 2.4, ring: 0.42 }, secs: [{ l: 31.0, d: 5.0, c: C.white, bands: [band(0.93, C.blue, 0.5)] }] },
      { name: 'Hydrogen second stage', drop: INF, eng: { n: 2, d: 1.0, l: 1.6, ring: 0.42 }, secs: [{ l: 11.5, d: 5.0, c: C.white }] },
    ],
    fairing: { d: 5.2, l: 12.3, nose: 5.6, c: C.white, drop: 300 },
  },

  // ------------------------------------------------------------------------------------------
  // India
  // ------------------------------------------------------------------------------------------
  'PSLV-XL': {
    name: 'PSLV-XL', h: 44.4,
    boosters: [{ name: 'PSOM-XL strap-on motors', slots: 6, d: 1.0, l: 13.5, nose: 'cone', c: C.white, drop: 92 }],
    stages: [
      { name: 'PS1 solid core', drop: 113, eng: { n: 1, d: 1.9, l: 2.0 }, secs: [{ l: 18.3, d: 2.8, c: C.white, bands: [band(0.3, C.red, 0.7), band(0.7, C.red, 0.7)] }, { l: 1.4, d: 2.8, c: C.lgrey }] },
      { name: 'PS2 liquid stage', drop: 265, eng: { n: 1, d: 1.6, l: 2.0 }, secs: [{ l: 12.8, d: 2.8, c: C.white }] },
      { name: 'PS3 solid stage', drop: 520, eng: { n: 1, d: 1.1, l: 1.2 }, secs: [{ l: 3.6, d: 2.0, c: C.white }] },
      { name: 'PS4 liquid stage', drop: INF, eng: { n: 2, d: 0.4, l: 0.5, ring: 0.4 }, secs: [{ l: 1.4, d: 2.0, c: C.gold, f: 'foil' }] },
    ],
    fairing: { d: 3.2, l: 10.8, nose: 3.4, boat: 0.6, over: 5.0, base: 2.8, c: C.white, drop: 160 },
  },
  'LVM3 (GSLV Mk III)': {
    name: 'LVM3', h: 43.5,
    boosters: [{ name: 'S200 solid boosters', slots: 2, d: 3.2, l: 25, nose: 'slant', c: C.white, drop: 127 }],
    stages: [
      { name: 'L110 liquid core', drop: 305, eng: { n: 2, d: 1.4, l: 2.0, ring: 0.42 }, secs: [{ l: 17.4, d: 4.0, c: C.white }, { l: 2.6, d: 4.0, c: C.lgrey }] },
      { name: 'C25 cryogenic stage', drop: INF, eng: { n: 1, d: 1.4, l: 2.0 }, inset: 0.7, secs: [{ l: 12.8, d: 4.0, c: C.white, bands: [band(0.5, C.dgrey, 0.5)] }] },
    ],
    fairing: { d: 5.0, l: 10.7, nose: 6.4, boat: 1.2, c: C.white, drop: 195 },
  },

  // ------------------------------------------------------------------------------------------
  // United States, 1994 onward
  // ------------------------------------------------------------------------------------------
  'Atlas V 401': {
    name: 'Atlas V 401', h: 58.3,
    stages: [
      { name: 'Common Core Booster', drop: 250, eng: { n: 2, d: 1.45, l: 2.4, ring: 0.3 }, secs: [{ l: 31.0, d: 3.81, c: C.copper, f: 'metal' }, { l: 3.9, d: 3.81, d2: 3.05, c: C.white }] },
      { name: 'Centaur', drop: INF, eng: { n: 1, d: 1.2, l: 2.0 }, inset: 2.7, secs: [{ l: 12.7, d: 3.05, c: C.white }] },
    ],
    fairing: { d: 4.2, l: 12.0, nose: 5.0, boat: 1.2, c: C.white, drop: 262 },
  },
  'Delta II 7920H': {
    name: 'Delta II 7920H-10C', h: 39,
    boosters: [
      { name: 'GEM-46 solid motors (ground-lit)', slots: 9, at: [0, 2, 3, 5, 6, 8], d: 1.17, l: 14.7, nose: 'ogive', c: C.white, drop: 86 },
      { name: 'GEM-46 solid motors (air-lit)', slots: 9, at: [1, 4, 7], d: 1.17, l: 14.7, nose: 'ogive', c: C.white, drop: 160 },
    ],
    stages: [
      { name: 'Extra-extended long-tank Thor', drop: 265, eng: { n: 1, d: 1.4, l: 2.0 }, secs: [{ l: 24.6, d: 2.44, c: C.teal }, { l: 4.4, d: 2.44, c: C.teal }] },
      { name: 'Delta K second stage', drop: INF, eng: { n: 1, d: 0.9, l: 1.4 }, inset: 4.0, secs: [{ l: 5.9, d: 2.2, c: C.gold, f: 'foil' }] },
    ],
    fairing: { d: 3.0, l: 8.9, nose: 3.6, boat: 0.9, over: 1.9, base: 2.44, c: C.white, drop: 285 },
  },
  'Minotaur V': {
    name: 'Minotaur V', h: 24.6,
    stages: [
      { name: 'SR118 first stage', drop: 57, eng: { n: 1, d: 1.5, l: 1.4 }, secs: [{ l: 7.2, d: 2.34, c: C.white, bands: [band(0.5, C.black, 0.4)] }, { l: 1.0, d: 2.34, c: C.dgrey }] },
      { name: 'SR119 second stage', drop: 117, eng: { n: 1, d: 1.4, l: 1.3 }, secs: [{ l: 4.6, d: 2.34, c: C.white }, { l: 0.8, d: 2.34, c: C.dgrey }] },
      { name: 'SR120 third stage', drop: 190, eng: { n: 1, d: 1.2, l: 1.1 }, secs: [{ l: 2.4, d: 2.34, c: C.white }] },
      { name: 'Star 48BV fourth stage', drop: 400, eng: { n: 1, d: 0.7, l: 0.8 }, secs: [{ l: 1.4, d: 1.25, c: C.lgrey }] },
      { name: 'Star 37FM fifth stage', drop: INF, eng: { n: 1, d: 0.5, l: 0.6 }, secs: [{ l: 1.1, d: 0.95, c: C.white }] },
    ],
    fairing: { d: 2.34, l: 7.8, nose: 2.8, over: 2.5, c: C.white, drop: 130 },
  },
  'Electron / Lunar Photon': {
    name: 'Electron', h: 18,
    stages: [
      { name: 'First stage', drop: 150, eng: { n: 9, d: 0.26, l: 0.4, ring: 0.68, centre: true }, secs: [{ l: 11.0, d: 1.2, c: C.black, f: 'matte' }, { l: 1.1, d: 1.2, c: C.black, f: 'matte' }] },
      { name: 'Second stage', drop: 535, eng: { n: 1, d: 0.55, l: 0.9 }, secs: [{ l: 2.4, d: 1.2, c: C.black, f: 'matte' }] },
      { name: 'Lunar Photon', drop: INF, eng: { n: 1, d: 0.25, l: 0.3 }, secs: [{ l: 0.9, d: 1.1, c: C.black, f: 'matte' }] },
    ],
    fairing: { d: 1.2, l: 3.4, nose: 1.5, over: 0.9, c: C.black, drop: 185 },
  },
  'SLS Block 1': {
    name: 'Space Launch System Block 1', h: 98.1,
    lift: 2.6,
    boosters: [{ name: 'Five-segment solid rocket boosters', slots: 2, d: 3.71, l: 54, nose: 'cone', c: C.white, drop: 126, y: -2.6 }],
    stages: [
      { name: 'Core stage', drop: 480, eng: { n: 4, d: 2.3, l: 3.4, ring: 0.5 }, secs: [{ l: 62.6, d: 8.4, c: C.foam, f: 'matte' }, { l: 8.4, d: 8.4, d2: 5.4, c: C.foam, f: 'matte' }] },
      { name: 'Interim Cryogenic Propulsion Stage', drop: INF, eng: { n: 1, d: 1.8, l: 2.6 }, inset: 9.0, secs: [{ l: 3.4, d: 3.2, c: C.foam, f: 'matte' }, { l: 1.0, d: 3.2, d2: 5.1, c: C.foam, f: 'matte' }, { l: 4.6, d: 5.1, c: C.foam, f: 'matte' }, { l: 1.5, d: 5.4, c: C.white }] },
    ],
    fairing: { d: 5.2, l: 5.0, nose: 0, c: C.white, drop: 200, las: { l: 15.4, d: 5.2 } },
  },
  'Vulcan Centaur VC2S': {
    name: 'Vulcan Centaur VC2S', h: 61.6,
    boosters: [{ name: 'GEM 63XL solid boosters', slots: 2, d: 1.6, l: 21.9, nose: 'ogive', c: C.white, drop: 110 }],
    stages: [
      { name: 'Vulcan booster', drop: 300, eng: { n: 2, d: 1.9, l: 2.6, ring: 0.42 }, secs: [{ l: 29.0, d: 5.4, c: C.white, bands: [band(0.2, C.red, 1.4)] }, { l: 2.9, d: 5.4, c: C.lgrey }] },
      { name: 'Centaur V', drop: INF, eng: { n: 2, d: 1.4, l: 2.2, ring: 0.42 }, inset: 1.0, secs: [{ l: 13.8, d: 5.4, c: C.steel, f: 'metal' }] },
    ],
    fairing: { d: 5.4, l: 15.5, nose: 6.6, c: C.white, drop: 320 },
  },
  'Falcon 9 Block 5': {
    name: 'Falcon 9 Block 5', h: 70,
    stages: [
      { name: 'First stage', drop: 150, legs: true, eng: { n: 9, d: 0.92, l: 1.2, ring: 0.7, centre: true }, secs: [{ l: 40.4, d: 3.66, c: C.white }, { l: 6.5, d: 3.66, c: C.black, f: 'matte' }] },
      { name: 'Second stage', drop: INF, eng: { n: 1, d: 2.5, l: 2.8 }, inset: 2.9, secs: [{ l: 12.5, d: 3.66, c: C.white }] },
    ],
    fairing: { d: 5.2, l: 13.1, nose: 6.0, boat: 1.6, c: C.white, drop: 200 },
  },

  // Used only if the NASA Saturn V model file is missing.
  'Saturn V': {
    name: 'Saturn V', h: 110.6,
    stages: [
      { name: 'S-IC first stage', drop: 162, eng: { n: 5, d: 3.7, l: 5.6, ring: 0.62, centre: true }, fins: { n: 4, span: 2.6, chord: 5.5 }, secs: [{ l: 38.6, d: 10.1, c: C.white, bands: [band(0.1, C.black, 3), band(0.6, C.black, 3)] }] },
      { name: 'S-II second stage', drop: 520, eng: { n: 5, d: 2.0, l: 3.0, ring: 0.5, centre: true }, secs: [{ l: 24.9, d: 10.1, c: C.white }, { l: 5.8, d: 10.1, d2: 6.6, c: C.white }] },
      { name: 'S-IVB third stage', drop: INF, eng: { n: 1, d: 2.0, l: 3.0 }, secs: [{ l: 12.0, d: 6.6, c: C.white, bands: [band(0.9, C.black, 0.9)] }] },
    ],
    fairing: { d: 6.6, l: 16.0, nose: 14.0, c: C.white, drop: 195, las: { l: 10.0, d: 3.9 } },
  },
};

// Fallbacks by vehicle class, for catalogue entries whose exact vehicle is not listed above.
const BY_CLASS: Record<string, string> = {
  r7: 'Molniya 8K78 (R-7)', proton: 'Proton-K / Blok D', atlas: 'Atlas-Agena D', delta: 'Delta E1', delta2: 'Delta II 7920H', titan: 'Titan II(23)G', atlas5: 'Atlas V 401',
  sls: 'SLS Block 1', vulcan: 'Vulcan Centaur VC2S', falcon9: 'Falcon 9 Block 5', electron: 'Electron / Lunar Photon', h2a: 'H-IIA', ariane5: 'Ariane 5G', lm3: 'Long March 3B',
  lm5: 'Long March 5', pslv: 'PSLV-XL', lvm3: 'LVM3 (GSLV Mk III)', 'saturn-v': 'Saturn V', small: 'Athena II',
};

export function vehicleFor(vehicleName: string, vehicleClass: string): Vehicle {
  return VEHICLES[vehicleName] ?? VEHICLES[BY_CLASS[vehicleClass] ?? 'Athena II'];
}
export const VEHICLE_NAMES = Object.keys(VEHICLES);

// ---------------------------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------------------------
export interface Exhaust { x: number; y: number; z: number; r: number }
interface Part {
  obj: THREE.Object3D;
  name: string;
  kind: 'stage' | 'booster' | 'half' | 'tower';
  drop: number;
  ignite: number;
  /** Base of the part above the ground, m, and the engines it carries (m). */
  base: number;
  top: number;
  engines: Exhaust[];
  /** Direction it leaves in. */
  out: THREE.Vector3;
  /** Where its pivot sits while attached. */
  home: THREE.Vector3;
}
export interface Rocket {
  object: THREE.Group;
  lengthKm: number;
  /** Where the spacecraft rides, km above the base of what is still attached. */
  payloadY: number;
  fairingDrop: number;
  name: string;
  heightM: number;
  /** Sets the vehicle to `t` seconds after liftoff; returns the engines that are firing (km). */
  update(t: number, burn: boolean): Exhaust[];
  stageName(t: number): string;
}

function engines(g: THREE.Group, e: Eng, r: number, yExit: number): Exhaust[] {
  const out: Exhaust[] = [];
  const ring = e.centre ? e.n - 1 : e.n;
  const put = (x: number, z: number) => { g.add(bell(e.d, e.l, yExit).translateX(x).translateZ(z)); out.push({ x, y: yExit, z, r: e.d / 2 }); };
  if (e.n === 1 || e.centre) put(0, 0);
  if (e.n > 1) for (let i = 0; i < ring; i++) { const a = (i / ring) * Math.PI * 2 + Math.PI / ring; put(Math.cos(a) * r * (e.ring ?? 0.55), Math.sin(a) * r * (e.ring ?? 0.55)); }
  return out;
}

function sections(g: THREE.Group, secs: Sec[], y: number, shrinkBelow = -Infinity): number {
  for (const s of secs) {
    const k = y < shrinkBelow ? 0.97 : 1;
    if (s.truss) g.add(truss(s.d, s.d2 ?? s.d, s.l, y, mat(s.c, 'metal')));
    else g.add(tube(s.d * k, (s.d2 ?? s.d) * k, s.l, y, mat(s.c, s.f ?? 'paint'), 48));
    for (const [at, w, c] of s.bands ?? []) {
      const d = s.d + ((s.d2 ?? s.d) - s.d) * at;
      g.add(tube(d * 1.006, d * 1.006, w, y + s.l * at - w / 2, mat(c, 'matte'), 48, true));
    }
    y += s.l;
  }
  return y;
}

function boosterBody(b: Booster, inward: THREE.Vector3, dist: number): { g: THREE.Group; engines: Exhaust[] } {
  const g = new THREE.Group();
  const m = mat(b.c, b.f ?? 'paint'), r = b.d / 2, nozzle = Math.min(1.6, b.l * 0.06);
  if (b.nose === 'r7') {
    // A tapered block that leans in so that its tip rests against the core.
    const body = lathe([[r * 0.92, nozzle], [r, nozzle + b.l * 0.04], [r, b.l * 0.2], [0.24, b.l * 0.95], [0, b.l]], m, 32);
    const leanBy = Math.max(0, dist - (b.meet ?? b.d) / 2 - 0.24);
    g.add(lean(body, b.l * 0.2, b.l * 0.8, inward.x * leanBy, inward.z * leanBy));
  } else {
    const noseL = b.nose === 'ogive' ? b.d * 1.6 : b.nose === 'slant' ? b.d * 1.5 : b.d * 1.3;
    g.add(tube(b.d, b.d, b.l - noseL - nozzle, nozzle, m, 32));
    const nose = b.nose === 'ogive' ? lathe(ogiveProfile(b.d, noseL, b.l - noseL), m, 32) : lathe([[r, b.l - noseL], [r * 0.08, b.l - noseL * 0.04], [0, b.l]], m, 32);
    if (b.nose === 'slant') lean(nose, b.l - noseL, noseL, inward.x * r * 0.85, inward.z * r * 0.85);
    g.add(nose);
    g.add(tube(b.d * 1.01, b.d * 1.01, 0.3, nozzle + (b.l - noseL) * 0.5, mat(C.dgrey, 'matte'), 32, true));
  }
  g.add(bell(b.d * 0.62, nozzle * 1.4, 0));
  return { g, engines: [{ x: 0, y: 0, z: 0, r: b.d * 0.31 }] };
}

/** Builds a launch vehicle. The result is in scene kilometres, base at y = 0, nose along +Y. */
export function buildRocket(v: Vehicle): Rocket {
  const root = new THREE.Group(), stack = new THREE.Group();
  root.add(stack);
  stack.scale.setScalar(M);
  const parts: Part[] = [];
  /** Mounts a part on a pivot at its own base, so that it turns about that point when it separates. */
  const add = (inner: THREE.Object3D, absolute: boolean, p: Omit<Part, 'obj' | 'home'> & { home: [number, number, number] }) => {
    const pivot = new THREE.Group();
    pivot.position.set(...p.home);
    if (absolute) inner.position.set(-p.home[0], -p.home[1], -p.home[2]);
    pivot.add(inner);
    stack.add(pivot);
    parts.push({ ...p, obj: pivot, home: new THREE.Vector3(...p.home) });
  };

  // Core stages, bottom to top.
  let y = v.lift ?? 0, prevTop = y, prevDrop = 0;
  for (const [i, s] of v.stages.entries()) {
    const g = new THREE.Group();
    const base = i === 0 ? y : y - (s.inset ?? 0);
    const tank = i === 0 ? base + s.eng.l * 0.55 : base;
    const r0 = s.secs[0].d / 2;
    const eng = s.eng.n > 0 ? engines(g, s.eng, r0, i === 0 ? base : base - s.eng.l * 0.8) : [];
    const top = sections(g, s.secs, tank, i === 0 ? -Infinity : prevTop);
    if (s.pods) {
      // Proton: fuel tanks around the core, an engine under each.
      const p = s.pods;
      for (let k = 0; k < p.n; k++) {
        const a = (k / p.n) * Math.PI * 2, d = r0 + p.d * 0.42, x = Math.cos(a) * d, z = Math.sin(a) * d;
        const pod = new THREE.Group();
        pod.add(tube(p.d, p.d, p.l - p.d * 1.4, tank, mat(p.c), 24), lathe([[p.d / 2, tank + p.l - p.d * 1.4], [0.1, tank + p.l - 0.1], [0, tank + p.l]], mat(p.c), 24));
        pod.add(tube(p.d * 1.01, p.d * 1.01, 1.2, tank + p.l * 0.55, mat(C.dgrey, 'matte'), 24, true));
        pod.add(bell(s.eng.d, s.eng.l, base));
        pod.position.set(x, 0, z);
        g.add(pod);
        eng.push({ x, y: base, z, r: s.eng.d / 2 });
      }
    }
    if (s.fins) for (let k = 0; k < s.fins.n; k++) {
      const a = (k / s.fins.n) * Math.PI * 2 + Math.PI / 4;
      const fin = box(s.fins.span, s.fins.chord, 0.12, r0 + s.fins.span / 2, tank + s.fins.chord / 2, 0, mat(C.lgrey));
      const holder = new THREE.Group();
      holder.add(fin);
      holder.rotation.y = a;
      g.add(holder);
    }
    if (s.legs) for (let k = 0; k < 4; k++) {
      // Falcon 9: landing legs folded against the tank, grid fins on the interstage.
      const holder = new THREE.Group();
      holder.add(box(0.35, 9.5, 1.5, r0 + 0.16, tank + 5.2, 0, mat(C.black, 'matte')));
      holder.add(box(0.25, 1.4, 1.9, r0 + 0.12, top - 3.2, 0, mat(C.dgrey, 'metal')));
      holder.rotation.y = (k / 4) * Math.PI * 2 + Math.PI / 4;
      g.add(holder);
    }
    const low = i === 0 || s.eng.n === 0 ? base : base - s.eng.l * 0.8;
    add(g, true, { name: s.name, kind: 'stage', drop: s.drop, ignite: i === 0 ? 0 : prevDrop, base: low, top, engines: eng, out: new THREE.Vector3(), home: [0, low, 0] });
    prevTop = top;
    prevDrop = s.drop;
    y = top;
  }
  const stackTop = y;

  // Strap-on boosters around the first stage.
  const r0 = v.stages[0].secs[0].d / 2;
  for (const b of v.boosters ?? []) {
    for (const k of b.at ?? Array.from({ length: b.slots }, (_, i) => i)) {
      const a = (k / b.slots) * Math.PI * 2 + (b.phase ?? 0);
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const dist = r0 + b.d / 2 + (b.nose === 'r7' ? 0.02 : 0.12);
      const { g, engines: eng } = boosterBody(b, out.clone().negate(), dist);
      const by = (v.lift ?? 0) + (b.y ?? 0);
      add(g, false, { name: b.name, kind: 'booster', drop: b.drop, ignite: 0, base: by, top: by + b.l, engines: eng.map((e) => ({ ...e, x: out.x * dist, y: by, z: out.z * dist })), out, home: [out.x * dist, by, out.z * dist] });
    }
  }

  // Payload fairing in two halves, and the launch escape system of a crewed vehicle.
  let fairingTop = stackTop, fairingDrop = 0;
  const f = v.fairing;
  if (f) {
    const below = v.stages[v.stages.length - 1].secs.at(-1)!;
    const fb = stackTop - (f.over ?? 0);
    const baseD = f.base ?? (f.over ? f.d : below.d2 ?? below.d), boat = f.boat ?? 0;
    const prof: [number, number][] = [[baseD / 2, fb]];
    if (boat > 0) prof.push([f.d / 2, fb + boat]);
    else if (Math.abs(baseD - f.d) > 0.01) prof.push([f.d / 2, fb + 0.01]);
    const cylTop = fb + f.l - f.nose;
    if (f.nose > 0) prof.push(...ogiveProfile(f.d, f.nose, cylTop).map(([r, yy], i): [number, number] => (i === 0 ? [f.d / 2, cylTop] : [r, yy])));
    else prof.push([f.d / 2, cylTop]);
    const m = mat(f.c, f.c === C.black ? 'matte' : 'paint');
    for (const half of [1, 2] as const) {
      const g = new THREE.Group();
      g.add(lathe(prof, m, 48, half));
      add(g, true, { name: 'Payload fairing', kind: 'half', drop: f.drop, ignite: INF, base: fb, top: fb + f.l, engines: [], out: new THREE.Vector3(half === 1 ? 1 : -1, 0, 0), home: [0, fb, 0] });
    }
    fairingTop = fb + f.l;
    fairingDrop = f.drop;
    if (f.las) {
      const g = new THREE.Group(), white = mat(C.white);
      const cover = f.las.l * 0.4, tower = f.las.l - cover;
      g.add(lathe([[f.las.d / 2, cylTop], ...ogiveProfile(f.las.d, cover, cylTop, 0.3).slice(1, -1), [0.45, cylTop + cover]], white, 40));
      g.add(tube(0.9, 0.9, tower * 0.8, cylTop + cover, white, 20), lathe([[0.45, cylTop + cover + tower * 0.8], [0, cylTop + f.las.l]], white, 20));
      for (let k = 0; k < 4; k++) g.add(bell(0.5, 0.9, cylTop + cover + tower * 0.42).translateX(Math.cos(k * Math.PI / 2) * 0.55).translateZ(Math.sin(k * Math.PI / 2) * 0.55));
      add(g, true, { name: 'Launch escape system', kind: 'tower', drop: f.drop + 4, ignite: INF, base: cylTop, top: cylTop + f.las.l, engines: [], out: new THREE.Vector3(0.3, 0, 0.2), home: [0, cylTop, 0] });
      fairingTop = cylTop + f.las.l;
    }
  }

  const rocket: Rocket = {
    object: root, lengthKm: fairingTop * M, payloadY: stackTop * M, fairingDrop, name: v.name, heightM: v.h,
    stageName: (t) => parts.find((p) => p.kind === 'stage' && t < p.drop)?.name ?? parts[parts.length - 1].name,
    update(t, burn) {
      let base = Infinity, top = 0;
      for (const p of parts) if (t < p.drop) { if (p.kind === 'stage' || p.kind === 'booster') base = Math.min(base, p.base); top = Math.max(top, p.top); }
      if (!Number.isFinite(base)) base = 0;
      // What is still attached stands on y = 0; what has separated falls away behind it.
      stack.position.y = -base * M;
      const firing: Exhaust[] = [];
      const lowest = parts.find((p) => p.kind === 'stage' && t < p.drop);
      for (const p of parts) {
        const tau = t - p.drop, h = p.home;
        if (tau < 0) {
          p.obj.visible = true;
          p.obj.position.copy(h);
          p.obj.rotation.set(0, 0, 0);
          const lit = burn && t >= 0 && t >= p.ignite && (p.kind === 'booster' || p === lowest);
          if (lit) for (const e of p.engines) firing.push({ x: e.x * M, y: (e.y - base) * M, z: e.z * M, r: e.r * M });
          continue;
        }
        p.obj.visible = tau < 45;
        if (!p.obj.visible) continue;
        if (p.kind === 'stage') {
          p.obj.position.set(h.x + 0.02 * tau * tau, h.y - (5 * tau + 0.9 * tau * tau), h.z);
          p.obj.rotation.set(Math.min(0.5, 0.0006 * tau * tau), 0, 0);
        } else if (p.kind === 'booster') {
          p.obj.position.set(h.x + p.out.x * 3.5 * tau, h.y - (2 * tau + 0.8 * tau * tau), h.z + p.out.z * 3.5 * tau);
          const tilt = Math.min(1.1, 0.035 * tau);
          p.obj.rotation.set(p.out.z * tilt, 0, -p.out.x * tilt);
        } else if (p.kind === 'half') {
          p.obj.position.set(h.x + p.out.x * (2.5 * tau + 0.2 * tau * tau), h.y - 0.6 * tau * tau, h.z);
          p.obj.rotation.set(0, 0, -p.out.x * Math.min(1.3, 0.1 * tau));
        } else {
          p.obj.position.set(h.x + p.out.x * 6 * tau, h.y + 30 * tau + 6 * tau * tau, h.z + p.out.z * 6 * tau);
          p.obj.rotation.set(0, 0, -Math.min(0.9, 0.03 * tau));
        }
      }
      rocket.lengthKm = Math.max(1, top - base) * M;
      rocket.payloadY = (stackTop - base) * M;
      return firing;
    },
  };
  rocket.update(-1, false);
  return rocket;
}
