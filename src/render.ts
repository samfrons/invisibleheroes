/**
 * The canvas renderer. It keeps no game state: every picture follows from the
 * Frame, the tune (NOTES) and the clock, so a replay draws the same pictures.
 * The only state it holds is the drawing surface, the cached static scenery
 * and the video camera's eased position.
 *
 * Hot-path rules (this runs at 60 fps on phones): no allocation per frame, no
 * closures, no gradients or font strings built per frame, no shadowBlur, no
 * getImageData, no DOM reads.
 */
import { GOOD, GOOD_S, MISS, PENDING, PERFECT, PERFECT_S } from './engine';
import { computeLayout, pointAt, seatAt as layoutSeatAt, type Column, type Layout } from './layout';
import { createPose, drawHero } from './render/heroes';
import { drawScenery, fitFont, outlineWidth, padDepth } from './render/scenery';
import {
  CREAM,
  CREAM_DARK,
  INK,
  PAPER,
  SEAT_STRONG,
  SPARK,
  bodyFont,
  clamp01,
  displayFont,
  fade,
  hash,
} from './render/style';
import { BAR_S, BEAT_S, COUNT_IN_S, NOTES, SONG_S } from './score';
import type { Frame, RenderLabels, Renderer } from './types';

/** A ball shows this long before its note, rolling the whole chute. */
export const LEAD_S = BAR_S;
/** The approach ring closes onto the target over this long. */
const APPROACH_S = BEAT_S;
const BURST_S = 0.5;
const FALL_S = 0.6;
/** How long after a note it can still be on screen (sitting, then falling). */
const TAIL_S = GOOD_S + FALL_S + 0.05;
const WORD_S = 0.7;
const PRESS_S = 0.14;
const FINALE_S = 2.4;
const MAX_BALLS = 48;
const TAU = Math.PI * 2;
const SEATS_N = 5;

interface Fonts {
  take: string;
  onAir: string;
  word: string;
  count: string;
  countSmall: string;
  title: string;
  subtitle: string;
  caption: string;
  captionSmall: string;
  rec: string;
  end: string;
}

