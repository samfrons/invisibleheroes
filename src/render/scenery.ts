/**
 * The overlay's static layer, drawn on a transparent canvas once per resize
 * (or when the seats change hands) and blitted every frame over the 3D
 * stage: the coral Bauhaus frame line, five bold lanes, their reticles, the
 * console pads and the oscilloscope window's bezel.
 *
 * Strokes are thick and clean: a dark under-stroke so they read over a bright
 * object behind, a soft halo from one wide faint stroke, then the solid
 * colour. There is no shadowBlur anywhere.
 */
import type { Layout } from '../layout';
import type { RenderLabels } from '../types';
import {
  BLACK,
  CORAL,
  CREAM,
  CREAM_DIM,
  GLASS,
  GLASS_DEEP,
  GOLD,
  SEAT_GLOW,
  TEAL,
  displayFont,
  monoFont,
} from './style';

/** Lane stroke width: about 5 to 6 px on a 1400-wide stage. */
export function laneWidth(L: Layout): number {
  return Math.max(3, Math.min(6, L.w * 0.004));
}

export function outlineWidth(L: Layout): number {
  return Math.max(2, Math.min(3, L.w * 0.002));
}

/** Largest font (from `px` down) at which `text` fits `maxW`. Resize time only. */
export function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  px: number,
  make: (px: number) => string
): string {
  let size = Math.floor(px);
  ctx.font = make(size);
  while (size > 7 && ctx.measureText(text).width > maxW) {
    size -= 1;
    ctx.font = make(size);
  }
  return ctx.font;
}

/** Stroke the current path: dark under-stroke, soft halo, solid colour. */
export function boldStroke(ctx: CanvasRenderingContext2D, colour: string, width: number): void {
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = BLACK;
  ctx.lineWidth = width + 4;
  ctx.stroke();
  ctx.globalAlpha = 0.2;
  ctx.strokeStyle = colour;
  ctx.lineWidth = width * 3;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawFrame(ctx: CanvasRenderingContext2D, L: Layout): void {
  const k = L.frameInset;
  ctx.strokeStyle = CORAL;
  ctx.lineWidth = 2;
  ctx.strokeRect(k, k, L.w - k * 2, L.h - k * 2);
}

function drawLanes(ctx: CanvasRenderingContext2D, L: Layout): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const lw = laneWidth(L);
  for (const col of L.cols) {
    const { pts, n } = col.chute;
    const colour = SEAT_GLOW[col.seat]!;
    ctx.beginPath();
    ctx.moveTo(pts[0]!, pts[1]!);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i * 2]!, pts[i * 2 + 1]!);
    boldStroke(ctx, colour, lw);
    // The emitter: a solid block the electrons drop out of.
    const ew = Math.max(10, L.ballR * 3);
    const eh = Math.max(4, lw * 1.2);
    ctx.fillStyle = BLACK;
    ctx.fillRect(col.outletX - ew / 2 - 2, col.outletY - eh - 2, ew + 4, eh + 4);
    ctx.fillStyle = colour;
    ctx.fillRect(col.outletX - ew / 2, col.outletY - eh, ew, eh);
  }
}

function drawReticles(ctx: CanvasRenderingContext2D, L: Layout): void {
  ctx.lineCap = 'butt';
  for (const col of L.cols) {
    const r = col.ringR;
    const x = col.ringX;
    const y = col.ringY;
    const colour = SEAT_GLOW[col.seat]!;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.2, 0, Math.PI * 2);
    ctx.fillStyle = GLASS_DEEP;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    boldStroke(ctx, colour, Math.max(3, r * 0.22));
    // Four quadrant ticks crossing the ring.
    ctx.beginPath();
    const t0 = r * 0.62;
    const t1 = r * 1.42;
    ctx.moveTo(x, y - t0);
    ctx.lineTo(x, y - t1);
    ctx.moveTo(x, y + t0);
    ctx.lineTo(x, y + t1);
    ctx.moveTo(x - t0, y);
    ctx.lineTo(x - t1, y);
    ctx.moveTo(x + t0, y);
    ctx.lineTo(x + t1, y);
    ctx.strokeStyle = BLACK;
    ctx.lineWidth = Math.max(3, r * 0.14) + 3;
    ctx.stroke();
    ctx.strokeStyle = CREAM;
    ctx.lineWidth = Math.max(3, r * 0.14);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, Math.max(2, r * 0.14), 0, Math.PI * 2);
    ctx.fillStyle = CREAM;
    ctx.fill();
  }
  ctx.lineCap = 'round';
}

