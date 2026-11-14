/**
 * Stage geometry (pure). Everything is computed from the stage's CSS size, so
 * the same code lays out a wide desktop stage, a landscape phone and a
 * portrait phone. The renderer calls computeLayout() once per resize and keeps
 * the result; nothing in here runs per frame except pointAt() and seatAt().
 */

export const COLUMNS = 5;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A chute as a polyline with cumulative arc length, for constant-speed travel. */
export interface Chute {
  /** Interleaved x, y. */
  pts: Float64Array;
  /** Arc length from the start to each point; cum[0] = 0. */
  cum: Float64Array;
  /** Number of points. */
  n: number;
  length: number;
}

export interface Column {
  seat: number;
  x0: number;
  x1: number;
  cx: number;
  outletX: number;
  outletY: number;
  ringX: number;
  ringY: number;
  ringR: number;
  /** Hero box: centred on heroX, standing on heroY (the floor), heroSize square. */
  heroX: number;
  heroY: number;
  heroSize: number;
  pad: Rect;
  chute: Chute;
}

export interface Gear {
  x: number;
  y: number;
  r: number;
  teeth: number;
  /** +1 or -1: meshed gears turn opposite ways. */
  dir: number;
}

export interface Layout {
  w: number;
  h: number;
  headerH: number;
  colW: number;
  /** Margin used around pads and boxes. */
  m: number;
  pipe: Rect;
  /** Height of the text row above the pipe. */
  rowH: number;
  takeX: number;
  takeY: number;
  lamp: { x: number; y: number; r: number };
  onAir: Rect;
  gears: Gear[];
  /** Ball radius and track width, shared by all chutes. */
  ballR: number;
  trackW: number;
  floorY: number;
  cols: Column[];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Points accumulate here while a chute is built (resize time only). */
class PathBuilder {
  xs: number[] = [];
  ys: number[] = [];
  constructor(
    private readonly lo: number,
    private readonly hi: number
  ) {}
  to(x: number, y: number): this {
    const cx = clamp(x, this.lo, this.hi);
    const n = this.xs.length;
    if (n > 0 && Math.abs(this.xs[n - 1]! - cx) < 1e-6 && Math.abs(this.ys[n - 1]! - y) < 1e-6) return this;
    this.xs.push(cx);
    this.ys.push(y);
    return this;
  }
  last(): [number, number] {
    const n = this.xs.length;
    return [this.xs[n - 1]!, this.ys[n - 1]!];
  }
  quad(cx: number, cy: number, x: number, y: number, step: number): this {
    const [x0, y0] = this.last();
    const approx = Math.hypot(cx - x0, cy - y0) + Math.hypot(x - cx, y - cy);
    const steps = Math.max(4, Math.ceil(approx / step));
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      const a = (1 - u) * (1 - u);
      const b = 2 * (1 - u) * u;
      const c = u * u;
      this.to(a * x0 + b * cx + c * x, a * y0 + b * cy + c * y);
    }
    return this;
  }
  build(): Chute {
    const n = this.xs.length;
    const pts = new Float64Array(n * 2);
    const cum = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      pts[i * 2] = this.xs[i]!;
      pts[i * 2 + 1] = this.ys[i]!;
      if (i > 0) {
        cum[i] = cum[i - 1]! + Math.hypot(this.xs[i]! - this.xs[i - 1]!, this.ys[i]! - this.ys[i - 1]!);
      }
    }
    return { pts, cum, n, length: cum[n - 1] ?? 0 };
  }
}

interface ChuteSpec {
  cx: number;
  left: number;
  right: number;
  top: number;
  end: number;
  /** Top and bottom of the free region for the contraption. */
  y0: number;
  y1: number;
  colW: number;
  step: number;
}

/** 0 wire: zigzag ramps, each ending in a short drop onto the next. */
function zigzag(b: PathBuilder, s: ChuteSpec): void {
  const H = s.y1 - s.y0;
  const ramps = clamp(Math.round(H / (s.colW * 0.55)), 2, 7);
  const pitch = H / ramps;
  const rampDy = pitch * 0.6;
  b.to(s.cx, s.y0);
  let y = s.y0;
  for (let i = 0; i < ramps; i++) {
    const xt = i % 2 === 0 ? s.left : s.right;
    b.to(xt, y + rampDy);
    y += pitch;
    if (i < ramps - 1) b.to(xt, y);
  }
  b.quad(b.last()[0], s.y1, s.cx, s.y1, s.step);
}