/** First index into NOTES with t >= time. */
function lowerBound(time: number): number {
  let lo = 0;
  let hi = NOTES.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (NOTES[mid]!.t < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function makeGear(teeth: number): Float32Array {
  const out = new Float32Array(teeth * 4 * 2);
  const step = TAU / teeth;
  for (let k = 0; k < teeth; k++) {
    const a = k * step;
    const angles = [a - step * 0.3, a - step * 0.16, a + step * 0.16, a + step * 0.3];
    const radii = [0.78, 1, 1, 0.78];
    for (let j = 0; j < 4; j++) {
      out[(k * 4 + j) * 2] = Math.cos(angles[j]!) * radii[j]!;
      out[(k * 4 + j) * 2 + 1] = Math.sin(angles[j]!) * radii[j]!;
    }
  }
  return out;
}

export function createRenderer(canvas: HTMLCanvasElement, labels: RenderLabels): Renderer {
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const scenery = document.createElement('canvas');
  const sctx = scenery.getContext('2d', { alpha: false })!;
  let sceneryKey = -1;

  let L: Layout = computeLayout(1, 1);
  let dpr = 1;
  let olw = 2;
  let lb = 0;
  const fonts: Fonts = {
    take: '',
    onAir: '',
    word: '',
    count: '',
    countSmall: '',
    title: '',
    subtitle: '',
    caption: '',
    captionSmall: '',
    rec: '',
    end: '',
  };
  const captionW = new Float64Array(SEATS_N);
  let lampGlow: CanvasGradient | string = SPARK;
  const gearShapes = [makeGear(10), makeGear(8)];

  // Scratch, reused every frame.
  const P = { x: 0, y: 0 };
  const pose = createPose();
  const nextIdx = new Int32Array(SEATS_N);
  const ballXY = new Float32Array(SEATS_N * MAX_BALLS * 2);
  const ballN = new Int32Array(SEATS_N);
  const fxIdx = new Int32Array(64);
  const fxStart = new Float64Array(64);
  let fxN = 0;
  let takeNum = -1;
  let takeText = '';

  // Video camera.
  const cam = { x: 0, y: 0, s: 1 };
  let camNow = -1;
  let camMode = '';

  function resize(width: number, height: number, ratio: number): void {
    dpr = Math.min(2, Math.max(1, ratio || 1));
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    scenery.width = canvas.width;
    scenery.height = canvas.height;
    L = computeLayout(w, h);
    olw = outlineWidth(L);
    lb = Math.round(h * 0.075);
    sceneryKey = -1;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const words = [labels.perfect, labels.good, labels.miss];
    let longest = '';
    for (const word of words) if (word.length > longest.length) longest = word;
    fonts.take = displayFont(Math.min(L.rowH * 0.42, w * 0.045));
    fonts.onAir = fitFont(ctx, labels.onAir, L.onAir.w * 0.84, L.onAir.h * 0.56, displayFont);
    fonts.word = fitFont(
      ctx,
      longest,
      L.colW * 0.92,
      Math.max(10, Math.min(24, L.colW * 0.12, L.cols[0]!.ringR * 0.9)),
      displayFont
    );
    let longestCount = '';
    for (const word of labels.countIn) if (word.length > longestCount.length) longestCount = word;
    fonts.count = fitFont(ctx, longestCount, w * 0.8, Math.min(h * 0.3, w * 0.3), displayFont);
    fonts.countSmall = fitFont(ctx, longestCount, w * 0.6, Math.min(h * 0.12, w * 0.14), displayFont);
    fonts.title = fitFont(ctx, labels.title, w * 0.78, Math.min(h * 0.09, 60), displayFont);
    fonts.subtitle = fitFont(ctx, labels.subtitle, w * 0.78, Math.min(h * 0.045, 24), bodyFont);
    fonts.end = fitFont(ctx, labels.theEnd, w * 0.7, Math.min(h * 0.12, 80), displayFont);
    fonts.rec = bodyFont(Math.max(9, lb * 0.42), 800);
    let longestName = '';
    for (const s of labels.seats) if (s.name.length > longestName.length) longestName = s.name;
    fonts.caption = fitFont(ctx, longestName, w * 0.6, Math.max(14, Math.min(h * 0.06, 40)), displayFont);
    fonts.captionSmall = bodyFont(Math.max(10, Math.min(h * 0.032, 20)), 700);
    for (let i = 0; i < SEATS_N; i++) {
      const s = labels.seats[i];
      ctx.font = fonts.caption;
      const a = ctx.measureText(s?.name ?? '').width;
      ctx.font = fonts.captionSmall;
      const b = ctx.measureText(s?.instrument ?? '').width;
      captionW[i] = Math.min(w * 0.9, Math.max(a, b));
    }
    const g = ctx.createRadialGradient(L.lamp.x, L.lamp.y, L.lamp.r * 0.6, L.lamp.x, L.lamp.y, L.lamp.r * 3.4);
    g.addColorStop(0, 'rgba(255, 215, 94, 0.95)');
    g.addColorStop(1, 'rgba(255, 215, 94, 0)');
    lampGlow = g;
  }

  function ensureScenery(mask: number, pads: boolean): void {
    const key = mask | (pads ? 64 : 0);
    if (key === sceneryKey) return;
    sceneryKey = key;
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScenery(sctx, L, labels, mask, pads);
  }

  function updateCamera(frame: Frame): void {
    let tx = L.w / 2;
    let ty = L.h / 2;
    let ts = 1;
    if (frame.mode === 'video' && frame.shot !== null && !frame.reducedMotion) {
      const col = L.cols[frame.shot];
      if (col) {
        ts = 1.7;
        tx = col.cx;
        ty = (col.ringY - col.ringR * 2.5 + col.heroY) / 2;
        const hw = L.w / (2 * ts);
        const hh = L.h / (2 * ts);
        tx = Math.min(L.w - hw, Math.max(hw, tx));
        ty = Math.min(L.h - hh, Math.max(hh, ty));
      }
    }
    const dt = frame.now - camNow;
    if (camMode !== frame.mode || camNow < 0 || dt < 0 || dt > 0.5) {
      cam.x = tx;
      cam.y = ty;
      cam.s = ts;
    } else {
      const k = 1 - Math.exp(-dt / 0.07);
      cam.x += (tx - cam.x) * k;
      cam.y += (ty - cam.y) * k;
      cam.s += (ts - cam.s) * k;
    }
    camNow = frame.now;
    camMode = frame.mode;
  }

  // ---- header widgets -------------------------------------------------------

  function drawHeaderLive(frame: Frame, clock: number): void {
    const p = L.pipe;
    const prog = clamp01(frame.t / SONG_S);
    const inset = olw * 0.6 + 1;
    const ix = p.x + p.h * 0.3;
    const iw = p.w - p.h * 0.6;
    const fw = iw * prog;
    if (fw > 0.5) {
      ctx.fillStyle = SPARK;
      ctx.fillRect(ix, p.y + inset, fw, p.h - inset * 2);
      // Electrons streaming along the filled part.
      const spacing = Math.max(8, p.h * 1.1);
      const off = (clock * spacing * 2.5) % spacing;
      const r = Math.max(1.5, p.h * 0.16);
      ctx.fillStyle = SEAT_STRONG[3];
      ctx.beginPath();
      for (let x = ix + off; x < ix + fw - r; x += spacing) {
        ctx.moveTo(x + r, p.y + p.h / 2);
        ctx.arc(x, p.y + p.h / 2, r, 0, TAU);
      }
      ctx.fill();
    }

    // Gears ratchet one tooth per beat.
    const beats = clock / BEAT_S;
    const whole = Math.floor(beats);
    const frac = beats - whole;
    const step = Math.min(1, frac / 0.22);
    const eased = 1 - (1 - step) * (1 - step);
    ctx.lineJoin = 'round';
    for (let g = 0; g < L.gears.length; g++) {
      const gear = L.gears[g]!;
      const shape = gearShapes[g]!;
      const angle = gear.dir * (whole + eased) * (TAU / gear.teeth);
      ctx.save();
      ctx.translate(gear.x, gear.y);
      ctx.rotate(angle);
      ctx.scale(gear.r, gear.r);
      ctx.beginPath();
      const n = shape.length / 2;
      ctx.moveTo(shape[0]!, shape[1]!);
      for (let k = 1; k < n; k++) ctx.lineTo(shape[k * 2]!, shape[k * 2 + 1]!);
      ctx.closePath();
      ctx.moveTo(0.28, 0);
      ctx.arc(0, 0, 0.28, 0, TAU, true);
      ctx.fillStyle = g === 0 ? SEAT_STRONG[3] : SEAT_STRONG[1];
      ctx.fill();
      ctx.lineWidth = olw / gear.r;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0.5, 0);
      ctx.lineTo(-0.5, 0);
      ctx.moveTo(0, 0.5);
      ctx.lineTo(0, -0.5);
      ctx.stroke();
      ctx.restore();
    }

    // Lamp and ON AIR sign.
    const lit = frame.groove > 0.6;
    const beatPulse = 1 - (frame.t / BEAT_S - Math.floor(frame.t / BEAT_S));
    const glow = lit ? 0.55 + 0.45 * beatPulse * beatPulse : clamp01(frame.groove) * 0.35;
    const lamp = L.lamp;
    if (glow > 0.02) {
      ctx.globalAlpha = glow;
      ctx.fillStyle = lampGlow;
      ctx.fillRect(lamp.x - lamp.r * 3.4, lamp.y - lamp.r * 3.4, lamp.r * 6.8, lamp.r * 6.8);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = INK;
    ctx.fillRect(lamp.x - lamp.r * 0.55, lamp.y + lamp.r * 0.7, lamp.r * 1.1, lamp.r * 0.6);
    ctx.beginPath();
    ctx.arc(lamp.x, lamp.y, lamp.r, 0, TAU);
    ctx.fillStyle = lit ? SPARK : CREAM_DARK;
    ctx.fill();
    ctx.lineWidth = olw;
    ctx.strokeStyle = INK;
    ctx.stroke();
    if (lit) {
      ctx.beginPath();
      ctx.arc(lamp.x - lamp.r * 0.3, lamp.y - lamp.r * 0.3, lamp.r * 0.28, 0, TAU);
      ctx.fillStyle = PAPER;
      ctx.fill();
    }
    const s = L.onAir;
    ctx.fillStyle = lit ? SEAT_STRONG[0] : CREAM_DARK;
    ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.strokeRect(s.x, s.y, s.w, s.h);
    ctx.font = fonts.onAir;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = lit ? PAPER : INK;
    ctx.globalAlpha = lit ? 1 : 0.45;
    ctx.fillText(labels.onAir, s.x + s.w / 2, s.y + s.h / 2 + 1);
    ctx.globalAlpha = 1;

    if (frame.takeNumber !== takeNum) {
      takeNum = frame.takeNumber;
      takeText = labels.take + ' ' + String(takeNum);
    }
    ctx.font = fonts.take;
    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    ctx.fillText(takeText, L.takeX, L.takeY);
  }

  // ---- notes ----------------------------------------------------------------

  function burstStart(frame: Frame, i: number, seat: number): number {
    const n = NOTES[i]!;
    const sf = frame.seats[seat];
    if (sf && Math.abs(sf.hitAt - n.t) <= GOOD_S) return Math.min(sf.hitAt, n.t);
    return n.t;
  }

  function pushBall(seat: number, x: number, y: number): void {
    const k = ballN[seat]!;
    if (k >= MAX_BALLS) return;
    const o = (seat * MAX_BALLS + k) * 2;
    ballXY[o] = x;
    ballXY[o + 1] = y;
    ballN[seat] = k + 1;
  }

  function pushFx(i: number, start: number): void {
    if (fxN >= fxIdx.length) return;
    fxIdx[fxN] = i;
    fxStart[fxN] = start;
    fxN++;
  }

  /** Sort the visible notes into balls on chutes, bursts and falls. */
  function collectNotes(frame: Frame): void {
    const t = frame.t;
    ballN.fill(0);
    nextIdx.fill(-1);
    fxN = 0;
    const grades = frame.grades;
    for (let i = lowerBound(t - TAIL_S); i < NOTES.length; i++) {
      const n = NOTES[i]!;
      const dt = n.t - t;
      if (dt > LEAD_S) break;
      const col = L.cols[n.seat]!;
      const g = grades[i] ?? PENDING;
      if (nextIdx[n.seat]! < 0 && (dt > 0 || (g === PENDING && dt > -GOOD_S))) nextIdx[n.seat] = i;
      if (g === GOOD || g === PERFECT) {
        const bs = burstStart(frame, i, n.seat);
        if (t >= bs) {
          if (t - bs < BURST_S) pushFx(i, bs);
          continue;
        }
      } else if (g === MISS && dt < -GOOD_S) {
        if (-dt - GOOD_S < FALL_S) pushFx(i, n.t + GOOD_S);
        continue;
      }
      if (dt >= 0) {
        pointAt(col.chute, col.chute.length * (1 - dt / LEAD_S), P);
        pushBall(n.seat, P.x, P.y);
      } else {
        // Arrived but unsettled: it rolls just past the centre and waits.
        pushBall(n.seat, col.ringX, col.ringY + col.ringR * 0.7 * (1 - Math.exp(dt / 0.06)));
      }
    }
  }

  function drawApproach(frame: Frame): void {
    const calm = frame.mode === 'idle';
    for (let seat = 0; seat < SEATS_N; seat++) {
      const i = nextIdx[seat]!;
      if (i < 0) continue;
      const n = NOTES[i]!;
      const dt = n.t - frame.t;
      if (dt > APPROACH_S) continue;
      const col = L.cols[seat]!;
      const k = clamp01(dt / APPROACH_S);
      const human = frame.humans[seat] === true;
      const r = col.ringR * (1 + 1.9 * k);
      const lw = Math.max(2.5, col.ringR * 0.2);
      ctx.globalAlpha = (calm ? 0.5 : human || frame.mode === 'video' ? 1 : 0.45) * (0.35 + 0.65 * (1 - k));
      ctx.beginPath();
      ctx.arc(col.ringX, col.ringY, r, 0, TAU);
      ctx.strokeStyle = INK;
      ctx.lineWidth = lw + olw * 1.6;
      ctx.stroke();
      ctx.strokeStyle = Math.abs(dt) <= PERFECT_S ? SPARK : SEAT_STRONG[seat]!;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawBalls(): void {
    const r = L.ballR;
    ctx.lineWidth = Math.max(1.2, olw * 0.8);
    ctx.strokeStyle = INK;
    for (let seat = 0; seat < SEATS_N; seat++) {
      const n = ballN[seat]!;
      if (n === 0) continue;
      const base = seat * MAX_BALLS * 2;
      ctx.beginPath();
      for (let k = 0; k < n; k++) {
        const x = ballXY[base + k * 2]!;
        const y = ballXY[base + k * 2 + 1]!;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TAU);
      }
      ctx.fillStyle = SEAT_STRONG[seat]!;
      ctx.fill();
      ctx.stroke();
    }
    // Highlights, all seats in one path.
    ctx.beginPath();
    const hr = r * 0.32;
    for (let seat = 0; seat < SEATS_N; seat++) {
      const n = ballN[seat]!;
      const base = seat * MAX_BALLS * 2;
      for (let k = 0; k < n; k++) {
        const x = ballXY[base + k * 2]! - r * 0.35;
        const y = ballXY[base + k * 2 + 1]! - r * 0.35;
        ctx.moveTo(x + hr, y);
        ctx.arc(x, y, hr, 0, TAU);
      }
    }
    ctx.fillStyle = PAPER;
    ctx.fill();
  }

  function drawFx(frame: Frame): void {
    const t = frame.t;
    const rm = frame.reducedMotion;
    const calm = frame.mode === 'idle';
    const sparks = rm ? 4 : calm ? 5 : 9;
    for (let f = 0; f < fxN; f++) {
      const i = fxIdx[f]!;
      const n = NOTES[i]!;
      const col: Column = L.cols[n.seat]!;
      const age = t - fxStart[f]!;
      const g = frame.grades[i]!;
      if (g === MISS) {
        // Falls past the ring with gravity, fading.
        const a = fade(age, FALL_S);
        const x = col.ringX + (hash(i, 7) - 0.5) * col.ringR * 2 * age;
        const y = col.ringY + col.ringR * 0.7 + age * col.ringR * 2 + 0.5 * L.h * 2.6 * age * age;
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.arc(x, y, L.ballR, 0, TAU);
        ctx.fillStyle = CREAM_DARK;
        ctx.fill();
        ctx.lineWidth = olw * 0.8;
        ctx.strokeStyle = INK;
        ctx.stroke();
        continue;
      }
      const a = fade(age, BURST_S);
      const u = age / BURST_S;
      const perfect = g === PERFECT;
      // Ring flash.
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(col.ringX, col.ringY, col.ringR * (1 + u * 1.3), 0, TAU);
      ctx.strokeStyle = perfect ? SPARK : SEAT_STRONG[n.seat]!;
      ctx.lineWidth = Math.max(2, col.ringR * 0.35 * (1 - u));
      ctx.stroke();
      if (age < 0.12) {
        ctx.beginPath();
        ctx.arc(col.ringX, col.ringY, col.ringR * 0.62, 0, TAU);
        ctx.fillStyle = perfect ? SPARK : PAPER;
        ctx.fill();
      }
      // Sparks.
      ctx.beginPath();
      for (let k = 0; k < sparks; k++) {
        const ang = ((k + hash(i, k) * 0.6) / sparks) * TAU;
        const d0 = col.ringR * (1.1 + u * 1.6 * (0.6 + hash(k, i)));
        const d1 = d0 + col.ringR * 0.45 * (1 - u);
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        ctx.moveTo(col.ringX + c * d0, col.ringY + s * d0);
        ctx.lineTo(col.ringX + c * d1, col.ringY + s * d1);
      }
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1.5, olw);
      ctx.stroke();
      // The electron flies off to the lamp.
      if (age > 0.04) {
        const v = clamp01((age - 0.04) / (BURST_S - 0.04));
        const e = v * v;
        const cx = col.ringX;
        const cy = L.lamp.y;
        const x = (1 - e) * (1 - e) * col.ringX + 2 * (1 - e) * e * cx + e * e * L.lamp.x;
        const y = (1 - e) * (1 - e) * col.ringY + 2 * (1 - e) * e * cy + e * e * L.lamp.y;
        ctx.globalAlpha = 1 - v * 0.6;
        ctx.beginPath();
        ctx.arc(x, y, L.ballR * (1 - 0.4 * v), 0, TAU);
        ctx.fillStyle = SPARK;
        ctx.fill();
        ctx.lineWidth = Math.max(1, olw * 0.7);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---- seats ----------------------------------------------------------------

  function drawHeroes(frame: Frame): void {
    const t = frame.t;
    const idle = frame.reducedMotion ? 0 : frame.mode === 'idle' ? 0.6 : 1;
    for (let seat = 0; seat < SEATS_N; seat++) {
      const col = L.cols[seat]!;
      const sf = frame.seats[seat];
      const hitAge = sf && t >= sf.hitAt ? t - sf.hitAt : Infinity;
      pose.hitAge = hitAge;
      pose.hit = hitAge < 0.8 ? Math.exp(-hitAge * 7) : 0;
      pose.missAge = sf && t >= sf.missAt ? t - sf.missAt : Infinity;
      pose.pressAge = sf && t >= sf.pressAt ? t - sf.pressAt : Infinity;
      pose.hitSeed = sf && hitAge < 10 ? hash(Math.round(sf.hitAt * 1000), seat) : 0;
      pose.now = frame.now;
      const b = frame.now * 0.31 + seat * 0.29;
      pose.blink = b - Math.floor(b) < 0.035;
      pose.idle = idle;
      pose.lw = olw / (col.heroSize / 100);
      drawHero(ctx, seat, col.heroX, col.heroY, col.heroSize, pose);
    }
  }

  function drawWords(frame: Frame): void {
    const t = frame.t;
    ctx.font = fonts.word;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    for (let seat = 0; seat < SEATS_N; seat++) {
      const sf = frame.seats[seat];
      if (!sf) continue;
      const col = L.cols[seat]!;
      const hitAge = t - sf.hitAt;
      const missAge = t - sf.missAt;
      const showHit = hitAge >= 0 && hitAge < WORD_S;
      const showMiss = missAge >= 0 && missAge < WORD_S && !(showHit && hitAge < missAge);
      const base = col.ringY - col.ringR * 1.7;
      if (showHit) {
        const word = sf.hitGrade === PERFECT ? labels.perfect : labels.good;
        const y = base - hitAge * col.ringR * 2.2;
        ctx.globalAlpha = fade(hitAge, WORD_S);
        ctx.strokeStyle = PAPER;
        ctx.strokeText(word, col.cx, y);
        ctx.fillStyle = sf.hitGrade === PERFECT ? SEAT_STRONG[seat]! : INK;
        ctx.fillText(word, col.cx, y);
      } else if (showMiss) {
        const y = base - missAge * col.ringR * 1.2;
        ctx.globalAlpha = fade(missAge, WORD_S);
        ctx.strokeStyle = PAPER;
        ctx.strokeText(labels.miss, col.cx, y);
        ctx.fillStyle = INK;
        ctx.fillText(labels.miss, col.cx, y);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawPressedPads(frame: Frame): void {
    const t = frame.t;
    const depth = padDepth(L);
    for (let seat = 0; seat < SEATS_N; seat++) {
      const sf = frame.seats[seat];
      if (!sf) continue;
      const age = t - sf.pressAt;
      if (!(age >= 0 && age < PRESS_S)) continue;
      const d = depth * (1 - age / PRESS_S);
      const p = L.cols[seat]!.pad;
      // Clear the top strip the key leaves, then blit the key face lower down.
      ctx.fillStyle = CREAM;
      ctx.fillRect(p.x, p.y - 0.5, p.w, d + 1);
      ctx.drawImage(scenery, p.x * dpr, p.y * dpr, p.w * dpr, (p.h - depth) * dpr, p.x, p.y + d, p.w, p.h - depth);
      ctx.strokeStyle = INK;
      ctx.lineWidth = olw * 1.4;
      ctx.strokeRect(p.x, p.y + d, p.w, p.h - depth);
    }
  }

  // ---- big moments ----------------------------------------------------------

  function drawFinale(frame: Frame): void {
    const age0 = frame.t - SONG_S;
    if (age0 < 0 || age0 > FINALE_S + 1.3) return;
    const per = frame.reducedMotion ? 4 : frame.mode === 'idle' ? 6 : 10;
    const waves = 5;
    const lamp = L.lamp;
    const speed = Math.max(L.w, L.h) * 0.55;
    const g = L.h * 1.3;
    const r = L.ballR * 0.9;
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, olw * 0.7);
    for (let wv = 0; wv < waves; wv++) {
      const a = age0 - wv * (FINALE_S / waves);
      if (a < 0 || a > 1.3) continue;
      ctx.globalAlpha = 1 - a / 1.3;
      for (let c = 0; c < SEATS_N; c++) {
        ctx.beginPath();
        for (let k = c; k < per; k += SEATS_N) {
          const ang = Math.PI * (0.45 + 0.85 * hash(wv * 31 + k, 11));
          const v = speed * (0.35 + 0.65 * hash(k, wv * 7 + 3));
          const x = lamp.x + Math.cos(ang) * v * a;
          const y = lamp.y + Math.sin(ang) * v * a + 0.5 * g * a * a;
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, TAU);
        }
        ctx.fillStyle = SEAT_STRONG[c]!;
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawCount(frame: Frame, small: boolean, cy: number): void {
    const beats = (frame.t + COUNT_IN_S) / BEAT_S;
    const n = labels.countIn.length;
    if (n === 0 || beats < 0) return;
    const idx = Math.min(n - 1, Math.floor(beats));
    const frac = beats - Math.floor(beats);
    const word = labels.countIn[idx]!;
    const pop = frame.reducedMotion ? 1 : 1 + 0.35 * (1 - frac) * (1 - frac) * (1 - frac);
    ctx.save();
    ctx.translate(L.w / 2, cy);
    ctx.scale(pop, pop);
    ctx.font = small ? fonts.countSmall : fonts.count;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 1 - frac * 0.35;
    ctx.lineWidth = small ? 6 : 10;
    ctx.strokeStyle = PAPER;
    ctx.strokeText(word, 0, 0);
    ctx.fillStyle = idx === n - 1 ? SEAT_STRONG[0] : INK;
    ctx.fillText(word, 0, 0);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function card(cx: number, cy: number, w: number, h: number): void {
    ctx.fillStyle = INK;
    ctx.fillRect(cx - w / 2 + 5, cy - h / 2 + 5, w, h);
    ctx.fillStyle = PAPER;
    ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    ctx.lineWidth = Math.max(2, olw * 1.2);
    ctx.strokeStyle = INK;
    ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
    const sh = Math.max(3, h * 0.05);
    ctx.fillStyle = SEAT_STRONG[0];
    ctx.fillRect(cx - w / 2 + olw, cy + h / 2 - sh * 3 - olw, w - olw * 2, sh);
    ctx.fillStyle = SEAT_STRONG[3];
    ctx.fillRect(cx - w / 2 + olw, cy + h / 2 - sh * 2 - olw, w - olw * 2, sh);
    ctx.fillStyle = SEAT_STRONG[1];
    ctx.fillRect(cx - w / 2 + olw, cy + h / 2 - sh - olw, w - olw * 2, sh);
  }

  function drawVideoOverlay(frame: Frame): void {
    const w = L.w;
    const h = L.h;
    const t = frame.t;
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, w, lb);
    ctx.fillRect(0, h - lb, w, lb);

    if (t < 0) {
      const cw = Math.min(w * 0.88, 680);
      const ch = Math.min(h * 0.34, 220);
      const cy = h * 0.4;
      card(w / 2, cy, cw, ch);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = INK;
      ctx.font = fonts.title;
      ctx.fillText(labels.title, w / 2, cy - ch * 0.16);
      ctx.font = fonts.subtitle;
      ctx.fillText(labels.subtitle, w / 2, cy + ch * 0.14);
      drawCount(frame, true, Math.min(h - lb - h * 0.1, cy + ch / 2 + h * 0.13));
    } else if (t > SONG_S + 0.4) {
      const cw = Math.min(w * 0.8, 520);
      const ch = Math.min(h * 0.26, 170);
      card(w / 2, h / 2, cw, ch);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = INK;
      ctx.font = fonts.end;
      ctx.fillText(labels.theEnd, w / 2, h / 2 - ch * 0.08);
    } else if (frame.shot !== null) {
      const seat = frame.shot;
      const s = labels.seats[seat];
      if (s) {
        const pad = Math.max(8, h * 0.018);
        const bw = (captionW[seat] ?? 100) + pad * 2 + 6;
        const bh = Math.max(36, h * 0.12);
        const x = Math.max(8, w * 0.04);
        const y = h - lb - bh - Math.max(8, h * 0.03);
        ctx.fillStyle = INK;
        ctx.fillRect(x + 4, y + 4, bw, bh);
        ctx.fillStyle = PAPER;
        ctx.fillRect(x, y, bw, bh);
        ctx.fillStyle = SEAT_STRONG[seat]!;
        ctx.fillRect(x, y, 6, bh);
        ctx.lineWidth = Math.max(2, olw);
        ctx.strokeStyle = INK;
        ctx.strokeRect(x, y, bw, bh);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = INK;
        ctx.font = fonts.caption;
        ctx.fillText(s.name, x + pad + 6, y + bh * 0.38);
        ctx.font = fonts.captionSmall;
        ctx.fillText(s.instrument, x + pad + 6, y + bh * 0.74);
      }
    }

    if (frame.recording && frame.now - Math.floor(frame.now) < 0.6) {
      const r = lb * 0.18;
      const x = Math.max(10, w * 0.025);
      ctx.beginPath();
      ctx.arc(x + r, lb / 2, r, 0, TAU);
      ctx.fillStyle = SEAT_STRONG[0];
      ctx.fill();
      ctx.font = fonts.rec;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = PAPER;
      ctx.fillText(labels.rec, x + r * 2 + 6, lb / 2 + 1);
    }
  }

  // ---- frame ----------------------------------------------------------------

  function draw(frame: Frame): void {
    const t = frame.t;
    const video = frame.mode === 'video';
    let mask = 0;
    for (let i = 0; i < SEATS_N; i++) if (frame.humans[i]) mask |= 1 << i;
    ensureScenery(mask, !video);
    updateCamera(frame);

    // Shake: the finale's thump, and the drum in the video. Never with reduced motion.
    let shake = 0;
    if (!frame.reducedMotion && frame.mode !== 'idle') {
      const fa = t - SONG_S;
      if (fa >= 0 && fa < 0.8) shake = 6 * (1 - fa / 0.8);
      const drum = frame.seats[3];
      if (video && drum) {
        const da = t - drum.hitAt;
        if (da >= 0 && da < 0.12) shake = Math.max(shake, 2.5 * (1 - da / 0.12));
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (shake > 0 || cam.s !== 1) {
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, L.w, L.h);
      ctx.translate(L.w / 2 + Math.sin(frame.now * 71) * shake, L.h / 2 + Math.cos(frame.now * 53) * shake);
      ctx.scale(cam.s, cam.s);
      ctx.translate(-cam.x, -cam.y);
    }
    ctx.drawImage(scenery, 0, 0, L.w, L.h);

    const clock = frame.mode === 'idle' ? frame.now : t;
    drawHeaderLive(frame, clock);
    if (!video) drawPressedPads(frame);
    collectNotes(frame);
    drawApproach(frame);
    drawBalls();
    drawHeroes(frame);
    drawFx(frame);
    drawWords(frame);
    drawFinale(frame);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (video) drawVideoOverlay(frame);
    else if (t < 0 && frame.mode === 'take') drawCount(frame, false, L.headerH + (L.h - L.headerH) * 0.4);
  }

  function seatAt(x: number, y: number): number | null {
    return layoutSeatAt(L, x, y);
  }

  return { resize, draw, seatAt };
}
