/**
 * The stage scene (loaded lazily by centrepiece.ts, with three.js).
 *
 * Layout, in scene units (1 unit is about 5 cm of real apparatus), with the
 * console top at y = 0 and the stage facing +z:
 *
 *   fuel cell (anode | membrane | cathode) on a cream plinth, left of centre
 *   battery pack (five upright cells, meter on the header), right of centre
 *   copper lead: anode rod -> arc -> bus bar over the pack -> each cell
 *   red return lead: pack -> cathode rod
 *   a mission-control console under both, gauges at its ends, dark in the middle
 *   floor grid to the horizon, sky dome, stars, a ringed planet, concentric arcs
 *
 * draw() is stateless for everything the game decides (charge, sparks,
 * pulses, the leader) and keeps only cosmetic easing state for the camera.
 * It allocates nothing: every vector, matrix and colour is made here once.
 */
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Points,
  Quaternion,
  LineSegments,
  LineCurve3,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
  AdditiveBlending,
  BackSide,
} from 'three';
import type { Frame } from '../types';
import { BEAT_S } from '../score';
import type { Centrepiece, CentrepieceOptions } from './centrepiece';
import {
  type Quality,
  DIAL_SWEEP,
  brushedTexture,
  dialTexture,
  labelTexture,
  linkMaterial,
  nodeMaterial,
  rimMaterial,
  streamMaterial,
  feltMaterial,
  feltTexture,
  fillMaterial,
  glassMaterial,
  glowSolid,
  glowSprite,
  glowTexture,
  gridMaterial,
  liquidMaterial,
  meshTexture,
  metal,
  plastic,
  skyMaterial,
} from './materials';
import {
  ANOLYTE,
  BIOFILM,
  BIOFILM_GLOW,
  CATHOLYTE,
  CHARCOAL_HI,
  CHARCOAL_LO,
  CORAL,
  GOLD,
  NODE_BLUE,
  NODE_TEAL,
  SEAT_STRONG,
  SPARK,
  TEAL_GLOW,
} from './palette';

const SEATS = 5;

// ---- layout ---------------------------------------------------------------------

const BASE_H = 0.28;
/** Fuel cell: anode and cathode chamber centres, membrane plane. */
const AX = -3.0;
const CX = -1.2;
const MX = -2.1;
const CW = 1.45;
const CH = 1.72;
const CD = 1.2;
const CY0 = BASE_H;
const CY1 = CY0 + CH;
const FILL = CY0 + 1.4;
const ELEC_Y = CY0 + 0.64;
const ELEC_W = 0.66;
const ELEC_H = 0.98;
const FELT_D = 0.2;
const ELEC_TOP = ELEC_Y + ELEC_H / 2;
const ROD_TOP = CY1 + 0.42;
/** Battery pack. */
const CELL_X = [0.95, 1.63, 2.31, 2.99, 3.67] as const;
const PACK_X = 2.31;
const CELL_R = 0.24;
const CELL_Y0 = BASE_H + 0.12;
const CELL_H = 1.66;
const CELL_Y1 = CELL_Y0 + CELL_H;
const HEADER_Y = 2.43;
const BUS_Y = 2.72;
const BUS_X0 = 0.4;
const METER_Y = 3.16;
const METER_R = 0.34;
/** Console and floor. */
const FLOOR_Y = -1.4;
const CON_W = 10.8;
/** Hero bounds for framing. */
const HERO_X0 = -4.15;
const HERO_X1 = 4.3;
const HERO_Y0 = -0.2;
const HERO_Y1 = 3.62;

/** A note's electron takes this long from the anode to its cell. */
const SPARK_T = 0.62;
const TRAIL = 4;
const LUT_N = 128;

function fade(age: number, life: number): number {
  return age >= 0 && age < life ? 1 - age / life : 0;
}
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function hash(a: number, b: number): number {
  let x = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d) >>> 0;
  x ^= x >>> 12;
  return (x >>> 0) / 4294967296;
}