/**
 * 1 keys: conical spiral funnels seen from the side, each narrowing onto the
 * centre line; a tall column stacks two or three of them.
 */
function spiral(b: PathBuilder, s: ChuteSpec): void {
  const H = s.y1 - s.y0;
  const width = s.right - s.left;
  const r0 = width / 2;
  const r1 = r0 * 0.14;
  const funnels = clamp(Math.floor(H / (width * 1.5)), 1, 3);
  const fh = H / funnels;
  const turns = clamp(Math.round(fh / (r0 * 0.5)), 2, 3);
  const tilt = clamp((fh / turns / width) * 1.6, 0.25, 0.6);
  const a0 = -Math.PI / 2;
  const total = turns * Math.PI * 2;
  const steps = Math.ceil((total * r0) / s.step);
  for (let f = 0; f < funnels; f++) {
    const top = s.y0 + f * fh + r0 * tilt;
    const bottom = s.y0 + (f + 1) * fh - r1 * tilt;
    b.to(s.cx, top - r0 * tilt);
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const a = a0 + total * u;
      // Ease the radius so the funnel's mouth stays wide and its neck narrows fast.
      const r = r1 + (r0 - r1) * (1 - u) * (1 - u * 0.4);
      b.to(s.cx + r * Math.cos(a), top + (bottom - top) * u + r * tilt * Math.sin(a));
    }
  }
  b.to(s.cx, s.y1);
}

/** 2 chimes: a staircase across the column, then a long slide back to the centre. */
function stairs(b: PathBuilder, s: ChuteSpec): void {
  const H = s.y1 - s.y0;
  const stairBottom = s.y0 + H * 0.5;
  b.to(s.cx, s.y0);
  b.to(s.left, s.y0 + H * 0.06);
  const steps = clamp(Math.round((s.right - s.left) / 14), 3, 7);
  const tread = (s.right - s.left) / steps;
  const riser = (stairBottom - (s.y0 + H * 0.06)) / steps;
  let x = s.left;
  let y = s.y0 + H * 0.06;
  for (let i = 0; i < steps; i++) {
    x += tread;
    b.to(x, y);
    y += riser;
    b.to(x, y);
  }
  b.quad(s.right, s.y1, s.cx, s.y1, s.step);
}

/** 3 drum: a ramp into a full loop-the-loop, then a U-turn home. */
function loop(b: PathBuilder, s: ChuteSpec): void {
  const H = s.y1 - s.y0;
  const half = (s.right - s.left) / 2;
  const rl = Math.min(half * 0.62, H * 0.2);
  const yb = s.y0 + H * 0.62;
  const yc = yb - rl;
  b.to(s.cx, s.y0);
  b.to(s.left, s.y0 + H * 0.12);
  b.quad(s.left, yb, s.cx, yb, s.step);
  const steps = Math.ceil((Math.PI * 2 * rl) / s.step);
  for (let i = 1; i <= steps; i++) {
    const a = Math.PI / 2 - (Math.PI * 2 * i) / steps;
    b.to(s.cx + rl * Math.cos(a), yc + rl * Math.sin(a));
  }
  b.quad(s.right, yb, s.right, yb + (s.y1 - yb) * 0.45, s.step);
  b.quad(s.right, s.y1, s.cx, s.y1, s.step);
}

/** 4 tuba: an S-bend pipe swinging side to side. */
function sbend(b: PathBuilder, s: ChuteSpec): void {
  const H = s.y1 - s.y0;
  const bends = clamp(Math.round(H / (s.colW * 0.8)), 2, 6);
  const A = (s.right - s.left) / 2;
  const steps = Math.ceil((H + bends * A * 2) / s.step);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    b.to(s.cx + A * Math.sin(Math.PI * bends * u), s.y0 + H * u);
  }
}

const SHAPES = [zigzag, spiral, stairs, loop, sbend] as const;

