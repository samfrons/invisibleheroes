/**
 * The static scenery: paper, header band and pipe shell, column panels, chute
 * tracks, target rings, the stage floor and the pads. Drawn once per resize
 * (or when the seats change hands) into an offscreen canvas that the renderer
 * blits every frame.
 */
import type { Layout } from '../layout';
import type { RenderLabels } from '../types';
import {
  CREAM,
  CREAM_DARK,
  GLASS,
  INK,
  MACHINE_FACE,
  PAPER,
  SEAT_PALE,
  SEAT_STRONG,
  SEAT_TINT,
  bodyFont,
  displayFont,
  hash,
} from './style';

export function outlineWidth(L: Layout): number {
  return Math.max(1.5, Math.min(3.5, Math.min(L.colW, L.h) * 0.012));
}

/** Largest font (from `px` down) at which `text` fits `maxW`. Resize time only. */
export function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  px: number,
  make: (px: number) => string
): string {
  let size = px;
  ctx.font = make(size);
  while (size > 7 && ctx.measureText(text).width > maxW) {
    size -= 1;
    ctx.font = make(size);
  }
  return ctx.font;
}

function tracePolyline(ctx: CanvasRenderingContext2D, pts: Float64Array, n: number): void {
  ctx.moveTo(pts[0]!, pts[1]!);
  for (let i = 1; i < n; i++) ctx.lineTo(pts[i * 2]!, pts[i * 2 + 1]!);
}

