// Curated landing-site catalogue. Every entry carries where its coordinates came from.
//
// Longitudes are east-positive in (-180, 180]; latitudes north-positive; both selenographic
// in the Moon Mean-Earth / Polar-Axis (MOON_ME) frame used by LOLA and LROC products.

export type SiteGroup = 'artemis' | 'polar' | 'clps' | 'international' | 'apollo' | 'custom';

export interface SiteDef {
  id: string;
  name: string;
  group: SiteGroup;
  lat: number;
  lon: number;
  /** One line a non-specialist can read. */
  blurb: string;
  /** Key into SOURCES. */
  source: keyof typeof SOURCES;
  /**
   * The PGDA tiles frame a candidate *region* (16-30 km across), and ridge, rim and massif
   * sites are extremely sensitive to position (tens of metres change the skyline). For these
   * the terrain pipeline analyses the highest cell (on the finest LOLA grid covering the
   * area) within 4 km of the tile centre and records the shift, so the point studied is the
   * high ground the region was chosen for.
   */
  snapToPeak?: boolean;
  /** NASA PGDA LOLA 5 m/px tile this site corresponds to. */
  pgdaTile?: string;
  /** Landing date for missions that have flown (UTC, ISO). */
  landed?: string;
}

export const SOURCES = {
  pgda: {
    label: 'NASA GSFC PGDA, High-Resolution LOLA Topography for Lunar South Pole Sites (Barker et al. 2021)',
    url: 'https://pgda.gsfc.nasa.gov/products/78',
    note: 'Centre of the 5 m/px site tile, read from the GeoTIFF georeferencing (south polar stereographic, MOON_ME / DE421). Site names follow Mazarico et al. 2011.',
  },
  nssdca: {
    label: 'NASA NSSDCA, lunar landing and impact site coordinates',
    url: 'https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_artifact_impacts.html',
    note: 'LRO-derived coordinates of spacecraft on the lunar surface.',
  },
  lroc: {
    label: 'LROC (NASA/GSFC/Arizona State University) featured-site pages',
    url: 'https://www.lroc.asu.edu/',
    note: 'Landing-region coordinates published by the LROC team.',
  },
  iau: {
    label: 'IAU / USGS Gazetteer of Planetary Nomenclature',
    url: 'https://planetarynames.wr.usgs.gov/',
    note: 'Catalogued centre of the named crater.',
  },
  user: {
    label: 'User-entered coordinates',
    url: '',
    note: 'Custom point; interpreted as selenographic latitude / east longitude on the 1737.4 km sphere.',
  },
} as const;

export const GROUPS: { id: SiteGroup; label: string; hint: string }[] = [
  { id: 'artemis', label: 'Artemis III candidate regions', hint: 'The 13 south-pole regions NASA announced in 2022' },
  { id: 'polar', label: 'South-pole science sites', hint: 'Rims, ridges and shadowed craters mapped at 5 m/px by LOLA' },
  { id: 'clps', label: 'CLPS & commercial landers', hint: 'NASA Commercial Lunar Payload Services deliveries' },
  { id: 'international', label: 'International missions', hint: 'ISRO, JAXA and CNSA landers' },
  { id: 'apollo', label: 'Apollo', hint: 'Crewed landings, 1969-1972' },
  { id: 'custom', label: 'Custom sites', hint: 'Your own coordinates' },
];

const pgda = (id: string, tile: string, name: string, lat: number, lonE: number, blurb: string, group: SiteGroup, snapToPeak: boolean): SiteDef => ({
  id, name, group, lat, lon: lonE > 180 ? +(lonE - 360).toFixed(4) : lonE, blurb, source: 'pgda', snapToPeak, pgdaTile: tile,
});

