/**
 * Dev harness for the renderer: draws fake frames so the scene can be checked
 * without the rest of the game. Open /render-preview.html with URL params:
 *
 *   mode=idle|take|video   t=<song seconds>   shot=<seat>|wide
 *   size=1400x700          dpr=2              humans=11010
 *   groove=0.8             rm=1 (reduced motion)  rec=1
 *   play=1  (animate from t)     bench=600  (time that many draw() calls)
 */
import { GOOD, GOOD_S, MISS, PENDING, PERFECT } from '../engine';
import { createRenderer } from '../render';
import { BAR_S, NOTES, SEATS } from '../score';
import type { Frame, FrameMode, RenderLabels, SeatFrame } from '../types';

const q = new URLSearchParams(location.search);
const mode = (q.get('mode') ?? 'take') as FrameMode;
const t0 = Number(q.get('t') ?? '30');
const shotParam = q.get('shot');
const shot = shotParam === null || shotParam === 'wide' ? null : Number(shotParam);
const [sw, sh] = (q.get('size') ?? `${innerWidth}x${innerHeight}`).split('x').map(Number) as [number, number];
const dpr = Number(q.get('dpr') ?? String(devicePixelRatio || 1));
const humansBits = q.get('humans') ?? '11010';
const humans = SEATS.map((_, i) => humansBits[i] === '1');
const groove = Number(q.get('groove') ?? '0.8');

const labels: RenderLabels = {
  seats: [
    { key: 'A', name: 'Geobacter', instrument: 'nanowire bass' },
    { key: 'S', name: 'Shewanella', instrument: 'flavin keys' },
    { key: 'D', name: 'Reed mannagrass', instrument: 'leaf chimes' },
    { key: 'F', name: 'Sporomusa', instrument: 'vinegar drum' },
    { key: 'G', name: 'Methanobacterium', instrument: 'bubble tuba' },
  ],
  perfect: 'PERFECT',
  good: 'GOOD',
  miss: 'MISS',
  machine: 'MACHINE',
  take: 'TAKE',
  onAir: 'ON AIR',
  countIn: ['4', '3', '2', 'GO'],
  title: 'Invisible Heroes',
  subtitle: 'The Biofilm Band',
  rec: 'REC',
  theEnd: 'THE END',
};

function h01(a: number, b: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** What each note would end up as in a decent take. */
const decided = new Uint8Array(NOTES.length);
const offset = new Float64Array(NOTES.length);
for (const n of NOTES) {
  if (!humans[n.seat] || mode === 'idle') {
    decided[n.i] = PERFECT;
    continue;
  }
  const r = h01(n.i, 1);
  decided[n.i] = r < 0.65 ? PERFECT : r < 0.88 ? GOOD : MISS;
  offset[n.i] = (h01(n.i, 2) - 0.5) * (decided[n.i] === PERFECT ? 0.1 : 0.28);
}

const grades = new Uint8Array(NOTES.length);
const seats: SeatFrame[] = SEATS.map(() => ({ hitAt: -Infinity, hitGrade: GOOD, missAt: -Infinity, pressAt: -Infinity }));
const frame: Frame = {
  mode,
  t: t0,
  now: 0,
  humans,
  grades,
  seats,
  groove,
  streak: 7,
  takeNumber: 3,
  shot,
  recording: q.get('rec') === '1',
  reducedMotion: q.get('rm') === '1',
};

/** Fill grades and seats for song time t (outside the timed section). */
function fill(t: number, now: number): void {
  frame.t = t;
  frame.now = now;
  for (const s of seats) {
    s.hitAt = -Infinity;
    s.missAt = -Infinity;
    s.pressAt = -Infinity;
  }
  for (const n of NOTES) {
    const d = decided[n.i]!;
    let g: number = d;
    const hitTime = n.t + offset[n.i]!;
    if (mode === 'take') {
      if (humans[n.seat]) {
        if (d === MISS) g = t > n.t + GOOD_S ? MISS : PENDING;
        else g = t >= hitTime ? d : PENDING;
      } else {
        g = t >= n.t ? d : PENDING;
      }
    }
    grades[n.i] = g;
    if (n.t > t + 0.2) continue;
    const s = seats[n.seat]!;
    if ((g === GOOD || g === PERFECT) && hitTime <= t) {
      s.hitAt = humans[n.seat] && mode !== 'idle' ? hitTime : n.t;
      s.hitGrade = g;
      s.pressAt = s.hitAt;
    } else if (g === MISS && n.t + GOOD_S <= t) {
      s.missAt = n.t + GOOD_S;
    }
  }
}

const canvas = document.getElementById('stage') as HTMLCanvasElement;
canvas.style.width = `${sw}px`;
canvas.style.height = `${sh}px`;
const renderer = createRenderer(canvas, labels);
renderer.resize(sw, sh, dpr);

declare global {
  interface Window {
    __bench?: { n: number; mean: number; p95: number; worst: number; first: number };
    __ready?: boolean;
  }
}

const bench = Number(q.get('bench') ?? '0');
/** raf=1 paces the timed draws on requestAnimationFrame (as the game does); flush=1 adds a 1px readback so the time includes rasterising. */
const paced = q.get('raf') === '1';
const flush = q.get('flush') === '1';
const probe = flush ? canvas.getContext('2d')! : null;

function step(k: number): number {
  const t = t0 + k / 60;
  fill(t, 10 + k / 60);
  if (mode === 'video' && shotParam === 'cycle') {
    const bar = Math.floor(t / BAR_S);
    frame.shot = bar % 2 ? bar % 5 : null;
  }
  const a = performance.now();
  renderer.draw(frame);
  if (probe) probe.getImageData(0, 0, 1, 1);
  return performance.now() - a;
}

function report(times: number[], first: number): void {
  times.sort((x, y) => x - y);
  const mean = times.reduce((x, y) => x + y, 0) / times.length;
  window.__bench = {
    n: times.length,
    mean,
    p95: times[Math.floor(times.length * 0.95)]!,
    worst: times[times.length - 1]!,
    first,
  };
  document.getElementById('stats')!.textContent = JSON.stringify(window.__bench);
  window.__ready = true;
}

if (bench > 0) {
  const times: number[] = [];
  const first = step(0);
  if (paced) {
    let k = 1;
    const tick = (): void => {
      times.push(step(k++));
      if (k <= bench) requestAnimationFrame(tick);
      else report(times, first);
    };
    requestAnimationFrame(tick);
  } else {
    for (let k = 1; k <= bench; k++) times.push(step(k));
    report(times, first);
  }
} else if (q.get('play') === '1') {
  const start = performance.now();
  const loop = (): void => {
    const el = (performance.now() - start) / 1000;
    let t = t0 + el;
    if (mode === 'idle') t = t0 + (el % (4 * BAR_S));
    fill(t, el);
    if (mode === 'video' && shotParam === 'cycle') frame.shot = Math.floor(t / BAR_S) % 2 ? Math.floor(t / BAR_S) % 5 : null;
    renderer.draw(frame);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.__ready = true;
} else {
  // A still: settle the camera with a few frames leading up to t.
  for (let k = 20; k >= 0; k--) {
    fill(t0 - k / 60, 10 - k / 60);
    renderer.draw(frame);
  }
  window.__ready = true;
}
