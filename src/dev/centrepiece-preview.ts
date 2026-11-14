/**
 * Dev harness for the 3D stage (centrepiece-preview.html). Imports only the
 * 3D module, types and the score, so it runs while other parts are mid-edit.
 *
 * URL params:
 *   mode=idle|take|video   t=<song s>   now=<wall s>   size=WxH   dpr=<n>
 *   charge=a,b,c,d,e (0..1)   leader=<seat|none>   groove=<0..1>
 *   hits=<age s per seat, '' for none>   miss=<age s per seat>
 *   shot=<seat|none> (video)   reduced=1   quality=high|low   anim=1
 * window.__cp: { ready, bench(n) -> { mean, calls, triangles } }
 */
import { createCentrepiece } from '../three/centrepiece';
import { BEAT_S } from '../score';
import type { Frame, FrameMode, SeatFrame } from '../types';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => {
  const v = q.get(k);
  const n = v == null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};
const list = (k: string): (number | null)[] =>
  (q.get(k) ?? '').split(',').map((s) => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s)));
const [W, H] = (q.get('size') ?? '1400x700').split('x').map(Number) as [number, number];
const dpr = num('dpr', 1);
const t0 = num('t', 12);
const now0 = num('now', 3);
const anim = q.get('anim') === '1';
const charge = list('charge').map((v) => v ?? 0);
while (charge.length < 5) charge.push(0);
const hits = list('hits');
const misses = list('miss');
const leaderQ = q.get('leader');
const shotQ = q.get('shot');

const seats: SeatFrame[] = [0, 1, 2, 3, 4].map((i) => ({
  hitAt: hits[i] != null ? t0 - hits[i]! : -Infinity,
  hitGrade: 2,
  missAt: misses[i] != null ? t0 - misses[i]! : -Infinity,
  pressAt: -Infinity,
}));

const frame: Frame = {
  mode: (q.get('mode') as FrameMode) ?? 'take',
  t: t0,
  now: now0,
  humans: [true, true, false, false, false],
  grades: new Uint8Array(0),
  seats,
  charge,
  leader: leaderQ == null || leaderQ === 'none' ? null : Number(leaderQ),
  groove: num('groove', 0.6),
  streak: 0,
  takeNumber: 1,
  shot: shotQ == null || shotQ === 'none' ? null : Number(shotQ),
  recording: false,
  reducedMotion: q.get('reduced') === '1',
};

declare global {
  interface Window {
    __cp?: { ready: boolean; error?: string; bench(n: number, sync?: boolean): { mean: number; calls: number; triangles: number } };
  }
}

async function main(): Promise<void> {
  const canvas = document.getElementById('stage3d') as HTMLCanvasElement;
  const quality = q.get('quality') === 'low' ? 'low' : 'high';
  const cp = await createCentrepiece(canvas, { quality });
  if (!cp) {
    window.__cp = { ready: true, error: 'no webgl', bench: () => ({ mean: NaN, calls: 0, triangles: 0 }) };
    return;
  }
  cp.resize(W, H, dpr);
  cp.draw(frame);
  const stats = document.getElementById('stats')!;
  const info = cp.info();
  stats.textContent = `${info.calls} calls ${info.triangles} tris`;
  window.__cp = {
    ready: true,
    bench(n: number, sync = false) {
      // sync: wait for the GPU after each draw (gl.finish), so the time includes rendering, not just submission.
      const gl = sync ? canvas.getContext('webgl2') : null;
      const a = performance.now();
      for (let i = 0; i < n; i++) {
        frame.t = t0 + i / 60;
        frame.now = now0 + i / 60;
        // Fresh hits every beat so sparks are in flight.
        for (let s = 0; s < 5; s++) seats[s]!.hitAt = Math.floor((frame.t - s * 0.11) / BEAT_S) * BEAT_S + s * 0.11;
        cp.draw(frame);
        gl?.finish();
      }
      const mean = (performance.now() - a) / n;
      const inf = cp.info();
      return { mean, calls: inf.calls, triangles: inf.triangles };
    },
  };
  if (anim) {
    const start = performance.now();
    const loop = (): void => {
      const s = (performance.now() - start) / 1000;
      frame.t = t0 + s;
      frame.now = now0 + s;
      for (let k = 0; k < 5; k++) {
        const period = BEAT_S * (k % 2 ? 1 : 2);
        seats[k]!.hitAt = Math.floor((frame.t - k * 0.13) / period) * period + k * 0.13;
        charge[k] = Math.min(1, (charge[k] ?? 0) + 0.0004 * (k + 1));
      }
      cp.draw(frame);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

main().catch((e: unknown) => {
  window.__cp = { ready: true, error: String(e), bench: () => ({ mean: NaN, calls: 0, triangles: 0 }) };
});