export const SITES: SiteDef[] = [
  // --- Artemis III candidate regions (NASA, August 2022), located via their PGDA LOLA tiles ---
  pgda('connecting-ridge', 'Site01', 'Connecting Ridge', -89.4632, 222.51, 'Ridge between Shackleton and de Gerlache: among the best-lit ground on the Moon.', 'artemis', true),
  pgda('connecting-ridge-ext', 'SL3', 'Connecting Ridge Extension', -89.0324, 258.001, 'Continuation of the ridge toward de Gerlache crater.', 'artemis', true),
  pgda('peak-near-shackleton', 'Site07', 'Peak near Shackleton', -88.811, 123.69, 'Isolated summit beside Shackleton with long sunlit seasons.', 'artemis', true),
  pgda('de-gerlache-rim-1', 'Site11', 'de Gerlache Rim 1', -88.6834, 292.068, 'High point on the rim of de Gerlache crater.', 'artemis', true),
  pgda('de-gerlache-rim-2', 'SL2', 'de Gerlache Rim 2', -88.23, 295.372, 'Second candidate on the de Gerlache rim.', 'artemis', true),
  pgda('de-gerlache-kocher', 'Site42', 'de Gerlache-Kocher Massif', -85.8296, 243.678, 'Massif between de Gerlache and Kocher craters.', 'artemis', true),
  pgda('haworth', 'Haworth', 'Haworth', -86.7639, 337.223, 'Terrain beside the permanently shadowed Haworth crater.', 'artemis', false),
  pgda('malapert-massif', 'Site23', 'Malapert Massif', -85.9948, 359.764, 'A 5 km high mountain on the Earth-facing side of the pole.', 'artemis', true),
  pgda('leibnitz-beta', 'Site20', 'Leibnitz Beta Plateau (Mons Mouton)', -85.4266, 31.743, 'Broad summit plateau of Mons Mouton, the Moon’s tallest south-polar mountain.', 'artemis', true),
  pgda('nobile-rim-1', 'Site06', 'Nobile Rim 1', -85.4381, 37.367, 'High ground west of Nobile crater, on the flank of Mons Mouton.', 'artemis', true),
  pgda('nobile-rim-2', 'DM2', 'Nobile Rim 2', -83.954, 58.822, 'Eastern candidate on the Nobile rim.', 'artemis', true),
  pgda('amundsen-rim', 'DM1', 'Amundsen Rim', -84.2287, 69.444, 'Rim of the 100 km Amundsen crater.', 'artemis', true),
  pgda('faustini-rim-a', 'LM7', 'Faustini Rim A', -87.8897, 90, 'Rim of the permanently shadowed Faustini crater.', 'artemis', true),

  // --- Other south-pole sites with LOLA 5 m/px coverage ---
  pgda('shackleton-rim', 'Site04', 'Shackleton Rim', -89.7668, 188.13, 'Rim of Shackleton, 7 km from the pole.', 'polar', true),
  pgda('shackleton-rim-b', 'LM1', 'Shackleton Rim B', -89.5244, 56.31, 'Opposite rim of Shackleton crater.', 'polar', true),
  { id: 'shackleton-floor', name: 'Shackleton crater floor', group: 'polar', lat: -89.67, lon: 129.78, blurb: 'Bottom of a 4 km deep crater at the pole: a cold trap that never sees the Sun or the Earth.', source: 'iau' },
  pgda('shoemaker-faustini', 'Shoemaker', 'Shoemaker–Faustini plain', -87.1835, 62.835, 'Inter-crater terrain between the Shoemaker and Faustini cold traps.', 'polar', false),
  pgda('shoemaker-rim-a', 'LM2', 'Shoemaker Rim A', -88.0792, 11.889, 'Rim site above the Shoemaker cold trap.', 'polar', true),
  pgda('shoemaker-rim-c', 'LM4', 'Shoemaker Rim C', -88.9645, 37.235, 'Rim site between Shoemaker and Shackleton.', 'polar', true),
  pgda('shoemaker-rim-e', 'LM6', 'Shoemaker Rim E', -87.9458, 71.274, 'Rim site between Shoemaker and Faustini.', 'polar', true),
  pgda('cabeus-wall', 'NPA', 'Cabeus Exterior Wall', -86.9243, 288.435, 'Outer wall of Cabeus, where LCROSS detected water in 2009.', 'polar', false),
  pgda('amundsen-1', 'NPB', 'Amundsen 1', -83.9046, 89.535, 'Science site inside Amundsen crater.', 'polar', false),
  pgda('idelson-l', 'NPC', "Idel'son L", -84.5397, 126.904, 'Science site at Idel’son L crater on the far-side edge of the polar region.', 'polar', false),
  pgda('malapert-crater', 'NPD', 'Malapert Crater', -84.8034, 8.387, 'Science site in Malapert crater, north of the massif.', 'polar', false),

  // --- CLPS and commercial ---
  { id: 'im1-odysseus', name: 'IM-1 Odysseus (Malapert A)', group: 'clps', lat: -80.13, lon: 1.44, blurb: 'First commercial soft landing; tipped on touchdown near Malapert A.', source: 'nssdca', landed: '2024-02-22T23:24:00Z' },
  { id: 'im2-athena', name: 'IM-2 Athena (Mons Mouton)', group: 'clps', lat: -84.7906, lon: 29.1957, blurb: 'Southernmost landing to date; came to rest on its side in a shadowed crater.', source: 'lroc', landed: '2025-03-06T17:30:00Z' },
  { id: 'blue-ghost-1', name: 'Blue Ghost M1 (Mare Crisium)', group: 'clps', lat: 18.56, lon: 61.81, blurb: 'Fully successful CLPS landing; operated a full lunar day and into the night.', source: 'lroc', landed: '2025-03-02T08:34:00Z' },

  // --- International ---
  { id: 'chandrayaan-3', name: 'Chandrayaan-3 (Shiv Shakti)', group: 'international', lat: -69.373, lon: 32.319, blurb: 'ISRO’s Vikram lander: first landing near the lunar south polar region.', source: 'nssdca', landed: '2023-08-23T12:33:00Z' },
  { id: 'slim', name: 'SLIM (Shioli crater)', group: 'international', lat: -13.316, lon: 25.251, blurb: 'JAXA’s pinpoint lander: touched down within 100 m of its target.', source: 'nssdca', landed: '2024-01-19T15:20:00Z' },
  { id: 'change-4', name: "Chang'e 4 (Von Kármán)", group: 'international', lat: -45.4446, lon: 177.5991, blurb: 'First far-side landing. Earth never rises here, so it needs a relay satellite.', source: 'nssdca', landed: '2019-01-03T02:26:00Z' },
  { id: 'change-6', name: "Chang'e 6 (Apollo basin)", group: 'international', lat: -41.6385, lon: -153.9852, blurb: 'First sample return from the far side.', source: 'nssdca', landed: '2024-06-01T22:23:00Z' },
  { id: 'change-5', name: "Chang'e 5 (Mons Rümker)", group: 'international', lat: 43.0576, lon: -51.9161, blurb: 'Sample return from young volcanic plains.', source: 'nssdca', landed: '2020-12-01T15:11:00Z' },
  { id: 'change-3', name: "Chang'e 3 (Mare Imbrium)", group: 'international', lat: 44.1214, lon: -19.5116, blurb: 'China’s first lunar landing, with the Yutu rover.', source: 'nssdca', landed: '2013-12-14T13:11:00Z' },

  // --- Apollo ---
  { id: 'apollo-11', name: 'Apollo 11 (Tranquility Base)', group: 'apollo', lat: 0.67416, lon: 23.47314, blurb: 'First crewed landing, on the flat Sea of Tranquility.', source: 'nssdca', landed: '1969-07-20T20:17:00Z' },
  { id: 'apollo-12', name: 'Apollo 12 (Ocean of Storms)', group: 'apollo', lat: -3.0128, lon: -23.4219, blurb: 'Precision landing beside Surveyor 3.', source: 'nssdca', landed: '1969-11-19T06:54:00Z' },
  { id: 'apollo-14', name: 'Apollo 14 (Fra Mauro)', group: 'apollo', lat: -3.64589, lon: -17.47194, blurb: 'Highland landing at Fra Mauro.', source: 'nssdca', landed: '1971-02-05T09:18:00Z' },
  { id: 'apollo-15', name: 'Apollo 15 (Hadley-Apennine)', group: 'apollo', lat: 26.13239, lon: 3.6333, blurb: 'Beside Hadley Rille under 4 km high Apennine mountains.', source: 'nssdca', landed: '1971-07-30T22:16:00Z' },
  { id: 'apollo-16', name: 'Apollo 16 (Descartes)', group: 'apollo', lat: -8.9734, lon: 15.5011, blurb: 'Central lunar highlands.', source: 'nssdca', landed: '1972-04-21T02:23:00Z' },
  { id: 'apollo-17', name: 'Apollo 17 (Taurus-Littrow)', group: 'apollo', lat: 20.1911, lon: 30.7723, blurb: 'Deep valley ringed by 2 km massifs: the last crewed landing.', source: 'nssdca', landed: '1972-12-11T19:54:00Z' },
];

/** Observer heights (m above the local surface) for which terrain masks are precomputed. */
export const OBSERVER_HEIGHTS_M = [2, 10];
