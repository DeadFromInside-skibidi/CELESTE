// GLSL for the two 3D views. World units: globe view = lunar radii in the Moon-fixed frame
// (+X mean sub-Earth meridian, +Z north); polar view = hundreds of kilometres in the LOLA
// south-polar stereographic plane (+X = 90 deg E, +Y = 0 deg E, +Z = up).

export const GLOBE_VERT = /* glsl */ `
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const GLOBE_FRAG = /* glsl */ `
uniform sampler2D albedoMap;
uniform sampler2D normalMap;
uniform float hasNormal;
uniform vec3 sunDir;
uniform vec3 earthDir;
uniform vec3 camPos;
uniform float gridOn;
varying vec3 vPos;
const float PI = 3.141592653589793;

void main() {
  vec3 n = normalize(vPos);
  float lon = atan(n.y, n.x);
  float v = asin(clamp(n.z, -1.0, 1.0)) / PI + 0.5;
  // Two parameterisations of longitude; pick the one that is continuous at this fragment so
  // the texture seam at +-180 deg never shows up as a mip-mapping artefact.
  float uA = lon / (2.0 * PI) + 0.5;
  float uB = fract(uA + 0.5) - 0.5;
  float u = fwidth(uA) < fwidth(uB) + 1e-6 ? uA : uB;
  vec3 albedo = texture2D(albedoMap, vec2(u, v)).rgb;

  // Relief: tangent-space normal (x = east, y = north) from LOLA.
  vec3 east = normalize(vec3(-n.y, n.x, 0.0) + vec3(1e-6, 0.0, 0.0));
  vec3 north = cross(n, east);
  vec3 t = texture2D(normalMap, vec2(u + 0.5, v)).xyz * 2.0 - 1.0;
  float polar = 1.0 - smoothstep(0.98, 0.999, abs(n.z));
  vec3 N = normalize(mix(n, normalize(t.x * east + t.y * north + t.z * n), hasNormal * polar));

  float mu0 = dot(N, sunDir);
  float geo = dot(n, sunDir);
  // Soft terminator from the Sun's finite disk; relief only shades where the sphere is lit.
  float day = smoothstep(-0.006, 0.02, geo);
  float lit = max(mu0, 0.0) * day;
  // The Moon shows almost no limb darkening (Lommel-Seeliger-like surface): blend toward a
  // flatter response so the full disk reads as it does in the sky.
  float diffuse = mix(lit, pow(lit, 0.55), 0.55);
  float earthshine = max(dot(n, earthDir), 0.0) * 0.022;
  vec3 col = albedo * (diffuse * 1.55 + vec3(0.45, 0.6, 1.0) * earthshine + 0.035);

  // Graticule every 30 deg, very faint.
  float gl = abs(fract(degrees(lon) / 30.0 + 0.5) - 0.5) * 30.0;
  float gt = abs(fract(degrees(asin(clamp(n.z, -1.0, 1.0))) / 30.0 + 0.5) - 0.5) * 30.0;
  float wl = fwidth(degrees(lon)) * 0.9, wt = fwidth(degrees(asin(clamp(n.z, -1.0, 1.0)))) * 0.9;
  float grid = max(1.0 - smoothstep(0.0, wl, gl), 1.0 - smoothstep(0.0, wt, gt)) * polar;
  col += vec3(0.55, 0.7, 0.95) * grid * 0.055 * gridOn;

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export const EARTH_FRAG = /* glsl */ `
uniform vec3 sunDir;
varying vec3 vPos;
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  vec3 n = normalize(vPos);
  float land = smoothstep(0.52, 0.6, noise(n * 2.3) * 0.6 + noise(n * 5.1) * 0.4);
  float cloud = smoothstep(0.5, 0.75, noise(n * 4.0 + 7.0) * 0.55 + noise(n * 9.0) * 0.45);
  vec3 col = mix(vec3(0.05, 0.22, 0.55), vec3(0.16, 0.36, 0.2), land);
  col = mix(col, vec3(0.95), cloud * 0.8);
  float lit = smoothstep(-0.08, 0.25, dot(n, sunDir));
  gl_FragColor = vec4(col * (lit * 1.25 + 0.012), 1.0);
  #include <colorspace_fragment>
}`;

/** Shared by the shadow pass and the terrain surface: local Sun vector at a map position. */
const POLAR_COMMON = /* glsl */ `
uniform sampler2D heightMap;   // km above the 1737.4 km sphere; row 0 = +Y edge
uniform vec3 sunDir;           // Moon-fixed unit vector
uniform float halfKm;          // half the map width in km
const float R_MOON = 1737.4;

float heightKm(vec2 pKm, float lod) {
  vec2 uv = vec2(pKm.x / (2.0 * halfKm) + 0.5, 0.5 - pKm.y / (2.0 * halfKm));
  return textureLod(heightMap, uv, lod).r;
}

// Sun direction in map space (x = 90E, y = 0E, z = local up) for a point of the stereographic plane.
vec3 localSun(vec2 pKm) {
  float rho = max(length(pKm), 1e-4);
  float colat = 2.0 * atan(rho / (2.0 * R_MOON));
  float lon = atan(pKm.x, pKm.y);
  float sl = -cos(colat), cl = sin(colat);
  vec3 up = vec3(cl * cos(lon), cl * sin(lon), sl);
  vec3 east = vec3(-sin(lon), cos(lon), 0.0);
  vec3 north = cross(up, east);
  float sE = dot(sunDir, east), sN = dot(sunDir, north);
  vec2 dirMap = sE * vec2(cos(lon), -sin(lon)) + sN * vec2(sin(lon), cos(lon));
  return vec3(dirMap, dot(sunDir, up));
}`;

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/**
 * Shadow pass: for every map texel, march toward the Sun over the height field and record how
 * much of the solar disk clears the terrain. The ray's height above the reference sphere grows
 * as d*tan(el) + d^2/(2R): the second term is the Moon's curvature falling away beneath it.
 * Far samples read coarser max-filtered mip levels, so distant peaks are never stepped over.
 */
export const SHADOW_FRAG = /* glsl */ `
${POLAR_COMMON}
uniform float texelKm;
uniform float observerKm;
varying vec2 vUv;
const float SUN_RADIUS = 0.00465;

void main() {
  vec2 p = vec2(vUv.x - 0.5, vUv.y - 0.5) * 2.0 * halfKm;
  vec3 L = localSun(p);
  float horiz = max(length(L.xy), 1e-4);
  vec2 dir = L.xy / horiz;
  float slope = L.z / horiz;
  float h0 = heightKm(p, 0.0) + observerKm;
  float clearance = 1.0;
  float t = texelKm * 0.75;
  for (int i = 0; i < 128; i++) {
    vec2 q = p + dir * t;
    if (abs(q.x) > halfKm || abs(q.y) > halfKm) break;
    float stepKm = max(texelKm, t * 0.055);
    float lod = max(0.0, log2(stepKm / texelKm) - 0.5);
    float ray = h0 + t * slope + t * t / (2.0 * R_MOON);
    clearance = min(clearance, (ray - heightKm(q, lod)) / t);
    if (clearance < -SUN_RADIUS) break;
    t += stepKm;
  }
  float vis = smoothstep(-SUN_RADIUS, SUN_RADIUS, clearance);
  gl_FragColor = vec4(vis, vis, vis, 1.0);
}`;

export const TERRAIN_VERT = /* glsl */ `
${POLAR_COMMON}
uniform float exaggeration;
varying vec2 vKm;
varying float vH;
void main() {
  vKm = position.xy * 100.0;
  vH = heightKm(vKm, 0.0);
  vec3 p = vec3(position.xy, vH * exaggeration / 100.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

export const TERRAIN_FRAG = /* glsl */ `
${POLAR_COMMON}
uniform sampler2D shadowMap;
uniform float texelKm;
uniform float accumulate;      // 1 = shadowMap holds a time-averaged illumination fraction
uniform float gridOn;
varying vec2 vKm;
varying float vH;
const float PI = 3.141592653589793;

vec3 ramp(float x) {
  // Dark -> violet -> amber -> near-white: perceptually ordered illumination scale.
  vec3 a = vec3(0.03, 0.04, 0.09), b = vec3(0.33, 0.16, 0.55), c = vec3(0.95, 0.55, 0.16), d = vec3(1.0, 0.96, 0.8);
  return x < 0.33 ? mix(a, b, x / 0.33) : x < 0.75 ? mix(b, c, (x - 0.33) / 0.42) : mix(c, d, (x - 0.75) / 0.25);
}

void main() {
  // Slope over one grid cell, or over one screen pixel when that is larger (stops distant
  // terrain from shimmering when the grid is much finer than the screen).
  float footprint = max(length(dFdx(vKm)), length(dFdy(vKm)));
  float e = max(texelKm, footprint * 0.7);
  float nLod = max(0.0, log2(e / texelKm) - 0.5);
  float hx = heightKm(vKm + vec2(e, 0.0), nLod) - heightKm(vKm - vec2(e, 0.0), nLod);
  float hy = heightKm(vKm + vec2(0.0, e), nLod) - heightKm(vKm - vec2(0.0, e), nLod);
  vec3 N = normalize(vec3(-hx / (2.0 * e), -hy / (2.0 * e), 1.0));
  vec3 L = localSun(vKm);
  vec2 uv = vec2(vKm.x / (2.0 * halfKm) + 0.5, vKm.y / (2.0 * halfKm) + 0.5);
  float vis = texture2D(shadowMap, uv).r;

  // Regolith tint by elevation keeps the relief readable inside shadow.
  float tone = smoothstep(-4.5, 6.5, vH);
  vec3 base = mix(vec3(0.42, 0.44, 0.5), vec3(0.72, 0.69, 0.64), tone);
  float relief = 0.5 + 0.5 * dot(N, normalize(vec3(-0.45, 0.5, 0.74)));
  vec3 col;
  if (accumulate > 0.5) {
    col = ramp(vis) * (0.55 + 0.45 * relief);
  } else {
    float ndl = max(dot(N, L), 0.0);
    // Grazing light: a small slope toward the Sun multiplies the received flux, so compress.
    float direct = pow(ndl, 0.72) * vis;
    col = base * (direct * 2.5 + 0.034 * relief + 0.008);
    col += vec3(1.0, 0.72, 0.3) * direct * 0.06;
  }

  // Latitude circles every 2 deg and meridians every 30 deg.
  float rho = length(vKm);
  float lat = 90.0 - degrees(2.0 * atan(rho / (2.0 * R_MOON)));
  float lon = degrees(atan(vKm.x, vKm.y));
  float gLat = abs(fract(lat / 2.0 + 0.5) - 0.5) * 2.0;
  float gLon = abs(fract(lon / 30.0 + 0.5) - 0.5) * 30.0 * rho * PI / 180.0 / 30.3;
  float wLat = fwidth(lat) * 1.1;
  float wLon = fwidth(rho) * 1.1 / 30.3;
  float grid = max(1.0 - smoothstep(0.0, wLat, gLat), (1.0 - smoothstep(0.0, wLon, gLon)) * step(3.0, rho));
  // The 0 deg E meridian points at the mean Earth direction: draw it in Earth blue.
  float earthward = (1.0 - smoothstep(0.0, wLon * 1.6, abs(lon) * rho * PI / 180.0 / 30.3)) * step(3.0, rho) * step(0.0, vKm.y);
  col = mix(col, vec3(0.62, 0.72, 0.92), grid * 0.17 * gridOn);
  col = mix(col, vec3(0.34, 0.77, 1.0), earthward * 0.55 * gridOn);

  // Fade the square map edge.
  float edge = 1.0 - smoothstep(halfKm - 14.0, halfKm, max(abs(vKm.x), abs(vKm.y)));
  gl_FragColor = vec4(col * edge, 1.0);
  #include <colorspace_fragment>
}`;

/** Additive accumulation of shadow passes for the time-averaged illumination map. */
export const COPY_FRAG = /* glsl */ `
uniform sampler2D src;
uniform float weight;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(src, vUv).rgb * weight, weight);
}`;

export const MARKER_VERT = /* glsl */ `
attribute float size;
attribute vec3 tint;
attribute float ring;
varying vec3 vColor;
varying float vRing;
uniform float pixelRatio;
void main() {
  vColor = tint;
  vRing = ring;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * pixelRatio;
}`;

/**
 * Diamond map markers. vRing: 0 = catalogue site (hollow diamond), 1 = selected (solid core
 * inside a diamond frame), 2 = compared site (solid diamond).
 */
export const MARKER_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vRing;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = abs(c.x) + abs(c.y);
  if (d > 1.0) discard;
  float aa = fwidth(d) * 1.4;
  float body = 1.0 - smoothstep(0.96 - aa, 0.96, d);
  float ink;      // coloured part
  float backing;  // dark translucent part that keeps the marker legible on bright terrain
  if (vRing > 1.5) {
    ink = 1.0 - smoothstep(0.74 - aa, 0.74, d);
    backing = body;
  } else if (vRing > 0.5) {
    float core = 1.0 - smoothstep(0.30 - aa, 0.30, d);
    float frame = smoothstep(0.70 - aa, 0.70, d) * (1.0 - smoothstep(0.90, 0.90 + aa, d));
    ink = max(core, frame);
    backing = body * 0.5;
  } else {
    ink = smoothstep(0.50 - aa, 0.50, d) * (1.0 - smoothstep(0.80, 0.80 + aa, d));
    backing = body * 0.62;
  }
  float alpha = max(ink, backing);
  if (alpha < 0.02) discard;
  vec3 col = mix(vec3(0.02, 0.035, 0.06), vColor, ink);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}`;
