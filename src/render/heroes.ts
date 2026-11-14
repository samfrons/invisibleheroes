/**
 * The seat glyphs: one small luminous vector icon per organism, drawn near
 * its pad in a 100-unit box (x from -50 to 50, y from -100 to 0, the floor)
 * and pulsing on a hit. They name the seat by shape as well as colour:
 * 0 a rod, 1 a rod with a tail, 2 a leaf, 3 a curved rod, 4 a long slim rod.
 */
import { BLACK, CREAM, SEAT_GLOW } from './style';

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
      ctx.moveTo(0, -4);
      ctx.bezierCurveTo(-38, -30, -30, -78, 4, -96);
      ctx.bezierCurveTo(34, -70, 30, -26, 0, -4);
      ctx.closePath();
      // The midrib.
      ctx.moveTo(0, -4);
      ctx.quadraticCurveTo(-2, -50, 4, -92);
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
      capsule(ctx, 0, -98, -2, 18);
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

/**
 * Draw glyph `seat` standing on (x, y) in a box `size` pixels square.
 * `pulse` 0..1 brightens and swells it (a hit); `dim` 0..1 greys it (a miss);
 * `alpha` fades the whole glyph (a lane dimmed in a video close-up).
 */
export function drawGlyph(
  ctx: CanvasRenderingContext2D,
  seat: number,
  x: number,
  y: number,
  size: number,
  pulse: number,
  dim: number,
  lineW: number,
  alpha: number
): void {
  const s = (size / 100) * (1 + 0.16 * pulse);
  const lw = lineW / s;
  const colour = SEAT_GLOW[seat] ?? CREAM;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
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
}
