import { simplex2 } from '../util/noise/index.js';
import { hash2 } from '../util/rng.js';
import type { FieldDeposit, FieldStyleId, FieldTerrain } from './terrain.js';
import type { FieldTrackPoint, FieldVehicle } from './vehicle.js';
import type { FieldOrbiter } from './miner.js';
import { invert, lookAt, multiply, perspective, pose, transformPoint, type Mat4, type V3 } from './glmath.js';
import { buildOre, buildRover, buildShip, hex, MeshBuilder, oreColour, type RGB, type RoverModel } from './meshes.js';

/**
 * Field renderer, WebGL2 (KES-543).
 *
 * A real 3D view of the field, because a flat top-down map read as "tiny,
 * upside-down, what am I looking at". The camera never turns: it sits behind
 * and above the vehicle looking north, so the far ground climbs the screen to
 * a horizon and sky, near things are big, and pushing up still means north.
 * That keeps the KES-541 rule (the direction you push is the direction it
 * goes) while giving the ground depth and the rover its real shape.
 *
 * Two rigs: `surface` chases a rover at a few metres, `orbit` rides above the
 * mining ship on a low pass with the ground scrolling below it.
 *
 * World axes: X east, Y up, Z south (terrain y). One terrain mesh at 0.5 m
 * with an apron to the horizon, shaded per pixel with sun, baked
 * self-shadows, a tiling grain texture and wheel tracks; boulders, ore and
 * vehicles are flat-shaded low-poly meshes.
 */

export type FieldCamera = 'surface' | 'orbit';

export interface FieldRenderOptions {
  camera?: FieldCamera;
  /** >1 moves the camera in. */
  zoom?: number;
}

export interface FieldStick { ox: number; oy: number; x: number; y: number }

export interface FieldBeam { from: V3; to: V3; colour: RGB }

const NEAR = 0.3;
const FAR = 900;
/** Navy-plum ink for outlines. */
const INK: V3 = [0.09, 0.05, 0.14];

/** Toward the sun: from the south-west, 35° up, so the camera (looking north) sees lit faces and shadows falling away. */
const SUN_EL = (35 * Math.PI) / 180;
const SUN_GROUND: [number, number] = [-0.8, 0.6];
const SUN: V3 = [SUN_GROUND[0] * Math.cos(SUN_EL), Math.sin(SUN_EL), SUN_GROUND[1] * Math.cos(SUN_EL)];

/**
 * Painted skies, Out There style: saturated nebulae over airless bodies, a
 * lilac sky with warm cloud banks where there is air. `haze` is what distance
 * fades to, `amb` the colour shadows lean towards.
 */
interface Sky {
  zenith: string; horizon: string; haze: string; amb: string;
  nebA: string; nebB: string; planetA: string; planetB: string;
  stars: number; planet: number; atmo: number;
}
const SKIES: Record<FieldStyleId, Sky> = {
  regolith: { zenith: '#0b0616', horizon: '#3a2050', haze: '#4a2c5e', amb: '#46307a', nebA: '#c2306e', nebB: '#2a8c9a', planetA: '#3a7fd0', planetB: '#e8f0ff', stars: 1, planet: 1, atmo: 0 },
  rust: { zenith: '#4c66a6', horizon: '#e9b6a4', haze: '#d9a08e', amb: '#6a3a6e', nebA: '#e08a5c', nebB: '#5b3a5a', planetA: '#b8b0c8', planetB: '#ece4f2', stars: 0, planet: 0.7, atmo: 1 },
  carbon: { zenith: '#0a0410', horizon: '#3e1d40', haze: '#4a2648', amb: '#4a2a6a', nebA: '#8a2fa0', nebB: '#d0546a', planetA: '#e07a3a', planetB: '#ffd08a', stars: 1, planet: 1, atmo: 0 },
  metal: { zenith: '#0c0612', horizon: '#4a2a30', haze: '#5a3438', amb: '#4a2a5a', nebA: '#c0663a', nebB: '#6a3a9a', planetA: '#5a9ad0', planetB: '#f0e8d8', stars: 1, planet: 1, atmo: 0 },
  ice: { zenith: '#050c1e', horizon: '#26476e', haze: '#2e5480', amb: '#34408a', nebA: '#3fb7c9', nebB: '#8a4fd0', planetA: '#d07a4a', planetB: '#f4d0a0', stars: 1, planet: 1, atmo: 0 },
};

const TERRAIN_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec3 aCol; layout(location=3) in float aSh;
uniform mat4 uVP;
out vec3 vPos; out vec3 vNrm; out vec3 vCol; out float vSh;
void main(){ vPos=aPos; vNrm=aNrm; vCol=aCol; vSh=aSh; gl_Position=uVP*vec4(aPos,1.0); }`;

const TERRAIN_FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNrm; in vec3 vCol; in float vSh;
uniform vec3 uSun; uniform vec3 uShade; uniform vec3 uAmb; uniform vec3 uFog; uniform vec3 uEye; uniform vec2 uFogRange;
uniform sampler2D uDetail; uniform sampler2D uTracks; uniform float uSize; uniform float uTime;
uniform vec4 uScan; uniform vec4 uHit;
uniform vec4 uDep[16]; uniform vec3 uDepCol[16]; uniform int uDepN;
uniform vec4 uBlob; uniform vec2 uBlobSize;
layout(location=0) out vec4 o; layout(location=1) out vec4 oN;
void main(){
  vec2 w = vPos.xz;
  vec4 d1 = texture(uDetail, w / 5.5);
  vec4 d2 = texture(uDetail, w.yx / 19.0 + 0.37);
  vec2 b = (d1.rg - 0.5) * 2.2 + (d2.rg - 0.5) * 1.4;
  vec3 n = normalize(normalize(vNrm) + vec3(-b.x, 0.0, -b.y) * 0.32);
  float sh = vSh;
  if (uBlob.w > 0.0) {
    vec2 q = w - uBlob.xy; float c = cos(uBlob.z), s = sin(uBlob.z);
    vec2 l = vec2(c*q.x + s*q.y, -s*q.x + c*q.y) / uBlobSize;
    sh *= mix(1.0 - 0.8*uBlob.w, 1.0, smoothstep(0.85, 1.0, length(l)));
  }
  // Cel bands with a dry-brush edge from the grain, plus a little of the smooth light.
  float dl = max(dot(n, uSun), 0.0) * sh;
  float band = 0.2 + 0.42 * smoothstep(0.1, 0.15, dl) + 0.42 * smoothstep(0.55, 0.6, dl);
  float light = mix(band, 0.2 + 1.05 * dl, 0.25);
  vec3 col = vCol * (0.9 + d1.b * 0.22) * (0.94 + d2.b * 0.12);
  vec2 tuv = w / uSize;
  if (tuv.x > 0.0 && tuv.y > 0.0 && tuv.x < 1.0 && tuv.y < 1.0) col *= 1.0 - texture(uTracks, tuv).r * 0.45;
  vec3 amb = mix(uShade, uAmb, 0.7);
  vec3 c = col * light + amb * max(0.0, 1.0 - light) * 0.55;
  if (uScan.w > 0.0) {
    float d = distance(w, uScan.xy);
    float ring = exp(-pow((d - uScan.z) / 0.7, 2.0));
    float wash = step(d, uScan.z) * 0.08;
    c += vec3(0.34, 0.91, 0.62) * (ring * 0.9 + wash) * uScan.w;
  }
  for (int i = 0; i < 16; i++) {
    if (i >= uDepN) break;
    vec4 dp = uDep[i];
    float d = distance(w, dp.xy);
    float glow = smoothstep(dp.z * 1.9, 0.0, d) * 0.55;
    float pulse = 0.65 + 0.35 * sin(uTime * 3.0 + float(i));
    float ring = exp(-pow((d - dp.z * 1.35) / 0.12, 2.0)) * pulse;
    c += uDepCol[i] * (glow + ring) * dp.w;
  }
  if (uHit.w > 0.0) {
    float d = distance(w, uHit.xy);
    c += vec3(1.0, 0.55, 0.25) * exp(-d * d / (uHit.z * uHit.z)) * uHit.w;
  }
  float f = pow(smoothstep(uFogRange.x, uFogRange.y, distance(vPos, uEye)), 0.8);
  o = vec4(mix(c, uFog, f), 1.0);
  oN = vec4(normalize(vNrm) * 0.5 + 0.5, 0.5);
}`;

