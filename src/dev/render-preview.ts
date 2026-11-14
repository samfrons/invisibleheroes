/**
 * Dev harness for the renderer: draws fake frames so the scene can be checked
 * without the rest of the game. Open /render-preview.html with URL params:
 *
 *   mode=idle|take|video   t=<song seconds>   shot=<seat>|wide
 *   size=1400x700          dpr=2              humans=11010
 *   groove=0.8             rm=1 (reduced motion)  rec=1
 *   remote=00100 (seats played from a phone)
 *   play=1  (animate from t)     bench=600  (time that many draw() calls)
 *   raf=1 (pace the bench on requestAnimationFrame)
 */
import { GOOD, GOOD_S, MISS, PENDING, PERFECT } from '../engine';
import { createCell } from '../kinetics';
import { createRenderer } from '../render';
import { DISPLAY_FAMILY } from '../render/style';
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
const remoteBits = q.get('remote') ?? '00100';
const remote = SEATS.map((_, i) => remoteBits[i] === '1' && humans[i] === true);

const labels: RenderLabels = {
  seats: [
    { key: 'A', name: 'Geo', instrument: 'nanowire bass', fact: 'Geobacter passes electrons along wires it grows itself.' },
    { key: 'S', name: 'Shiva', instrument: 'flavin keys', fact: 'Shewanella sends out yellow shuttles that carry its electrons.' },
    { key: 'D', name: 'Rhodo', instrument: 'sunlight chimes', fact: 'Rhodo runs on sunlight, so it plays brighter as the day goes on.' },
    {
      key: 'F',
      name: 'Sporo',
      instrument: 'vinegar drum',
      fact: 'Sporomusa turns electrons and carbon dioxide into acetate, the acid in vinegar.',
    },
    {
      key: 'G',
      name: 'Cable',
      instrument: 'cable tuba',
      fact: 'Cable bacteria are long chains of cells that conduct electrons end to end.',
    },
  ],
  perfect: 'PERFECT',
  good: 'GOOD',
  miss: 'MISS',
  machine: 'MACHINE',
  phone: 'PHONE',
  take: 'TAKE',
  onAir: 'ON AIR',
  battery: 'BATTERY',
  winner: 'WINNER',
  countIn: ['4', '3', '2', 'GO'],
  title: 'THE BIOFILM BAND',
  subtitle: 'an Invisible Heroes video',
  rec: 'REC',
  theEnd: 'THE END',
  lyrics: [
    'Well, I got bacteria in my fuel cell tonight',
    "They're munchin' on sewage by the pale moonlight",
    'Down in the chamber where the microbes play',
    "Electrons dancin' like it's judgment day",
    "Geobacter's singing its electron lullaby",
    "It's a microscopic carnival ride",
    "So here's to the bugs that nobody sees",
  ],
  chant: ['WE ARE THE MICROBES!', 'CLEANING YOUR WATER!', 'MAKING ELECTRICITY!'],
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

/** A stand-in fuel cell: biofilm grows through the song, conductance follows the groove. */
const cell = createCell();

const grades = new Uint8Array(NOTES.length);
const seats: SeatFrame[] = SEATS.map(() => ({ hitAt: -Infinity, hitGrade: GOOD, missAt: -Infinity, pressAt: -Infinity }));
const frame: Frame = {
  mode,
  t: t0,
  now: 0,
  humans,
  remote,
  charge: [0, 0, 0, 0, 0],
  leader: null,
  grades,
  seats,
  cell,
  groove,
  streak: 7,
  takeNumber: 3,
  shot,
  recording: q.get('rec') === '1',
  reducedMotion: q.get('rm') === '1',
};

/** Fill grades and seats for song time t (outside the timed section). */
const charge = [0, 0, 0, 0, 0];
const perSeat = SEATS.map((_, seat) => NOTES.filter((n) => n.seat === seat).length);

function fill(t: number, now: number): void {
  frame.t = t;
  frame.now = now;
  cell.biofilm.fill(Math.min(1, 0.2 + t / 90));
  cell.conductance = groove;
  charge.fill(0);
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
    if ((g === GOOD || g === PERFECT) && n.t <= t) charge[n.seat]! += (g === PERFECT ? 1 : 0.7) * (humans[n.seat] ? 1 : 0.8);
    if ((g === GOOD || g === PERFECT) && hitTime <= t) {
      s.hitAt = humans[n.seat] && mode !== 'idle' ? hitTime : n.t;
      s.hitGrade = g;
      s.pressAt = s.hitAt;
    } else if (g === MISS && n.t + GOOD_S <= t) {
      s.missAt = n.t + GOOD_S;
    }
  }
  let leader: number | null = null;
  for (let i = 0; i < charge.length; i++) {
    charge[i] = charge[i]! / perSeat[i]!;
    if (charge[i]! > 0 && (leader === null || charge[i]! > charge[leader]!)) leader = i;
  }
  frame.charge = charge;
  frame.leader = leader;
}

const canvas = document.getElementById('stage') as HTMLCanvasElement;
canvas.style.width = `${sw}px`;
canvas.style.height = `${sh}px`;
const wrap = document.getElementById('stage-wrap');
if (wrap) {
  wrap.style.width = `${sw}px`;
  wrap.style.height = `${sh}px`;
}
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

/** Time the bench once the display face is in, so its one-off layer rebuild is not counted. */
function runBench(): void {
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
}

if (bench > 0) {
  // Draw once so the renderer starts loading its face, then wait for it.
  fill(t0, 10);
  renderer.draw(frame);
  const started = performance.now();
  const settle = (): void => {
    let loaded = false;
    document.fonts.forEach((f) => {
      if (f.family.replace(/"/g, '') === DISPLAY_FAMILY && f.status === 'loaded') loaded = true;
    });
    if (!loaded && performance.now() - started < 3000) {
      setTimeout(settle, 50);
      return;
    }
    renderer.draw(frame);
    setTimeout(runBench, 100);
  };
  settle();
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
  // A still: settle the camera with a few frames leading up to t, then keep
  // redrawing t for a moment so the display face shows once it has loaded.
  for (let k = 20; k >= 0; k--) {
    fill(t0 - k / 60, 10 - k / 60);
    renderer.draw(frame);
  }
  let frames = 0;
  const hold = (): void => {
    renderer.draw(frame);
    if (++frames < 30) requestAnimationFrame(hold);
    else window.__ready = true;
  };
  requestAnimationFrame(hold);
}
