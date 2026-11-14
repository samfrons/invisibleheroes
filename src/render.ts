/**
 * The heads-up overlay. A transparent 2D canvas drawn over the 3D reactor
 * scene, styled after the "Bacterial Blues" video: a coral Bauhaus frame,
 * five bold lanes in the lower 55 % of the stage, a reticle and its shrinking
 * approach ring per lane, gold electrons with a glow and a short trail, flat
 * Bauhaus keys, a glyph per seat, an oscilloscope window, condensed all-caps
 * words with a glow and a hard offset shadow, and in the video the
 * letterbox, captions, lyric lines and cards.
 *
 * It keeps no game state: every picture follows from the Frame, the tune
 * (NOTES) and the clock, so a replay draws the same pictures. The only state
 * it holds is the drawing surface and the cached static layer.
 *
 * Hot-path rules (this runs at 60 fps on phones): no allocation per frame, no
 * closures, no gradients or font strings built per frame, no shadowBlur, no
 * getImageData, no DOM reads.
 */
import { GOOD, GOOD_S, MISS, PENDING, PERFECT, PERFECT_S } from './engine';
import { computeLayout, pointAt, seatAt as layoutSeatAt, type Column, type Layout } from './layout';
import { drawGlyph } from './render/heroes';
import { drawScenery, fitFont, outlineWidth } from './render/scenery';
import {
  BLACK,
  CORAL,
  CREAM,
  CREAM_DIM,
  DISPLAY_FAMILY,
  DISPLAY_FONT_URL,
  GLASS,
  GOLD,
  SCOPE_GREEN,
  SEAT_GLOW,
  TEAL,
  clamp01,
  displayFont,
  fade,
  hash,
  monoFont,
} from './render/style';
import { BAR_S, BARS, BEAT_S, COUNT_IN_S, NOTES, SONG_S, STEP_S } from './score';
import type { Frame, RenderLabels, Renderer } from './types';

/** A ball shows this long before its note, rolling the whole lane. */
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
const CREDITS_AT = SONG_S + 0.4;
const MAX_BALLS = 48;
/** Trail dots behind each electron. */
const TRAIL = 3;
const TAU = Math.PI * 2;
const SEATS_N = 5;
/** The video's lyric lines run over the verse and the chorus. */
const LYRIC_FROM_BAR = 4;
const LYRIC_TO_BAR = BARS - 1;
/** How much a non-featured lane fades during a video close-up. */
const DIMMED = 0.28;
/** Lyric and chant lines cycle through the three accents. */
const LINE_COLOURS = [TEAL, CORAL, GOLD] as const;
/** Condensed caps are letter-spaced. */
const TRACKING = '0.04em';

interface Fonts {
  take: string;
  word: string;
  count: string;
  leader: string;
  title: string;
  subtitle: string;
  caption: string;
  captionSmall: string;
  rec: string;
  end: string;
  lyric: string;
  chant: string;
  winnerLabel: string;
  winner: string;
  creditName: string;
  creditFact: string;
}

// ---- the display face ----------------------------------------------------------

let fontState: 'idle' | 'loading' | 'ready' = 'idle';
const fontListeners: (() => void)[] = [];

