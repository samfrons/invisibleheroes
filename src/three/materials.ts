/**
 * Materials, shaders and painted textures for the stage, made once at start.
 *
 * The apparatus is physically based in the spirit of MESSAI's lab models:
 * clear glass with environment reflections, absorbing liquids (transmission
 * on 'high', a translucent fake on 'low'), matte carbon felt, brushed
 * titanium mesh, copper leads. The set around it is 1970s science fiction:
 * a navy sky with a horizon glow, a receding mission-control grid, sparkle
 * stars, a ringed planet. Textures are painted on a 2D canvas, never fetched.
 */
import {
  AdditiveBlending,
  BackSide,
  CanvasTexture,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NearestFilter,
  RepeatWrapping,
  SRGBColorSpace,
  ShaderMaterial,
  type Texture,
} from 'three';
import { INK, PAPER, SEAT_STRONG } from './palette';

export type Quality = 'high' | 'low';

// ---- PBR surfaces ----------------------------------------------------------------

/** Borosilicate: almost clear, all reflection. Not transmissive, so liquids show through it. */
export function glassMaterial(): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: '#EAF4F6',
    metalness: 0,
    roughness: 0.04,
    transparent: true,
    opacity: 0.16,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    specularIntensity: 1,
    envMapIntensity: 1.6,
    depthWrite: false,
    side: DoubleSide,
  });
}

/** An absorbing liquid: transmission with Beer-Lambert colour on 'high', translucent paint on 'low'. */
export function liquidMaterial(hex: string, quality: Quality): MeshPhysicalMaterial {
  if (quality === 'high') {
    return new MeshPhysicalMaterial({
      color: '#FFFFFF',
      metalness: 0,
      roughness: 0.08,
      transmission: 0.92,
      thickness: 1.1,
      ior: 1.33,
      attenuationColor: new Color(hex),
      attenuationDistance: 0.7,
      envMapIntensity: 1,
    });
  }
  return new MeshPhysicalMaterial({
    color: hex,
    metalness: 0,
    roughness: 0.12,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    envMapIntensity: 1,
  });
}

export function metal(hex: string, roughness: number, extra: { map?: Texture; alphaMap?: Texture } = {}): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: hex, metalness: 1, roughness });
  if (extra.map) m.roughnessMap = extra.map;
  if (extra.alphaMap) {
    m.alphaMap = extra.alphaMap;
    m.alphaTest = 0.5;
    m.side = DoubleSide;
  }
  return m;
}

export function plastic(hex: string, roughness = 0.42, emissive?: string, emissiveIntensity = 1): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: hex, metalness: 0, roughness });
  if (emissive) {
    m.emissive = new Color(emissive);
    m.emissiveIntensity = emissiveIntensity;
  }
  return m;
}

/** Carbon felt: matte, fibrous, never satin. */
export function feltMaterial(tex: Texture): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: '#FFFFFF',
    map: tex,
    roughness: 0.95,
    metalness: 0,
    bumpMap: tex,
    bumpScale: 2.5,
    envMapIntensity: 0.4,
  });
}

/** Unlit glow: emissive things, organisms, spark heads. Tinted per instance. */
export function glowSolid(hex: string, depthTest = true): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: hex, depthTest, depthWrite: depthTest, toneMapped: false });
}

/** Additive soft glow billboards, tinted per instance. */
export function glowSprite(map: Texture): MeshBasicMaterial {
  return new MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}

// ---- shaders -----------------------------------------------------------------------

const FILL_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vC;
varying float vY;
void main() {
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
  p = instanceMatrix * p;
  n = mat3(instanceMatrix) * n;
  #endif
  #ifdef USE_INSTANCING_COLOR
  vC = instanceColor;
  #else
  vC = vec3(1.0);
  #endif
  vY = (modelMatrix * p).y;
  vec4 mv = modelViewMatrix * p;
  vN = normalize(normalMatrix * n);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const FILL_FRAG = /* glsl */ `
uniform float time;
varying vec3 vN;
varying vec3 vV;
varying vec3 vC;
varying float vY;
void main() {
  float f = abs(dot(normalize(vN), normalize(vV)));
  // Liquid light: a hot core, darker flanks, rising scan bands.
  vec3 col = vC * (0.45 + 0.85 * f);
  float band = smoothstep(0.8, 1.0, sin(vY * 22.0 - time * 3.0));
  col += vC * band * 0.35;
  col = mix(col, vec3(1.0), smoothstep(0.7, 1.0, f) * 0.25);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** The cells' charge: self-luminous seat colour. */
export function fillMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: FILL_VERT,
    fragmentShader: FILL_FRAG,
  });
}

const SKY_VERT = /* glsl */ `
void main() {
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 hiCol;
uniform vec3 loCol;
uniform vec2 resolution;
uniform vec2 centre;
void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  vec2 d = (uv - centre) * vec2(resolution.x / resolution.y, 1.0);
  float r = length(d);
  vec3 col = mix(hiCol, loCol, smoothstep(0.0, 0.95, r));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** The charcoal stage: a screen-space radial, like the reference video. Set `resolution` (drawing-buffer px) on resize. */
export function skyMaterial(hi: string, lo: string): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      hiCol: { value: new Color(hi) },
      loCol: { value: new Color(lo) },
      resolution: { value: [1, 1] },
      centre: { value: [0.5, 0.62] },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: BackSide,
    depthWrite: false,
  });
}