export function buildCentrepiece(canvas: HTMLCanvasElement, options: CentrepieceOptions): Centrepiece {
  const quality: Quality = options.quality ?? 'high';
  const hi = quality === 'high';
  const dpr0 = window.devicePixelRatio || 1;

  const renderer = new WebGLRenderer({
    canvas,
    alpha: false,
    antialias: dpr0 <= 1,
    powerPreference: hi ? 'high-performance' : 'low-power',
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(CHARCOAL_LO, 1);
  renderer.transmissionResolutionScale = 0.5;

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 2, 0.3, 200);

  const geos: BufferGeometry[] = [];
  const mats: Material[] = [];
  const texs: Texture[] = [];
  const G = <T extends BufferGeometry>(g: T): T => (geos.push(g), g);
  const M = <T extends Material>(m: T): T => (mats.push(m), m);
  const T = <T2 extends Texture>(t: T2): T2 => (texs.push(t), t);

  // ---- environment: a small procedural mission-control room ----------------
  {
    const pmrem = new PMREMGenerator(renderer);
    const env = new Scene();
    const room = new Mesh(new BoxGeometry(20, 12, 20), new MeshBasicMaterial({ color: '#121214', side: BackSide }));
    env.add(room);
    const panel = (w: number, h: number, hex: string, k: number, x: number, y: number, z: number) => {
      const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(hex).multiplyScalar(k), side: DoubleSide }));
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    panel(10, 3, '#FFF1DC', 3.2, 0, 5.5, 6); // softbox over the console, front
    panel(1.2, 8, TEAL_GLOW, 4, 9.5, 1, -2); // teal strip right (cathode side faces it)
    panel(1.2, 8, CORAL, 4, -9.5, 1, -2); // coral strip left (anode side)
    panel(14, 0.6, '#F3EEDD', 1.5, 0, 1.5, -9.5); // lamp line behind
    const rt = pmrem.fromScene(env, 0.03, 0.1, 50, { size: hi ? 256 : 64 });
    scene.environment = rt.texture;
    scene.environmentIntensity = 0.75;
    env.traverse((o) => {
      if (o instanceof Mesh) {
        (o.geometry as BufferGeometry).dispose();
        (o.material as Material).dispose();
      }
    });
    pmrem.dispose();
    texs.push(rt.texture);
  }

  // ---- lights -----------------------------------------------------------------
  scene.add(new HemisphereLight('#B8C4CC', '#101012', 0.45));
  const key = new DirectionalLight('#FFF1DC', 2.0);
  key.position.set(-4, 7, 9);
  scene.add(key);
  // Coral rims the anode side, teal the cathode side and the pack.
  const rimCoral = new DirectionalLight(CORAL, 3.4);
  rimCoral.position.set(-8, 4, -6);
  scene.add(rimCoral);
  const rimTeal = new DirectionalLight(TEAL_GLOW, 3.4);
  rimTeal.position.set(8, 3.5, -6);
  scene.add(rimTeal);
  const biofilmLight = new PointLight(BIOFILM_GLOW, 0, 3.2, 2);
  biofilmLight.position.set(AX, ELEC_Y, 0.55);
  scene.add(biofilmLight);
  const packLight = hi ? new PointLight(TEAL_GLOW, 1.0, 4, 2) : null;
  if (packLight) {
    packLight.position.set(PACK_X, 1.4, 1.2);
    scene.add(packLight);
  }

  // ---- shared helpers ---------------------------------------------------------
  const dummy = new Object3D();
  const tmpM = new Matrix4();
  const tmpV = new Vector3();
  const tmpV2 = new Vector3();
  const tmpQ = new Quaternion();
  const tmpC = new Color();
  const white = new Color('#FFFFFF');

  function mesh(geo: BufferGeometry, mat: Material, x: number, y: number, z: number, parent: Object3D = scene): Mesh {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  function inst(geo: BufferGeometry, mat: Material, count: number, colors = false): InstancedMesh {
    const m = new InstancedMesh(geo, mat, count);
    if (colors) for (let i = 0; i < count; i++) m.setColorAt(i, white);
    m.frustumCulled = false;
    scene.add(m);
    return m;
  }
  function place(m: InstancedMesh, i: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): void {
    dummy.position.set(x, y, z);
    dummy.rotation.set(rx, ry, rz);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    m.setMatrixAt(i, dummy.matrix);
  }

  // ---- materials ----------------------------------------------------------------
  const brushed = T(brushedTexture());
  const glass = M(glassMaterial());
  const aluminium = M(metal('#C3C8CE', 0.32, { map: brushed }));
  const steel = M(metal('#A9AFB8', 0.28));
  const chrome = M(metal('#E6EAEE', 0.12));
  const titanium = M(metal('#D4D7DC', 0.28, { alphaMap: T(meshTexture()) }));
  const copper = M(metal('#C87A45', 0.3));
  const cream = M(plastic('#E9E3D2', 0.5));
  const graphite = M(plastic('#2A2D33', 0.45));
  const consoleNavy = M(plastic('#1A1B1F', 0.5));
  const consoleDark = M(plastic('#0D0D0F', 0.7));
  const edgeMat = M(glowSolid('#FFFFFF'));
  const membraneMat = M(plastic('#D9B45A', 0.3, '#6B4A10', 0.35));
  membraneMat.transparent = true;
  membraneMat.opacity = 0.9;
  const capMat = M(plastic('#2F8073', 0.38));
  const ppMat = M(plastic('#E8ECEE', 0.3));
  const tubing = M(plastic('#E9E2D2', 0.25));
  tubing.transparent = true;
  tubing.opacity = 0.7;
  const redLead = M(plastic('#2B9D94', 0.35));
  const clipMat = M(plastic('#FFFFFF', 0.4));
  const felt = M(feltMaterial(T(feltTexture())));
  const biofilmMat = M(new MeshStandardMaterial({ color: BIOFILM, roughness: 0.35, metalness: 0, emissive: new Color(BIOFILM_GLOW), emissiveIntensity: 0.3 }));
  const anolyte = M(liquidMaterial(ANOLYTE, quality));
  const catholyte = M(liquidMaterial(CATHOLYTE, quality));
  const surfaceMat = M(plastic('#FFFFFF', 0.04));
  surfaceMat.transparent = true;
  surfaceMat.opacity = 0.1;
  surfaceMat.depthWrite = false;
  const bubbleMat = M(new MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.75, envMapIntensity: 2 }));
  const fill = M(fillMaterial());
  const bandMat = M(plastic('#FFFFFF', 0.35));
  const gold = M(glowSolid(SPARK));
  const lampMat = M(glowSolid('#FFFFFF'));
  const microbeMat = M(glowSolid('#FFFFFF'));
  const sparkMat = M(glowSolid('#FFFFFF', false));
  const glowMap = T(glowTexture());
  const glowMat = M(glowSprite(glowMap));

  // ---- set: charcoal radial, biofilm network, line-art planet, arcs, faint grid ----------
  const skyMat = M(skyMaterial(CHARCOAL_HI, CHARCOAL_LO));
  const sky = mesh(G(new SphereGeometry(90, 16, 8)), skyMat, 0, 0, 0);
  sky.renderOrder = -10;
  sky.frustumCulled = false;

  // A drifting 3D network of teal and blue nodes joined by thin lines, like a
  // living biofilm around the stage. Edges are fixed at start; nodes drift.
  const NODES = hi ? 150 : 64;
  const nodeHome = new Float32Array(NODES * 3);
  const nodePos = new Float32Array(NODES * 3);
  const nodeSize = new Float32Array(NODES);
  const nodeTint = new Float32Array(NODES * 3);
  {
    const teal = new Color(NODE_TEAL);
    const blue = new Color(NODE_BLUE);
    for (let i = 0; i < NODES; i++) {
      // Clustered colonies in a shell behind and around the reactor, clear of the lanes.
      const colony = Math.floor(hash(i, 60) * 12);
      const cxs = [-11, -7, -3, 1, 5, 9, 12, -13, 13, -9, 9, 0][colony]!;
      const cys = [5.5, 7.5, 6.8, 7.8, 6.5, 7.2, 4.5, 2.5, 2.2, 1.2, 1.0, 4.5][colony]!;
      const czs = [-8, -10, -12, -11, -12, -9, -7, -4, -4, -6, -6, -14][colony]!;
      const sp = 2.6;
      nodeHome[i * 3] = cxs + (hash(i, 61) - 0.5) * sp * 2;
      nodeHome[i * 3 + 1] = cys + (hash(i, 62) - 0.5) * sp * 1.4;
      nodeHome[i * 3 + 2] = czs + (hash(i, 63) - 0.5) * sp * 1.6;
      nodeSize[i] = 3 + hash(i, 64) * 9;
      const c = hash(i, 65) < 0.6 ? teal : blue;
      nodeTint[i * 3] = c.r;
      nodeTint[i * 3 + 1] = c.g;
      nodeTint[i * 3 + 2] = c.b;
    }
    nodePos.set(nodeHome);
  }
  const edgeList: number[] = [];
  for (let i = 0; i < NODES; i++) {
    // Join each node to its two nearest neighbours within reach.
    let b1 = -1;
    let b2 = -1;
    let d1 = 9e9;
    let d2 = 9e9;
    for (let j = 0; j < NODES; j++) {
      if (j === i) continue;
      const dx = nodeHome[i * 3]! - nodeHome[j * 3]!;
      const dy = nodeHome[i * 3 + 1]! - nodeHome[j * 3 + 1]!;
      const dz = nodeHome[i * 3 + 2]! - nodeHome[j * 3 + 2]!;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < d1) {
        d2 = d1;
        b2 = b1;
        d1 = d;
        b1 = j;
      } else if (d < d2) {
        d2 = d;
        b2 = j;
      }
    }
    if (b1 > i && d1 < 9) edgeList.push(i, b1);
    if (b2 > i && d2 < 9) edgeList.push(i, b2);
  }
  const EDGES = edgeList.length / 2;
  const edgeIdx = Uint16Array.from(edgeList);
  const nodeGeo = G(new BufferGeometry());
  const nodeAttr = new BufferAttribute(nodePos, 3);
  nodeGeo.setAttribute('position', nodeAttr);
  nodeGeo.setAttribute('size', new BufferAttribute(nodeSize, 1));
  nodeGeo.setAttribute('tint', new BufferAttribute(nodeTint, 3));
  const nodeMat = M(nodeMaterial());
  const nodes = new Points(nodeGeo, nodeMat);
  nodes.frustumCulled = false;
  scene.add(nodes);
  const linkPos = new Float32Array(EDGES * 6);
  const linkCol = new Float32Array(EDGES * 6);
  const linkGeo = G(new BufferGeometry());
  const linkAttr = new BufferAttribute(linkPos, 3);
  const linkColAttr = new BufferAttribute(linkCol, 3);
  linkGeo.setAttribute('position', linkAttr);
  linkGeo.setAttribute('color', linkColAttr);
  const links = new LineSegments(linkGeo, M(linkMaterial()));
  links.frustumCulled = false;
  scene.add(links);

  // Line-art planet: a dark body with a coral rim and two thin teal rings.
  const planetGroup = new Group();
  planetGroup.position.set(-27, 8.5, -80);
  scene.add(planetGroup);
  const planet = new Mesh(G(new SphereGeometry(6, hi ? 48 : 24, hi ? 24 : 12)), M(rimMaterial(CORAL, '#141416')));
  planetGroup.add(planet);
  const ringLine = M(new MeshBasicMaterial({ color: new Color(TEAL_GLOW), transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
  for (const r of [9.2, 10.4, 12.2]) {
    const ring = new Mesh(G(new TorusGeometry(r, 0.07, 4, 128)), ringLine);
    ring.rotation.set(1.25, 0.25, 0.35);
    planetGroup.add(ring);
  }

  // Concentric arcs behind the stage, quiet line-art in coral and teal.
  const arcGroup = new Group();
  arcGroup.position.set(0.3, 1.0, -16);
  scene.add(arcGroup);
  const arcTeal = M(new MeshBasicMaterial({ color: new Color(TEAL_GLOW), transparent: true, opacity: 0.22, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
  const arcCoral = M(new MeshBasicMaterial({ color: new Color(CORAL), transparent: true, opacity: 0.22, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
  const ARCS: readonly [number, number, Material][] = [
    [7.5, 2.2, arcTeal],
    [8.6, 1.7, arcCoral],
    [9.7, 2.5, arcTeal],
    [11.2, 1.2, arcCoral],
  ];
  for (const [r, arc, mat] of ARCS) {
    const a = new Mesh(G(new TorusGeometry(r, 0.04, 4, 128, arc)), mat);
    a.rotation.z = (Math.PI - arc) / 2;
    arcGroup.add(a);
  }

  const gridMat = M(gridMaterial(hi ? 1.0 : 1.5));
  const grid = mesh(G(new PlaneGeometry(240, 160)), gridMat, 0, FLOOR_Y, -60);
  grid.rotation.x = -Math.PI / 2;
  grid.renderOrder = -8;

  // ---- console ------------------------------------------------------------------
  mesh(G(new BoxGeometry(CON_W, 1.28, 2.7)), consoleNavy, 0, -0.76, -0.05);
  mesh(G(new BoxGeometry(CON_W + 0.2, 0.12, 2.95)), consoleNavy, 0, -0.06, 0.05);
  const trim = mesh(G(new BoxGeometry(CON_W + 0.22, 0.04, 0.05)), chrome, 0, -0.02, 1.53);
  trim.name = 'trim';
  const PANEL_TILT = -Math.atan2(0.8, 1.28);
  const panel = new Group();
  panel.position.set(0, -0.76, 1.92);
  panel.rotation.x = PANEL_TILT;
  scene.add(panel);
  mesh(G(new BoxGeometry(CON_W, 1.52, 0.08)), consoleDark, 0, 0, 0, panel);
  mesh(G(new BoxGeometry(CON_W, 0.03, 0.05)), chrome, 0, 0.74, 0.04, panel);
  mesh(G(new BoxGeometry(CON_W, 0.03, 0.05)), chrome, 0, -0.74, 0.04, panel);
  // Two big round dials: the cell's VOLTAGE left, its CURRENT right,
  // dark faces with glowing coral rims, like the reference video.
  const DIAL_X = [-4.25, 4.25] as const;
  const DIAL_R = 0.52;
  const DIAL_Y = 0.08;
  const needleMat = M(glowSolid(CORAL));
  const needleGeo = G(new BoxGeometry(0.03, 1, 0.012));
  needleGeo.translate(0, 0.5, 0);
  const rimGeo = G(new TorusGeometry(1, 0.06, 10, 64));
  const rims = inst(rimGeo, M(glowSolid(CORAL)), 3);
  const dialNeedles: Mesh[] = [];
  const dialFaces: Mesh[] = [];
  const dialCentres: Vector3[] = [];
  const DIAL_LABELS = ['VOLTAGE', 'CURRENT'] as const;
  panel.updateMatrixWorld(true);
  tmpQ.setFromAxisAngle(tmpV2.set(1, 0, 0), PANEL_TILT);
  for (let i = 0; i < 2; i++) {
    const gx = DIAL_X[i]!;
    const faceTex = T(dialTexture(DIAL_LABELS[i]!, TEAL_GLOW, TEAL_GLOW));
    dialFaces.push(mesh(G(new CircleGeometry(DIAL_R, 48)), M(new MeshBasicMaterial({ map: faceTex })), gx, DIAL_Y, 0.045, panel));
    const n = mesh(needleGeo, needleMat, gx, DIAL_Y, 0.055, panel);
    n.scale.set(1, DIAL_R * 0.8, 1);
    dialNeedles.push(n);
    tmpV.set(gx, DIAL_Y, 0.05).applyMatrix4(panel.matrixWorld);
    dialCentres.push(tmpV.clone());
    tmpM.compose(tmpV, tmpQ, tmpV2.set(DIAL_R, DIAL_R, DIAL_R));
    rims.setMatrixAt(i + 1, tmpM);
  }
  const coralC = new Color(CORAL);
  /** Move the console dials inward on a portrait stage so both stay in frame. */
  function layoutDials(x: number): void {
    panel.updateMatrixWorld(true);
    tmpQ.setFromAxisAngle(tmpV2.set(1, 0, 0), PANEL_TILT);
    for (let i = 0; i < 2; i++) {
      const gx = i === 0 ? -x : x;
      dialFaces[i]!.position.x = gx;
      dialNeedles[i]!.position.x = gx;
      dialCentres[i]!.set(gx, DIAL_Y, 0.05).applyMatrix4(panel.matrixWorld);
      tmpM.compose(dialCentres[i]!, tmpQ, tmpV2.set(DIAL_R, DIAL_R, DIAL_R));
      rims.setMatrixAt(i + 1, tmpM);
    }
    rims.instanceMatrix.needsUpdate = true;
  }
  const LAMPS_PER_SIDE = 6;
  const lampGeo = G(new SphereGeometry(0.05, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2));
  const consoleLamps = inst(lampGeo, lampMat, LAMPS_PER_SIDE * 2, true);
  const consoleLampPos: Vector3[] = [];
  for (let s = 0; s < 2; s++) {
    for (let k = 0; k < LAMPS_PER_SIDE; k++) {
      const lx = (s === 0 ? -3.35 : 2.0) + k * 0.27;
      const v = new Vector3(lx, -0.48, 0.04);
      v.applyMatrix4(panel.matrixWorld);
      consoleLampPos.push(v);
    }
  }

  // ---- fuel cell --------------------------------------------------------------------
  mesh(G(new BoxGeometry(3.75, BASE_H, 1.75)), graphite, MX, BASE_H / 2, 0);
  // Name plates on the plinth front: coral ANODE, teal CATHODE.
  const plateGeo = G(new PlaneGeometry(1.2, 0.3));
  mesh(plateGeo, M(new MeshBasicMaterial({ map: T(labelTexture('ANODE', CORAL)), transparent: true, depthWrite: false, toneMapped: false })), AX, BASE_H / 2, 0.88);
  mesh(plateGeo, M(new MeshBasicMaterial({ map: T(labelTexture('CATHODE', TEAL_GLOW)), transparent: true, depthWrite: false, toneMapped: false })), CX, BASE_H / 2, 0.88);
  mesh(G(new BoxGeometry(3.77, 0.05, 1.77)), aluminium, MX, BASE_H, 0);

  const struts: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
  const frameBox = (cx: number, cy: number, cz: number, w: number, h: number, d: number, t: number) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) struts.push({ x: cx + (sx * w) / 2, y: cy, z: cz + (sz * d) / 2, sx: t, sy: h, sz: t });
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) struts.push({ x: cx, y: cy + (sy * h) / 2, z: cz + (sz * d) / 2, sx: w + t, sy: t, sz: t });
      for (const sx of [-1, 1]) struts.push({ x: cx + (sx * w) / 2, y: cy + (sy * h) / 2, z: cz, sx: t, sy: t, sz: d + t });
    }
  };
  // Glowing edge frames: the chambers read as the reference's outlined boxes.
  frameBox(AX, CY0 + CH / 2, 0, CW, CH, CD, 0.035);
  const anodeStruts = struts.length;
  frameBox(CX, CY0 + CH / 2, 0, CW, CH, CD, 0.035);
  const unitBox = G(new BoxGeometry(1, 1, 1));
  const strutMesh = inst(unitBox, edgeMat, struts.length, true);
  const tealC = new Color(TEAL_GLOW);
  struts.forEach((s, i) => {
    place(strutMesh, i, s.x, s.y, s.z, s.sx, s.sy, s.sz);
    strutMesh.setColorAt(i, i < anodeStruts ? coralC : tealC);
  });
  strutMesh.instanceMatrix.needsUpdate = true;
  const posts = inst(unitBox, aluminium, 2);
  place(posts, 0, 0.52, (BASE_H + HEADER_Y) / 2, -0.28, 0.08, HEADER_Y - BASE_H, 0.08);
  place(posts, 1, 4.1, (BASE_H + HEADER_Y) / 2, -0.28, 0.08, HEADER_Y - BASE_H, 0.08);
  posts.instanceMatrix.needsUpdate = true;

  const chamberGeo = G(new BoxGeometry(CW, CH, CD));
  const anodeGlass = mesh(chamberGeo, glass, AX, CY0 + CH / 2, 0);
  const cathodeGlass = mesh(chamberGeo, glass, CX, CY0 + CH / 2, 0);
  anodeGlass.renderOrder = 5;
  cathodeGlass.renderOrder = 5;
  const lidGeo = G(new BoxGeometry(CW + 0.06, 0.07, CD + 0.06));
  mesh(lidGeo, aluminium, AX, CY1 + 0.035, 0);
  mesh(lidGeo, aluminium, CX, CY1 + 0.035, 0);

  const flangeGeo = G(new BoxGeometry(0.145, CH + 0.16, CD + 0.16));
  mesh(flangeGeo, aluminium, MX - 0.1025, CY0 + CH / 2, 0);
  mesh(flangeGeo, aluminium, MX + 0.1025, CY0 + CH / 2, 0);
  mesh(G(new BoxGeometry(0.06, CH - 0.04, CD + 0.3)), membraneMat, MX, CY0 + CH / 2, 0);
  const bolts = inst(G(new CylinderGeometry(0.03, 0.03, 0.62, 10)), steel, 4);
  {
    let k = 0;
    for (const y of [CY0 + 0.02, CY1 - 0.02]) for (const z of [-(CD / 2 + 0.05), CD / 2 + 0.05]) place(bolts, k++, MX, y, z, 1, 1, 1, 0, 0, Math.PI / 2);
    bolts.instanceMatrix.needsUpdate = true;
  }

  // Liquids and their surfaces.
  const liqH = FILL - CY0 - 0.04;
  const liqGeo = G(new BoxGeometry(CW - 0.08, liqH, CD - 0.08));
  const anodeLiquid = mesh(liqGeo, anolyte, AX, CY0 + 0.04 + liqH / 2, 0);
  const cathodeLiquid = mesh(liqGeo, catholyte, CX, CY0 + 0.04 + liqH / 2, 0);
  anodeLiquid.renderOrder = 3;
  cathodeLiquid.renderOrder = 3;
  const surfGeo = G(new PlaneGeometry(CW - 0.1, CD - 0.1));
  const anodeSurf = mesh(surfGeo, surfaceMat, AX, FILL + 0.005, 0);
  const cathodeSurf = mesh(surfGeo, surfaceMat, CX, FILL + 0.005, 0);
  anodeSurf.renderOrder = 4;
  cathodeSurf.renderOrder = 4;

  // Electrodes.
  mesh(G(new BoxGeometry(ELEC_W, ELEC_H, FELT_D)), felt, AX, ELEC_Y, 0.08);
  const cathodePlate = mesh(G(new PlaneGeometry(ELEC_W, ELEC_H)), titanium, CX, ELEC_Y, 0.08);
  cathodePlate.name = 'cathode';
  const cfr = inst(G(new BoxGeometry(1, 1, 1)), steel, 4);
  place(cfr, 0, CX, ELEC_TOP, 0.08, ELEC_W + 0.04, 0.04, 0.04);
  place(cfr, 1, CX, ELEC_Y - ELEC_H / 2, 0.08, ELEC_W + 0.04, 0.04, 0.04);
  place(cfr, 2, CX - ELEC_W / 2, ELEC_Y, 0.08, 0.04, ELEC_H, 0.04);
  place(cfr, 3, CX + ELEC_W / 2, ELEC_Y, 0.08, 0.04, ELEC_H, 0.04);
  cfr.instanceMatrix.needsUpdate = true;
  const rods = inst(G(new CylinderGeometry(0.025, 0.025, ROD_TOP - ELEC_TOP, 10)), steel, 2);
  place(rods, 0, AX, (ROD_TOP + ELEC_TOP) / 2, 0.08);
  place(rods, 1, CX, (ROD_TOP + ELEC_TOP) / 2, 0.08);
  rods.instanceMatrix.needsUpdate = true;
  const clips = inst(G(new CylinderGeometry(0.06, 0.06, 0.14, 14)), clipMat, 2, true);
  place(clips, 0, AX, ROD_TOP, 0.08);
  place(clips, 1, CX, ROD_TOP, 0.08);
  clips.setColorAt(0, tmpC.set('#1D1D1F'));
  clips.setColorAt(1, tmpC.set('#B4301C'));
  clips.instanceMatrix.needsUpdate = true;

  // Ports and caps: an electrode port and a side port per chamber.
  const PORTS: readonly [number, number][] = [
    [AX, 0.08],
    [AX - 0.45, -0.2],
    [CX, 0.08],
    [CX + 0.45, -0.2],
  ];
  const ports = inst(G(new CylinderGeometry(0.12, 0.13, 0.2, 20)), ppMat, 4);
  const caps = inst(G(new CylinderGeometry(0.15, 0.15, 0.13, 20)), capMat, 4);
  PORTS.forEach(([x, z], i) => {
    place(ports, i, x, CY1 + 0.17, z);
    place(caps, i, x, CY1 + 0.32, z);
  });
  ports.instanceMatrix.needsUpdate = true;
  caps.instanceMatrix.needsUpdate = true;

  // Air stone and line in the cathode chamber.
  const AIR_X = CX + 0.45;
  mesh(G(new BoxGeometry(0.24, 0.1, 0.24)), cream, AIR_X, CY0 + 0.09, -0.2);
  mesh(G(new CylinderGeometry(0.022, 0.022, CY1 + 0.32 - (CY0 + 0.14), 8)), tubing, AIR_X, (CY1 + 0.32 + CY0 + 0.14) / 2, -0.2);

  // Biofilm on the felt: blobs on the faces the camera sees.
  const BLOBS = hi ? 220 : 90;
  const blobGeo = G(new IcosahedronGeometry(1, hi ? 1 : 0));
  const blobs = inst(blobGeo, biofilmMat, BLOBS);
  const blobBase = new Float32Array(BLOBS * 4);
  /** 0: front/top face (flatten z or y), 1: side face (flatten x). */
  const blobFace = new Uint8Array(BLOBS);
  for (let i = 0; i < BLOBS; i++) {
    const f = hash(i, 11);
    const a = hash(i, 12) - 0.5;
    const b = hash(i, 13) - 0.5;
    let x: number;
    let y: number;
    let z: number;
    if (f < 0.62) {
      x = AX + a * ELEC_W;
      y = ELEC_Y + b * ELEC_H;
      z = 0.08 + FELT_D / 2;
    } else if (f < 0.9) {
      const side = f < 0.76 ? -1 : 1;
      x = AX + (side * ELEC_W) / 2;
      blobFace[i] = 1;
      y = ELEC_Y + b * ELEC_H;
      z = 0.08 + a * FELT_D;
    } else {
      x = AX + a * ELEC_W;
      y = ELEC_TOP;
      z = 0.08 + b * FELT_D;
    }
    blobBase[i * 4] = x;
    blobBase[i * 4 + 1] = y;
    blobBase[i * 4 + 2] = z;
    blobBase[i * 4 + 3] = 0.018 + hash(i, 14) * 0.026;
  }

  /** Per blob, the groove level it appears at: low near colony seeds, so growth spreads outward. */
  const blobGate = new Float32Array(BLOBS);
  {
    const seeds = [
      [AX - 0.18, ELEC_Y - 0.3],
      [AX + 0.2, ELEC_Y + 0.1],
      [AX - 0.1, ELEC_Y + 0.35],
      [AX + 0.25, ELEC_Y - 0.4],
    ] as const;
    for (let i = 0; i < BLOBS; i++) {
      let dmin = 9;
      for (const [sx, sy] of seeds) dmin = Math.min(dmin, Math.hypot(blobBase[i * 4]! - sx, blobBase[i * 4 + 1]! - sy));
      blobGate[i] = Math.min(1, dmin * 1.6 + hash(i, 15) * 0.25);
    }
  }

  // Bubbles rising from the air stone.
  const BUBBLES = hi ? 22 : 9;
  const bubbles = inst(G(new IcosahedronGeometry(1, 1)), bubbleMat, BUBBLES);
  bubbles.renderOrder = 2;

  // Microbes: one small glowing colony per seat, living on the electrodes.
  const MICROBE_RODS = 3;
  const microbeGeo = G(new CapsuleGeometry(0.03, 0.09, 3, 8));
  const microbes = inst(microbeGeo, microbeMat, SEATS * MICROBE_RODS, true);
  const MICROBE_AT: readonly [number, number, number][] = [
    [AX - 0.2, ELEC_Y + 0.28, 0.08 + FELT_D / 2 + 0.05],
    [AX + 0.18, ELEC_Y + 0.02, 0.08 + FELT_D / 2 + 0.05],
    [AX - 0.12, ELEC_Y - 0.3, 0.08 + FELT_D / 2 + 0.05],
    [CX - 0.15, ELEC_Y + 0.18, 0.13],
    [CX + 0.16, ELEC_Y - 0.22, 0.13],
  ];

  // ---- wires --------------------------------------------------------------------------
  const arcPts = [
    new Vector3(AX, ROD_TOP, 0.08),
    new Vector3(AX - 0.05, ROD_TOP + 0.45, 0.08),
    new Vector3(-2.0, 3.36, 0.06),
    new Vector3(-0.6, 3.24, 0.03),
    new Vector3(0.12, 2.92, 0),
    new Vector3(BUS_X0, BUS_Y, 0),
  ];
  const arcCurve = new CatmullRomCurve3(arcPts, false, 'centripetal');
  mesh(G(new TubeGeometry(arcCurve, 96, 0.035, 10, false)), copper, 0, 0, 0);
  const retCurve = new CatmullRomCurve3(
    [
      new Vector3(0.5, 0.2, 0.62),
      new Vector3(0.2, 0.45, 0.62),
      new Vector3(-0.08, 1.4, 0.45),
      new Vector3(-0.32, 2.5, 0.25),
      new Vector3(-0.85, 2.82, 0.1),
      new Vector3(CX, ROD_TOP, 0.08),
    ],
    false,
    'centripetal',
  );
  mesh(G(new TubeGeometry(retCurve, 80, 0.03, 8, false)), redLead, 0, 0, 0);
  mesh(G(new CylinderGeometry(0.045, 0.045, CELL_X[4] + 0.12 - BUS_X0, 14).rotateZ(Math.PI / 2)), copper, (BUS_X0 + CELL_X[4] + 0.12) / 2, BUS_Y, 0);

  // The electron river: a gold beaded stream over the copper, bright with the groove.
  const streamMat = M(streamMaterial(GOLD));
  const streamArc = mesh(G(new TubeGeometry(arcCurve, 160, 0.05, 8, false)), streamMat, 0, 0, 0);
  const busCurve = new LineCurve3(new Vector3(BUS_X0, BUS_Y, 0), new Vector3(CELL_X[4], BUS_Y, 0));
  const streamBus = mesh(G(new TubeGeometry(busCurve, 64, 0.06, 8, false)), streamMat, 0, 0, 0);
  streamArc.renderOrder = 28;
  streamBus.renderOrder = 28;
  // An "e- flow" arrowhead on the arc, pointing anode to pack.
  {
    const arrow = mesh(G(new CylinderGeometry(0, 0.09, 0.22, 16)), M(glowSolid(GOLD)), 0, 0, 0);
    arcCurve.getPointAt(0.62, arrow.position);
    arrow.position.y += 0.16;
    arcCurve.getTangentAt(0.62, tmpV);
    arrow.quaternion.setFromUnitVectors(tmpV2.set(0, 1, 0), tmpV.normalize());
  }

  // Spark path LUT: felt -> rod -> arc, resampled uniformly by length.
  const lut = new Float32Array(LUT_N * 3);
  let prefixLen = 0;
  {
    const dense: Vector3[] = [];
    for (let i = 0; i <= 12; i++) dense.push(new Vector3(AX, ELEC_Y + ((ROD_TOP - ELEC_Y) * i) / 12, 0.12));
    for (const p of arcCurve.getPoints(160)) dense.push(p);
    const cum = [0];
    for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1]! + dense[i]!.distanceTo(dense[i - 1]!));
    prefixLen = cum[cum.length - 1]!;
    let j = 0;
    for (let k = 0; k < LUT_N; k++) {
      const d = (prefixLen * k) / (LUT_N - 1);
      while (j < cum.length - 2 && cum[j + 1]! < d) j++;
      const a = dense[j]!;
      const b = dense[j + 1]!;
      const seg = cum[j + 1]! - cum[j]!;
      const u = seg > 0 ? (d - cum[j]!) / seg : 0;
      lut[k * 3] = a.x + (b.x - a.x) * u;
      lut[k * 3 + 1] = a.y + (b.y - a.y) * u;
      lut[k * 3 + 2] = a.z + (b.z - a.z) * u;
    }
  }
  /** Point at distance d along seat's path (felt, wire, bus, drop to fillY), into out. */
  function pathPoint(seat: number, d: number, fillY: number, out: Vector3): Vector3 {
    if (d <= prefixLen) {
      const f = (Math.max(0, d) / prefixLen) * (LUT_N - 1);
      const k = Math.min(LUT_N - 2, Math.floor(f));
      const u = f - k;
      return out.set(
        lut[k * 3]! + (lut[k * 3 + 3]! - lut[k * 3]!) * u,
        lut[k * 3 + 1]! + (lut[k * 3 + 4]! - lut[k * 3 + 1]!) * u,
        lut[k * 3 + 2]! + (lut[k * 3 + 5]! - lut[k * 3 + 2]!) * u,
      );
    }
    const cx = CELL_X[seat] ?? PACK_X;
    const bus = cx - BUS_X0;
    const e = d - prefixLen;
    if (e <= bus) return out.set(BUS_X0 + e, BUS_Y, 0);
    return out.set(cx, Math.max(fillY, BUS_Y - (e - bus)), 0);
  }

  // ---- battery pack -----------------------------------------------------------------
  mesh(G(new BoxGeometry(3.75, BASE_H, 1.25)), graphite, PACK_X + 0.05, BASE_H / 2, 0);
  mesh(G(new BoxGeometry(3.77, 0.05, 1.27)), aluminium, PACK_X + 0.05, BASE_H, 0);
  mesh(G(new BoxGeometry(3.75, 0.14, 0.72)), graphite, PACK_X + 0.05, HEADER_Y, -0.05);
  const cellGlass = inst(G(new CylinderGeometry(CELL_R, CELL_R, CELL_H, hi ? 40 : 24, 1, true)), glass, SEATS);
  cellGlass.renderOrder = 6;
  const fillGeo = G(new CylinderGeometry(CELL_R - 0.035, CELL_R - 0.035, 1, hi ? 32 : 20));
  fillGeo.translate(0, 0.5, 0);
  const fills = inst(fillGeo, fill, SEATS, true);
  const bands = inst(G(new CylinderGeometry(CELL_R + 0.03, CELL_R + 0.03, 0.12, 32)), bandMat, SEATS, true);
  const topCaps = inst(G(new CylinderGeometry(CELL_R + 0.03, CELL_R + 0.03, 0.1, 32)), chrome, SEATS);
  const nubs = inst(G(new CylinderGeometry(0.07, 0.07, 0.08, 14)), copper, SEATS);
  const droppers = inst(G(new CylinderGeometry(0.022, 0.022, BUS_Y - (CELL_Y1 + 0.18), 8)), copper, SEATS);
  const seatCol: Color[] = [];
  for (let i = 0; i < SEATS; i++) {
    const x = CELL_X[i]!;
    place(cellGlass, i, x, CELL_Y0 + CELL_H / 2, 0);
    place(bands, i, x, CELL_Y0 - 0.06, 0);
    place(topCaps, i, x, CELL_Y1 + 0.05, 0);
    place(nubs, i, x, CELL_Y1 + 0.14, 0);
    place(droppers, i, x, (BUS_Y + CELL_Y1 + 0.18) / 2, 0);
    const c = new Color(SEAT_STRONG[i] ?? TEAL_GLOW);
    seatCol.push(c);
    bands.setColorAt(i, c);
  }
  for (const m of [cellGlass, bands, topCaps, nubs, droppers]) m.instanceMatrix.needsUpdate = true;
  const leaderRings = inst(G(new TorusGeometry(CELL_R + 0.07, 0.022, 8, 40)), gold, 2);
  const packLamps = inst(lampGeo, lampMat, SEATS, true);

  // Pack meter: the same dark dial with a coral rim, showing the pack mean.
  mesh(G(new BoxGeometry(0.95, 0.8, 0.22)), graphite, PACK_X, METER_Y, -0.14);
  mesh(G(new CircleGeometry(METER_R, 48)), M(new MeshBasicMaterial({ map: T(dialTexture('PACK', GOLD, TEAL_GLOW)) })), PACK_X, METER_Y, -0.025);
  const packNeedle = mesh(needleGeo, needleMat, PACK_X, METER_Y, -0.015);
  packNeedle.scale.set(1.2, METER_R * 0.8, 1.2);
  place(rims, 0, PACK_X, METER_Y, -0.025, METER_R, METER_R, METER_R);
  rims.instanceMatrix.needsUpdate = true;

  // ---- sparks and glows ----------------------------------------------------------------
  const sparks = inst(G(new IcosahedronGeometry(1, 1)), sparkMat, SEATS * TRAIL, true);
  sparks.renderOrder = 30;
  const GLOW_MAX = 48;
  const glows = inst(G(new PlaneGeometry(1, 1)), glowMat, GLOW_MAX, true);
  glows.renderOrder = 29;
  let glowCount = 0;
  function glow(x: number, y: number, z: number, size: number, c: Color, k: number): void {
    if (glowCount >= GLOW_MAX) return;
    tmpV.set(x, y, z);
    tmpV2.set(size, size, size);
    tmpM.compose(tmpV, camera.quaternion, tmpV2);
    glows.setMatrixAt(glowCount, tmpM);
    tmpC.copy(c).multiplyScalar(k);
    glows.setColorAt(glowCount, tmpC);
    glowCount++;
  }

  // ---- camera state ---------------------------------------------------------------------
  const target = new Vector3();
  const wantTarget = new Vector3();
  const wide = { dist: 20, ty: 1.5 };
  let camDist = 20;
  let camAmp = 0.12;
  let lastNow = -1;
  let portrait = false;
  const sparkC = new Color(SPARK);
  const goldC = new Color(SPARK);
  const biofilmC = new Color(BIOFILM_GLOW);
  const dimLamp = new Color();
  const charges = new Float32Array(SEATS);

  function resize(width: number, height: number, dpr: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const pr = Math.min(dpr || 1, hi ? 2 : 1.5);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, true);
    camera.aspect = w / h;
    portrait = camera.aspect < 1;
    layoutDials(portrait ? 3.45 : DIAL_X[1]);
    consoleLamps.visible = !portrait;
    const tanH = Math.tan((camera.fov * Math.PI) / 360);
    const heroW = HERO_X1 - HERO_X0;
    const heroH = HERO_Y1 - HERO_Y0;
    const heroCY = (HERO_Y0 + HERO_Y1) / 2;
    let visH: number;
    let fromTop: number;
    if (!portrait) {
      visH = Math.max(heroH / 0.5, heroW / (camera.aspect * 0.8));
      fromTop = 0.36;
    } else {
      visH = Math.max(heroH / 0.38, heroW / (camera.aspect * 0.97));
      fromTop = 0.23;
    }
    wide.dist = visH / 2 / tanH + 0.9;
    wide.ty = heroCY - (0.5 - fromTop) * visH;
    camera.updateProjectionMatrix();
    nodeMat.uniforms.pixelRatio!.value = pr;
    const res = skyMat.uniforms.resolution!.value as number[];
    res[0] = w * pr;
    res[1] = h * pr;
  }

  function draw(frame: Frame): void {
    const t = frame.t;
    const now = frame.now;
    const still = frame.reducedMotion;
    const first = lastNow < 0;
    const dt = first ? 0 : Math.min(0.25, Math.max(0, now - lastNow));
    lastNow = now;
    const ch = frame.charge;
    let mean = 0;
    for (let i = 0; i < SEATS; i++) {
      const c = clamp01(ch?.[i] ?? 0);
      charges[i] = c;
      mean += c;
    }
    mean /= SEATS;
    const leader = frame.leader ?? null;

    // Camera: a slow drift, closer on a video shot.
    const ampWant = still ? 0 : frame.mode === 'idle' ? 0.16 : frame.mode === 'video' ? 0.2 : 0.05;
    const ease = 1 - Math.exp(-dt * 1.6);
    camAmp += (ampWant - camAmp) * ease;
    const shot = frame.mode === 'video' ? frame.shot : null;
    let distWant = wide.dist;
    if (shot != null && shot >= 0 && shot < SEATS) {
      const side = shot < 3 ? AX : CX;
      const cx = CELL_X[shot]!;
      wantTarget.set(cx * 0.55 + side * 0.45, 1.35, 0);
      distWant = wide.dist * (portrait ? 0.62 : 0.5);
    } else {
      wantTarget.set(0.05, wide.ty, 0);
    }
    if (first) {
      target.copy(wantTarget);
      camDist = distWant;
      camAmp = ampWant;
    } else {
      target.lerp(wantTarget, ease);
      camDist += (distWant - camDist) * ease;
    }
    const yaw = -0.1 + camAmp * Math.sin((now * Math.PI * 2) / 26);
    const pitch = (portrait ? 0.2 : 0.15) + camAmp * 0.18 * Math.sin((now * Math.PI * 2) / 37);
    camera.position.set(
      target.x + Math.sin(yaw) * Math.cos(pitch) * camDist,
      target.y + Math.sin(pitch) * camDist,
      target.z + Math.cos(yaw) * Math.cos(pitch) * camDist,
    );
    camera.lookAt(target);
    camera.updateMatrixWorld();
    sky.position.copy(camera.position);

    const time = still ? 0 : now;
    streamMat.uniforms.time!.value = time;
    // The river thickens and brightens as the groove rises (quiet below about 0.35).
    const river = clamp01((clamp01(frame.groove) - 0.3) / 0.6);
    streamMat.uniforms.level!.value = 0.08 + 0.9 * river;
    streamMat.uniforms.amp!.value = 0.005 + 0.045 * river;
    // The network drifts slowly.
    const drift = still ? 0 : now;
    for (let i = 0; i < NODES; i++) {
      const ph = i * 1.37;
      nodePos[i * 3] = nodeHome[i * 3]! + Math.sin(drift * 0.11 + ph) * 0.6;
      nodePos[i * 3 + 1] = nodeHome[i * 3 + 1]! + Math.sin(drift * 0.08 + ph * 1.7) * 0.45;
      nodePos[i * 3 + 2] = nodeHome[i * 3 + 2]! + Math.cos(drift * 0.07 + ph) * 0.5;
    }
    nodeAttr.needsUpdate = true;
    for (let e = 0; e < EDGES; e++) {
      const a = edgeIdx[e * 2]!;
      const b = edgeIdx[e * 2 + 1]!;
      const dx = nodePos[a * 3]! - nodePos[b * 3]!;
      const dy = nodePos[a * 3 + 1]! - nodePos[b * 3 + 1]!;
      const dz = nodePos[a * 3 + 2]! - nodePos[b * 3 + 2]!;
      const k = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy + dz * dz) / 3.2) * 0.55;
      for (let v = 0; v < 2; v++) {
        const n = v === 0 ? a : b;
        linkPos[e * 6 + v * 3] = nodePos[n * 3]!;
        linkPos[e * 6 + v * 3 + 1] = nodePos[n * 3 + 1]!;
        linkPos[e * 6 + v * 3 + 2] = nodePos[n * 3 + 2]!;
        linkCol[e * 6 + v * 3] = nodeTint[n * 3]! * k;
        linkCol[e * 6 + v * 3 + 1] = nodeTint[n * 3 + 1]! * k;
        linkCol[e * 6 + v * 3 + 2] = nodeTint[n * 3 + 2]! * k;
      }
    }
    linkAttr.needsUpdate = true;
    linkColAttr.needsUpdate = true;
    fill.uniforms.time!.value = time;
    gridMat.uniforms.scroll!.value = still ? 0 : now * 0.35;
    const eye = gridMat.uniforms.eye!.value as number[];
    eye[0] = camera.position.x;
    eye[1] = camera.position.y;
    eye[2] = camera.position.z;
    planet.rotation.y = time * 0.02;
    arcGroup.rotation.z = still ? 0 : Math.sin(time * 0.1) * 0.03;

    glowCount = 0;

    // Liquids wobble.
    const wob = still ? 0 : 1;
    anodeSurf.rotation.set(-Math.PI / 2 + wob * 0.025 * Math.sin(now * 1.3), wob * 0.02 * Math.sin(now * 0.9 + 1), 0);
    cathodeSurf.rotation.set(-Math.PI / 2 + wob * 0.03 * Math.sin(now * 1.7 + 2), wob * 0.025 * Math.sin(now * 1.1), 0);

    // Biofilm grows with the givers' biofilm in the cell (kinetics.ts) and glows with the power.
    const groove = clamp01(frame.groove);
    const bf = frame.cell?.biofilm;
    const film = bf ? clamp01(((bf[0] ?? 0) + (bf[1] ?? 0) + (bf[2] ?? 0)) / 3) : groove;
    const thick = 0.6 + 0.7 * film;
    const coverage = 0.3 + 0.75 * film;
    for (let i = 0; i < BLOBS; i++) {
      const pulse = still ? 1 : 1 + 0.12 * Math.sin(now * 2.1 + i * 1.7);
      // Colonies spread as the groove rises: each blob appears at its own threshold.
      const grow = clamp01((coverage - blobGate[i]!) * 6);
      const s = blobBase[i * 4 + 3]! * thick * pulse * grow;
      if (blobFace[i] === 1) place(blobs, i, blobBase[i * 4]!, blobBase[i * 4 + 1]!, blobBase[i * 4 + 2]!, s * 0.5, s * 0.9, s);
      else place(blobs, i, blobBase[i * 4]!, blobBase[i * 4 + 1]!, blobBase[i * 4 + 2]!, s, s * 0.9, s * 0.5);
    }
    blobs.instanceMatrix.needsUpdate = true;
    biofilmMat.emissiveIntensity = 0.08 + 0.55 * groove;
    biofilmLight.intensity = 0.4 + 2.6 * groove;
    glow(AX, ELEC_Y, 0.3, 1.2 + groove * 0.8, biofilmC, 0.12 + groove * 0.25);

    // Bubbles.
    if (still) {
      bubbles.count = 0;
    } else {
      bubbles.count = BUBBLES;
      const span = FILL - (CY0 + 0.16);
      for (let i = 0; i < BUBBLES; i++) {
        const sp = 0.25 + hash(i, 21) * 0.25;
        const ph = (now * sp + hash(i, 22)) % 1;
        const r = (0.018 + hash(i, 23) * 0.03) * (0.7 + ph * 0.5);
        const x = AIR_X - 0.08 + hash(i, 24) * 0.16 + Math.sin(now * 3 + i) * 0.03 * ph;
        const z = -0.2 + (hash(i, 25) - 0.5) * 0.18;
        place(bubbles, i, x, CY0 + 0.16 + ph * span, z, r, r, r);
      }
      bubbles.instanceMatrix.needsUpdate = true;
    }

    // Cells, sparks, lamps, microbes.
    let sparkCount = 0;
    for (let i = 0; i < SEATS; i++) {
      const seat = frame.seats[i];
      const x = CELL_X[i]!;
      const c = charges[i]!;
      const fillH = Math.max(0.004, c * CELL_H);
      const fillY = CELL_Y0 + fillH;
      const hitAge = seat ? t - seat.hitAt : Infinity;
      const missAge = seat ? t - seat.missAt : Infinity;
      const land = fade(hitAge - SPARK_T, 0.45);
      const miss = fade(missAge, 0.4);
      place(fills, i, x, CELL_Y0, 0, 1, fillH, 1);
      const col = seatCol[i]!;
      tmpC.copy(col).lerp(white, land * 0.4).multiplyScalar(1.0 + land * 0.8 - miss * 0.6);
      fills.setColorAt(i, tmpC);
      const isLead = leader === i;
      glow(x, fillY, 0.3, 0.7 + land * 0.9 + (isLead ? 0.2 : 0), col, 0.3 + land * 0.9 + (isLead ? 0.15 : 0));

      // Lamps on the pack plinth: dim seat colour, gold for the leader, flash on a landing.
      dimLamp.copy(col).multiplyScalar(0.35 + land * 1.2);
      if (isLead) dimLamp.copy(goldC).multiplyScalar(1.2);
      packLamps.setColorAt(i, dimLamp);
      place(packLamps, i, x, 0.14, 0.63, 1.2, 1.2, 1.2, Math.PI / 2, 0, 0);
      if (isLead || land > 0) glow(x, 0.14, 0.7, 0.5, isLead ? goldC : col, isLead ? 0.8 : land);

      // The electron: felt -> wire -> bus -> down into the cell.
      if (hitAge >= 0 && hitAge < SPARK_T) {
        const u = hitAge / SPARK_T;
        const eased = u * u * (3 - 2 * u) * 0.55 + u * 0.45;
        const L = prefixLen + (x - BUS_X0) + (BUS_Y - fillY);
        const d = eased * L;
        for (let k = 0; k < TRAIL; k++) {
          const dk = d - k * 0.13;
          if (dk < 0) break;
          pathPoint(i, dk, fillY, tmpV);
          const s = k === 0 ? 0.06 : 0.045 - k * 0.008;
          place(sparks, sparkCount, tmpV.x, tmpV.y, tmpV.z, s, s, s);
          if (k === 0) sparks.setColorAt(sparkCount, sparkC);
          else sparks.setColorAt(sparkCount, tmpC.copy(col).lerp(white, 0.3));
          sparkCount++;
          if (k === 0) glow(tmpV.x, tmpV.y, tmpV.z + 0.05, 0.55, col, 1.2);
        }
      }

      // Microbe colony: pulses on its seat's hit.
      const hitPulse = fade(hitAge, 0.35);
      const m = MICROBE_AT[i]!;
      const ms = 1 + hitPulse * 0.6;
      for (let r = 0; r < MICROBE_RODS; r++) {
        const a = hash(i, 30 + r) * Math.PI;
        const ox = (hash(i, 40 + r) - 0.5) * 0.14;
        const oy = (hash(i, 50 + r) - 0.5) * 0.14;
        const wig = still ? 0 : Math.sin(now * 2.4 + r * 2 + i) * 0.15;
        place(microbes, i * MICROBE_RODS + r, m[0] + ox, m[1] + oy, m[2], ms, ms, ms, 0, 0, a + wig);
        microbes.setColorAt(i * MICROBE_RODS + r, tmpC.copy(col).lerp(white, 0.2 + hitPulse * 0.5).multiplyScalar(1.2 + hitPulse));
      }
      glow(m[0], m[1], m[2] + 0.05, 0.4 + hitPulse * 0.5, col, 0.6 + hitPulse * 1.2);

      // Miss: the glass flushes darker for a moment (handled by the fill colour above).
    }
    fills.instanceMatrix.needsUpdate = true;
    if (fills.instanceColor) fills.instanceColor.needsUpdate = true;
    packLamps.instanceMatrix.needsUpdate = true;
    if (packLamps.instanceColor) packLamps.instanceColor.needsUpdate = true;
    microbes.instanceMatrix.needsUpdate = true;
    if (microbes.instanceColor) microbes.instanceColor.needsUpdate = true;
    sparks.count = sparkCount;
    if (sparkCount > 0) {
      sparks.instanceMatrix.needsUpdate = true;
      if (sparks.instanceColor) sparks.instanceColor.needsUpdate = true;
    }

    // Leader rings.
    if (leader != null && leader >= 0 && leader < SEATS) {
      const x = CELL_X[leader]!;
      const bob = still ? 0 : Math.sin(now * 3) * 0.02;
      leaderRings.count = 2;
      place(leaderRings, 0, x, CELL_Y1 + 0.05 + bob, 0, 1, 1, 1, Math.PI / 2, 0, 0);
      place(leaderRings, 1, x, CELL_Y0 - 0.06, 0, 1, 1, 1, Math.PI / 2, 0, 0);
      leaderRings.instanceMatrix.needsUpdate = true;
      glow(x, CELL_Y1 + 0.08, 0.05, 0.9, goldC, 0.5);
    } else {
      leaderRings.count = 0;
    }

    // Meters: the pack mean on the header; the console's groove, mean, leader and beat.
    const jitter = still || frame.mode === 'idle' ? 0 : Math.sin(now * 23) * 0.012 * groove;
    packNeedle.rotation.z = DIAL_SWEEP * (1 - 2 * clamp01(mean + jitter));
    // VOLTAGE and CURRENT read the fuel cell itself (kinetics.ts): voltage sags as current rises.
    const beat = still || frame.mode === 'idle' ? 0 : Math.abs(Math.sin((t * Math.PI) / BEAT_S)) * 0.04 * groove;
    const volts = frame.cell ? frame.cell.voltage / 0.8 : mean;
    const amps = frame.cell ? frame.cell.current / 3 : groove;
    dialNeedles[0]!.rotation.z = DIAL_SWEEP * (1 - 2 * clamp01(volts + jitter));
    dialNeedles[1]!.rotation.z = DIAL_SWEEP * (1 - 2 * clamp01(amps + beat));
    for (let i = 0; i < 2; i++) {
      const c = dialCentres[i]!;
      glow(c.x, c.y, c.z + 0.02, DIAL_R * 3.0, coralC, 0.22);
    }
    glow(PACK_X, METER_Y, 0.0, METER_R * 3.0, coralC, 0.18);

    // Console lamps: a slow chase in idle, seat lamps that flash on hits in play.
    for (let k = 0; k < consoleLampPos.length; k++) {
      const p = consoleLampPos[k]!;
      const s = k % SEATS;
      const sf = frame.seats[s];
      const flash = sf ? fade(t - sf.hitAt, 0.25) : 0;
      const chase = still ? 0.5 : 0.5 + 0.5 * Math.sin(now * 2 - k * 0.9);
      const lit = frame.mode === 'idle' ? 0.25 + 0.5 * chase : 0.25 + flash * 1.4;
      place(consoleLamps, k, p.x, p.y, p.z, 1, 1, 1, PANEL_TILT + Math.PI / 2, 0, 0);
      consoleLamps.setColorAt(k, tmpC.copy(k % 3 === 0 ? tealC : seatCol[s]!).multiplyScalar(lit));
      if (lit > 0.6) glow(p.x, p.y, p.z + 0.05, 0.3, k % 3 === 0 ? tealC : seatCol[s]!, lit * 0.5);
    }
    consoleLamps.instanceMatrix.needsUpdate = true;
    if (consoleLamps.instanceColor) consoleLamps.instanceColor.needsUpdate = true;

    glows.count = glowCount;
    glows.instanceMatrix.needsUpdate = true;
    if (glows.instanceColor) glows.instanceColor.needsUpdate = true;

    renderer.render(scene, camera);
  }

  return {
    resize,
    draw,
    info() {
      return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
      scene.traverse((o) => {
        if (o instanceof InstancedMesh) o.dispose();
      });
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