/** Load the self-hosted display face once; listeners rebuild their cached layers. */
function loadDisplayFont(onReady: () => void): void {
  if (fontState === 'ready') return;
  fontListeners.push(onReady);
  if (fontState === 'loading') return;
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return;
  fontState = 'loading';
  const face = new FontFace(DISPLAY_FAMILY, `url(${import.meta.env.BASE_URL}${DISPLAY_FONT_URL})`, {
    weight: '700',
    style: 'normal',
    display: 'swap',
  });
  face
    .load()
    .then((loaded) => {
      document.fonts.add(loaded);
      fontState = 'ready';
      for (const fn of fontListeners.splice(0)) fn();
    })
    .catch(() => {
      // The fallback stack still reads fine; nothing to redo.
      fontState = 'idle';
    });
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

/** Break `text` into lines no wider than `maxW` in the current font (resize time only). */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? line + ' ' + word : word;
    if (line && ctx.measureText(next).width > maxW && lines.length < maxLines - 1) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Set letter-spacing where the browser supports it on canvas. */
function track(ctx: CanvasRenderingContext2D, value: string): void {
  if ('letterSpacing' in ctx) ctx.letterSpacing = value;
}

export function createRenderer(canvas: HTMLCanvasElement, labels: RenderLabels): Renderer {
  const ctx = canvas.getContext('2d')!;
  const layer = document.createElement('canvas');
  const lctx = layer.getContext('2d')!;
  let layerKey = -1;

  let L: Layout = computeLayout(1, 1);
  let dpr = 1;
  let olw = 2;
  let lb = 0;
  const fonts: Fonts = {
    take: '',
    word: '',
    count: '',
    leader: '',
    title: '',
    subtitle: '',
    caption: '',
    captionSmall: '',
    rec: '',
    end: '',
    lyric: '',
    chant: '',
    winnerLabel: '',
    winner: '',
    creditName: '',
    creditFact: '',
  };
  /** Pixel sizes of the big fonts, for their offset shadows and glows. */
  let wordPx = 16;
  let countPx = 60;
  let lyricPx = 30;
  let chantPx = 40;
  let titlePx = 40;
  let leaderPx = 60;
  let endPx = 24;
  let winnerPx = 40;
  let captionPx = 24;
  const captionW = new Float64Array(SEATS_N);
  // Display strings, upper-cased once at resize.
  let perfectText = '';
  let goodText = '';
  let missText = '';
  let countText: string[] = [];
  let lyricLines: string[][] = [];
  let chantText: string[] = [];
  let nameText: string[] = [];
  let instrText: string[] = [];
  let titleText = '';
  let subtitleText = '';
  let endText = '';
  let winnerText = '';
  let recText = '';
  let factLines: string[][] = [];
  let creditRowH = 0;
  let creditFactH = 0;
  let creditNameH = 0;

  // Scratch, reused every frame.
  const P = { x: 0, y: 0 };
  const nextIdx = new Int32Array(SEATS_N);
  const ballXY = new Float32Array(SEATS_N * MAX_BALLS * 2);
  const trailXY = new Float32Array(SEATS_N * MAX_BALLS * TRAIL * 2);
  const ballN = new Int32Array(SEATS_N);
  const fxIdx = new Int32Array(64);
  const fxStart = new Float64Array(64);
  const seatAlpha = new Float32Array(SEATS_N);
  let fxN = 0;
  let takeNum = -1;
  let takeText = '';

  function measureFonts(): void {
    const w = L.w;
    const h = L.h;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    track(ctx, TRACKING);
    perfectText = labels.perfect.toUpperCase();
    goodText = labels.good.toUpperCase();
    missText = labels.miss.toUpperCase();
    countText = labels.countIn.map((s) => s.toUpperCase());
    chantText = (labels.chant ?? []).map((s) => s.toUpperCase());
    nameText = labels.seats.map((s) => s.name.toUpperCase());
    instrText = labels.seats.map((s) => s.instrument.toUpperCase());
    titleText = labels.title.toUpperCase();
    subtitleText = labels.subtitle.toUpperCase();
    endText = labels.theEnd.toUpperCase();
    winnerText = (labels.winner ?? '').toUpperCase();
    recText = labels.rec.toUpperCase();
    let longest = perfectText;
    if (goodText.length > longest.length) longest = goodText;
    if (missText.length > longest.length) longest = missText;
    fonts.take = monoFont(Math.max(10, Math.min(L.headerH * 0.42, 14)), 600);
    fonts.word = fitFont(ctx, longest, L.colW * 0.94, Math.max(12, Math.min(30, L.colW * 0.15, L.cols[0]!.ringR * 1.3)), displayFont);
    wordPx = fontPx(fonts.word);
    let longestCount = '';
    for (const word of countText) if (word.length > longestCount.length) longestCount = word;
    fonts.count = fitFont(ctx, longestCount, w * 0.8, Math.min(L.laneTop * 0.7, w * 0.32), displayFont);
    countPx = fontPx(fonts.count);
    fonts.leader = fitFont(ctx, longestCount, Math.min(w, h) * 0.36, Math.min(h, w) * 0.22, displayFont);
    fonts.title = fitFont(ctx, labels.title.toUpperCase(), w * 0.84, Math.min(h * 0.11, 72), displayFont);
    fonts.subtitle = fitFont(ctx, labels.subtitle.toUpperCase(), w * 0.8, Math.min(h * 0.03, 16), monoFont);
    fonts.end = fitFont(ctx, labels.theEnd.toUpperCase(), w * 0.7, Math.min(h * 0.05, 30), displayFont);
    titlePx = fontPx(fonts.title);
    leaderPx = fontPx(fonts.leader);
    endPx = fontPx(fonts.end);
    fonts.rec = monoFont(Math.max(9, lb * 0.36), 700);
    let longestName = '';
    for (const s of nameText) if (s.length > longestName.length) longestName = s;
    fonts.caption = fitFont(ctx, longestName, w * 0.6, Math.max(16, Math.min(h * 0.06, 40)), displayFont);
    captionPx = fontPx(fonts.caption);
    fonts.captionSmall = monoFont(Math.max(10, Math.min(h * 0.024, 14)), 500);
    for (let i = 0; i < SEATS_N; i++) {
      ctx.font = fonts.caption;
      const a = ctx.measureText(nameText[i] ?? '').width;
      ctx.font = fonts.captionSmall;
      const b = ctx.measureText((labels.seats[i]?.instrument ?? '').toUpperCase()).width;
      captionW[i] = Math.min(w * 0.9, Math.max(a, b));
    }
    // Lyric lines: as large as two lines across the stage allow.
    const lyrics = labels.lyrics ?? [];
    let px = Math.min(h * 0.085, w * 0.075, 64);
    for (;;) {
      fonts.lyric = displayFont(px);
      ctx.font = fonts.lyric;
      let fits = true;
      lyricLines = [];
      for (const line of lyrics) {
        const lines = wrap(ctx, line.toUpperCase(), w * 0.88, 2);
        for (const l of lines) if (ctx.measureText(l).width > w * 0.9) fits = false;
        lyricLines.push(lines);
      }
      if (fits || px <= 12) break;
      px -= 2;
    }
    lyricPx = px;
    let longestChant = '';
    for (const line of chantText) if (line.length > longestChant.length) longestChant = line;
    fonts.chant = fitFont(ctx, longestChant, w * 0.9, Math.min(h * 0.13, 96), displayFont);
    chantPx = fontPx(fonts.chant);
    const cardW = Math.min(w * 0.94, 820);
    fonts.winnerLabel = fitFont(ctx, (labels.winner ?? '').toUpperCase(), cardW * 0.8, Math.max(10, Math.min(h * 0.026, 15)), monoFont);
    fonts.winner = fitFont(ctx, longestName, cardW * 0.8, Math.min(h * 0.085, 52), displayFont);
    winnerPx = fontPx(fonts.winner);
    const avail =
      h - lb * 2 - Math.max(14, h * 0.035) - Math.max(14, h * 0.04) - Math.max(18, h * 0.06) - Math.max(22, h * 0.06) - 24;
    creditNameH = Math.max(11, Math.min(20, (avail / 5) * 0.42));
    creditFactH = Math.max(9, Math.min(13, (avail / 5) * 0.26));
    fonts.creditName = displayFont(creditNameH);
    fonts.creditFact = monoFont(creditFactH, 400);
    ctx.font = fonts.creditFact;
    track(ctx, '0px');
    factLines = [];
    let maxLines = 1;
    for (let i = 0; i < SEATS_N; i++) {
      const fact = labels.seats[i]?.fact ?? '';
      const lines = fact ? wrap(ctx, fact, cardW * 0.86, 2) : [];
      factLines.push(lines);
      maxLines = Math.max(maxLines, lines.length);
    }
    creditRowH = creditNameH * 1.3 + creditFactH * 1.3 * maxLines + Math.max(4, h * 0.01);
  }

  /** The pixel size in a font string built by displayFont / monoFont. */
  function fontPx(font: string): number {
    const m = /(\d+)px/.exec(font);
    return m ? Number(m[1]) : 16;
  }

  function resize(width: number, height: number, ratio: number): void {
    dpr = Math.min(2, Math.max(1, ratio || 1));
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    layer.width = canvas.width;
    layer.height = canvas.height;
    L = computeLayout(w, h);
    olw = outlineWidth(L);
    lb = Math.round(h * 0.075);
    layerKey = -1;
    measureFonts();
    loadDisplayFont(refreshFonts);
  }

  /** The display face arrived: re-measure the text and repaint the cached layer. */
  function refreshFonts(): void {
    measureFonts();
    layerKey = -1;
  }

  function ensureLayer(key: number, humans: number, remote: number, pads: boolean): void {
    if (key === layerKey) return;
    layerKey = key;
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    track(lctx, TRACKING);
    drawScenery(lctx, L, labels, humans, remote, pads);
  }

  /**
   * Display type as in the video: a hard dark offset shadow, a soft glow in
   * the line's colour, then the colour itself.
   */
  function shout(text: string, x: number, y: number, colour: string, px: number): void {
    const d = Math.max(2, px * 0.06);
    ctx.fillStyle = BLACK;
    ctx.fillText(text, x + d, y + d);
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * 0.35;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(3, px * 0.16);
    ctx.strokeText(text, x, y);
    ctx.globalAlpha = a;
    ctx.fillStyle = colour;
    ctx.fillText(text, x, y);
  }

  // ---- top band ---------------------------------------------------------------

  function drawTopBand(frame: Frame): void {
    // Song progress as a hairline just inside the frame's top edge.
    const k = L.frameInset + 2;
    const prog = clamp01(frame.t / SONG_S);
    ctx.fillStyle = CREAM_DIM;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(k, k, L.w - k * 2, 2);
    ctx.globalAlpha = 1;
    if (prog > 0) {
      ctx.fillStyle = TEAL;
      ctx.fillRect(k, k, (L.w - k * 2) * prog, 2);
    }
    if (frame.takeNumber !== takeNum) {
      takeNum = frame.takeNumber;
      takeText = labels.take.toUpperCase() + ' ' + String(takeNum);
    }
    ctx.font = fonts.take;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = BLACK;
    ctx.fillText(takeText, L.takeX + 5 + 1, L.takeY + 6 + 1);
    ctx.fillStyle = CREAM;
    ctx.fillText(takeText, L.takeX + 5, L.takeY + 6);
  }

  /** The oscilloscope: a green trace driven by the groove and the beat. */
  function drawScope(frame: Frame, clock: number): void {
    const s = L.scope;
    const beat = clock / BEAT_S;
    const kick = 1 - (beat - Math.floor(beat));
    const amp = s.h * 0.36 * (0.2 + 0.8 * clamp01(frame.groove)) * (0.6 + 0.4 * kick * kick);
    ctx.beginPath();
    const n = 40;
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      const x = s.x + 3 + (s.w - 6) * u;
      const y = s.y + s.h / 2 + Math.sin(u * 13 - clock * 8) * amp;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineJoin = 'round';
    ctx.strokeStyle = SCOPE_GREEN;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // ---- notes ----------------------------------------------------------------

  function burstStart(frame: Frame, i: number, seat: number): number {
    const n = NOTES[i]!;
    const sf = frame.seats[seat];
    if (sf && Math.abs(sf.hitAt - n.t) <= GOOD_S) return Math.min(sf.hitAt, n.t);
    return n.t;
  }

  function pushFx(i: number, start: number): void {
    if (fxN >= fxIdx.length) return;
    fxIdx[fxN] = i;
    fxStart[fxN] = start;
    fxN++;
  }

  /** Sort the visible notes into electrons on lanes, bursts and falls. */
  function collectNotes(frame: Frame): void {
    const t = frame.t;
    ballN.fill(0);
    nextIdx.fill(-1);
    fxN = 0;
    const grades = frame.grades;
    const gap = L.ballR * 1.5;
    for (let i = lowerBound(t - TAIL_S); i < NOTES.length; i++) {
      const n = NOTES[i]!;
      const dt = n.t - t;
      if (dt > LEAD_S) break;
      const seat = n.seat;
      const col = L.cols[seat]!;
      const g = grades[i] ?? PENDING;
      if (nextIdx[seat]! < 0 && (dt > 0 || (g === PENDING && dt > -GOOD_S))) nextIdx[seat] = i;
      if (g === GOOD || g === PERFECT) {
        const bs = burstStart(frame, i, seat);
        if (t >= bs) {
          if (t - bs < BURST_S) pushFx(i, bs);
          continue;
        }
      } else if (g === MISS && dt < -GOOD_S) {
        if (-dt - GOOD_S < FALL_S) pushFx(i, n.t + GOOD_S);
        continue;
      }
      const k = ballN[seat]!;
      if (k >= MAX_BALLS) continue;
      const o = (seat * MAX_BALLS + k) * 2;
      const to = (seat * MAX_BALLS + k) * TRAIL * 2;
      if (dt >= 0) {
        const s = col.chute.length * (1 - dt / LEAD_S);
        pointAt(col.chute, s, P);
        ballXY[o] = P.x;
        ballXY[o + 1] = P.y;
        for (let j = 0; j < TRAIL; j++) {
          pointAt(col.chute, s - gap * (j + 1), P);
          trailXY[to + j * 2] = P.x;
          trailXY[to + j * 2 + 1] = P.y;
        }
      } else {
        // Arrived but unsettled: it rolls just past the centre and waits.
        const y = col.ringY + col.ringR * 0.7 * (1 - Math.exp(dt / 0.06));
        ballXY[o] = col.ringX;
        ballXY[o + 1] = y;
        for (let j = 0; j < TRAIL; j++) {
          trailXY[to + j * 2] = col.ringX;
          trailXY[to + j * 2 + 1] = y;
        }
      }
      ballN[seat] = k + 1;
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
      const r = col.ringR * (1 + 2 * k);
      const lw = Math.max(4, col.ringR * 0.26);
      const base = (calm ? 0.55 : human || frame.mode === 'video' ? 1 : 0.5) * seatAlpha[seat]!;
      const a = base * (0.45 + 0.55 * (1 - k));
      const colour = Math.abs(dt) <= PERFECT_S ? GOLD : SEAT_GLOW[seat]!;
      ctx.beginPath();
      ctx.arc(col.ringX, col.ringY, r, 0, TAU);
      ctx.globalAlpha = a * 0.85;
      ctx.strokeStyle = BLACK;
      ctx.lineWidth = lw + 4;
      ctx.stroke();
      ctx.globalAlpha = a * 0.25;
      ctx.strokeStyle = colour;
      ctx.lineWidth = lw * 2.6;
      ctx.stroke();
      ctx.globalAlpha = a;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Gold electrons, every seat: trail, glow, dark rim, gold body, hot core. */
  function drawElectrons(): void {
    const r = L.ballR;
    for (let seat = 0; seat < SEATS_N; seat++) {
      const n = ballN[seat]!;
      if (n === 0) continue;
      const a = seatAlpha[seat]!;
      const base = seat * MAX_BALLS;
      for (let j = 0; j < TRAIL; j++) {
        const tr = r * (0.78 - j * 0.2);
        ctx.beginPath();
        for (let k = 0; k < n; k++) {
          const o = ((base + k) * TRAIL + j) * 2;
          const x = trailXY[o]!;
          const y = trailXY[o + 1]!;
          ctx.moveTo(x + tr, y);
          ctx.arc(x, y, tr, 0, TAU);
        }
        ctx.globalAlpha = a * (0.5 - j * 0.14);
        ctx.fillStyle = GOLD;
        ctx.fill();
      }
      ctx.beginPath();
      for (let k = 0; k < n; k++) {
        const x = ballXY[(base + k) * 2]!;
        const y = ballXY[(base + k) * 2 + 1]!;
        ctx.moveTo(x + r * 2, y);
        ctx.arc(x, y, r * 2, 0, TAU);
      }
      ctx.globalAlpha = a * 0.22;
      ctx.fill();
      ctx.beginPath();
      for (let k = 0; k < n; k++) {
        const x = ballXY[(base + k) * 2]!;
        const y = ballXY[(base + k) * 2 + 1]!;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TAU);
      }
      ctx.globalAlpha = a;
      ctx.strokeStyle = BLACK;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fill();
      ctx.beginPath();
      const cr = r * 0.42;
      for (let k = 0; k < n; k++) {
        const x = ballXY[(base + k) * 2]! - r * 0.2;
        const y = ballXY[(base + k) * 2 + 1]! - r * 0.2;
        ctx.moveTo(x + cr, y);
        ctx.arc(x, y, cr, 0, TAU);
      }
      ctx.fillStyle = CREAM;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** A hit: the reticle fills, a gold burst, and the electron rises out of the lane. */
  function drawHit(frame: Frame, col: Column, i: number, age: number): void {
    const seat = col.seat;
    const sa = seatAlpha[seat]!;
    const a = fade(age, BURST_S) * sa;
    const u = age / BURST_S;
    const perfect = frame.grades[i] === PERFECT;
    const sparks = frame.reducedMotion ? 4 : frame.mode === 'idle' ? 6 : 10;
    // The reticle fills with the seat's colour (gold for a perfect).
    ctx.beginPath();
    ctx.arc(col.ringX, col.ringY, col.ringR * 0.9, 0, TAU);
    ctx.globalAlpha = a * 0.85;
    ctx.fillStyle = perfect ? GOLD : SEAT_GLOW[seat]!;
    ctx.fill();
    // Expanding gold ring.
    ctx.beginPath();
    ctx.arc(col.ringX, col.ringY, col.ringR * (1.1 + u * 1.5), 0, TAU);
    ctx.globalAlpha = a;
    ctx.strokeStyle = BLACK;
    ctx.lineWidth = Math.max(3, col.ringR * 0.3 * (1 - u)) + 3;
    ctx.stroke();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = Math.max(3, col.ringR * 0.3 * (1 - u));
    ctx.stroke();
    // Gold rays.
    ctx.beginPath();
    for (let k = 0; k < sparks; k++) {
      const ang = ((k + hash(i, k) * 0.5) / sparks) * TAU;
      const d0 = col.ringR * (1.3 + u * 1.8 * (0.6 + hash(k, i)));
      const d1 = d0 + col.ringR * 0.6 * (1 - u);
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      ctx.moveTo(col.ringX + c * d0, col.ringY + s * d0);
      ctx.lineTo(col.ringX + c * d1, col.ringY + s * d1);
    }
    ctx.lineCap = 'round';
    ctx.strokeStyle = BLACK;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 3;
    ctx.stroke();
    // The electron leaves the lane, rising into the reactor above.
    if (age > 0.04) {
      const v = clamp01((age - 0.04) / (BURST_S - 0.04));
      const e = v * v;
      const tx = L.w / 2 + (seat - 2) * L.w * 0.07;
      const ty = L.laneTop * 0.55;
      const x = (1 - e) * (1 - e) * col.ringX + 2 * (1 - e) * e * col.ringX + e * e * tx;
      const y = (1 - e) * (1 - e) * col.ringY + 2 * (1 - e) * e * L.laneTop + e * e * ty;
      const r = L.ballR * (1 - 0.4 * v);
      ctx.globalAlpha = (1 - v * 0.7) * sa * 0.3;
      ctx.beginPath();
      ctx.arc(x, y, r * 2, 0, TAU);
      ctx.fillStyle = GOLD;
      ctx.fill();
      ctx.globalAlpha = (1 - v * 0.7) * sa;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.8, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** A miss: the electron goes dark and falls away with gravity. */
  function drawMiss(col: Column, i: number, age: number): void {
    const a = fade(age, FALL_S) * seatAlpha[col.seat]!;
    const x = col.ringX + (hash(i, 7) - 0.5) * col.ringR * 2 * age;
    const y = col.ringY + col.ringR * 0.7 + age * col.ringR * 2 + 0.5 * L.h * 1.6 * age * age;
    ctx.globalAlpha = a * 0.85;
    ctx.beginPath();
    ctx.arc(x, y, L.ballR, 0, TAU);
    ctx.fillStyle = CREAM_DIM;
    ctx.fill();
    ctx.strokeStyle = BLACK;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawFx(frame: Frame): void {
    const t = frame.t;
    for (let f = 0; f < fxN; f++) {
      const i = fxIdx[f]!;
      const col = L.cols[NOTES[i]!.seat]!;
      const age = t - fxStart[f]!;
      if (frame.grades[i] === MISS) drawMiss(col, i, age);
      else drawHit(frame, col, i, age);
    }
  }

  // ---- seats ----------------------------------------------------------------

  function drawGlyphs(frame: Frame): void {
    const t = frame.t;
    for (let seat = 0; seat < SEATS_N; seat++) {
      const col = L.cols[seat]!;
      const sf = frame.seats[seat];
      const hitAge = sf && t >= sf.hitAt ? t - sf.hitAt : Infinity;
      const missAge = sf && t >= sf.missAt ? t - sf.missAt : Infinity;
      const pulse = hitAge < 0.6 ? Math.exp(-hitAge * 6) : 0;
      const dim = missAge < 0.5 ? 1 - missAge / 0.5 : 0;
      drawGlyph(ctx, seat, col.glyphX, col.glyphY, col.glyphSize, pulse, dim, Math.max(2.5, olw * 1.2), seatAlpha[seat]!);
    }
  }

  function drawWords(frame: Frame): void {
    const t = frame.t;
    ctx.font = fonts.word;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let seat = 0; seat < SEATS_N; seat++) {
      const sf = frame.seats[seat];
      if (!sf) continue;
      const col = L.cols[seat]!;
      const hitAge = t - sf.hitAt;
      const missAge = t - sf.missAt;
      const showHit = hitAge >= 0 && hitAge < WORD_S;
      const showMiss = missAge >= 0 && missAge < WORD_S && !(showHit && hitAge < missAge);
      const base = col.ringY - col.ringR * 2.1;
      if (showHit) {
        const perfect = sf.hitGrade === PERFECT;
        ctx.globalAlpha = fade(hitAge, WORD_S) * seatAlpha[seat]!;
        shout(perfect ? perfectText : goodText, col.cx, base - hitAge * col.ringR * 2.2, perfect ? GOLD : TEAL, wordPx);
      } else if (showMiss) {
        ctx.globalAlpha = fade(missAge, WORD_S) * seatAlpha[seat]!;
        shout(missText, col.cx, base - missAge * col.ringR * 1.2, CORAL, wordPx);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawPressedPads(frame: Frame): void {
    const t = frame.t;
    for (let seat = 0; seat < SEATS_N; seat++) {
      if (!frame.humans[seat]) continue;
      const sf = frame.seats[seat];
      if (!sf) continue;
      const age = t - sf.pressAt;
      if (!(age >= 0 && age < PRESS_S)) continue;
      const k = 1 - age / PRESS_S;
      const p = L.cols[seat]!.pad;
      ctx.globalAlpha = 0.4 * k;
      ctx.fillStyle = CREAM;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.globalAlpha = k;
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 3;
      ctx.strokeRect(p.x - 1.5, p.y - 1.5, p.w + 3, p.h + 3);
    }
    ctx.globalAlpha = 1;
  }

  // ---- big moments ----------------------------------------------------------

  function drawFinale(frame: Frame): void {
    const age0 = frame.t - SONG_S;
    if (age0 < 0 || age0 > FINALE_S + 1.3) return;
    const per = frame.reducedMotion ? 4 : frame.mode === 'idle' ? 6 : 12;
    const waves = 5;
    const ox = L.w / 2;
    const oy = L.laneTop * 0.5;
    const speed = Math.max(L.w, L.h) * 0.55;
    const g = L.h * 1.1;
    const r = L.ballR;
    ctx.fillStyle = GOLD;
    for (let wv = 0; wv < waves; wv++) {
      const a = age0 - wv * (FINALE_S / waves);
      if (a < 0 || a > 1.3) continue;
      ctx.beginPath();
      for (let k = 0; k < per; k++) {
        const ang = hash(wv * 31 + k, 11) * TAU;
        const v = speed * (0.3 + 0.7 * hash(k, wv * 7 + 3));
        const x = ox + Math.cos(ang) * v * a;
        const y = oy + Math.sin(ang) * v * a * 0.6 + 0.5 * g * a * a;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TAU);
      }
      ctx.globalAlpha = 1 - a / 1.3;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function countIndex(t: number): number {
    const beats = (t + COUNT_IN_S) / BEAT_S;
    const n = countText.length;
    if (n === 0 || beats < 0) return -1;
    return Math.min(n - 1, Math.floor(beats));
  }

  function drawCount(frame: Frame): void {
    const idx = countIndex(frame.t);
    if (idx < 0) return;
    const beats = (frame.t + COUNT_IN_S) / BEAT_S;
    const frac = beats - Math.floor(beats);
    const pop = frame.reducedMotion ? 1 : 1 + 0.3 * (1 - frac) * (1 - frac) * (1 - frac);
    ctx.save();
    ctx.translate(L.w / 2, L.laneTop * 0.55);
    ctx.scale(pop, pop);
    ctx.font = fonts.count;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 1 - frac * 0.3;
    const last = idx === countText.length - 1;
    shout(countText[idx]!, 0, 0, last ? GOLD : LINE_COLOURS[idx % 3]!, countPx);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** A dark glass panel in a coral frame line. */
  function panel(x: number, y: number, w: number, h: number, edge: string): void {
    ctx.fillStyle = GLASS;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  /** Film leader during the video's count-in: rings, crosshair, sweep, count; title above. */
  function drawLeader(frame: Frame): void {
    const idx = countIndex(frame.t);
    const w = L.w;
    const h = L.h;
    const titleY = lb + Math.max(20, h * 0.12);
    ctx.font = fonts.title;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    shout(titleText, w / 2, titleY, CORAL, titlePx);
    ctx.font = fonts.subtitle;
    ctx.fillStyle = TEAL;
    ctx.fillText(subtitleText, w / 2, titleY + titlePx * 0.75);
    const top = titleY + titlePx * 1.1;
    const cx = w / 2;
    const cy = (top + h - lb) / 2;
    const r = Math.min(w * 0.4, (h - lb - top) * 0.42);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.05, 0, TAU);
    ctx.fillStyle = GLASS;
    ctx.fill();
    if (idx >= 0) {
      const beats = (frame.t + COUNT_IN_S) / BEAT_S;
      const frac = beats - Math.floor(beats);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * TAU);
      ctx.closePath();
      ctx.fillStyle = TEAL;
      ctx.globalAlpha = 0.25;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.moveTo(cx + r * 0.78, cy);
    ctx.arc(cx, cy, r * 0.78, 0, TAU);
    ctx.moveTo(cx - r * 1.25, cy);
    ctx.lineTo(cx + r * 1.25, cy);
    ctx.moveTo(cx, cy - r * 1.15);
    ctx.lineTo(cx, cy + r * 1.15);
    ctx.strokeStyle = CORAL;
    ctx.lineWidth = 3;
    ctx.stroke();
    if (idx >= 0) {
      ctx.font = fonts.leader;
      shout(countText[idx]!, cx, cy, idx === countText.length - 1 ? GOLD : CREAM, leaderPx);
    }
  }

  /** Lyric lines, as in the video: huge condensed caps, lower third, one colour per line. */
  function drawLyric(frame: Frame): void {
    const n = lyricLines.length;
    if (n === 0 || frame.shot !== null) return;
    const bar = frame.t / BAR_S;
    if (bar < LYRIC_FROM_BAR || bar >= LYRIC_TO_BAR) return;
    const span = (LYRIC_TO_BAR - LYRIC_FROM_BAR) / n;
    const idx = Math.min(n - 1, Math.floor((bar - LYRIC_FROM_BAR) / span));
    const into = (bar - LYRIC_FROM_BAR - idx * span) * BAR_S;
    const left = span * BAR_S - into;
    const a = clamp01(Math.min(into, left) / 0.25);
    if (a <= 0) return;
    const lines = lyricLines[idx]!;
    const lineH = lyricPx * 1.12;
    const y0 = L.h - lb - Math.max(12, L.h * 0.06) - lineH * (lines.length - 0.5);
    ctx.font = fonts.lyric;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = a;
    const colour = LINE_COLOURS[idx % 3]!;
    for (let k = 0; k < lines.length; k++) shout(lines[k]!, L.w / 2, y0 + k * lineH, colour, lyricPx);
    ctx.globalAlpha = 1;
  }

  function drawChant(frame: Frame): void {
    if (chantText.length === 0) return;
    const into = frame.t - (BARS - 1) * BAR_S;
    if (into < 0 || frame.t >= CREDITS_AT) return;
    const idx = Math.min(chantText.length - 1, Math.floor(into / (4 * STEP_S)));
    const age = into - idx * 4 * STEP_S;
    const pop = frame.reducedMotion ? 1 : 1 + 0.2 * Math.max(0, 1 - age / 0.15);
    ctx.save();
    ctx.translate(L.w / 2, L.h - lb - Math.max(12, L.h * 0.06) - chantPx * 0.6);
    ctx.scale(pop, pop);
    ctx.font = fonts.chant;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    shout(chantText[idx]!, 0, 0, LINE_COLOURS[(idx + 1) % 3]!, chantPx);
    ctx.restore();
  }

  function drawCredits(frame: Frame): void {
    const w = L.w;
    const h = L.h;
    const cw = Math.min(w * 0.94, 820);
    const leader = frame.leader;
    const winner = leader !== undefined && leader !== null ? labels.seats[leader] : undefined;
    const contentH =
      Math.max(14, h * 0.035) +
      (winner ? Math.max(14, h * 0.04) + Math.max(18, h * 0.06) + Math.max(22, h * 0.06) : 0) +
      creditNameH * 0.9 +
      creditRowH * SEATS_N;
    const room = h - lb * 2 - Math.max(12, h * 0.04);
    const ch = Math.min(room, contentH + Math.max(30, h * 0.06));
    const top = h / 2 - ch / 2;
    const bottom = h / 2 + ch / 2;
    ctx.globalAlpha = clamp01((frame.t - CREDITS_AT) / 0.4);
    panel(w / 2 - cw / 2, top, cw, ch, CORAL);
    const x0 = w / 2 - cw / 2 + Math.max(12, cw * 0.05);
    ctx.textBaseline = 'middle';
    let y = top + Math.max(16, h * 0.035);
    ctx.textAlign = 'center';
    ctx.font = fonts.end;
    shout(endText, w / 2, y, CORAL, endPx);
    if (winner && leader !== undefined && leader !== null) {
      y += Math.max(14, h * 0.04);
      ctx.font = fonts.winnerLabel;
      ctx.fillStyle = TEAL;
      ctx.fillText(winnerText, w / 2, y);
      y += Math.max(18, h * 0.06);
      ctx.font = fonts.winner;
      shout(nameText[leader] ?? '', w / 2, y, GOLD, winnerPx);
      y += Math.max(22, h * 0.06);
    }
    ctx.textAlign = 'left';
    y += creditNameH * 0.9;
    for (let i = 0; i < SEATS_N; i++) {
      const lines = factLines[i];
      const n = lines ? lines.length : 0;
      ctx.fillStyle = SEAT_GLOW[i]!;
      ctx.fillRect(x0, y - creditNameH * 0.5, 4, creditNameH + creditFactH * 1.3 * n);
      ctx.font = fonts.creditName;
      ctx.fillStyle = SEAT_GLOW[i]!;
      ctx.fillText(nameText[i] ?? '', x0 + 12, y);
      ctx.font = fonts.creditFact;
      ctx.fillStyle = CREAM_DIM;
      track(ctx, '0px');
      for (let k = 0; k < n; k++) ctx.fillText(lines![k]!, x0 + 12, y + creditNameH * 0.95 + creditFactH * 1.3 * k);
      track(ctx, TRACKING);
      y += creditRowH;
      if (y > bottom) break;
    }
    ctx.globalAlpha = 1;
  }

  /** Close-up: brackets around the featured lane and a caption beside it. */
  function drawCloseUp(seat: number): void {
    const s = labels.seats[seat];
    const col = L.cols[seat];
    if (!s || !col) return;
    const w = L.w;
    const h = L.h;
    const colour = SEAT_GLOW[seat]!;
    const x0 = col.x0 + 4;
    const x1 = col.x1 - 4;
    const y0 = L.laneTop - 8;
    const y1 = h - lb - 6;
    const k = Math.min(28, L.colW * 0.22);
    ctx.beginPath();
    ctx.moveTo(x0, y0 + k);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x0 + k, y0);
    ctx.moveTo(x1 - k, y0);
    ctx.lineTo(x1, y0);
    ctx.lineTo(x1, y0 + k);
    ctx.moveTo(x0, y1 - k);
    ctx.lineTo(x0, y1);
    ctx.lineTo(x0 + k, y1);
    ctx.moveTo(x1 - k, y1);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1, y1 - k);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = BLACK;
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = colour;
    ctx.lineWidth = 4;
    ctx.stroke();
    const pad = Math.max(8, h * 0.018);
    const bw = (captionW[seat] ?? 100) + pad * 2 + 10;
    const bh = Math.max(40, h * 0.12);
    const leftSide = col.cx > w / 2;
    const x = leftSide ? Math.max(10, col.x0 - bw - 12) : Math.min(w - bw - 10, col.x1 + 12);
    const y = L.laneTop - bh - Math.max(8, h * 0.02);
    panel(x, y, bw, bh, colour);
    ctx.fillStyle = colour;
    ctx.fillRect(x, y, 6, bh);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = fonts.caption;
    shout(nameText[seat] ?? '', x + pad + 8, y + bh * 0.4, CREAM, captionPx);
    ctx.font = fonts.captionSmall;
    ctx.fillStyle = colour;
    ctx.fillText(instrText[seat] ?? '', x + pad + 8, y + bh * 0.78);
  }

  function drawVideoOverlay(frame: Frame): void {
    const w = L.w;
    const h = L.h;
    const t = frame.t;
    if (t < 0) drawLeader(frame);
    else if (t >= CREDITS_AT) drawCredits(frame);
    else {
      drawChant(frame);
      drawLyric(frame);
      if (frame.shot !== null) drawCloseUp(frame.shot);
    }
    ctx.fillStyle = BLACK;
    ctx.fillRect(0, 0, w, lb);
    ctx.fillRect(0, h - lb, w, lb);
    if (frame.recording && frame.now - Math.floor(frame.now) < 0.6) {
      const r = lb * 0.16;
      const x = Math.max(14, w * 0.025);
      ctx.beginPath();
      ctx.arc(x + r, lb / 2, r, 0, TAU);
      ctx.fillStyle = CORAL;
      ctx.fill();
      ctx.font = fonts.rec;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = CREAM;
      ctx.fillText(recText, x + r * 2 + 6, lb / 2 + 1);
    }
  }

  // ---- frame ----------------------------------------------------------------

  function draw(frame: Frame): void {
    const t = frame.t;
    const video = frame.mode === 'video';
    let humans = 0;
    let remote = 0;
    const rem = frame.remote;
    for (let i = 0; i < SEATS_N; i++) {
      if (frame.humans[i]) humans |= 1 << i;
      if (rem && rem[i]) remote |= 1 << i;
    }
    ensureLayer(humans | (remote << 5) | (video ? 0 : 1 << 10), humans, remote, !video);

    // In a video close-up the featured lane stays lit and the others dim.
    const shot = video && t >= 0 && t < CREDITS_AT ? frame.shot : null;
    for (let i = 0; i < SEATS_N; i++) seatAlpha[i] = shot === null || shot === i ? 1 : DIMMED;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, L.w, L.h);
    if (shot === null) {
      ctx.drawImage(layer, 0, 0, L.w, L.h);
    } else {
      // Blit the static layer a column at a time so each lane takes its own alpha.
      for (let i = 0; i < SEATS_N; i++) {
        const col = L.cols[i]!;
        ctx.globalAlpha = seatAlpha[i]!;
        const sx = col.x0 * dpr;
        const sw = Math.min(layer.width - sx, L.colW * dpr);
        ctx.drawImage(layer, sx, 0, sw, layer.height, col.x0, 0, sw / dpr, L.h);
      }
      ctx.globalAlpha = 1;
    }

    const clock = frame.mode === 'idle' ? frame.now : t;
    drawScope(frame, clock);
    if (!video) {
      drawTopBand(frame);
      drawPressedPads(frame);
    }
    collectNotes(frame);
    drawApproach(frame);
    drawElectrons();
    drawGlyphs(frame);
    drawFx(frame);
    drawWords(frame);
    drawFinale(frame);
    if (video) drawVideoOverlay(frame);
    else if (t < 0 && frame.mode === 'take') drawCount(frame);
  }

  function seatAt(x: number, y: number): number | null {
    return layoutSeatAt(L, x, y);
  }

  return { resize, draw, seatAt };
}