const GRID_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const GRID_FRAG = /* glsl */ `
uniform vec3 line;
uniform vec3 ground;
uniform vec3 fogCol;
uniform float cell;
uniform float scroll;
uniform vec3 eye;
varying vec3 vW;
void main() {
  vec2 q = vec2(vW.x, vW.z + scroll) / cell;
  vec2 w = fwidth(q);
  vec2 g = abs(fract(q - 0.5) - 0.5) / max(w, vec2(1e-4));
  float l = 1.0 - min(min(g.x, g.y), 1.0);
  // Thin lines fade as they crowd toward the horizon instead of moireing.
  l *= 1.0 - smoothstep(0.25, 0.9, max(w.x, w.y));
  float d = length(vW.xz - eye.xz);
  float fog = smoothstep(10.0, 80.0, d);
  // Keep the lower middle (under the note lanes) quiet: the grid is faint in
  // front of the console and brightens toward the horizon.
  // Only a faint hint, and none in front of the console (under the lanes).
  float behind = smoothstep(-2.0, -14.0, vW.z);
  vec3 col = ground + line * l * behind * 0.16;
  col = mix(col, fogCol, fog);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** The mission-control floor: a teal grid on dark navy receding into the horizon haze. */
export function gridMaterial(cell: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      line: { value: new Color('#4ECDC4') },
      ground: { value: new Color('#0B0B0C') },
      fogCol: { value: new Color('#141414') },
      cell: { value: cell },
      scroll: { value: 0 },
      eye: { value: [0, 0, 0] },
    },
    vertexShader: GRID_VERT,
    fragmentShader: GRID_FRAG,
  });
}

const STAR_VERT = /* glsl */ `
attribute float phase;
attribute float size;
attribute vec3 tint;
uniform float time;
uniform float pixelRatio;
varying vec3 vTint;
varying float vTw;
void main() {
  vTint = tint;
  vTw = 0.6 + 0.4 * sin(time * (0.6 + phase * 1.1) + phase * 6.2831);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * pixelRatio * (0.75 + 0.25 * vTw);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w * 0.99999;
}`;

const STAR_FRAG = /* glsl */ `
varying vec3 vTint;
varying float vTw;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float arms = max(1.0 - abs(c.x) * 14.0, 0.0) * max(1.0 - abs(c.y) * 2.0, 0.0)
             + max(1.0 - abs(c.y) * 14.0, 0.0) * max(1.0 - abs(c.x) * 2.0, 0.0);
  float core = 1.0 - smoothstep(0.0, 0.14, length(c));
  float a = clamp(arms * 0.8 + core, 0.0, 1.0) * vTw;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vTint * a, a);
  #include <colorspace_fragment>
}`;

/** Four-point sparkle stars. Needs `phase`, `size` and `tint` attributes. */
export function starMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { time: { value: 0 }, pixelRatio: { value: 1 } },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}


const NODE_VERT = /* glsl */ `
attribute float size;
attribute vec3 tint;
uniform float pixelRatio;
varying vec3 vTint;
void main() {
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * pixelRatio * (34.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const NODE_FRAG = /* glsl */ `
varying vec3 vTint;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.18, 0.5, r)) * 0.9 + (1.0 - smoothstep(0.0, 0.2, r)) * 0.6;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vTint * a, a);
  #include <colorspace_fragment>
}`;

/** Glowing round nodes of the backdrop network (additive). Needs `size` and `tint`. */
export function nodeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { pixelRatio: { value: 1 } },
    vertexShader: NODE_VERT,
    fragmentShader: NODE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

/** Thin additive lines; brightness comes from vertex colours (black = invisible). */
export function linkMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec3 color;
      varying vec3 vC;
      void main() { vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC;
      void main() { gl_FragColor = vec4(vC, 1.0);
      #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

const STREAM_VERT = /* glsl */ `
uniform float time;
uniform float amp;
varying float vU;
void main() {
  vU = uv.x;
  float bead = 0.5 + 0.5 * sin(uv.x * 90.0 - time * 9.0);
  vec3 p = position + normal * amp * (0.35 + 0.65 * bead);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const STREAM_FRAG = /* glsl */ `
uniform float time;
uniform float level;
uniform vec3 gold;
varying float vU;
void main() {
  float wave = 0.5 + 0.5 * sin(vU * 90.0 - time * 9.0);
  float a = level * (0.35 + 0.65 * wave);
  gl_FragColor = vec4(gold * a, a);
  #include <colorspace_fragment>
}`;

/** The electron river along the wire: gold beads flowing anode to pack, thicker with the groove. */
export function streamMaterial(goldHex: string): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { time: { value: 0 }, amp: { value: 0.03 }, level: { value: 0 }, gold: { value: new Color(goldHex) } },
    vertexShader: STREAM_VERT,
    fragmentShader: STREAM_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

/** A line-art planet: a dark body with a glowing fresnel rim. */
export function rimMaterial(rimHex: string, bodyHex: string): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { rim: { value: new Color(rimHex) }, body: { value: new Color(bodyHex) } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 rim; uniform vec3 body; varying vec3 vN; varying vec3 vV;
      void main() { float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        vec3 c = body + rim * (smoothstep(0.55, 1.0, f) * 1.1);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * A dark analogue dial face in the reference's style: charcoal radial, faint
 * teal ticks, a condensed all-caps label. The needle pivots at the centre.
 */
export function dialTexture(label: string, tickHex: string, labelHex: string): CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas2d(S, S);
  const g = ctx.createRadialGradient(S * 0.45, S * 0.4, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, '#3A3A3A');
  g.addColorStop(1, '#141414');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const R = S * 0.42;
  ctx.strokeStyle = tickHex;
  for (let i = 0; i <= 20; i++) {
    const a = -Math.PI / 2 - DIAL_SWEEP + (i / 20) * DIAL_SWEEP * 2;
    const major = i % 5 === 0;
    ctx.globalAlpha = major ? 0.9 : 0.5;
    ctx.lineWidth = major ? S * 0.018 : S * 0.009;
    const r0 = R * (major ? 0.8 : 0.87);
    ctx.beginPath();
    ctx.moveTo(S / 2 + Math.cos(a) * r0, S / 2 + Math.sin(a) * r0);
    ctx.lineTo(S / 2 + Math.cos(a) * R, S / 2 + Math.sin(a) * R);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = labelHex;
  ctx.font = `700 ${Math.round(S * 0.1)}px Oswald, "Arial Narrow", "Roboto Condensed", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(label, S / 2, S * 0.74);
  return finish(c);
}
/** Dial needles sweep this far either side of straight up. */
export const DIAL_SWEEP = 2.2;

/** A condensed all-caps label on a transparent ground (for plinth plates). */
export function labelTexture(text: string, hex: string): CanvasTexture {
  const [c, ctx] = canvas2d(512, 128);
  ctx.clearRect(0, 0, 512, 128);
  ctx.font = `700 84px Oswald, "Arial Narrow", "Roboto Condensed", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = hex;
  ctx.shadowBlur = 18;
  ctx.fillStyle = hex;
  ctx.fillText(text, 256, 68);
  return finish(c);
}

// ---- painted textures ------------------------------------------------------------

function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

/** Deterministic noise for the painted textures (same pictures every load). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function finish(c: HTMLCanvasElement, srgb = true): CanvasTexture {
  const tex = new CanvasTexture(c);
  if (srgb) tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Carbon felt: dark matted fibres. */
export function feltTexture(): CanvasTexture {
  const [c, ctx] = canvas2d(128, 128);
  const r = rng(7);
  ctx.fillStyle = '#2C3038';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 700; i++) {
    const x = r() * 128;
    const y = r() * 128;
    const a = r() * Math.PI;
    const len = 3 + r() * 9;
    ctx.strokeStyle = r() < 0.55 ? 'rgba(10,12,20,0.6)' : 'rgba(120,128,140,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  const tex = finish(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  return tex;
}

/** Cathode mesh: a square weave with open holes (alpha map). */
export function meshTexture(): CanvasTexture {
  const [c, ctx] = canvas2d(32, 32);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, 32, 10);
  ctx.fillRect(0, 0, 10, 32);
  const tex = finish(c, false);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(7, 10);
  tex.magFilter = NearestFilter;
  return tex;
}

/** Brushed-metal roughness streaks. */
export function brushedTexture(): CanvasTexture {
  const [c, ctx] = canvas2d(4, 128);
  const r = rng(11);
  for (let y = 0; y < 128; y++) {
    const v = Math.round(150 + r() * 90);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(0, y, 4, 1);
  }
  const tex = finish(c, false);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  return tex;
}

/** A soft round glow, white, tinted per instance. */
export function glowTexture(): CanvasTexture {
  const [c, ctx] = canvas2d(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return finish(c);
}

/** Gas-giant bands in cream, orange and teal. */
export function planetTexture(): CanvasTexture {
  const [c, ctx] = canvas2d(8, 256);
  const r = rng(5);
  const hues = ['#E8C9A0', '#D9582B', '#F3E3C8', '#B8693A', '#2F8073', '#E0A526', '#F3E3C8'];
  let y = 0;
  while (y < 256) {
    const h = 6 + Math.floor(r() * 26);
    ctx.fillStyle = hues[Math.floor(r() * hues.length)] ?? PAPER;
    ctx.fillRect(0, y, 8, h);
    y += h;
  }
  return finish(c);
}

/**
 * Planet ring: concentric translucent bands, painted radially on a square so
 * RingGeometry's planar UVs pick them up. `inner` is inner/outer radius.
 */
export function ringTexture(inner: number): CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas2d(S, S);
  const r = rng(9);
  const R = S / 2;
  for (let i = 0; i < 90; i++) {
    const u = i / 90;
    const rad = R * (inner + (1 - inner) * u);
    const a = (0.12 + r() * 0.55) * Math.sin(u * Math.PI);
    ctx.strokeStyle = r() < 0.2 ? `rgba(217,88,43,${a.toFixed(3)})` : `rgba(243,227,200,${a.toFixed(3)})`;
    ctx.lineWidth = (R * (1 - inner)) / 90 + 0.6;
    ctx.beginPath();
    ctx.arc(R, R, rad, 0, Math.PI * 2);
    ctx.stroke();
  }
  return finish(c);
}

/**
 * An analogue meter face. The needle pivots at (0.5, METER_PIVOT_V) in UV
 * space and sweeps METER_SWEEP radians either side of straight up.
 */
export const METER_PIVOT_V = 0.26;
export const METER_SWEEP = 0.95;
export function meterTexture(label: string, bands: readonly string[]): CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas2d(S, S);
  ctx.fillStyle = '#F3EEDD';
  ctx.fillRect(0, 0, S, S);
  const px = S / 2;
  const py = S * (1 - METER_PIVOT_V);
  const R = S * 0.56;
  for (let i = 0; i < bands.length; i++) {
    const a0 = -Math.PI / 2 - METER_SWEEP + (i / bands.length) * METER_SWEEP * 2;
    const a1 = -Math.PI / 2 - METER_SWEEP + ((i + 1) / bands.length) * METER_SWEEP * 2;
    ctx.strokeStyle = bands[i] ?? INK;
    ctx.lineWidth = S * 0.07;
    ctx.beginPath();
    ctx.arc(px, py, R * 0.88, a0, a1);
    ctx.stroke();
  }
  ctx.strokeStyle = INK;
  for (let i = 0; i <= 20; i++) {
    const a = -Math.PI / 2 - METER_SWEEP + (i / 20) * METER_SWEEP * 2;
    const major = i % 5 === 0;
    ctx.lineWidth = major ? S * 0.022 : S * 0.01;
    const r0 = R * (major ? 0.98 : 1.03);
    const r1 = R * 1.12;
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(a) * r0, py + Math.sin(a) * r0);
    ctx.lineTo(px + Math.cos(a) * r1, py + Math.sin(a) * r1);
    ctx.stroke();
  }
  ctx.fillStyle = INK;
  ctx.font = `700 ${Math.round(S * 0.09)}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(label, px, py - R * 0.4);
  return finish(c);
}

export const SEAT_BANDS: readonly string[] = SEAT_STRONG;