export function computeLayout(width: number, height: number): Layout {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const colW = w / COLUMNS;
  const headerH = Math.round(clamp(h * 0.12, 40, 84));
  const R = h - headerH;
  const m = clamp(Math.min(colW, R) * 0.05, 3, 10);
  const padH = clamp(R * 0.13, 30, 72);
  const padY = h - padH - m;
  const floorY = padY - m;
  const ringR = clamp(Math.min(colW * 0.2, R * 0.055), 8, 40);
  const heroSize = Math.max(24, Math.min(colW * 0.86, R * 0.3));
  const ringY = floorY - heroSize - m - ringR * 1.2;
  const ballR = clamp(ringR * 0.4, 3.5, 11);
  const trackW = ballR * 2 + 4;

  // Header: a text row on top, the feed pipe along the bottom.
  const pipeH = Math.max(10, headerH * 0.26);
  const pipeBottom = headerH - Math.max(6, headerH * 0.12);
  const pipe: Rect = { x: m, y: pipeBottom - pipeH, w: w - 2 * m, h: pipeH };
  const rowH = pipe.y;
  const lampR = Math.max(5, rowH * 0.28);
  const lamp = { x: w - m - lampR - 2, y: rowH * 0.52, r: lampR };
  const signH = Math.max(12, rowH * 0.52);
  const signW = signH * 3.1;
  const onAir: Rect = { x: lamp.x - lampR - 6 - signW, y: lamp.y - signH / 2, w: signW, h: signH };
  const gr = Math.max(8, rowH * 0.48);
  const gears: Gear[] = [
    { x: w * 0.42, y: rowH * 0.62, r: gr, teeth: 10, dir: 1 },
    { x: w * 0.42 + gr * 1.72, y: rowH * 0.42, r: gr * 0.72, teeth: 8, dir: -1 },
  ];

  const cols: Column[] = [];
  for (let i = 0; i < COLUMNS; i++) {
    const x0 = i * colW;
    const x1 = x0 + colW;
    const cx = x0 + colW / 2;
    const inset = Math.max(trackW / 2 + 2, colW * 0.1);
    const outletY = headerH;
    const straight = clamp((ringY - outletY) * 0.1, ringR * 1.6, ringR * 3);
    const gap = Math.max(ballR * 2, (ringY - outletY) * 0.04);
    const spec: ChuteSpec = {
      cx,
      left: x0 + inset,
      right: x1 - inset,
      top: outletY,
      end: ringY,
      y0: outletY + gap,
      y1: ringY - straight,
      colW,
      step: Math.max(3, colW / 40),
    };
    const b = new PathBuilder(x0 + inset, x1 - inset);
    b.to(cx, outletY);
    SHAPES[i]!(b, spec);
    b.to(cx, spec.y1);
    b.to(cx, ringY);
    cols.push({
      seat: i,
      x0,
      x1,
      cx,
      outletX: cx,
      outletY,
      ringX: cx,
      ringY,
      ringR,
      heroX: cx,
      heroY: floorY,
      heroSize,
      pad: { x: x0 + m, y: padY, w: colW - 2 * m, h: padH },
      chute: b.build(),
    });
  }

  return {
    w,
    h,
    headerH,
    colW,
    m,
    pipe,
    rowH,
    takeX: m + 2,
    takeY: rowH * 0.55,
    lamp,
    onAir,
    gears,
    ballR,
    trackW,
    floorY,
    cols,
  };
}

/** A point on a chute at arc length s (clamped to the ends), written into `out`. */
export function pointAt(chute: Chute, s: number, out: { x: number; y: number }): void {
  const { pts, cum, n } = chute;
  if (n === 0) {
    out.x = 0;
    out.y = 0;
    return;
  }
  if (s <= 0 || n === 1) {
    out.x = pts[0]!;
    out.y = pts[1]!;
    return;
  }
  if (s >= chute.length) {
    out.x = pts[(n - 1) * 2]!;
    out.y = pts[(n - 1) * 2 + 1]!;
    return;
  }
  // Last index with cum <= s.
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi]! - cum[lo]!;
  const u = seg > 0 ? (s - cum[lo]!) / seg : 0;
  out.x = pts[lo * 2]! + (pts[hi * 2]! - pts[lo * 2]!) * u;
  out.y = pts[lo * 2 + 1]! + (pts[hi * 2 + 1]! - pts[lo * 2 + 1]!) * u;
}

/** The column under a CSS-pixel point, anywhere below the header band, or null. */
export function seatAt(layout: Layout, x: number, y: number): number | null {
  if (!(y >= layout.headerH && y < layout.h && x >= 0 && x < layout.w)) return null;
  const seat = Math.floor(x / layout.colW);
  return seat >= 0 && seat < COLUMNS ? seat : null;
}
