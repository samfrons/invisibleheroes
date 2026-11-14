/**
 * The five heroes and their instruments, drawn in a 100-unit box: x from -50
 * to 50, y from -100 (top) to 0 (the floor). The caller scales the box to the
 * column. Every pose comes from the Pose object, which the renderer refills
 * each frame (no allocation here).
 */
import { INK, PAPER, SEAT_STRONG, SEAT_TINT, hash } from './style';

export interface Pose {
  /** Hit envelope, 1 at the hit falling to 0. */
  hit: number;
  /** Seconds since the last hit (Infinity if none). */
  hitAge: number;
  /** Seconds since the last miss (Infinity if none). */
  missAge: number;
  /** Seconds since the last press (Infinity if none). */
  pressAge: number;
  /** Seed for which key dips, which string rings. */
  hitSeed: number;
  now: number;
  blink: boolean;
  /** Scale on idle motion (0 for reduced motion, smaller in idle mode). */
  idle: number;
  /** Line width in box units. */
  lw: number;
}

export function createPose(): Pose {
  return {
    hit: 0,
    hitAge: Infinity,
    missAge: Infinity,
    pressAge: Infinity,
    hitSeed: 0,
    now: 0,
    blink: false,
    idle: 1,
    lw: 3,
  };
}

const TAU = Math.PI * 2;

/** A vertical capsule from y0 (top) to y1 (bottom). */
function capsule(ctx: CanvasRenderingContext2D, cx: number, y0: number, y1: number, w: number): void {
  const r = w / 2;
  ctx.moveTo(cx + r, y0 + r);
  ctx.arc(cx, y0 + r, r, 0, Math.PI, true);
  ctx.lineTo(cx - r, y1 - r);
  ctx.arc(cx, y1 - r, r, Math.PI, 0, true);
  ctx.closePath();
}

function fillStroke(ctx: CanvasRenderingContext2D, fill: string, lw: number): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.stroke();
}

function mood(p: Pose): number {
  if (p.missAge < 0.7) return -1;
  if (p.hit > 0.3) return 1;
  return 0;
}

