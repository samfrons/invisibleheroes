/**
 * Electron Chain's stage: a microbial fuel cell in cross-section, drawn in
 * MESSAi's instrument style (bakelite navy, brass, cream dial faces, copper)
 * with a 1970s sci-fi glow (phosphor scope, amber readouts, CRT lines).
 *
 * The four microbes are the biofilm on the anode. A right press hops the
 * electron from cell to cell; a whole signal sends it into the anode, up the
 * copper circuit, through the town (the load) and down to the cathode, where
 * oxygen and protons that crossed the membrane make water. The meters read
 * the cell's voltage, current and power, and every pulse lights a house.
 *
 * Draws from the rules' state plus a few timestamps it keeps itself. No game
 * state is decided here.
 */
import { clamp01, fade, hash } from '../render/style';
import {
  GOAL,
  LIVES,
  PLAYERS,
  isOver,
  tempoFor,
  timeLeft,
  type ChainEvent,
  type ChainState,
  type StepKind,
} from './rules';

export interface ChainLabels {
  /** Key cap per player ('A'), or the touch prompt. */
  keys: readonly string[];
  names: readonly string[];
  phone: string;
  round: string;
  watch: string;
  yourTurn: string;
  delivered: string;
  broken: Record<'wrong' | 'half' | 'cold', string>;
  twice: string;
  lit: string;
  blackout: string;
  title: string;
  subtitle: string;
  anode: string;
  cathode: string;
  membrane: string;
  load: string;
  source: string;
  water: string;
  voltage: string;
  current: string;
  power: string;
  chain: string;
}

/* MESSAi's instrument palette (libs/shared/ui/src/tokens/palette.ts), lit for a dark room. */
const NAVY = '#0C1638';
const BAKELITE = '#1B2438';
const BRASS = '#C9A86A';
const BRASS_DARK = '#8C7A5E';
const CREAM = '#F1E6C8';
const COPPER = '#C8773E';
const TEAL_GLOW = '#5FD3C2';
const GRAPHITE = '#3A3A42';
const NICKEL = '#9AA3A8';
const AMBER = '#FFB547';
const PHOSPHOR = '#4CFF8A';
const ALARM = '#FF5A4E';
const ELECTRON = '#FFD84A';
/** Per player, bright enough to read on navy: coral, cyan, amber, violet. */
export const PLAYER_COLORS = ['#FF7A59', '#4FC3D9', '#F2C14E', '#B48CFF'] as const;

const DISPLAY = 'Oswald, "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const MONO = '"Roboto Mono", ui-monospace, "SF Mono", Menlo, monospace';
const display = (px: number, weight = 600) => `${weight} ${Math.max(7, Math.round(px))}px ${DISPLAY}`;
const mono = (px: number, weight = 500) => `${weight} ${Math.max(7, Math.round(px))}px ${MONO}`;

interface Point {
  x: number;
  y: number;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Geometry {
  w: number;
  h: number;
  hudH: number;
  tank: Box;
  anode: Box;
  cathode: Box;
  membraneX: number;
  /** Where each microbe sits, and how big. */
  hold: Point[];
  cell: number;
  /** The acetate the electrons come from. */
  source: Point;
  /** The copper wire's height above the tank, and the town on it. */
  wireY: number;
  town: Box;
  panel: Box;
  meters: { x: number; y: number; r: number }[];
  scope: Box | null;
  lw: number;
}

const HOP_S = 0.22;
const FLY_S = 1.2;
const TAU = Math.PI * 2;
const DIAL_FROM = Math.PI * 1.15;
const DIAL_SWEEP = Math.PI * 0.7;

function geometry(w: number, h: number): Geometry {
  const pad = Math.max(10, Math.min(w, h) * 0.022);
  const hudH = Math.max(42, Math.min(58, h * 0.08));
  const narrow = w < 640;
  const panelH = Math.max(96, Math.min(190, h * 0.22));
  const circuitH = Math.max(64, Math.min(150, h * 0.19));
  const tank: Box = {
    x: pad,
    y: hudH + circuitH,
    w: w - pad * 2,
    h: h - hudH - circuitH - panelH - pad * 1.5,
  };
  const slabW = Math.max(9, tank.w * 0.016);
  const anode: Box = { x: tank.x + pad, y: tank.y + tank.h * 0.14, w: slabW, h: tank.h * 0.76 };
  const membraneX = tank.x + tank.w * (narrow ? 0.84 : 0.78);
  const cathode: Box = { x: tank.x + tank.w - pad - slabW, y: anode.y, w: slabW, h: anode.h };
  const left = anode.x + slabW + pad * 0.8;
  const right = membraneX - pad * (narrow ? 1.2 : 2.6);
  const span = (right - left) / PLAYERS;
  const cell = Math.min(span * 0.92, tank.h * 0.6);
  const cy = tank.y + tank.h * 0.56;
  const hold: Point[] = [];
  for (let i = 0; i < PLAYERS; i++) hold.push({ x: left + span * (i + 0.5), y: cy });
  const wireY = hudH + circuitH * 0.82;
  const townW = Math.min(w * 0.5, 520);
  const town: Box = { x: (w - townW) / 2, y: hudH + circuitH * 0.18, w: townW, h: wireY - (hudH + circuitH * 0.18) };
  const panel: Box = { x: pad, y: h - panelH - pad * 0.5, w: w - pad * 2, h: panelH };
  const r = Math.min(panel.h * 0.42, (panel.w / (narrow ? 3 : 4.4)) * 0.42);
  const meters: Geometry['meters'] = [];
  const slots = narrow ? 3 : 4;
  for (let i = 0; i < 3; i++) {
    meters.push({ x: panel.x + (panel.w / slots) * (i + 0.5), y: panel.y + panel.h * 0.56, r });
  }
  const scope: Box | null = narrow
    ? null
    : {
        x: panel.x + (panel.w / slots) * 3 + pad * 0.5,
        y: panel.y + panel.h * 0.16,
        w: panel.w / slots - pad * 1.5,
        h: panel.h * 0.68,
      };
  return {
    w,
    h,
    hudH,
    tank,
    anode,
    cathode,
    membraneX,
    hold,
    cell,
    source: { x: right + pad * (narrow ? 0.3 : 1.2), y: cy - cell * 0.05 },
    wireY,
    town,
    panel,
    meters,
    scope,
    lw: Math.max(1.4, Math.min(2.6, cell * 0.014)),
  };
}

/** A point `u` (0..1) of the way along a polyline, by length. */
function along(pts: readonly Point[], u: number): Point {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  let left = clamp01(u) * total;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= d || i === pts.length - 1) {
      const k = d > 0 ? Math.min(1, left / d) : 1;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
    left -= d;
  }
  return pts[pts.length - 1]!;
}