function drawPaper(ctx: CanvasRenderingContext2D, L: Layout): void {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, L.w, L.h);
  // Column panels in a pale tint of each seat's colour.
  for (const col of L.cols) {
    ctx.fillStyle = SEAT_PALE[col.seat]!;
    ctx.fillRect(col.x0, L.headerH, col.x1 - col.x0, L.h - L.headerH);
  }
  // Printed-paper speckle: a deterministic scatter of tiny ink dots.
  ctx.fillStyle = INK;
  ctx.globalAlpha = 0.06;
  ctx.beginPath();
  const count = Math.round((L.w * L.h) / 2600);
  for (let k = 0; k < count; k++) {
    const x = hash(k, 1) * L.w;
    const y = hash(k, 2) * L.h;
    const r = 0.4 + hash(k, 3) * 0.8;
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fill();
  // Pegboard holes in the panels.
  ctx.globalAlpha = 0.1;
  ctx.beginPath();
  const pitch = Math.max(14, L.colW / 7);
  for (const col of L.cols) {
    for (let y = L.headerH + pitch * 0.6; y < L.floorY - pitch * 0.3; y += pitch) {
      for (let x = col.x0 + pitch * 0.5; x < col.x1 - pitch * 0.3; x += pitch) {
        ctx.moveTo(x + 1.6, y);
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      }
    }
  }
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawColumnsFrame(ctx: CanvasRenderingContext2D, L: Layout, olw: number): void {
  // Stage floor: a cream shelf the heroes stand on.
  ctx.fillStyle = CREAM;
  ctx.fillRect(0, L.floorY, L.w, L.h - L.floorY);
  ctx.strokeStyle = INK;
  ctx.lineWidth = olw * 1.2;
  ctx.beginPath();
  ctx.moveTo(0, L.floorY);
  ctx.lineTo(L.w, L.floorY);
  ctx.stroke();
  // Column dividers.
  ctx.lineWidth = Math.max(1, olw * 0.6);
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  for (let i = 1; i < L.cols.length; i++) {
    const x = Math.round(L.cols[i]!.x0) + 0.5;
    ctx.moveTo(x, L.headerH);
    ctx.lineTo(x, L.h);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawHeader(ctx: CanvasRenderingContext2D, L: Layout, olw: number): void {
  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, L.w, L.headerH);
  // Three retro stripes under the band.
  const sh = Math.max(2, L.headerH * 0.035);
  const stripes = [SEAT_STRONG[0], SEAT_STRONG[3], SEAT_STRONG[1]];
  for (let k = 0; k < stripes.length; k++) {
    ctx.fillStyle = stripes[k]!;
    ctx.fillRect(0, L.headerH - sh * (3 - k), L.w, sh);
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = olw;
  ctx.beginPath();
  ctx.moveTo(0, L.headerH);
  ctx.lineTo(L.w, L.headerH);
  ctx.stroke();

  // Outlet stubs from the pipe down to the header's edge.
  const p = L.pipe;
  const stubW = L.trackW + 4;
  for (const col of L.cols) {
    ctx.fillStyle = SEAT_TINT[col.seat]!;
    ctx.fillRect(col.outletX - stubW / 2, p.y + p.h / 2, stubW, L.headerH - (p.y + p.h / 2) + 1);
    ctx.strokeRect(col.outletX - stubW / 2, p.y + p.h / 2, stubW, L.headerH - (p.y + p.h / 2) + 1);
  }

  // Pipe shell: an ink-edged tube with round ends.
  const r = p.h / 2;
  ctx.beginPath();
  ctx.moveTo(p.x + r, p.y);
  ctx.lineTo(p.x + p.w - r, p.y);
  ctx.arc(p.x + p.w - r, p.y + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(p.x + r, p.y + p.h);
  ctx.arc(p.x + r, p.y + r, r, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.closePath();
  ctx.fillStyle = GLASS;
  ctx.fill();
  ctx.lineWidth = olw * 1.2;
  ctx.stroke();

  // Flanges where each outlet meets the pipe.
  ctx.fillStyle = CREAM_DARK;
  ctx.lineWidth = olw * 0.8;
  for (const col of L.cols) {
    const fw = stubW + 6;
    const fh = Math.max(4, p.h * 0.3);
    ctx.fillRect(col.outletX - fw / 2, p.y + p.h - fh / 2, fw, fh);
    ctx.strokeRect(col.outletX - fw / 2, p.y + p.h - fh / 2, fw, fh);
  }
}

function drawTracks(ctx: CanvasRenderingContext2D, L: Layout, olw: number): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // One ink pass under all tracks, then each seat's colour on top.
  ctx.strokeStyle = INK;
  ctx.lineWidth = L.trackW + olw * 2;
  ctx.beginPath();
  for (const col of L.cols) tracePolyline(ctx, col.chute.pts, col.chute.n);
  ctx.stroke();
  for (const col of L.cols) {
    ctx.strokeStyle = SEAT_TINT[col.seat]!;
    ctx.lineWidth = L.trackW;
    ctx.beginPath();
    tracePolyline(ctx, col.chute.pts, col.chute.n);
    ctx.stroke();
  }
  // A thin groove down the middle of every track.
  ctx.strokeStyle = PAPER;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = Math.max(1, L.trackW * 0.14);
  ctx.beginPath();
  for (const col of L.cols) tracePolyline(ctx, col.chute.pts, col.chute.n);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Rivets along the track: paper dots with ink rims.
  const spacing = Math.max(40, L.colW * 0.45);
  const rr = Math.max(1.5, L.trackW * 0.13);
  ctx.fillStyle = PAPER;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, olw * 0.5);
  ctx.beginPath();
  for (const col of L.cols) {
    const { pts, cum, n } = col.chute;
    let next = spacing * 0.5;
    for (let i = 1; i < n - 3; i++) {
      if (cum[i]! < next) continue;
      next += spacing;
      const dx = pts[i * 2]! - pts[(i - 1) * 2]!;
      const dy = pts[i * 2 + 1]! - pts[(i - 1) * 2 + 1]!;
      const len = Math.hypot(dx, dy) || 1;
      // Offset to the outer edge of the track.
      const ox = (-dy / len) * (L.trackW / 2 + olw + rr + 1);
      const oy = (dx / len) * (L.trackW / 2 + olw + rr + 1);
      const x = pts[i * 2]! + ox;
      const y = pts[i * 2 + 1]! + oy;
      if (x - rr < col.x0 || x + rr > col.x1 || y < L.headerH + rr) continue;
      ctx.moveTo(x + rr, y);
      ctx.arc(x, y, rr, 0, Math.PI * 2);
    }
  }
  ctx.fill();
  ctx.stroke();
}

function drawRings(ctx: CanvasRenderingContext2D, L: Layout, olw: number): void {
  for (const col of L.cols) {
    const r = col.ringR;
    // The catch cup.
    ctx.beginPath();
    ctx.arc(col.ringX, col.ringY, r, 0, Math.PI * 2);
    ctx.fillStyle = PAPER;
    ctx.fill();
    ctx.lineWidth = r * 0.36;
    ctx.strokeStyle = SEAT_STRONG[col.seat]!;
    ctx.beginPath();
    ctx.arc(col.ringX, col.ringY, r * 0.8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = olw;
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.arc(col.ringX, col.ringY, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(col.ringX, col.ringY, r * 0.6, 0, Math.PI * 2);
    ctx.stroke();
    // Tick marks at the quarters, like a dial.
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      ctx.moveTo(col.ringX + Math.cos(a) * r, col.ringY + Math.sin(a) * r);
      ctx.lineTo(col.ringX + Math.cos(a) * (r + Math.max(3, r * 0.25)), col.ringY + Math.sin(a) * (r + Math.max(3, r * 0.25)));
    }
    ctx.stroke();
  }
}

/** The depth of a pad's ink shadow, which the press animation travels. */
export function padDepth(L: Layout): number {
  return Math.max(2, Math.min(5, L.cols[0]!.pad.h * 0.08));
}

function drawPads(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  labels: RenderLabels,
  humansMask: number,
  olw: number
): void {
  const depth = padDepth(L);
  for (const col of L.cols) {
    const p = col.pad;
    const human = (humansMask & (1 << col.seat)) !== 0;
    const face = { x: p.x, y: p.y, w: p.w, h: p.h - depth };
    ctx.fillStyle = INK;
    ctx.fillRect(face.x, face.y + depth, face.w, face.h);
    ctx.fillStyle = human ? SEAT_TINT[col.seat]! : MACHINE_FACE;
    ctx.fillRect(face.x, face.y, face.w, face.h);
    if (!human) {
      // Hatching for a seat the machine plays.
      ctx.save();
      ctx.beginPath();
      ctx.rect(face.x, face.y, face.w, face.h);
      ctx.clip();
      ctx.strokeStyle = INK;
      ctx.globalAlpha = 0.14;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const step = 9;
      for (let x = face.x - face.h; x < face.x + face.w; x += step) {
        ctx.moveTo(x, face.y + face.h);
        ctx.lineTo(x + face.h, face.y);
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = olw;
    ctx.strokeRect(face.x, face.y, face.w, face.h);
    // A colour strip along the top edge of the key.
    ctx.fillStyle = human ? SEAT_STRONG[col.seat]! : CREAM_DARK;
    ctx.fillRect(face.x + olw / 2, face.y + olw / 2, face.w - olw, Math.max(3, face.h * 0.1));

    const seat = labels.seats[col.seat];
    const main = human ? (seat?.key ?? '') : labels.machine;
    const small = seat?.instrument ?? '';
    const hasSmall = face.h > 30 && small.length > 0;
    const mainY = face.y + face.h * (hasSmall ? 0.46 : 0.55);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = INK;
    ctx.globalAlpha = human ? 1 : 0.55;
    const mainPx = human ? Math.min(face.h * 0.5, face.w * 0.4) : Math.min(face.h * 0.26, face.w * 0.2);
    ctx.font = fitFont(ctx, main, face.w * 0.86, mainPx, displayFont);
    ctx.fillText(main, face.x + face.w / 2, mainY);
    if (hasSmall) {
      ctx.font = fitFont(ctx, small, face.w * 0.92, Math.min(face.h * 0.22, 15), bodyFont);
      ctx.fillText(small, face.x + face.w / 2, face.y + face.h * 0.8);
    }
    ctx.globalAlpha = 1;
  }
}

export function drawScenery(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  labels: RenderLabels,
  humansMask: number,
  pads: boolean
): void {
  const olw = outlineWidth(L);
  drawPaper(ctx, L);
  drawColumnsFrame(ctx, L, olw);
  drawHeader(ctx, L, olw);
  drawTracks(ctx, L, olw);
  drawRings(ctx, L, olw);
  if (pads) drawPads(ctx, L, labels, humansMask, olw);
}