function drawPads(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  labels: RenderLabels,
  humansMask: number,
  remoteMask: number
): void {
  for (const col of L.cols) {
    const p = col.pad;
    const human = (humansMask & (1 << col.seat)) !== 0;
    const remote = human && (remoteMask & (1 << col.seat)) !== 0;
    const colour = SEAT_GLOW[col.seat]!;
    const solid = human && !remote;
    if (solid) {
      // A flat Bauhaus key: a solid block of the seat's colour.
      ctx.fillStyle = BLACK;
      ctx.fillRect(p.x + 3, p.y + 3, p.w, p.h);
      ctx.fillStyle = colour;
      ctx.fillRect(p.x, p.y, p.w, p.h);
    } else {
      ctx.fillStyle = remote ? GLASS : GLASS_DEEP;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.strokeStyle = remote ? GOLD : colour;
      ctx.globalAlpha = remote ? 1 : 0.45;
      ctx.lineWidth = remote ? 2.5 : 2;
      ctx.strokeRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
      ctx.globalAlpha = 1;
    }
    const seat = labels.seats[col.seat];
    const main = !human ? labels.machine : remote ? (labels.phone ?? 'PHONE') : (seat?.key ?? '');
    const small = seat?.instrument ?? '';
    const hasSmall = p.h > 34 && small.length > 0;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const mainPx = solid ? Math.min(p.h * 0.5, p.w * 0.42) : Math.min(p.h * 0.3, p.w * 0.22);
    ctx.font = fitFont(ctx, main.toUpperCase(), p.w * 0.86, mainPx, displayFont);
    ctx.fillStyle = solid ? BLACK : remote ? GOLD : CREAM_DIM;
    ctx.fillText(main.toUpperCase(), p.x + p.w / 2, p.y + p.h * (hasSmall ? 0.44 : 0.52));
    if (hasSmall) {
      const label = small.toUpperCase();
      ctx.font = fitFont(ctx, label, p.w * 0.9, Math.min(p.h * 0.17, 12), monoFont);
      ctx.fillStyle = solid ? BLACK : CREAM_DIM;
      ctx.fillText(label, p.x + p.w / 2, p.y + p.h * 0.8);
    }
  }
}

function drawScopeBezel(ctx: CanvasRenderingContext2D, L: Layout): void {
  const s = L.scope;
  ctx.fillStyle = '#000000';
  ctx.fillRect(s.x, s.y, s.w, s.h);
  ctx.strokeStyle = TEAL;
  ctx.lineWidth = 2;
  ctx.strokeRect(s.x, s.y, s.w, s.h);
  ctx.strokeStyle = '#0B3B0B';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = 1; k < 4; k++) {
    const x = Math.round(s.x + (s.w * k) / 4) + 0.5;
    ctx.moveTo(x, s.y + 2);
    ctx.lineTo(x, s.y + s.h - 2);
  }
  const y = Math.round(s.y + s.h / 2) + 0.5;
  ctx.moveTo(s.x + 2, y);
  ctx.lineTo(s.x + s.w - 2, y);
  ctx.stroke();
}

export function drawScenery(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  labels: RenderLabels,
  humansMask: number,
  remoteMask: number,
  pads: boolean
): void {
  ctx.clearRect(0, 0, L.w, L.h);
  drawFrame(ctx, L);
  drawScopeBezel(ctx, L);
  drawLanes(ctx, L);
  drawReticles(ctx, L);
  if (pads) drawPads(ctx, L, labels, humansMask, remoteMask);
}