const MESH_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec3 aCol;
uniform mat4 uVP; uniform mat4 uModel;
out vec3 vPos; out vec3 vNrm; out vec3 vCol;
void main(){ vec4 p = uModel*vec4(aPos,1.0); vPos=p.xyz; vNrm=mat3(uModel)*aNrm; vCol=aCol; gl_Position=uVP*p; }`;

const MESH_FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNrm; in vec3 vCol;
uniform vec3 uSun; uniform vec3 uShade; uniform vec3 uAmb; uniform vec3 uFog; uniform vec3 uEye; uniform vec2 uFogRange; uniform float uEmit; uniform float uShadow;
layout(location=0) out vec4 o; layout(location=1) out vec4 oN;
void main(){
  vec3 n = normalize(vNrm);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(uEye - vPos);
  float dl = max(dot(n, uSun), 0.0) * uShadow;
  float band = 0.32 + 0.4 * smoothstep(0.06, 0.12, dl) + 0.36 * smoothstep(0.55, 0.6, dl);
  // Painted metal, not plastic: a narrow warm glint only on faces almost
  // square to the sun, and a rim tinted by the sky rather than white.
  float rim = smoothstep(0.66, 0.78, 1.0 - max(dot(n, v), 0.0)) * 0.18;
  float spec = step(0.8, pow(max(dot(reflect(-uSun, n), v), 0.0), 24.0)) * 0.16 * uShadow;
  float up = n.y * 0.5 + 0.5;
  vec3 c = vCol * band * (0.86 + 0.14 * up) + uAmb * (1.0 - band) * 0.5 + spec * vec3(1.0, 0.92, 0.75) + rim * mix(uFog, vec3(1.0), 0.4);
  c = mix(c, vCol * 1.4, uEmit);
  float f = pow(smoothstep(uFogRange.x, uFogRange.y, distance(vPos, uEye)), 0.8);
  o = vec4(mix(c, uFog, f), 1.0);
  oN = vec4(n * 0.5 + 0.5, 1.0);
}`;

const GLOW_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec4 aCol;
uniform mat4 uVP; out vec4 vCol;
void main(){ vCol=aCol; gl_Position=uVP*vec4(aPos,1.0); }`;

const GLOW_FS = `#version 300 es
precision mediump float; in vec4 vCol; layout(location=0) out vec4 o; void main(){ o = vec4(vCol.rgb * vCol.a, vCol.a); }`;

const FULL_VS = `#version 300 es
out vec2 vNdc;
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0; vNdc = p; gl_Position = vec4(p, 0.9999, 1.0); }`;

const NOISE = `
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += vn(p) * a; p = p * 2.03 + 17.1; a *= 0.5; } return s; }`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vNdc; uniform mat4 uInvVP; uniform vec3 uEye; uniform vec3 uZenith; uniform vec3 uHorizon;
uniform vec3 uNebA; uniform vec3 uNebB; uniform vec3 uPlanetA; uniform vec3 uPlanetB; uniform vec3 uInk;
uniform float uStars; uniform float uPlanet; uniform float uAtmo;
layout(location=0) out vec4 o; layout(location=1) out vec4 oN;
${NOISE}
void main(){
  vec4 p = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize(p.xyz / p.w - uEye);
  float e = d.y;
  vec2 sp = vec2(atan(d.x, -d.z) * 1.6, e * 3.0);
  vec3 c = mix(uHorizon, uZenith, smoothstep(-0.05, 0.6, e));
  if (uAtmo > 0.5) {
    // Cloud banks: long streaks, lit warm on top, plum underneath, inked edge.
    float f = fbm(vec2(sp.x * 1.1, sp.y * 5.5) + vec2(3.0, 0.0));
    float g = fbm(vec2(sp.x * 2.3, sp.y * 9.0) + 11.0);
    float m = smoothstep(0.5, 0.62, f) * smoothstep(0.03, 0.14, e) * (1.0 - smoothstep(0.55, 0.95, e));
    vec3 cloud = mix(uNebB, uNebA, smoothstep(0.35, 0.65, g + (f - 0.5)));
    c = mix(c, cloud, m * 0.9);
    c = mix(c, uInk, (smoothstep(0.47, 0.5, f) - smoothstep(0.5, 0.53, f)) * 0.35 * smoothstep(0.03, 0.14, e));
  } else {
    // Nebula: two layered fbm washes, saturated, with darker dust lanes.
    float f = fbm(sp * 1.2 + vec2(0.0, 3.1));
    float g = fbm(sp * 2.6 + f * 1.6);
    float dust = smoothstep(0.55, 0.75, fbm(sp * 4.0 + 5.0));
    vec3 neb = mix(uNebA, uNebB, smoothstep(0.35, 0.7, g));
    c += neb * smoothstep(0.38, 0.8, f) * 0.85 * (1.0 - dust * 0.6) * smoothstep(-0.05, 0.2, e);
  }
  if (uStars > 0.0) {
    vec2 sg = vec2(atan(d.x, -d.z), asin(clamp(e, -1.0, 1.0))) * 150.0;
    vec2 cell = floor(sg);
    float h = h21(cell);
    float r = length(fract(sg) - 0.5 - (h21(cell + 7.0) - 0.5) * 0.4);
    float star = step(0.972, h) * smoothstep(0.35, 0.0, r);
    c += vec3(star * (0.5 + 0.7 * h21(cell + 3.0))) * smoothstep(0.0, 0.08, e) * uStars;
  }
  if (uPlanet > 0.0) {
    vec3 pd = normalize(vec3(0.42, 0.34, -1.0));
    float a = acos(clamp(dot(d, pd), -1.0, 1.0));
    float R = 0.16;
    vec3 t = normalize(cross(pd, vec3(0.0, 1.0, 0.0))); vec3 u = cross(t, pd);
    vec2 q = vec2(dot(d - pd, t), dot(d - pd, u)) / R;
    if (a < R) {
      vec3 nrm = normalize(t * q.x + u * q.y + pd * -sqrt(max(0.0, 1.0 - dot(q, q))));
      float lit = smoothstep(-0.05, 0.3, dot(nrm, normalize(vec3(-0.85, 0.35, 0.25))));
      float bands = fbm(vec2(q.y * 3.5 + fbm(q * 2.5 + 4.0) * 1.2, q.x * 0.6));
      vec3 pc = mix(uPlanetA, uPlanetB, smoothstep(0.38, 0.68, bands));
      pc = pc * (0.16 + 0.95 * lit) + uZenith * 0.3 * (1.0 - lit);
      c = mix(c, pc, uPlanet);
      c = mix(c, uInk, smoothstep(R * 0.93, R * 0.985, a) * uPlanet);
    } else {
      c += uPlanetA * 0.25 * smoothstep(R * 1.35, R, a) * uPlanet;
    }
  }
  c += uHorizon * 0.35 * exp(-max(e, 0.0) * 14.0);
  o = vec4(c, 1.0);
  oN = vec4(0.5, 0.5, 0.5, 0.0);
}`;