/** Two eyes and a mouth, centred on the eyes' midpoint. */
function face(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, p: Pose): void {
  const lw = p.lw * 0.8;
  const m = mood(p);
  const ex = 5 * s;
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  if (p.blink) {
    ctx.beginPath();
    ctx.moveTo(x - ex - 3.5 * s, y);
    ctx.lineTo(x - ex + 3.5 * s, y);
    ctx.moveTo(x + ex - 3.5 * s, y);
    ctx.lineTo(x + ex + 3.5 * s, y);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(x - ex + 4.2 * s, y);
    ctx.arc(x - ex, y, 4.2 * s, 0, TAU);
    ctx.moveTo(x + ex + 4.2 * s, y);
    ctx.arc(x + ex, y, 4.2 * s, 0, TAU);
    ctx.fillStyle = PAPER;
    ctx.fill();
    ctx.stroke();
    // Pupils look down at the instrument, up when surprised.
    const py = m === 1 ? -0.8 * s : 1 * s;
    ctx.beginPath();
    ctx.moveTo(x - ex + 2.2 * s + 0.8 * s, y + py);
    ctx.arc(x - ex + 0.8 * s, y + py, 2.2 * s, 0, TAU);
    ctx.moveTo(x + ex + 2.2 * s + 0.8 * s, y + py);
    ctx.arc(x + ex + 0.8 * s, y + py, 2.2 * s, 0, TAU);
    ctx.fillStyle = INK;
    ctx.fill();
  }
  ctx.beginPath();
  if (m === 1) {
    ctx.moveTo(x - 4.5 * s, y + 7 * s);
    ctx.arc(x, y + 7 * s, 4.5 * s, Math.PI, 0, true);
    ctx.closePath();
    ctx.fillStyle = INK;
    ctx.fill();
  } else if (m === -1) {
    ctx.arc(x, y + 13 * s, 5 * s, 1.2 * Math.PI, 1.8 * Math.PI);
    ctx.stroke();
  } else {
    ctx.arc(x, y + 5 * s, 4.5 * s, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();
  }
}

/** 0: Geobacter, a rod whose nanowire filaments are strung as bass strings. */
function geobacter(ctx: CanvasRenderingContext2D, p: Pose): void {
  const lw = p.lw;
  // The bass: an ellipse body on a dark neck.
  ctx.beginPath();
  ctx.rect(20.5, -96, 7, 48);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(24, -28, 19, 27, 0, 0, TAU);
  fillStroke(ctx, SEAT_TINT[0], lw);
  ctx.beginPath();
  ctx.moveTo(15, -36);
  ctx.quadraticCurveTo(12, -30, 15, -24);
  ctx.moveTo(33, -36);
  ctx.quadraticCurveTo(36, -30, 33, -24);
  ctx.moveTo(16, -12);
  ctx.lineTo(32, -12);
  ctx.lineWidth = lw;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(24, -98, 4, 0, TAU);
  fillStroke(ctx, SEAT_STRONG[0], lw * 0.8);

  // The rod.
  ctx.beginPath();
  capsule(ctx, -20, -80, -6, 30);
  fillStroke(ctx, SEAT_STRONG[0], lw);
  ctx.beginPath();
  ctx.moveTo(-26, -6);
  ctx.lineTo(-28, 0);
  ctx.moveTo(-14, -6);
  ctx.lineTo(-12, 0);
  ctx.stroke();
  face(ctx, -20, -60, 1, p);

  // Filaments: out of the rod, over the scroll, down the bass as strings.
  const ring = p.hit;
  ctx.lineWidth = lw * 0.55;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const sx = 21 + i * 3;
    const ex = 18 + i * 6;
    const amp = ring * 4 * Math.sin(p.hitAge * 70 + i * 1.7);
    ctx.moveTo(-6, -74 + i * 4);
    ctx.quadraticCurveTo(4, -100 - i * 2, sx, -92);
    ctx.quadraticCurveTo((sx + ex) / 2 + amp, -52, ex, -12);
  }
  ctx.stroke();
  // The plucking arm.
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(-6, -42);
  ctx.lineTo(16 + ring * 6, -36 + ring * 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(16 + ring * 6, -36 + ring * 4, 3.5, 0, TAU);
  fillStroke(ctx, SEAT_STRONG[0], lw * 0.8);
}

/** 1: Shewanella, a rod with a wavy tail, at a little keyboard. */
function shewanella(ctx: CanvasRenderingContext2D, p: Pose): void {
  const lw = p.lw;
  // Tail.
  ctx.beginPath();
  for (let k = 0; k <= 12; k++) {
    const x = -30 - k * 1.5 + 3.5 * Math.sin(k * 0.9 - p.now * 8 * p.idle);
    const y = -60 + k * 3;
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw * 0.9;
  ctx.stroke();
  // Legs and body.
  ctx.beginPath();
  ctx.moveTo(-22, -36);
  ctx.lineTo(-24, 0);
  ctx.moveTo(-10, -36);
  ctx.lineTo(-8, 0);
  ctx.lineWidth = lw;
  ctx.stroke();
  ctx.beginPath();
  capsule(ctx, -16, -86, -32, 30);
  fillStroke(ctx, SEAT_STRONG[1], lw);
  face(ctx, -16, -66, 1, p);

  // Keyboard on a stand.
  ctx.beginPath();
  ctx.moveTo(8, -28);
  ctx.lineTo(4, 0);
  ctx.moveTo(42, -28);
  ctx.lineTo(46, 0);
  ctx.moveTo(4, -12);
  ctx.lineTo(46, -12);
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(-1, -42, 50, 16);
  fillStroke(ctx, SEAT_TINT[1], lw);
  const down = p.hit > 0.05 ? Math.floor(p.hitSeed * 6) : -1;
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    if (k === down) continue;
    ctx.rect(1 + k * 7.7, -37, 7.7, 10);
  }
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.lineWidth = lw * 0.5;
  ctx.stroke();
  if (down >= 0) {
    ctx.beginPath();
    ctx.rect(1 + down * 7.7, -37 + 2 * p.hit, 7.7, 10 - 2 * p.hit);
    ctx.fillStyle = SEAT_STRONG[1];
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  for (let k = 0; k < 5; k++) {
    if (k === 2) continue;
    ctx.rect(6.5 + k * 7.7, -37, 4, 6);
  }
  ctx.fillStyle = INK;
  ctx.fill();
  // Arm reaching the key.
  const kx = 5 + (down >= 0 ? down : 2) * 7.7;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(-2, -54);
  ctx.lineTo(kx, -42 + p.hit * 3);
  ctx.stroke();
}

/** 2: Reed mannagrass, a leafy stalk with roots and hanging chime tubes. */
function leaf(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, angle: number, w: number): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const tx = x + c * len;
  const ty = y + s * len;
  const mx = x + c * len * 0.5;
  const my = y + s * len * 0.5;
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(mx - s * w, my + c * w, tx, ty);
  ctx.quadraticCurveTo(mx + s * w, my - c * w, x, y);
}

function reed(ctx: CanvasRenderingContext2D, p: Pose): void {
  const lw = p.lw;
  const sway = Math.sin(p.now * 1.3) * 3 * p.idle + p.hit * 2;
  // Roots fanning over the floor.
  ctx.beginPath();
  ctx.moveTo(0, -3);
  ctx.quadraticCurveTo(-8, -1, -18, 3);
  ctx.moveTo(0, -3);
  ctx.quadraticCurveTo(-4, 1, -9, 5);
  ctx.moveTo(0, -3);
  ctx.quadraticCurveTo(4, 1, 8, 5);
  ctx.moveTo(0, -3);
  ctx.quadraticCurveTo(9, -1, 19, 2);
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw * 0.7;
  ctx.stroke();
  // Stalk.
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.quadraticCurveTo(-5, -40, sway, -66);
  ctx.lineWidth = lw * 2.6;
  ctx.stroke();
  ctx.strokeStyle = SEAT_STRONG[2];
  ctx.lineWidth = lw * 1.4;
  ctx.stroke();
  // Leaves.
  ctx.beginPath();
  leaf(ctx, -2, -18, 28, Math.PI * 1.12, 6);
  leaf(ctx, -3, -34, 26, Math.PI * 1.88, 6);
  leaf(ctx, -2, -48, 22, Math.PI * 1.15, 5);
  fillStroke(ctx, SEAT_TINT[2], lw * 0.8);
  // Chime branch and tubes.
  const bx0 = sway * 0.9;
  const by0 = -60;
  ctx.beginPath();
  ctx.moveTo(bx0, by0);
  ctx.quadraticCurveTo(22, -72, 44, -66);
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw * 1.1;
  ctx.stroke();
  ctx.beginPath();
  leaf(ctx, 44, -66, 9, -0.3, 3);
  fillStroke(ctx, SEAT_TINT[2], lw * 0.7);
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const hx = 16 + i * 8;
    const hy = -69.5 + i * 0.6;
    const len = 26 - i * 4;
    const a =
      p.hit * 0.45 * Math.sin(p.hitAge * 13 + i * 1.1) + 0.04 * Math.sin(p.now * 2.1 + i) * p.idle;
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx + Math.sin(a) * len, hy + Math.cos(a) * len);
  }
  ctx.lineCap = 'butt';
  ctx.lineWidth = lw * 2.8;
  ctx.stroke();
  ctx.strokeStyle = SEAT_STRONG[3];
  ctx.lineWidth = lw * 1.4;
  ctx.stroke();
  ctx.lineCap = 'round';
  // Head with a tuft.
  ctx.beginPath();
  leaf(ctx, sway, -88, 12, -Math.PI * 0.62, 3.5);
  leaf(ctx, sway, -88, 11, -Math.PI * 0.3, 3);
  fillStroke(ctx, SEAT_STRONG[2], lw * 0.7);
  ctx.beginPath();
  ctx.ellipse(sway, -76, 14, 15, 0, 0, TAU);
  fillStroke(ctx, SEAT_STRONG[2], lw);
  face(ctx, sway, -78, 0.95, p);
}