function roundRect(ctx: CanvasRenderingContext2D, b: Box, r: number) {
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, r);
}

export interface ChainRenderer {
  resize(width: number, height: number, dpr: number): void;
  /** Feed every event the rules return, with the time it happened. */
  event(e: ChainEvent, t: number): void;
  /** Any press, right or wrong: the microbe pings. */
  press(player: number, t: number): void;
  /** `state` null is the lobby: the cell idles. `remote` marks players on a phone. */
  draw(state: ChainState | null, t: number, remote: readonly boolean[], reducedMotion: boolean): void;
  /** The player whose microbe is under a point (CSS pixels), or null. */
  playerAt(x: number, y: number): number | null;
  /** Forget every flash and hop (a new game). */
  reset(): void;
}

export function createChainRenderer(canvas: HTMLCanvasElement, labels: ChainLabels): ChainRenderer {
  const ctx = canvas.getContext('2d')!;
  let g = geometry(1, 1);
  let dpr = 1;
  /** The blueprint ground and the CRT lines, drawn once per resize. */
  let backdrop: HTMLCanvasElement | null = null;
  let scanlines: CanvasPattern | null = null;

  const litAt = new Array<number>(PLAYERS).fill(-Infinity);
  const litKind: StepKind[] = new Array<StepKind>(PLAYERS).fill('tap');
  const pressAt = new Array<number>(PLAYERS).fill(-Infinity);
  const wrongAt = new Array<number>(PLAYERS).fill(-Infinity);
  /** The electron: where it hops from, to (null = the acetate, PLAYERS = round the circuit), and when. */
  let from: number | null = null;
  let to: number | null = null;
  let hopAt = -Infinity;
  let flyFrom: Point = { x: 0, y: 0 };
  let pulseAt = -Infinity;
  let brokenAt = -Infinity;
  let brokenText = '';
  let endAt = -Infinity;
  /** Smoothed meter needles. */
  let volts = 0.3;
  let amps = 0;

  const holdOf = (who: number | null): Point => (who === null ? g.source : g.hold[who]!);

  /** The electron's road from a microbe out through the circuit to the cathode. */
  function circuitFrom(p: Point): Point[] {
    const ax = g.anode.x + g.anode.w / 2;
    const cx = g.cathode.x + g.cathode.w / 2;
    return [p, { x: ax, y: p.y }, { x: ax, y: g.wireY }, { x: cx, y: g.wireY }, { x: cx, y: g.cathode.y + g.cathode.h * 0.3 }];
  }
  /** How far along that road the town sits (0..1), so the house lights as the pulse passes. */
  function townAt(p: Point): number {
    const pts = circuitFrom(p);
    let total = 0;
    let before = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
      if (i <= 2) before += d;
      if (i === 3) before += Math.abs(g.w / 2 - pts[2]!.x);
      total += d;
    }
    return total > 0 ? before / total : 0.5;
  }

  function reset() {
    litAt.fill(-Infinity);
    pressAt.fill(-Infinity);
    wrongAt.fill(-Infinity);
    from = to = null;
    hopAt = pulseAt = brokenAt = endAt = -Infinity;
    volts = 0.3;
    amps = 0;
  }

  function glow(color: string, blur: number) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
  }
  function noGlow() {
    ctx.shadowBlur = 0;
  }

  function paintBackdrop(w: number, h: number) {
    const c = document.createElement('canvas');
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const b = c.getContext('2d')!;
    b.scale(dpr, dpr);
    const bg = b.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.max(w, h) * 0.75);
    bg.addColorStop(0, '#17223F');
    bg.addColorStop(1, '#060A16');
    b.fillStyle = bg;
    b.fillRect(0, 0, w, h);
    // Blueprint grid.
    b.strokeStyle = 'rgba(95, 211, 194, 0.05)';
    b.lineWidth = 1;
    const step = Math.max(24, Math.min(w, h) / 22);
    for (let x = (w % step) / 2; x < w; x += step) {
      b.beginPath();
      b.moveTo(x, 0);
      b.lineTo(x, h);
      b.stroke();
    }
    for (let y = (h % step) / 2; y < h; y += step) {
      b.beginPath();
      b.moveTo(0, y);
      b.lineTo(w, y);
      b.stroke();
    }
    backdrop = c;
    const s = document.createElement('canvas');
    s.width = 1;
    s.height = 3;
    const sc = s.getContext('2d')!;
    sc.fillStyle = 'rgba(0, 0, 0, 0.18)';
    sc.fillRect(0, 0, 1, 1);
    scanlines = ctx.createPattern(s, 'repeat');
  }

  function label(text: string, x: number, y: number, px: number, color: string, align: CanvasTextAlign = 'left') {
    ctx.font = mono(px, 500);
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  /* ---------------------------------------------------------------- tank */

  function tank(state: ChainState | null, t: number) {
    const k = g.tank;
    const r = Math.min(18, k.h * 0.06);
    // Glass and liquid.
    const liquid = ctx.createLinearGradient(0, k.y, 0, k.y + k.h);
    liquid.addColorStop(0, 'rgba(79, 195, 217, 0.05)');
    liquid.addColorStop(1, 'rgba(47, 128, 115, 0.16)');
    roundRect(ctx, k, r);
    ctx.fillStyle = liquid;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(200, 230, 240, 0.35)';
    ctx.stroke();
    // Brass clamps at the corners: the lab-instrument detail.
    ctx.fillStyle = BRASS_DARK;
    for (const x of [k.x + r, k.x + k.w - r - 14]) {
      ctx.fillRect(x, k.y - 3, 14, 6);
      ctx.fillRect(x, k.y + k.h - 3, 14, 6);
    }
    // Surface line.
    ctx.strokeStyle = 'rgba(200, 230, 240, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = k.x + 4; x <= k.x + k.w - 4; x += 6) {
      const y = k.y + k.h * 0.07 + Math.sin(x * 0.05 + t * 1.5) * 1.5;
      if (x === k.x + 4) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Membrane: a dashed teal band.
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = TEAL_GLOW;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(g.membraneX, k.y + k.h * 0.1);
    ctx.lineTo(g.membraneX, k.y + k.h * 0.95);
    ctx.stroke();
    ctx.restore();

    // Electrodes: graphite anode, nickel cathode.
    const a = g.anode;
    ctx.fillStyle = GRAPHITE;
    ctx.fillRect(a.x, a.y, a.w, a.h);
    ctx.strokeStyle = '#55555f';
    ctx.lineWidth = 1;
    for (let y = a.y + 6; y < a.y + a.h; y += 9) {
      ctx.beginPath();
      ctx.moveTo(a.x + 2, y);
      ctx.lineTo(a.x + a.w - 2, y + 3);
      ctx.stroke();
    }
    const c = g.cathode;
    const sheen = ctx.createLinearGradient(c.x, 0, c.x + c.w, 0);
    sheen.addColorStop(0, '#6E777C');
    sheen.addColorStop(0.5, NICKEL);
    sheen.addColorStop(1, '#6E777C');
    ctx.fillStyle = sheen;
    ctx.fillRect(c.x, c.y, c.w, c.h);

    const px = Math.max(9, Math.min(12, k.h * 0.035));
    const ly = k.y + k.h * 0.07 + px * 1.4;
    label(`${labels.anode.toUpperCase()} (-)`, a.x, k.y + k.h - px * 1.2, px, CREAM);
    label(labels.membrane.toUpperCase(), g.membraneX, k.y + k.h - px * 1.2, px, TEAL_GLOW, 'center');
    label(`${labels.cathode.toUpperCase()} (+)`, c.x + c.w, k.y + k.h - px * 1.2, px, CREAM, 'right');
    label(labels.source, g.source.x, g.source.y - g.cell * 0.32, px, TEAL_GLOW, 'center');

    // The acetate: a little cloud of food molecules.
    for (let i = 0; i < 6; i++) {
      const ox = Math.sin(t * 0.6 + i * 1.7) * g.cell * 0.09;
      const oy = Math.cos(t * 0.5 + i * 2.3) * g.cell * 0.12;
      ctx.beginPath();
      ctx.arc(g.source.x + ox, g.source.y + oy, Math.max(1.5, g.cell * 0.014), 0, TAU);
      ctx.fillStyle = 'rgba(95, 211, 194, 0.55)';
      ctx.fill();
    }

    // Cathode chemistry: protons drift across the membrane after each pulse, water forms.
    const since = t - hopAt;
    if (to === PLAYERS && since >= 0 && since < FLY_S + 1.2) {
      const u = clamp01(since / (FLY_S + 0.6));
      for (let i = 0; i < 4; i++) {
        const x = g.membraneX - g.cell * 0.4 + u * (c.x - g.membraneX + g.cell * 0.3);
        const y = k.y + k.h * (0.3 + i * 0.14);
        label('H+', x, y, px, AMBER, 'center');
      }
    }
    label(labels.water, (g.membraneX + c.x) / 2, ly, px, 'rgba(241, 230, 200, 0.7)', 'center');
    for (let i = 0; i < 5; i++) {
      const u = (t * 0.25 + i / 5) % 1;
      ctx.beginPath();
      ctx.arc(c.x - 8 - (i % 2) * 6, c.y + c.h * (1 - u), 1.5 + (i % 3), 0, TAU);
      ctx.strokeStyle = 'rgba(200, 230, 240, 0.35)';
      ctx.stroke();
    }

    biofilm(state, t);
  }

  function biofilm(state: ChainState | null, t: number) {
    // The conductive biofilm: a wavy nanowire from the anode through every cell to the food.
    const pts = [{ x: g.anode.x + g.anode.w, y: g.hold[0]!.y }, ...g.hold, g.source];
    const broken = state?.phase === 'broken' || state?.phase === 'lost';
    ctx.save();
    ctx.lineWidth = Math.max(1, g.lw * 0.8);
    ctx.strokeStyle = broken ? ALARM : ELECTRON;
    ctx.globalAlpha = broken ? (hash(Math.floor(t * 18), 3) > 0.5 ? 0.6 : 0.15) : 0.35;
    if (broken) ctx.setLineDash([3, 7]);
    glow(ctx.strokeStyle, 6);
    ctx.beginPath();
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      for (let k = 0; k <= 20; k++) {
        const u = k / 20;
        const x = a.x + (b.x - a.x) * u;
        const y = a.y + (b.y - a.y) * u + Math.sin(u * TAU * 2 + t * 2.5 + i) * g.cell * 0.03;
        if (i === 0 && k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  /* ------------------------------------------------------------ microbes */

  /** A rod cell from (x0, y0) to (x1, y1), `r` thick. */
  function rod(x0: number, y0: number, x1: number, y1: number, r: number) {
    const a = Math.atan2(y1 - y0, x1 - x0);
    ctx.beginPath();
    ctx.arc(x0, y0, r, a + Math.PI / 2, a - Math.PI / 2);
    ctx.arc(x1, y1, r, a - Math.PI / 2, a + Math.PI / 2);
    ctx.closePath();
  }

  /** Each species in line art, in a box of size `s` around (0, 0). Ends with the body as the current path. */
  function body(i: number, s: number, t: number, w: number) {
    switch (i) {
      case 0: {
        // Geobacter: a short rod bristling with conductive pili.
        for (let k = 0; k < 5; k++) {
          const a = -0.9 + k * 0.45 + Math.sin(t * 1.4 + k) * 0.05 * w;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * s * 0.12, Math.sin(a) * s * 0.1 - s * 0.02);
          for (let q = 1; q <= 8; q++) {
            const rr = s * (0.12 + q * 0.035);
            ctx.lineTo(Math.cos(a) * rr + Math.sin(q + t * 3 * w) * s * 0.012, Math.sin(a) * rr - s * 0.02);
          }
          ctx.stroke();
        }
        rod(-s * 0.2, s * 0.06, s * 0.16, -s * 0.08, s * 0.11);
        return;
      }
      case 1: {
        // Shewanella: one long flagellum, and flavin shuttles circling it.
        ctx.beginPath();
        for (let q = 0; q <= 20; q++) {
          const x = s * 0.2 + q * s * 0.012;
          const y = s * 0.04 + Math.sin(q * 0.8 - t * 8 * w) * s * 0.035;
          if (q === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        for (let k = 0; k < 4; k++) {
          const a = k * 1.6 + t * 0.7 * w;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * s * 0.3, Math.sin(a) * s * 0.26, s * 0.022, 0, TAU);
          ctx.stroke();
        }
        rod(-s * 0.2, -s * 0.02, s * 0.18, s * 0.06, s * 0.1);
        return;
      }
      case 2: {
        // Sporomusa: a curved rod.
        const r0 = s * 0.25;
        const r1 = s * 0.08;
        const a0 = Math.PI * 1.18;
        const a1 = Math.PI * 1.82;
        const oy = s * 0.18;
        ctx.beginPath();
        ctx.arc(0, oy, r0 + r1, a0, a1);
        ctx.arc(Math.cos(a1) * r0, oy + Math.sin(a1) * r0, r1, a1, a1 + Math.PI);
        ctx.arc(0, oy, r0 - r1, a1, a0, true);
        ctx.arc(Math.cos(a0) * r0, oy + Math.sin(a0) * r0, r1, a0 + Math.PI, a0);
        ctx.closePath();
        return;
      }
      default: {
        // Methanobacterium: a long thin rod, methane bubbling off it.
        for (let k = 0; k < 3; k++) {
          const u = (t * 0.35 * w + k / 3) % 1;
          ctx.beginPath();
          ctx.arc(s * (0.12 + k * 0.05), -s * (0.08 + u * 0.28), s * (0.018 + k * 0.008), 0, TAU);
          ctx.stroke();
        }
        rod(-s * 0.3, s * 0.08, s * 0.26, -s * 0.06, s * 0.065);
      }
    }
  }

  function microbes(state: ChainState | null, t: number, remote: readonly boolean[], reduced: boolean) {
    const tempo = tempoFor(state?.round ?? 1);
    const s = g.cell;
    for (let i = 0; i < PLAYERS; i++) {
      const p = g.hold[i]!;
      const color = PLAYER_COLORS[i]!;
      const litAge = t - litAt[i]!;
      const lit = litAge >= 0 && litAge < tempo.flashS;
      // A double flashes twice inside one flash time.
      const on = lit && (litKind[i] === 'tap' || litAge < tempo.flashS * 0.4 || litAge > tempo.flashS * 0.6);
      const ping = fade(t - pressAt[i]!, 0.35);
      const wrong = fade(t - wrongAt[i]!, 0.6);
      const r = s * 0.42;

      if (on) {
        const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 1.1);
        halo.addColorStop(0, `${color}66`);
        halo.addColorStop(1, `${color}00`);
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 1.1, 0, TAU);
        ctx.fill();
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = on ? color : 'rgba(241, 230, 200, 0.12)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.stroke();
      if (ping > 0) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = ping;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * (1 + (1 - ping) * 0.3), 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.save();
      const jitter = wrong > 0 ? (hash(Math.floor(t * 40), i) - 0.5) * s * 0.06 * wrong : 0;
      ctx.translate(p.x + jitter, p.y);
      ctx.lineWidth = g.lw * 1.1;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const ink = wrong > 0 && hash(Math.floor(t * 25), i + 9) > 0.4 ? ALARM : color;
      ctx.strokeStyle = ink;
      glow(ink, on ? 26 : 8);
      body(i, s, t, reduced ? 0 : 1);
      ctx.fillStyle = on ? ink : `${color}26`;
      ctx.fill();
      ctx.stroke();
      noGlow();
      ctx.restore();

      if (on && litKind[i] === 'double') {
        ctx.font = display(s * 0.15);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = color;
        ctx.fillText(labels.twice, p.x + r * 0.8, p.y - r * 0.8);
      }

      // Key above, name below.
      const key = remote[i] ? labels.phone : labels.keys[i]!;
      const kpx = Math.max(10, Math.min(16, s * 0.085));
      ctx.font = mono(kpx, 700);
      const kw = Math.max(kpx * 2.2, ctx.measureText(key).width + kpx * 1.2);
      const ky = p.y - r - kpx * 1.1;
      ctx.fillStyle = remote[i] ? `${color}33` : 'rgba(27, 36, 56, 0.9)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      roundRect(ctx, { x: p.x - kw / 2, y: ky - kpx * 0.85, w: kw, h: kpx * 1.7 }, 4);
      ctx.fill();
      ctx.stroke();
      label(key, p.x, ky + 1, kpx, CREAM, 'center');
      ctx.font = display(Math.max(11, Math.min(18, s * 0.1)), 500);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = color;
      ctx.fillText(labels.names[i]!.toUpperCase(), p.x, p.y + r + 6);
    }
  }

  /* ------------------------------------------------------- circuit, town */

  function circuit(t: number) {
    const ax = g.anode.x + g.anode.w / 2;
    const cx = g.cathode.x + g.cathode.w / 2;
    const hot = to === PLAYERS ? fade(t - hopAt, FLY_S + 0.4) : 0;
    ctx.save();
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COPPER;
    glow(COPPER, 4 + 16 * hot);
    ctx.globalAlpha = 0.6 + 0.4 * hot;
    ctx.beginPath();
    ctx.moveTo(ax, g.anode.y);
    ctx.lineTo(ax, g.wireY);
    ctx.lineTo(cx, g.wireY);
    ctx.lineTo(cx, g.cathode.y);
    ctx.stroke();
    ctx.restore();
    // Terminals.
    for (const x of [ax, cx]) {
      ctx.beginPath();
      ctx.arc(x, g.anode.y - 2, 4, 0, TAU);
      ctx.fillStyle = BRASS;
      ctx.fill();
    }
    label('e-  >', ax + 10, g.wireY - 9, 10, 'rgba(255, 216, 74, 0.7)');
  }

  function town(state: ChainState | null, charge: number, t: number) {
    const b = g.town;
    const won = state?.phase === 'won';
    const lost = state?.phase === 'lost';
    const n = GOAL;
    const slot = b.w / n;
    for (let i = 0; i < n; i++) {
      // On the win the houses light one after another, left to right.
      const lit = won ? t - endAt > i * 0.15 : !lost && i < charge;
      const hw = slot * (0.62 + hash(i, 2) * 0.28);
      const hh = b.h * (0.42 + hash(i, 4) * 0.5);
      const x = b.x + slot * i + (slot - hw) / 2;
      const top = g.wireY - hh;
      ctx.fillStyle = '#0A0F1F';
      ctx.strokeStyle = lit ? 'rgba(255, 181, 71, 0.6)' : 'rgba(241, 230, 200, 0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(x, top, hw, hh);
      ctx.fill();
      ctx.stroke();
      const rows = Math.max(1, Math.floor(hh / 14));
      const ww = hw / 5;
      const wh = Math.min(ww * 1.2, hh / (rows * 2 + 1));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < 2; c++) {
          const on = lit && hash(i * 31 + r, c) > 0.2;
          ctx.fillStyle = on ? AMBER : 'rgba(241, 230, 200, 0.06)';
          if (on) glow(AMBER, 10);
          ctx.fillRect(x + ww * (c * 2 + 1), top + wh * (r * 2 + 1), ww, wh);
          noGlow();
        }
      }
    }
    label(
      `${labels.load.toUpperCase()}  ${String(Math.min(charge, GOAL)).padStart(2, '0')}/${GOAL}`,
      b.x + b.w / 2,
      g.wireY + 11,
      Math.max(9, Math.min(12, b.h * 0.14)),
      CREAM,
      'center'
    );
  }

  function electron(t: number, reduced: boolean) {
    let pt: Point;
    if (to === PLAYERS) {
      const u = reduced ? 1 : clamp01((t - hopAt) / FLY_S);
      if (u >= 1) return;
      pt = along(circuitFrom(flyFrom), u);
    } else {
      const u = reduced ? 1 : clamp01((t - hopAt) / HOP_S);
      const a = holdOf(from);
      const b = holdOf(to);
      const k = u * u * (3 - 2 * u);
      pt = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k - Math.sin(u * Math.PI) * g.cell * 0.3 };
    }
    const r = Math.max(4, g.cell * 0.042);
    ctx.fillStyle = ELECTRON;
    glow(ELECTRON, 22);
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, TAU);
    ctx.fill();
    noGlow();
    label('e-', pt.x, pt.y - r * 2.2, Math.max(9, r * 1.8), ELECTRON, 'center');
  }

  /* --------------------------------------------------------- instruments */

  function meter(i: number, name: string, value: number, max: number, unit: string, digits: number) {
    const { x, y, r } = g.meters[i]!;
    // Brass bezel, cream face: a panel meter from a 1970s bench supply.
    ctx.fillStyle = BRASS_DARK;
    roundRect(ctx, { x: x - r * 1.18, y: y - r * 1.02, w: r * 2.36, h: r * 1.62 }, 6);
    ctx.fill();
    const face: Box = { x: x - r * 1.08, y: y - r * 0.92, w: r * 2.16, h: r * 1.42 };
    const grad = ctx.createLinearGradient(0, face.y, 0, face.y + face.h);
    grad.addColorStop(0, CREAM);
    grad.addColorStop(1, '#D9CBA4');
    ctx.fillStyle = grad;
    roundRect(ctx, face, 4);
    ctx.fill();
    const cy = face.y + face.h - r * 0.1;
    ctx.strokeStyle = NAVY;
    ctx.lineWidth = 1;
    for (let k = 0; k <= 10; k++) {
      const a = DIAL_FROM + (k / 10) * DIAL_SWEEP;
      const major = k % 5 === 0;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r * (major ? 0.78 : 0.86), cy + Math.sin(a) * r * (major ? 0.78 : 0.86));
      ctx.lineTo(x + Math.cos(a) * r * 0.98, cy + Math.sin(a) * r * 0.98);
      ctx.stroke();
    }
    ctx.strokeStyle = ALARM;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, cy, r * 0.93, DIAL_FROM + DIAL_SWEEP * 0.85, DIAL_FROM + DIAL_SWEEP);
    ctx.stroke();
    const a = DIAL_FROM + clamp01(value / max) * DIAL_SWEEP;
    ctx.strokeStyle = NAVY;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, cy);
    ctx.lineTo(x + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.95);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, cy, 3, 0, TAU);
    ctx.fillStyle = NAVY;
    ctx.fill();
    const px = Math.max(9, Math.min(13, r * 0.2));
    label(name.toUpperCase(), x, face.y + px * 1.1, px, NAVY, 'center');
    // Amber digital readout under the meter.
    const txt = `${value.toFixed(digits)} ${unit}`;
    ctx.font = mono(px * 1.1, 700);
    ctx.fillStyle = AMBER;
    glow(AMBER, 8);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(txt, x, y + r * 0.66);
    noGlow();
  }

  function panel(state: ChainState | null, charge: number, t: number) {
    const p = g.panel;
    roundRect(ctx, p, 10);
    const grad = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
    grad.addColorStop(0, '#222C46');
    grad.addColorStop(1, BAKELITE);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = BRASS_DARK;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Cell readings. Game numbers on a real fuel cell's scale: under a volt, a few milliamps.
    const pulse = to === PLAYERS ? fade(t - hopAt, FLY_S + 1.2) : 0;
    const hop = fade(t - pulseAt, 0.4);
    const sag = fade(t - brokenAt, 1.6);
    const targetV = state?.phase === 'lost' ? 0.02 : 0.32 + 0.05 * charge - 0.18 * sag;
    const targetA = state?.phase === 'lost' ? 0 : 0.15 + 2.6 * pulse + 0.35 * hop;
    volts += (targetV - volts) * 0.08;
    amps += (targetA - amps) * 0.15;
    meter(0, labels.voltage, volts, 1, 'V', 2);
    meter(1, labels.current, amps, 3.2, 'mA', 2);
    meter(2, labels.power, volts * amps, 2.4, 'mW', 2);
    if (g.scope) scope(g.scope, t, state);
  }

  function scope(b: Box, t: number, state: ChainState | null) {
    ctx.fillStyle = '#04080A';
    roundRect(ctx, b, 6);
    ctx.fill();
    ctx.strokeStyle = BRASS_DARK;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(76, 255, 138, 0.1)';
    ctx.lineWidth = 1;
    for (let k = 1; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo(b.x + (b.w * k) / 4, b.y);
      ctx.lineTo(b.x + (b.w * k) / 4, b.y + b.h);
      ctx.moveTo(b.x, b.y + (b.h * k) / 4);
      ctx.lineTo(b.x + b.w, b.y + (b.h * k) / 4);
      ctx.stroke();
    }
    const amp = 0.1 + 0.85 * Math.max(fade(t - pulseAt, 0.7), to === PLAYERS ? fade(t - hopAt, FLY_S) : 0);
    const flat = state?.phase === 'lost';
    ctx.strokeStyle = flat ? ALARM : PHOSPHOR;
    ctx.lineWidth = 2;
    glow(ctx.strokeStyle, 10);
    ctx.beginPath();
    for (let k = 0; k <= 60; k++) {
      const u = k / 60;
      const y = flat ? 0 : Math.sin(u * TAU * 3 - t * 7) * amp + Math.sin(u * 37 + t * 19) * 0.05 * amp;
      const x = b.x + 4 + u * (b.w - 8);
      if (k === 0) ctx.moveTo(x, b.y + b.h / 2 - y * b.h * 0.4);
      else ctx.lineTo(x, b.y + b.h / 2 - y * b.h * 0.4);
    }
    ctx.stroke();
    noGlow();
  }

  /* ----------------------------------------------------------- hud, text */

  function hud(state: ChainState | null, t: number) {
    ctx.fillStyle = 'rgba(12, 22, 56, 0.92)';
    ctx.fillRect(0, 0, g.w, g.hudH);
    ctx.fillStyle = BRASS_DARK;
    ctx.fillRect(0, g.hudH - 2, g.w, 2);
    const mid = g.hudH / 2;
    const pad = Math.max(12, g.w * 0.02);
    if (!state) {
      ctx.font = display(g.hudH * 0.46, 600);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = CREAM;
      ctx.fillText(labels.title.toUpperCase(), g.w / 2, mid);
      return;
    }
    label(
      labels.round.replace('{n}', String(state.round).padStart(2, '0')).replace('{of}', String(GOAL)),
      pad,
      mid,
      Math.min(16, g.hudH * 0.3),
      CREAM
    );
    const left = Math.ceil(timeLeft(state, t));
    const urgent = left <= 30 && !isOver(state);
    ctx.font = mono(Math.min(28, g.hudH * 0.52), 700);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = urgent ? ALARM : AMBER;
    glow(ctx.fillStyle, 12);
    ctx.fillText(`${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`, g.w / 2, mid);
    noGlow();
    const r = Math.min(7, g.hudH * 0.14);
    let x = g.w - pad - r;
    for (let i = LIVES - 1; i >= 0; i--) {
      const alive = i < LIVES - state.breaks;
      ctx.beginPath();
      ctx.arc(x, mid, r, 0, TAU);
      ctx.fillStyle = alive ? PHOSPHOR : '#2a2f3d';
      if (alive) glow(PHOSPHOR, 10);
      ctx.fill();
      noGlow();
      ctx.strokeStyle = BRASS_DARK;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      x -= r * 3;
    }
    label(labels.chain.toUpperCase(), x + r * 0.6, mid, Math.min(11, g.hudH * 0.2), 'rgba(241, 230, 200, 0.6)', 'right');
  }

  function banner(state: ChainState | null, t: number) {
    let text = labels.subtitle;
    let color = CREAM;
    if (state) {
      switch (state.phase) {
        case 'signal':
          text = labels.watch;
          color = TEAL_GLOW;
          break;
        case 'repeat':
          text = labels.yourTurn;
          color = AMBER;
          break;
        case 'delivered':
          text = labels.delivered;
          color = ELECTRON;
          break;
        case 'broken':
          text = brokenText;
          color = ALARM;
          break;
        case 'won':
          text = labels.lit;
          color = AMBER;
          break;
        case 'lost':
          text = labels.blackout;
          color = ALARM;
          break;
      }
    }
    const k = g.tank;
    const bx = (k.x + g.membraneX) / 2;
    const by = k.y + Math.max(22, k.h * 0.12);
    const shake = fade(t - brokenAt, 0.4) * 6 * Math.sin(t * 60);
    ctx.font = display(Math.max(15, Math.min(30, k.w * 0.032)), 600);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    glow(color, 14);
    ctx.fillText(text.toUpperCase(), bx + shake, by);
    noGlow();
    // Progress through the sequence as LEDs, colourless: the order is yours to remember.
    if (state && (state.phase === 'repeat' || state.phase === 'signal')) {
      const n = state.sequence.length;
      const sz = Math.max(5, Math.min(10, (k.w * 0.4) / (n * 1.8)));
      const step = sz * 1.8;
      const x0 = bx - ((n - 1) * step) / 2;
      const dy = by + Math.max(18, sz * 2.6);
      for (let i = 0; i < n; i++) {
        const done = i < state.pos;
        const fill = done ? (state.phase === 'repeat' ? AMBER : TEAL_GLOW) : 'rgba(241, 230, 200, 0.12)';
        ctx.fillStyle = fill;
        if (done) glow(fill, 8);
        ctx.fillRect(x0 + i * step - sz / 2, dy - sz / 2, sz, sz);
        noGlow();
      }
    }
  }

  return {
    resize(width, height, ratio) {
      dpr = ratio;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      g = geometry(width, height);
      paintBackdrop(width, height);
    },
    event(e, t) {
      switch (e.k) {
        case 'flash':
          litAt[e.player] = t;
          litKind[e.player] = e.kind;
          pulseAt = t;
          break;
        case 'hop':
          from = to;
          to = e.player;
          hopAt = t;
          pulseAt = t;
          break;
        case 'delivered':
          flyFrom = holdOf(to);
          from = to;
          to = PLAYERS;
          hopAt = t;
          break;
        case 'break':
          brokenAt = t;
          wrongAt[e.player] = t;
          brokenText = labels.broken[e.reason];
          break;
        case 'signal':
          from = to = null;
          hopAt = t;
          break;
        case 'won':
        case 'lost':
          endAt = t;
          break;
      }
    },
    press(player, t) {
      if (player >= 0 && player < PLAYERS) pressAt[player] = t;
    },
    draw(state, t, remote, reduced) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#060A16';
      ctx.fillRect(0, 0, g.w, g.h);
      if (backdrop) ctx.drawImage(backdrop, 0, 0, g.w, g.h);
      // A pulse counts at the town once the electron has flown that far along the wire.
      let charge = state?.charge ?? 0;
      if (to === PLAYERS && state && state.phase !== 'won' && !reduced) {
        if ((t - hopAt) / FLY_S < townAt(flyFrom)) charge -= 1;
      }
      charge = Math.max(0, charge);
      circuit(t);
      town(state, charge, t);
      tank(state, t);
      microbes(state, t, remote, reduced);
      if (state && !isOver(state)) electron(t, reduced);
      panel(state, charge, t);
      banner(state, t);
      hud(state, t);
      if (state?.phase === 'lost') {
        const k = Math.min(0.65, (t - endAt) * 0.9);
        const flicker = t - endAt < 0.6 && hash(Math.floor(t * 30), 1) > 0.5 ? 0.25 : 0;
        ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.85, k + flicker)})`;
        ctx.fillRect(0, g.hudH, g.w, g.h - g.hudH);
      }
      if (scanlines && !reduced) {
        ctx.fillStyle = scanlines;
        ctx.fillRect(0, 0, g.w, g.h);
      }
      const v = ctx.createRadialGradient(g.w / 2, g.h / 2, Math.min(g.w, g.h) * 0.45, g.w / 2, g.h / 2, Math.max(g.w, g.h) * 0.8);
      v.addColorStop(0, 'rgba(0, 0, 0, 0)');
      v.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, g.w, g.h);
    },
    playerAt(x, y) {
      const k = g.tank;
      if (x < k.x || x > g.membraneX || y < k.y || y > k.y + k.h) return null;
      let best: number | null = null;
      let bestD = Infinity;
      for (let i = 0; i < PLAYERS; i++) {
        const d = Math.abs(x - g.hold[i]!.x);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    },
    reset,
  };
}