/**
 * Comic pass: navy ink lines where depth creases or normals break, violet
 * shadows and warm lights, hatching in the darkest shade, a paper grain and a
 * vignette. Lines fade with distance so the horizon stays painted.
 */
const POST_FS = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform sampler2D uCol; uniform sampler2D uNrm; uniform sampler2D uDep;
uniform vec2 uPx; uniform vec2 uNF; uniform vec3 uInk; uniform float uW; uniform vec2 uInkFade;
out vec4 o;
${NOISE}
float lin(float d){ float z = d * 2.0 - 1.0; return 2.0 * uNF.x * uNF.y / (uNF.y + uNF.x - z * (uNF.y - uNF.x)); }
void main(){
  vec2 uv = vNdc * 0.5 + 0.5;
  vec3 c = texture(uCol, uv).rgb;
  vec4 nc = texture(uNrm, uv);
  vec2 ox = vec2(uPx.x * uW, 0.0), oy = vec2(0.0, uPx.y * uW);
  float zc = lin(texture(uDep, uv).r);
  float zl = lin(texture(uDep, uv - ox).r), zr = lin(texture(uDep, uv + ox).r);
  float zd = lin(texture(uDep, uv - oy).r), zu = lin(texture(uDep, uv + oy).r);
  float lap = (abs(1.0/zl + 1.0/zr - 2.0/zc) + abs(1.0/zd + 1.0/zu - 2.0/zc)) * zc;
  float edgeD = smoothstep(0.02, 0.06, lap);
  vec4 nl = texture(uNrm, uv - ox), nr = texture(uNrm, uv + ox), nd = texture(uNrm, uv - oy), nu = texture(uNrm, uv + oy);
  vec3 n0 = nc.xyz * 2.0 - 1.0;
  float bend = 0.0;
  bend = max(bend, (1.0 - dot(n0, nl.xyz * 2.0 - 1.0)) * min(nc.a, nl.a));
  bend = max(bend, (1.0 - dot(n0, nr.xyz * 2.0 - 1.0)) * min(nc.a, nr.a));
  bend = max(bend, (1.0 - dot(n0, nd.xyz * 2.0 - 1.0)) * min(nc.a, nd.a));
  bend = max(bend, (1.0 - dot(n0, nu.xyz * 2.0 - 1.0)) * min(nc.a, nu.a));
  float edgeN = smoothstep(0.35, 0.6, bend);
  // Silhouettes: where a model meets the ground (ink weight 1 against 0.5),
  // ink regardless of how far the camera is.
  float da = max(max(abs(nc.a - nl.a), abs(nc.a - nr.a)), max(abs(nc.a - nd.a), abs(nc.a - nu.a)));
  edgeN = max(edgeN, step(0.3, da) * step(0.75, max(nc.a, max(max(nl.a, nr.a), max(nd.a, nu.a)))));
  float solid = max(max(nc.a, nl.a), max(max(nr.a, nd.a), nu.a));
  float near = 1.0 - smoothstep(uInkFade.x, uInkFade.y, min(min(zc, zl), min(zr, min(zd, zu))));
  float ink = max(edgeD, edgeN) * near * step(0.01, solid);
  // Grade: plum shadows, warm lights, a touch more saturation.
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, c * vec3(0.82, 0.62, 1.18) + vec3(0.03, 0.0, 0.05), 1.0 - smoothstep(0.08, 0.5, lum));
  c = mix(c, c * vec3(1.1, 1.0, 0.84), smoothstep(0.45, 0.95, lum));
  float l2 = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l2), c, 1.25);
  // Hatching in the deepest shade of solid things.
  float hatch = step(0.62, fract((gl_FragCoord.x - gl_FragCoord.y) / (uW * 4.5)));
  c *= 1.0 - hatch * 0.22 * (1.0 - smoothstep(0.06, 0.2, l2)) * step(0.01, nc.a) * near;
  c = mix(c, uInk, ink * 0.9);
  c *= 0.97 + 0.06 * h21(floor(gl_FragCoord.xy / uW));
  vec2 v = uv - 0.5;
  c *= 1.0 - dot(v, v) * 0.55;
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const make = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('takeon field shader: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('takeon field program: ' + gl.getProgramInfoLog(p));
  return p;
}