/** 3: Sporomusa, a curved rod at a drum. */
function sporomusa(ctx: CanvasRenderingContext2D, p: Pose): void {
  const lw = p.lw;
  // Legs.
  ctx.beginPath();
  ctx.moveTo(-27, -16);
  ctx.lineTo(-31, 0);
  ctx.moveTo(-19, -16);
  ctx.lineTo(-16, 0);
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.stroke();
  // The curved body: an ink stroke under a colour stroke.
  ctx.beginPath();
  ctx.arc(-50, -48, 34, -0.95, 0.95);
  ctx.lineWidth = 26;
  ctx.stroke();
  ctx.strokeStyle = SEAT_STRONG[3];
  ctx.lineWidth = 26 - lw * 2;
  ctx.stroke();
  face(ctx, -18, -52, 0.95, p);

  // Drum.
  const cx = 26;
  ctx.beginPath();
  ctx.moveTo(cx - 20, -36);
  ctx.lineTo(cx - 22, 0);
  ctx.moveTo(cx + 20, -36);
  ctx.lineTo(cx + 22, 0);
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 21, -40);
  ctx.lineTo(cx - 21, -12);
  ctx.ellipse(cx, -12, 21, 7, 0, Math.PI, 0, true);
  ctx.lineTo(cx + 21, -40);
  ctx.closePath();
  fillStroke(ctx, SEAT_STRONG[3], lw);
  ctx.beginPath();
  for (let k = 0; k < 5; k++) {
    const x = cx - 18 + k * 9;
    ctx.moveTo(x, -37);
    ctx.lineTo(x + 4.5, -16);
    ctx.lineTo(x + 9, -37);
  }
  ctx.lineWidth = lw * 0.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, -40, 21, 7, 0, 0, TAU);
  fillStroke(ctx, PAPER, lw);
  // Ripples on the head after a hit.
  if (p.hitAge < 0.5) {
    ctx.lineWidth = lw * 0.6;
    for (let k = 0; k < 2; k++) {
      const a = p.hitAge - k * 0.08;
      if (a <= 0) continue;
      const s = Math.min(1, 0.2 + a * 3);
      ctx.globalAlpha = 1 - a / 0.5;
      ctx.beginPath();
      ctx.ellipse(cx, -40, 19 * s, 6 * s, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  // The stick: raised at rest, down on the head at the hit.
  const e = p.hit;
  const tipX = 16 + (1 - e) * -4;
  const tipY = -42 - (1 - e) * 18;
  ctx.beginPath();
  ctx.moveTo(-6, -50);
  ctx.lineTo(tipX, tipY);
  ctx.lineWidth = lw * 1.2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(tipX, tipY, 3.2, 0, TAU);
  fillStroke(ctx, PAPER, lw * 0.7);
}

/** 4: Methanobacterium, a long slim rod with a tuba that blows bubbles. */
function methano(ctx: CanvasRenderingContext2D, p: Pose): void {
  const lw = p.lw;
  // Tuba tubing coil.
  ctx.beginPath();
  ctx.arc(14, -34, 17, 0, TAU);
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw + 7;
  ctx.stroke();
  ctx.strokeStyle = SEAT_TINT[4];
  ctx.lineWidth = 7;
  ctx.stroke();
  // Bell.
  ctx.beginPath();
  ctx.moveTo(22, -46);
  ctx.lineTo(29, -46);
  ctx.quadraticCurveTo(32, -70, 42, -84);
  ctx.lineTo(10, -84);
  ctx.quadraticCurveTo(20, -70, 22, -46);
  ctx.closePath();
  fillStroke(ctx, SEAT_TINT[4], lw);
  ctx.beginPath();
  ctx.ellipse(26, -84, 16, 4.5, 0, 0, TAU);
  fillStroke(ctx, INK, lw);
  // Mouthpiece from the rod.
  ctx.beginPath();
  ctx.moveTo(-20, -70);
  ctx.quadraticCurveTo(-6, -66, -3, -40);
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw * 1.6;
  ctx.stroke();
  // The rod.
  ctx.beginPath();
  capsule(ctx, -27, -99, -2, 18);
  fillStroke(ctx, SEAT_STRONG[4], lw);
  face(ctx, -27, -82, 0.78, p);

  // Bubbles: a slow idle trickle, a burst on a hit.
  ctx.lineWidth = lw * 0.5;
  ctx.strokeStyle = INK;
  ctx.fillStyle = PAPER;
  for (let k = 0; k < 3; k++) {
    const ph = (p.now * 0.4 + k / 3) % 1;
    if (p.idle === 0 && k > 0) break;
    const r = 1.6 + ph * 2.2;
    ctx.globalAlpha = 1 - ph;
    ctx.beginPath();
    ctx.arc(26 + Math.sin(ph * 7 + k * 2) * 4, -90 - ph * 26, r, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }
  if (p.hitAge < 0.9) {
    for (let k = 0; k < 5; k++) {
      const a = p.hitAge - k * 0.05;
      if (a <= 0) continue;
      const r = 2.5 + a * 6;
      ctx.globalAlpha = Math.max(0, 1 - a / 0.9);
      ctx.beginPath();
      ctx.arc(26 + (hash(k, p.hitSeed * 1000) - 0.5) * 34 * a, -90 - a * 80, r, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

const HEROES = [geobacter, shewanella, reed, sporomusa, methano] as const;

/**
 * Draw hero `seat` standing on (x, y) in a box `size` pixels square, with the
 * hit bounce and squash applied.
 */
export function drawHero(
  ctx: CanvasRenderingContext2D,
  seat: number,
  x: number,
  y: number,
  size: number,
  p: Pose
): void {
  const k = size / 100;
  let lift = 0;
  let sx = 1;
  let sy = 1;
  if (p.hitAge < 0.32) {
    const u = p.hitAge / 0.32;
    lift = Math.sin(u * Math.PI) * 7;
    const sq = (1 - u) * (1 - u) * 0.14;
    sx = 1 + sq;
    sy = 1 - sq;
  } else if (p.missAge < 0.4) {
    // A little slump.
    const u = 1 - p.missAge / 0.4;
    sy = 1 - 0.06 * u;
    sx = 1 + 0.03 * u;
  } else if (p.idle > 0) {
    sy = 1 + Math.sin(p.now * 2.2 + seat * 1.3) * 0.012 * p.idle;
  }
  ctx.save();
  ctx.translate(x, y - lift * k);
  ctx.scale(k * sx, k * sy);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  HEROES[seat]!(ctx, p);
  ctx.restore();
}
