/**
 * The seat glyphs: one small luminous vector microbe per seat, drawn near its
 * pad in a 100-unit box (x from -50 to 50, y from -100 to 0, the floor). Each
 * one shows its real fuel-cell job when its seat hits a note:
 * 0 Geo, a rod: nanowire filaments spark from its foot down to the anode.
 * 1 Shiva, a rod with a flagellum: a yellow flavin shuttle leaves on the hit
 *   and pops SHUTTLE_S later, when its electrons arrive.
 * 2 Rhodo, a plump purple rod in a ring of sun rays: the rays follow the
 *   sunlight and pulse on a hit.
 * 3 Sporo, a curved rod: gulps (squashes) and lets go a bubble of acetate.
 * 4 Cable, a chain of linked cells: a gold electron runs along it, and the
 *   chain glows with the circuit's conductance.
 * The three givers (0-2) swell a little as their biofilm grows. A miss dims
 * and droops the glyph. Everything is drawn from the Frame; with reduced
 * motion only the still glyph (and its slow glows) remain.
 */
import { SHUTTLE_S, sunlightAt } from '../kinetics';
import type { Frame } from '../types';
import { BLACK, CREAM, GOLD, SEAT_GLOW } from './style';

/** Seconds a hit pulse, a nanowire flash, a cable spark and an acetate bubble last. */
const PULSE_S = 0.6;
const WIRE_S = 0.45;
const SPARK_S = 0.55;
const BUBBLE_S = 1.0;
const POP_S = 0.25;
/** Cable cells: count, centre spacing and radius, in glyph units. */
const CELLS = 6;
const CELL_GAP = 16.4;
const CELL_R = 7.6;

/** The cable's centre line: x at height fraction u (0 the foot, 1 the top). */
function chainX(u: number): number {
  return 11 * Math.sin(u * (CELLS - 1) * 0.9);
}
function chainY(u: number): number {
  return -9 - u * CELL_GAP * (CELLS - 1);
}

/** Trace glyph `seat` (no fill or stroke). */
function trace(ctx: CanvasRenderingContext2D, seat: number): void {
  switch (seat) {
    case 0:
      capsule(ctx, 0, -84, -16, 34);
      break;
    case 1:
      capsule(ctx, 8, -84, -26, 30);
      // The flagellum.
      ctx.moveTo(-7, -40);
      ctx.bezierCurveTo(-24, -34, -14, -20, -30, -14);
      ctx.bezierCurveTo(-42, -10, -36, -2, -46, 0);
      break;
    case 2:
      // Plump: a short, fat rod.
      capsule(ctx, 0, -78, -22, 44);
      break;
    case 3:
      // A banana-shaped rod: outer and inner arcs joined by round ends.
      ctx.moveTo(-14, -90);
      ctx.bezierCurveTo(28, -78, 28, -22, -14, -10);
      ctx.bezierCurveTo(-26, -8, -28, -22, -16, -24);
      ctx.bezierCurveTo(6, -32, 6, -68, -16, -76);
      ctx.bezierCurveTo(-28, -78, -26, -92, -14, -90);
      ctx.closePath();
      break;
    default:
      // Cable bacterium: small cells end to end along a gentle wave.
      for (let i = 0; i < CELLS; i++) {
        const u = i / (CELLS - 1);
        const cx = chainX(u);
        ctx.moveTo(cx + CELL_R, chainY(u));
        ctx.arc(cx, chainY(u), CELL_R, 0, Math.PI * 2);
      }
      break;
  }
}

function capsule(ctx: CanvasRenderingContext2D, cx: number, y0: number, y1: number, w: number): void {
  const r = w / 2;
  ctx.moveTo(cx + r, y0 + r);
  ctx.arc(cx, y0 + r, r, 0, Math.PI, true);
  ctx.lineTo(cx - r, y1 - r);
  ctx.arc(cx, y1 - r, r, Math.PI, 0, true);
  ctx.closePath();
}