interface Prog { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }
interface Mesh { vao: WebGLVertexArrayObject; count: number }

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class FieldRenderer {
  camera: FieldCamera;
  zoom: number;
  /** Deposits the player has scanned. */
  readonly revealed = new Set<string>();
  /** Set by the host each frame: the stick being dragged (CSS px), the laser beam, the ship. */
  stick: FieldStick | null = null;
  beam: FieldBeam | null = null;
  orbiter: FieldOrbiter | null = null;
  /** Fraction of each deposit left, 0..1, so ore shrinks as it is cut. */
  oreLeft: (id: string) => number = () => 1;

  private gl: WebGL2RenderingContext;
  private dpr = 1;
  private cssW = 390;
  private cssH = 844;
  private progs: Record<'terrain' | 'mesh' | 'glow' | 'sky' | 'post', Prog>;
  private fbo: WebGLFramebuffer | null = null;
  private fboTex: WebGLTexture[] = [];
  private terrainMesh!: Mesh & { ibo: WebGLBuffer; type: number };
  private boulderMesh!: Mesh;
  private rover: { body: Mesh; wheel: Mesh; model: RoverModel } | null = null;
  private ship: { mesh: Mesh; muzzle: V3; engines: V3[] } | null = null;
  private ore = new Map<string, Mesh>();
  private glowBuf: WebGLBuffer;
  private glowVao: WebGLVertexArrayObject;
  private skyVao: WebGLVertexArrayObject;
  private detailTex!: WebGLTexture;
  private trackTex!: WebGLTexture;
  private track: Uint8Array;
  private trackN: number;
  private trackDirty = false;
  private trackAge = 0;
  private revealedAt = new Map<string, number>();
  private scans: { x: number; y: number; r: number; t: number }[] = [];
  private sparks: { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number }[] = [];
  private time = 0;
  private vp: Mat4 = new Float32Array(16);
  private invVp: Mat4 = new Float32Array(16);
  private eye: V3 = [0, 0, 0];
  private camX: number;
  private camZ: number;
  private camY: number;
  private camLift = 0;
  private camDist = 30;
  private leadX = 0;
  private leadZ = 0;
  private sky: Sky;

  constructor(
    private canvas: HTMLCanvasElement,
    readonly terrain: FieldTerrain,
    readonly vehicle: FieldVehicle | null,
    opts: FieldRenderOptions = {},
  ) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('takeon field: WebGL2 is not available');
    this.gl = gl;
    this.camera = opts.camera ?? 'surface';
    this.zoom = opts.zoom ?? 1;
    this.sky = SKIES[terrain.style.id] ?? SKIES.regolith;
    const at = vehicle ?? terrain.landing;
    this.camX = at.x;
    this.camZ = at.y;
    this.camY = terrain.height(at.x, at.y);
    this.progs = {
      terrain: this.prog(TERRAIN_VS, TERRAIN_FS, ['uVP', 'uSun', 'uShade', 'uAmb', 'uFog', 'uEye', 'uFogRange', 'uDetail', 'uTracks', 'uSize', 'uTime', 'uScan', 'uHit', 'uDep', 'uDepCol', 'uDepN', 'uBlob', 'uBlobSize']),
      mesh: this.prog(MESH_VS, MESH_FS, ['uVP', 'uModel', 'uSun', 'uShade', 'uAmb', 'uFog', 'uEye', 'uFogRange', 'uEmit', 'uShadow']),
      glow: this.prog(GLOW_VS, GLOW_FS, ['uVP']),
      sky: this.prog(FULL_VS, SKY_FS, ['uInvVP', 'uEye', 'uZenith', 'uHorizon', 'uNebA', 'uNebB', 'uPlanetA', 'uPlanetB', 'uInk', 'uStars', 'uPlanet', 'uAtmo']),
      post: this.prog(FULL_VS, POST_FS, ['uCol', 'uNrm', 'uDep', 'uPx', 'uNF', 'uInk', 'uW', 'uInkFade']),
    };
    this.trackN = Math.min(1024, Math.ceil(terrain.size * 4));
    this.track = new Uint8Array(this.trackN * this.trackN);
    this.buildTerrain();
    this.buildBoulders();
    this.buildTextures();
    if (vehicle) {
      const model = buildRover();
      this.rover = { body: this.meshFrom(model.body), wheel: this.meshFrom(model.wheel), model };
      vehicle.onTrack = p => this.stampTrack(p);
    }
    for (const d of terrain.deposits) this.ore.set(d.id, this.meshFrom(buildOre(d.r, d.resource, hash2(d.x | 0, d.y | 0, terrain.seed) * 1e9)));
    this.glowBuf = gl.createBuffer()!;
    this.glowVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.glowVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glowBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
    this.skyVao = gl.createVertexArray()!;
    gl.bindVertexArray(null);
  }

  /** Add the mining ship; the orbit rig follows it. */
  attachOrbiter(orbiter: FieldOrbiter): void {
    this.orbiter = orbiter;
    const s = buildShip();
    this.ship = { mesh: this.meshFrom(s.mesh), muzzle: s.muzzle, engines: s.engines };
    this.camX = orbiter.x;
    this.camZ = orbiter.y;
  }

  resize(cssW: number, cssH: number, dpr = 1): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.dpr = Math.max(1, Math.min(2, dpr));
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.buildTarget();
  }

  /** Off-screen colour, normal and depth targets for the comic pass. */
  private buildTarget(): void {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    for (const t of this.fboTex) gl.deleteTexture(t);
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    const tex = (internal: number, format: number, type: number, filter: number) => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const col = tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
    const nrm = tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
    const dep = tex(gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST);
    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, col, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, nrm, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, dep, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.fboTex = [col, nrm, dep];
  }

  /** Reveal deposits within `radius` metres of a point, each as the pulse reaches it. */
  scan(x: number, y: number, radius = 18): FieldDeposit[] {
    this.scans.push({ x, y, r: radius, t: this.time });
    const found = this.terrain.deposits.filter(d => Math.hypot(d.x - x, d.y - y) <= radius);
    for (const d of found) {
      const delay = (Math.hypot(d.x - x, d.y - y) / radius) * 1.1;
      setTimeout(() => {
        if (!this.revealed.has(d.id)) this.revealedAt.set(d.id, this.time);
        this.revealed.add(d.id);
      }, delay * 1000);
    }
    return found;
  }

  /** World point (metres; z defaults to the ground) → CSS px, with whether it is in front of the camera. */
  project(x: number, y: number, z = this.terrain.height(x, y)): { x: number; y: number; front: boolean } {
    const m = this.vp;
    const cx = m[0] * x + m[4] * z + m[8] * y + m[12];
    const cy = m[1] * x + m[5] * z + m[9] * y + m[13];
    const cw = m[3] * x + m[7] * z + m[11] * y + m[15];
    const w = Math.abs(cw) < 1e-6 ? 1e-6 : cw;
    return { x: ((cx / w) * 0.5 + 0.5) * this.cssW, y: (0.5 - (cy / w) * 0.5) * this.cssH, front: cw > 0 };
  }

  /** CSS px → the ground point under it, or null for sky. */
  pick(sx: number, sy: number): { x: number; y: number } | null {
    const nx = (sx / this.cssW) * 2 - 1, ny = 1 - (sy / this.cssH) * 2;
    const a = this.unproject(nx, ny, -1), b = this.unproject(nx, ny, 1);
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    const ux = dx / len, uy = dy / len, uz = dz / len;
    let prev = 0;
    for (let t = 0.5; t < 400; t += 0.5) {
      const x = a[0] + ux * t, y = a[1] + uy * t, z = a[2] + uz * t;
      if (y <= this.terrain.height(x, z)) {
        let lo = prev, hi = t;
        for (let i = 0; i < 12; i++) {
          const m = (lo + hi) / 2;
          if (a[1] + uy * m <= this.terrain.height(a[0] + ux * m, a[2] + uz * m)) hi = m; else lo = m;
        }
        return { x: a[0] + ux * hi, y: a[2] + uz * hi };
      }
      prev = t;
    }
    return null;
  }

  draw(dt: number): void {
    const gl = this.gl;
    this.time += dt;
    this.updateCamera(dt);
    if (!this.fbo) this.buildTarget();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const haze = hex(this.sky.haze);
    gl.clearBufferfv(gl.COLOR, 0, [haze[0], haze[1], haze[2], 1]);
    gl.clearBufferfv(gl.COLOR, 1, [0.5, 0.5, 0.5, 0]);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);

    // Sky.
    gl.disable(gl.DEPTH_TEST);
    const sky = this.progs.sky;
    gl.useProgram(sky.p);
    gl.uniformMatrix4fv(sky.u.uInvVP, false, this.invVp);
    gl.uniform3fv(sky.u.uEye, this.eye);
    for (const k of ['zenith', 'horizon', 'nebA', 'nebB', 'planetA', 'planetB'] as const)
      gl.uniform3fv(sky.u['u' + k[0].toUpperCase() + k.slice(1)], hex(this.sky[k]));
    gl.uniform3fv(sky.u.uInk, INK);
    gl.uniform1f(sky.u.uStars, this.sky.stars);
    gl.uniform1f(sky.u.uPlanet, this.sky.planet);
    gl.uniform1f(sky.u.uAtmo, this.sky.atmo);
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    this.drawTerrain();
    this.drawMeshes();
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
    this.drawGlow(dt);

    // Comic pass to the screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    const post = this.progs.post;
    gl.useProgram(post.p);
    this.fboTex.forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
    });
    gl.uniform1i(post.u.uCol, 0);
    gl.uniform1i(post.u.uNrm, 1);
    gl.uniform1i(post.u.uDep, 2);
    gl.uniform2f(post.u.uPx, 1 / this.canvas.width, 1 / this.canvas.height);
    gl.uniform2f(post.u.uNF, NEAR, FAR);
    gl.uniform3fv(post.u.uInk, INK);
    gl.uniform1f(post.u.uW, this.dpr);
    { const [f0, f1] = this.fogRange(); gl.uniform2fv(post.u.uInkFade, [f0 * 1.1, f1 * 1.1]); }
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
  }

  // ── Camera ────────────────────────────────────────────────────────────

  /**
   * Portrait-first camera (KES-543): high and steep, looking down at about 56°
   * like a top-down action game, never a chase camera on the horizon. On a
   * phone held upright the screen is tall and narrow, so a low camera spends
   * half the screen on sky and squeezes the ground into a strip; a steep one
   * fills the whole screen with ground. The camera frames a fixed ground width
   * (the narrow side of the screen) so the rover is the same size on every
   * phone, sits a little below centre, and the ground it is driving towards
   * gets the extra room.
   */
  private updateCamera(dt: number): void {
    const k = Math.min(1, dt * 5);
    const aspect = this.cssW / this.cssH;
    const t = this.terrain;
    const z = this.zoom;
    const portrait = aspect < 1;
    const vfov = (portrait ? 44 : 34) * Math.PI / 180;
    // Half-angle of the narrow side of the screen.
    const narrow = portrait ? Math.atan(Math.tan(vfov / 2) * aspect) : vfov / 2;
    let fx: number, fy: number, fz: number, width: number, pitch: number, vx = 0, vz = 0;
    if (this.camera === 'orbit' && this.orbiter) {
      const o = this.orbiter;
      fx = o.x; fy = o.altitude; fz = o.y;
      vx = o.vx; vz = o.vy;
      width = 26; pitch = 62;
    } else {
      const v = this.vehicle;
      fx = v?.x ?? t.landing.x; fz = v?.y ?? t.landing.y;
      fy = t.height(fx, fz) + 0.6;
      if (v) { vx = Math.cos(v.heading) * v.speed; vz = Math.sin(v.heading) * v.speed; }
      width = 11; pitch = 56;
    }
    // Lead the camera the way the vehicle is going, and always a little north.
    const lead = this.camera === 'orbit' ? 0.6 : 0.35;
    this.leadX = lerp(this.leadX, vx * lead, Math.min(1, dt * 1.5));
    this.leadZ = lerp(this.leadZ, vz * lead - width * 0.12, Math.min(1, dt * 1.5));
    this.camX = lerp(this.camX, fx + this.leadX, k);
    this.camZ = lerp(this.camZ, fz + this.leadZ, k);
    this.camY = lerp(this.camY, fy, k);
    const dist = (width / 2) / Math.tan(narrow) / z;
    // Over a crater rim, tilt steeper rather than lose the rover behind it.
    let p = pitch * Math.PI / 180;
    if (this.camera === 'surface') {
      const blocked = (pp: number) => {
        for (let i = 2; i < 14; i++) {
          const f = i / 14 * dist;
          if (t.height(this.camX, this.camZ + Math.cos(pp) * f) + 0.3 > this.camY + Math.sin(pp) * f) return true;
        }
        return false;
      };
      let extra = 0;
      while (extra < 28 && blocked(p + extra * Math.PI / 180)) extra += 2;
      this.camLift = lerp(this.camLift, extra, extra > this.camLift ? Math.min(1, dt * 6) : k * 0.4);
      p += this.camLift * Math.PI / 180;
    }
    this.camDist = dist;
    const target: V3 = [this.camX, this.camY, this.camZ];
    const eye: V3 = [this.camX, this.camY + Math.sin(p) * dist, this.camZ + Math.cos(p) * dist];
    this.eye = eye;
    const proj = perspective(vfov, aspect, NEAR, FAR);
    this.vp = multiply(proj, lookAt(eye, target));
    this.invVp = invert(this.vp);
  }

  private unproject(nx: number, ny: number, nz: number): V3 {
    const m = this.invVp;
    const x = m[0] * nx + m[4] * ny + m[8] * nz + m[12];
    const y = m[1] * nx + m[5] * ny + m[9] * nz + m[13];
    const z = m[2] * nx + m[6] * ny + m[10] * nz + m[14];
    const w = m[3] * nx + m[7] * ny + m[11] * nz + m[15];
    return [x / w, y / w, z / w];
  }

  private fogRange(): [number, number] {
    // Relative to the camera distance, so the ground round the rover is clear.
    const d = this.camDist + (this.camera === 'orbit' && this.orbiter ? this.orbiter.altitude - this.camY + 60 : 0);
    return [d * 1.25, d * 3.2];
  }

  // ── Terrain ───────────────────────────────────────────────────────────

  private drawTerrain(): void {
    const gl = this.gl;
    const pr = this.progs.terrain;
    const u = pr.u;
    gl.useProgram(pr.p);
    this.common(pr);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.detailTex);
    gl.uniform1i(u.uDetail, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.trackTex);
    this.trackAge += 1;
    if (this.trackDirty && this.trackAge > 5) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.trackN, this.trackN, gl.RED, gl.UNSIGNED_BYTE, this.track);
      this.trackDirty = false;
      this.trackAge = 0;
    }
    gl.uniform1i(u.uTracks, 1);
    gl.uniform1f(u.uSize, this.terrain.size);
    gl.uniform1f(u.uTime, this.time);
    // Scan pulse.
    this.scans = this.scans.filter(sc => this.time - sc.t < 1.6);
    const s = this.scans[this.scans.length - 1];
    if (s) {
      const age = this.time - s.t;
      gl.uniform4f(u.uScan, s.x, s.y, s.r * Math.min(1, age / 1.1), Math.max(0, 1 - Math.max(0, age - 1.1) / 0.5));
    } else gl.uniform4f(u.uScan, 0, 0, 0, 0);
    // Ore.
    const deps = new Float32Array(64), cols = new Float32Array(48);
    let n = 0;
    for (const d of this.terrain.deposits) {
      if (!this.revealed.has(d.id) || n >= 16) continue;
      const left = this.oreLeft(d.id);
      if (left <= 0) continue;
      const k = clamp((this.time - (this.revealedAt.get(d.id) ?? 0)) / 0.6, 0, 1);
      deps.set([d.x, d.y, d.r, k * (0.35 + 0.65 * left)], n * 4);
      cols.set(oreColour(d.resource), n * 3);
      n++;
    }
    gl.uniform4fv(u.uDep, deps);
    gl.uniform3fv(u.uDepCol, cols);
    gl.uniform1i(u.uDepN, n);
    // Laser hit.
    const b = this.beam;
    gl.uniform4f(u.uHit, b ? b.to[0] : 0, b ? b.to[2] : 0, 1.4, b ? 0.9 + Math.sin(this.time * 40) * 0.15 : 0);
    // Vehicle shadow.
    const v = this.vehicle;
    if (this.camera === 'orbit' && this.orbiter) {
      const o = this.orbiter;
      const ground = this.terrain.height(o.x, o.y);
      const drop = (o.altitude - ground) / SUN[1];
      gl.uniform4f(u.uBlob, o.x - SUN[0] * drop, o.y - SUN[2] * drop, Math.PI / 2, 0.55);
      gl.uniform2f(u.uBlobSize, 6.5, 8.5);
    } else if (v) {
      gl.uniform4f(u.uBlob, v.x - SUN[0] * 1.6, v.y - SUN[2] * 1.6, v.heading, 0.85);
      gl.uniform2f(u.uBlobSize, 1.9, 1.45);
    } else gl.uniform4f(u.uBlob, 0, 0, 0, 0);
    gl.bindVertexArray(this.terrainMesh.vao);
    gl.drawElements(gl.TRIANGLES, this.terrainMesh.count, this.terrainMesh.type, 0);
  }

  private common(pr: Prog): void {
    const gl = this.gl;
    gl.uniformMatrix4fv(pr.u.uVP, false, this.vp);
    gl.uniform3fv(pr.u.uSun, SUN);
    const sh = this.terrain.style.shade;
    gl.uniform3f(pr.u.uShade, sh[0] / 255, sh[1] / 255, sh[2] / 255);
    gl.uniform3fv(pr.u.uAmb, hex(this.sky.amb));
    gl.uniform3fv(pr.u.uFog, hex(this.sky.haze));
    gl.uniform3fv(pr.u.uEye, this.eye);
    gl.uniform2fv(pr.u.uFogRange, this.fogRange());
  }

  private buildTerrain(): void {
    const gl = this.gl;
    const t = this.terrain;
    const S = t.size;
    const inner = S <= 160 ? 0.5 : S / 320;
    const apron = S > 160 ? 400 : 160, outer = S > 160 ? 10 : 4;
    const axis: number[] = [];
    for (let v = -apron; v < 0; v += outer) axis.push(v);
    for (let v = 0; v <= S + 1e-6; v += inner) axis.push(v);
    for (let v = S + outer; v <= S + apron; v += outer) axis.push(v);
    const N = axis.length;
    // Height range for the colour ramp.
    let hMin = Infinity, hMax = -Infinity, hSum = 0, hn = 0;
    for (let y = 0; y <= S; y += 2)
      for (let x = 0; x <= S; x += 2) {
        const h = t.height(x, y);
        hMin = Math.min(hMin, h); hMax = Math.max(hMax, h); hSum += h; hn++;
      }
    const mean = hSum / hn, span = Math.max(0.001, hMax - hMin);
    const relief = t.style.relief;
    const outerH = (x: number, y: number) => {
      const cx = clamp(x, 0, S), cy = clamp(y, 0, S);
      const d = Math.hypot(x - cx, y - cy);
      const base = t.height(cx, cy);
      if (d === 0) return base;
      const blend = Math.min(1, d / 30);
      const far = mean + simplex2(x * 0.015, y * 0.015, t.seed + 5) * relief * 2.2 + simplex2(x * 0.06, y * 0.06, t.seed + 9) * relief * 0.5;
      return base * (1 - blend) + far * blend + d * d * 0.0006;
    };
    const st = t.style;
    const tanEl = Math.tan(SUN_EL);
    const gl0 = Math.hypot(SUN_GROUND[0], SUN_GROUND[1]);
    const sx = SUN_GROUND[0] / gl0, sy = SUN_GROUND[1] / gl0;
    const data = new Float32Array(N * N * 10);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const x = axis[i], y = axis[j];
        const inside = x >= 0 && y >= 0 && x <= S && y <= S;
        const h = inside ? t.height(x, y) : outerH(x, y);
        let nx: number, ny: number, nz: number;
        if (inside) [nx, nz, ny] = t.normal(x, y);
        else {
          const e = 1;
          const gx = (outerH(x + e, y) - outerH(x - e, y)) / (2 * e), gy = (outerH(x, y + e) - outerH(x, y - e)) / (2 * e);
          const l = Math.hypot(gx, gy, 1);
          nx = -gx / l; nz = -gy / l; ny = 1 / l;
        }
        // Normal from terrain: (x east, y south, z up) → GL (x, up, south).
        const tone = inside ? t.tone(x, y) : 0.5 + simplex2(x * 0.05, y * 0.05, t.seed + 2) * 0.15;
        const ht = clamp((h - hMin) / span, 0, 1);
        const a = clamp(0.25 + ht * 0.45 + (tone - 0.5) * 0.7, 0, 1);
        let r = st.low[0] + (st.high[0] - st.low[0]) * a;
        let g = st.low[1] + (st.high[1] - st.low[1]) * a;
        let b = st.low[2] + (st.high[2] - st.low[2]) * a;
        const br = Math.max(0, tone - 0.62) * 1.6;
        r += (st.bright[0] - r) * br; g += (st.bright[1] - g) * br; b += (st.bright[2] - b) * br;
        let lit = 1;
        if (inside) {
          const h0 = h + 0.05;
          for (let d = 0.25; d < 30; d += d < 6 ? 0.25 : 0.75) {
            const px = x + sx * d, py = y + sy * d;
            if (px < 0 || py < 0 || px > S || py > S) break;
            const over = t.height(px, py) - (h0 + d * tanEl);
            if (over > 0) {
              lit = Math.min(lit, Math.max(0, 1 - over * 1.6));
              if (lit === 0) break;
            }
          }
        }
        const o = (j * N + i) * 10;
        data[o] = x; data[o + 1] = h; data[o + 2] = y;
        data[o + 3] = nx; data[o + 4] = ny; data[o + 5] = nz;
        data[o + 6] = r / 255; data[o + 7] = g / 255; data[o + 8] = b / 255;
        data[o + 9] = lit;
      }
    const idx = new Uint32Array((N - 1) * (N - 1) * 6);
    let k = 0;
    for (let j = 0; j < N - 1; j++)
      for (let i = 0; i < N - 1; i++) {
        const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const stride = 40;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 36);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.terrainMesh = { vao, count: idx.length, ibo, type: gl.UNSIGNED_INT };
  }

  private buildBoulders(): void {
    const t = this.terrain;
    const st = t.style;
    const b = new MeshBuilder();
    const detail = t.boulders.length > 400 ? 0 : 1;
    t.boulders.forEach((r, i) => {
      const k = 0.55 + r.tone * 0.5;
      const col: RGB = [
        ((st.low[0] + st.high[0]) / 2 / 255) * k,
        ((st.low[1] + st.high[1]) / 2 / 255) * k,
        ((st.low[2] + st.high[2]) / 2 / 255) * k,
      ];
      const g = t.height(r.x, r.y);
      b.rock(r.x, g + r.h * 0.35, r.y, r.r, r.h * 0.75, r.r * (0.8 + (i % 5) * 0.08), col, t.seed * 7919 + i, detail);
    });
    this.boulderMesh = this.meshFrom(b.build());
  }

  private buildTextures(): void {
    const gl = this.gl;
    // Grain: periodic value noise, pebbles and pits, as (dx, dy, height).
    const N = 256;
    const h = new Float32Array(N * N);
    const seed = this.terrain.seed;
    for (const [cells, amp] of [[8, 0.45], [16, 0.25], [32, 0.16], [64, 0.1], [128, 0.06]] as const) {
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const fx = (x / N) * cells, fy = (y / N) * cells;
          const ix = Math.floor(fx), iy = Math.floor(fy);
          const ux = fx - ix, uy = fy - iy;
          const sx = ux * ux * (3 - 2 * ux), sy = uy * uy * (3 - 2 * uy);
          const v = (a: number, b: number) => hash2(((a % cells) + cells) % cells, ((b % cells) + cells) % cells, seed + cells);
          const top = lerp(v(ix, iy), v(ix + 1, iy), sx), bot = lerp(v(ix, iy + 1), v(ix + 1, iy + 1), sx);
          h[y * N + x] += (lerp(top, bot, sy) - 0.5) * amp;
        }
    }
    let r = seed >>> 0;
    const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 420; i++) {
      const cx = rnd() * N, cy = rnd() * N, rad = 1.5 + rnd() * rnd() * 7, up = rnd() < 0.7 ? 1 : -0.6;
      for (let y = Math.floor(cy - rad); y <= cy + rad; y++)
        for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
          const d = Math.hypot(x - cx, y - cy) / rad;
          if (d >= 1) continue;
          const ii = ((y + N) % N) * N + ((x + N) % N);
          h[ii] += Math.sqrt(1 - d * d) * 0.22 * up;
        }
    }
    const px = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const at = (a: number, b: number) => h[((b + N) % N) * N + ((a + N) % N)];
        const dx = (at(x + 1, y) - at(x - 1, y)) * 4, dy = (at(x, y + 1) - at(x, y - 1)) * 4;
        const o = (y * N + x) * 4;
        px[o] = clamp(128 + dx * 127, 0, 255);
        px[o + 1] = clamp(128 + dy * 127, 0, 255);
        px[o + 2] = clamp(128 + h[y * N + x] * 200, 0, 255);
        px[o + 3] = 255;
      }
    this.detailTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.detailTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    this.trackTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.trackTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, this.trackN, this.trackN, 0, gl.RED, gl.UNSIGNED_BYTE, this.track);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private stampTrack(p: FieldTrackPoint): void {
    const n = this.trackN, ppm = n / this.terrain.size;
    const fx = Math.cos(p.heading), fy = Math.sin(p.heading);
    for (const side of [-0.98, 0.98]) {
      const cx = (p.x - fy * side) * ppm, cy = (p.y + fx * side) * ppm;
      for (let y = Math.floor(cy - 1.5); y <= cy + 1.5; y++)
        for (let x = Math.floor(cx - 1.5); x <= cx + 1.5; x++) {
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          const v = Math.round(clamp(1.6 - d, 0, 1) * 230);
          const i = y * n + x;
          if (v > this.track[i]) this.track[i] = v;
        }
    }
    this.trackDirty = true;
  }

  // ── Meshes ────────────────────────────────────────────────────────────

  private drawMeshes(): void {
    const gl = this.gl;
    const pr = this.progs.mesh;
    gl.useProgram(pr.p);
    this.common(pr);
    const u = pr.u;
    const ident = pose(0, 0, 0, 0);
    gl.uniform1f(u.uEmit, 0);
    gl.uniform1f(u.uShadow, 1);
    gl.uniformMatrix4fv(u.uModel, false, ident);
    this.drawMesh(this.boulderMesh);
    // Ore pops up when scanned and shrinks as it is cut.
    gl.uniform1f(u.uEmit, 0.45);
    for (const d of this.terrain.deposits) {
      if (!this.revealed.has(d.id)) continue;
      const left = this.oreLeft(d.id);
      if (left <= 0) continue;
      const k = clamp((this.time - (this.revealedAt.get(d.id) ?? 0)) / 0.5, 0, 1);
      const pop = 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2);
      const s = Math.max(0.01, pop * (0.3 + 0.7 * left));
      gl.uniformMatrix4fv(u.uModel, false, pose(d.x, this.terrain.height(d.x, d.y), d.y, 0, 0, 0, s));
      this.drawMesh(this.ore.get(d.id)!);
    }
    gl.uniform1f(u.uEmit, 0);
    const v = this.vehicle, rv = this.rover;
    if (v && rv) {
      const m = pose(v.x, v.z, v.y, -v.heading, v.pitch, -v.roll);
      gl.uniformMatrix4fv(u.uModel, false, m);
      this.drawMesh(rv.body);
      const spin = -v.odometer / rv.model.wheelRadius;
      for (const [wx, wy, wz] of rv.model.wheels) {
        const local = pose(wx, wy, wz, 0, spin);
        gl.uniformMatrix4fv(u.uModel, false, multiply(m, local));
        this.drawMesh(rv.wheel);
      }
      if (this.camera === 'surface' && this.beam) this.beam.from = transformPoint(m, ...rv.model.muzzle);
    }
    const o = this.orbiter, sh = this.ship;
    if (o && sh) {
      // Ship flies nose-north (yaw so model +X points to -Z), banking with its slide.
      const m = pose(o.x, o.altitude + Math.sin(this.time * 1.3) * 0.25, o.y, Math.PI / 2, 0, o.bank);
      gl.uniformMatrix4fv(u.uModel, false, m);
      this.drawMesh(sh.mesh);
      if (this.beam && this.camera === 'orbit') this.beam.from = transformPoint(m, ...sh.muzzle);
    }
  }

  // ── Glow: laser, engine flare, sparks ────────────────────────────────

  private drawGlow(dt: number): void {
    const gl = this.gl;
    const out: number[] = [];
    const view = this.eye;
    const quadStrip = (a: V3, b: V3, width: number, col: RGB, alpha: number) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const ex = view[0] - a[0], ey = view[1] - a[1], ez = view[2] - a[2];
      let sx = dy * ez - dz * ey, sy = dz * ex - dx * ez, sz = dx * ey - dy * ex;
      const l = Math.hypot(sx, sy, sz) || 1;
      sx = (sx / l) * width; sy = (sy / l) * width; sz = (sz / l) * width;
      const P = (p: V3, s: number, al: number) => out.push(p[0] + sx * s, p[1] + sy * s, p[2] + sz * s, col[0], col[1], col[2], al);
      // Two quads: edge (0) → centre (alpha) → edge (0).
      P(a, -1, 0); P(b, -1, 0); P(b, 0, alpha);
      P(a, -1, 0); P(b, 0, alpha); P(a, 0, alpha);
      P(a, 0, alpha); P(b, 0, alpha); P(b, 1, 0);
      P(a, 0, alpha); P(b, 1, 0); P(a, 1, 0);
    };
    const flare = (c: V3, r: number, col: RGB, alpha: number) => {
      // Camera-facing disc from the inverse view-projection's right and up axes.
      const right = this.camAxis(0), up = this.camAxis(1);
      const segs = 14;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
        const p0 = [0, 1, 2].map(k => c[k] + (right[k] * Math.cos(a0) + up[k] * Math.sin(a0)) * r);
        const p1 = [0, 1, 2].map(k => c[k] + (right[k] * Math.cos(a1) + up[k] * Math.sin(a1)) * r);
        out.push(c[0], c[1], c[2], col[0], col[1], col[2], alpha);
        out.push(p0[0], p0[1], p0[2], col[0], col[1], col[2], 0);
        out.push(p1[0], p1[1], p1[2], col[0], col[1], col[2], 0);
      }
    };
    const b = this.beam;
    if (b) {
      const flick = 0.85 + Math.sin(this.time * 55) * 0.15;
      const w = this.camera === 'orbit' ? 1 : 0.4;
      quadStrip(b.from, b.to, w * 2.4, b.colour, 0.35 * flick);
      quadStrip(b.from, b.to, w * 0.7, [1, 1, 1], 0.9 * flick);
      flare(b.to, w * 3.2, b.colour, 0.8);
      flare(b.to, w * 1.1, [1, 1, 0.9], 1);
      flare(b.from, w * 0.9, b.colour, 0.8);
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 4;
        this.sparks.push({ x: b.to[0], y: b.to[1] + 0.1, z: b.to[2], vx: Math.cos(a) * s, vy: 3 + Math.random() * 5, vz: Math.sin(a) * s, life: 0.5 + Math.random() * 0.4 });
      }
    }
    const g = this.terrain.style.gravity;
    this.sparks = this.sparks.filter(s => (s.life -= dt) > 0);
    for (const s of this.sparks) {
      s.vy -= Math.max(2, g * 2) * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      const a: V3 = [s.x, s.y, s.z];
      const tail: V3 = [s.x - s.vx * 0.03, s.y - s.vy * 0.03, s.z - s.vz * 0.03];
      quadStrip(tail, a, this.camera === 'orbit' ? 0.25 : 0.06, [1, 0.7, 0.3], Math.min(1, s.life * 2));
    }
    const o = this.orbiter, sh = this.ship;
    if (o && sh) {
      const m = pose(o.x, o.altitude + Math.sin(this.time * 1.3) * 0.25, o.y, Math.PI / 2, 0, o.bank);
      for (const e of sh.engines) {
        const p = transformPoint(m, ...e);
        flare(p, 1.3 + Math.sin(this.time * 30) * 0.1, [0.45, 0.75, 1], 0.9);
        flare(p, 0.5, [1, 1, 1], 1);
      }
    }
    if (!out.length) return;
    gl.useProgram(this.progs.glow.p);
    gl.uniformMatrix4fv(this.progs.glow.u.uVP, false, this.vp);
    gl.bindVertexArray(this.glowVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glowBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(out), gl.DYNAMIC_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLES, 0, out.length / 7);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /** World-space camera right (0) or up (1), unit length. */
  private camAxis(i: 0 | 1): V3 {
    const a = this.unproject(0, 0, 0.5);
    const b = i === 0 ? this.unproject(0.01, 0, 0.5) : this.unproject(0, 0.01, 0.5);
    const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(...d) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  }

  // ── Plumbing ──────────────────────────────────────────────────────────

  private prog(vs: string, fs: string, names: string[]): Prog {
    const p = compile(this.gl, vs, fs);
    const u: Record<string, WebGLUniformLocation | null> = {};
    for (const n of names) u[n] = this.gl.getUniformLocation(p, n);
    return { p, u };
  }

  private meshFrom(data: Float32Array): Mesh {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 24);
    gl.bindVertexArray(null);
    return { vao, count: data.length / 9 };
  }

  private drawMesh(m: Mesh): void {
    if (!m.count) return;
    this.gl.bindVertexArray(m.vao);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, m.count);
  }

  destroy(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