/** A soft round dot: glow, then core. */
function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string, a: number): void {
  ctx.globalAlpha = a * 0.35;
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(x, y, r * 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = a;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Geo: three nanowires from the foot to the anode, flashing, with a spark down each. */
function drawWires(ctx: CanvasRenderingContext2D, age: number, lw: number, alpha: number, still: boolean): void {
  const colour = SEAT_GLOW[0]!;
  const k = age < WIRE_S ? 1 - age / WIRE_S : 0;
  ctx.lineCap = 'round';
  ctx.strokeStyle = colour;
  for (let w = -1; w <= 1; w++) {
    const x1 = w * 9;
    const x2 = w * 19;
    ctx.beginPath();
    ctx.moveTo(x1, -18);
    ctx.bezierCurveTo(x1 + w * 2, -10, x2 - w * 6, -4, x2, 5);
    ctx.globalAlpha = alpha * (0.35 + 0.65 * k);
    ctx.lineWidth = lw * (1 + 1.4 * k);
    ctx.stroke();
    if (!still && k > 0) {
      // The spark runs down the wire: a point on the same curve.
      const u = Math.min(1, age / (WIRE_S * 0.8));
      const m = 1 - u;
      const px = m * m * m * x1 + 3 * m * m * u * (x1 + w * 2) + 3 * m * u * u * (x2 - w * 6) + u * u * u * x2;
      const py = m * m * m * -18 + 3 * m * m * u * -10 + 3 * m * u * u * -4 + u * u * u * 5;
      dot(ctx, px, py, 3.2, GOLD, alpha * k);
    }
  }
}

/** Rhodo: a ring of sun rays round the body; bright with the sunlight, longer on a hit. */
function drawRays(ctx: CanvasRenderingContext2D, sun: number, pulse: number, spin: number, lw: number, alpha: number): void {
  const colour = SEAT_GLOW[2]!;
  const n = 10;
  ctx.lineCap = 'round';
  ctx.strokeStyle = colour;
  ctx.lineWidth = lw * (1 + 0.8 * pulse);
  ctx.globalAlpha = alpha * Math.min(1, (0.15 + 0.7 * sun) * (1 + 0.5 * pulse));
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = spin + (i / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // Rays start outside the body (an ellipse 22 wide, 29 tall) and grow with sun and hit.
    const r0 = 34 + 3 * Math.abs(s);
    const r1 = r0 + 4 + 8 * sun + 8 * pulse;
    ctx.moveTo(c * r0, -50 + s * r0 * 1.05);
    ctx.lineTo(c * r1, -50 + s * r1 * 1.05);
  }
  ctx.stroke();
}

/** Shiva: the flavin shuttle leaves the cell and pops where its electrons land. */
function drawShuttle(ctx: CanvasRenderingContext2D, age: number, alpha: number): void {
  const x0 = 8;
  const y0 = -56;
  const x1 = 40;
  const y1 = -10;
  if (age < SHUTTLE_S) {
    const u = age / SHUTTLE_S;
    // A little hop on the way.
    const x = x0 + (x1 - x0) * u;
    const y = y0 + (y1 - y0) * u - 14 * Math.sin(u * Math.PI);
    dot(ctx, x, y, 4.5, GOLD, alpha);
    // A faded trail behind it.
    dot(ctx, x - (x1 - x0) * 0.08, y - (y1 - y0) * 0.08 + 3, 2.4, GOLD, alpha * 0.45);
  } else if (age < SHUTTLE_S + POP_S) {
    const u = (age - SHUTTLE_S) / POP_S;
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2.6 * (1 - u) + 0.6;
    ctx.globalAlpha = alpha * (1 - u);
    ctx.beginPath();
    ctx.arc(x1, y1, 5 + 15 * u, 0, Math.PI * 2);
    ctx.stroke();
    dot(ctx, x1, y1, 4.5 * (1 - u) + 1, CREAM, alpha * (1 - u));
  }
}

/** Sporo: a bubble of acetate rising from the cell. */
function drawBubble(ctx: CanvasRenderingContext2D, age: number, lw: number, alpha: number): void {
  const u = age / BUBBLE_S;
  const x = 18 + 6 * Math.sin(u * 5);
  const y = -62 - 38 * u;
  const r = 4 + 4 * Math.min(1, u * 3);
  ctx.globalAlpha = alpha * 0.25 * (1 - u);
  ctx.fillStyle = SEAT_GLOW[3]!;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = alpha * (1 - u * u);
  ctx.strokeStyle = SEAT_GLOW[3]!;
  ctx.lineWidth = lw;
  ctx.stroke();
  ctx.fillStyle = CREAM;
  ctx.globalAlpha = alpha * 0.8 * (1 - u);
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
}

/** Cable: the conducting core glows with conductance; a gold electron runs foot to tip on a hit. */
function drawCore(ctx: CanvasRenderingContext2D, conductance: number, age: number, lw: number, alpha: number, still: boolean): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = SEAT_GLOW[4]!;
  ctx.beginPath();
  for (let i = 0; i <= 24; i++) {
    const u = i / 24;
    if (i === 0) ctx.moveTo(chainX(u), chainY(u));
    else ctx.lineTo(chainX(u), chainY(u));
  }
  ctx.globalAlpha = alpha * (0.08 + 0.3 * conductance);
  ctx.lineWidth = lw * (4 + 5 * conductance);
  ctx.stroke();
  ctx.globalAlpha = alpha * (0.3 + 0.6 * conductance);
  ctx.strokeStyle = CREAM;
  ctx.lineWidth = lw * 0.5;
  ctx.stroke();
  if (!still && age < SPARK_S) {
    const u = age / SPARK_S;
    const fade = 1 - 0.5 * u;
    dot(ctx, chainX(u), chainY(u), 4, GOLD, alpha * fade);
    // A short tail.
    const v = Math.max(0, u - 0.07);
    dot(ctx, chainX(v), chainY(v), 2.6, GOLD, alpha * fade * 0.6);
  }
}

/**
 * Draw glyph `seat` standing on (x, y) in a box `size` pixels square, from
 * the frame: its hits, misses, biofilm, the sunlight and the circuit.
 * `alpha` fades the whole glyph (a lane dimmed in a video close-up).
 */
export function drawGlyph(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  seat: number,
  x: number,
  y: number,
  size: number,
  lineW: number,
  alpha: number
): void {
  const still = frame.reducedMotion;
  const sf = frame.seats[seat];
  const t = frame.t;
  const hitAge = sf && t >= sf.hitAt ? t - sf.hitAt : Infinity;
  const missAge = sf && t >= sf.missAt ? t - sf.missAt : Infinity;
  const pulse = !still && hitAge < PULSE_S ? Math.exp(-hitAge * 6) : 0;
  const dim = missAge < 0.5 ? 1 - missAge / 0.5 : 0;
  const droop = still ? 0 : dim;
  // The givers swell with their biofilm, by up to 15% either way.
  const film = seat < 3 && frame.cell ? frame.cell.biofilm[seat] : undefined;
  const grow = film === undefined ? 1 : 0.85 + 0.3 * Math.min(1, Math.max(0, film));
  const s = (size / 100) * grow * (1 + 0.16 * pulse);
  const lw = lineW / s;
  const colour = SEAT_GLOW[seat] ?? CREAM;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  // The seat's own work, drawn behind the body.
  if (seat === 0 && !still) drawWires(ctx, hitAge, lw, alpha, still);
  if (seat === 2) drawRays(ctx, sunlightAt(t), pulse, still ? 0 : frame.now * 0.25, lw, alpha);
  if (seat === 4) drawCore(ctx, frame.cell ? frame.cell.conductance : 0.5, hitAge, lw, alpha, still);
  // A miss droops the glyph; Sporo gulps on a hit (squash, wider and shorter).
  if (droop > 0) {
    ctx.rotate(0.14 * droop);
    ctx.scale(1, 1 - 0.08 * droop);
  }
  if (seat === 3 && pulse > 0) ctx.scale(1 + 0.14 * pulse, 1 - 0.18 * pulse);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  trace(ctx, seat);
  ctx.globalAlpha = alpha * (0.18 + 0.4 * pulse - 0.1 * dim);
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.globalAlpha = alpha * 0.8;
  ctx.strokeStyle = BLACK;
  ctx.lineWidth = lw + 4 / s;
  ctx.stroke();
  ctx.globalAlpha = alpha * (0.25 + 0.35 * pulse);
  ctx.strokeStyle = colour;
  ctx.lineWidth = lw * (3 + 2 * pulse);
  ctx.stroke();
  ctx.globalAlpha = alpha * (1 - 0.5 * dim);
  ctx.lineWidth = lw;
  ctx.stroke();
  if (pulse > 0.05) {
    ctx.globalAlpha = alpha * pulse;
    ctx.strokeStyle = CREAM;
    ctx.lineWidth = lw * 0.4;
    ctx.stroke();
  }
  ctx.restore();
  // The shuttle and the bubble are not part of the body: undo the body's squash.
  if (still) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  if (seat === 1 && hitAge < SHUTTLE_S + POP_S) drawShuttle(ctx, hitAge, alpha);
  if (seat === 3 && hitAge < BUBBLE_S) drawBubble(ctx, hitAge, lw * 0.8, alpha);
  ctx.restore();
}
