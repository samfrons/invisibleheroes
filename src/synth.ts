/**
 * The band's sound: every note is synthesised with the Web Audio API, no files.
 *
 * Voices are built by `VoiceKit`, which only needs a BaseAudioContext and a
 * destination node, so the same code runs live and in an OfflineAudioContext
 * (the measurement page renders voices offline and reads the samples).
 *
 * Nothing here touches `window` or AudioContext at module load.
 */

import type { BandAudio, BandCue } from './types';

/** MIDI note number to Hz (A4 = 69 = 440 Hz). */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const FLOOR = 0.0001;
/** More live sources than this and a new note is dropped. */
const MAX_SOURCES = 40;

/** Per-voice loudness trims, tuned by measurement so the five parts sit together. */
const TRIM = {
  wire: 0.24,
  keys: 0.4,
  chimes: 0.3,
  kick: 0.5,
  snare: 0.33,
  tuba: 0.8,
} as const;

type Source = AudioScheduledSourceNode;

/** One second of white noise, built once per context and shared by every voice. */
export function makeNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** The instruments, cues and ticks, drawn into `dest`. */
export class VoiceKit {
  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly dest: AudioNode,
    private readonly noise: AudioBuffer,
    private readonly live: Set<Source>
  ) {}

  private full(): boolean {
    return this.live.size >= MAX_SOURCES;
  }

  private track(src: Source, end: number, extra?: AudioNode[]): void {
    this.live.add(src);
    src.onended = () => {
      this.live.delete(src);
      try {
        src.disconnect();
      } catch {
        /* already disconnected */
      }
      if (extra) {
        for (const n of extra) {
          try {
            n.disconnect();
          } catch {
            /* already disconnected */
          }
        }
      }
    };
    src.stop(end + 0.02);
  }

  /** A gain node with an attack/exponential-decay envelope, wired to `out`. */
  private envelope(out: AudioNode, start: number, peak: number, attack: number, end: number): GainNode {
    const g = this.ctx.createGain();
    const p = Math.max(peak, FLOOR * 2);
    g.gain.setValueAtTime(FLOOR, start);
    g.gain.exponentialRampToValueAtTime(p, start + attack);
    g.gain.exponentialRampToValueAtTime(FLOOR, end);
    g.connect(out);
    return g;
  }

  private osc(
    type: OscillatorType,
    freq: number,
    start: number,
    end: number,
    out: AudioNode,
    extra?: AudioNode[]
  ): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    o.connect(out);
    o.start(start);
    this.track(o, end, extra);
    return o;
  }

  private noiseBurst(start: number, dur: number, out: AudioNode, extra?: AudioNode[]): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.connect(out);
    const offset = Math.random() * Math.max(0, this.noise.duration - dur - 0.01);
    src.start(start, offset, dur + 0.01);
    this.track(src, start + dur, extra);
  }

  play(seat: number, midi: readonly number[], when: number, level: number): void {
    const t = Math.max(when, this.ctx.currentTime);
    const lv = Math.min(1, Math.max(0, level));
    if (lv <= 0) return;
    for (const m of midi) {
      if (this.full()) return;
      switch (seat) {
        case 0:
          this.wire(m, t, lv);
          break;
        case 1:
          this.keys(m, t, lv / Math.sqrt(Math.max(1, midi.length)));
          break;
        case 2:
          this.chime(m, t, lv, 0.9);
          break;
        case 3:
          this.drum(m, t, lv);
          break;
        case 4:
          this.tuba(m, t, lv);
          break;
        default:
          break;
      }
    }
  }

  private wire(midi: number, t: number, lv: number): void {
    const f = midiToHz(midi);
    const end = t + 0.35;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 4;
    filter.frequency.setValueAtTime(Math.min(f * 14, 3200), t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(f * 1.5, 120), t + 0.18);
    const g = this.envelope(this.dest, t, TRIM.wire * lv, 0.006, end);
    filter.connect(g);
    const nodes: AudioNode[] = [filter, g];
    this.osc('sawtooth', f, t, end, filter, nodes);
    this.osc('sine', f / 2, t, end, filter);
  }

  private keys(midi: number, t: number, lv: number): void {
    const f = midiToHz(midi);
    const end = t + 0.3;
    const g = this.envelope(this.dest, t, TRIM.keys * lv, 0.008, end);
    this.osc('triangle', f, t, end, g, [g]);
    // The tine: a bright partial that dies quickly, like a tapped tine.
    const tine = this.envelope(g, t, 0.6, 0.003, t + 0.09);
    this.osc('sine', f * 4, t, t + 0.09, tine, [tine]);
    // Soft attack click.
    const click = this.envelope(g, t, 0.35, 0.001, t + 0.012);
    this.noiseBurst(t, 0.012, click, [click]);
  }

  private chime(midi: number, t: number, lv: number, ring: number): void {
    const f = midiToHz(midi);
    const main = this.envelope(this.dest, t, TRIM.chimes * lv, 0.002, t + ring);
    this.osc('sine', f, t, t + ring, main, [main]);
    const p1 = this.envelope(main, t, 0.5, 0.002, t + ring * 0.35);
    this.osc('sine', f * 2.76, t, t + ring * 0.35, p1, [p1]);
    const p2 = this.envelope(main, t, 0.3, 0.002, t + ring * 0.18);
    this.osc('sine', f * 5.4, t, t + ring * 0.18, p2, [p2]);
  }

  private drum(midi: number, t: number, lv: number): void {
    if (midi >= 38) {
      const end = t + 0.16;
      const band = this.ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 1900;
      band.Q.value = 0.8;
      const ng = this.envelope(this.dest, t, TRIM.snare * lv, 0.001, end);
      band.connect(ng);
      this.noiseBurst(t, 0.16, band, [band, ng]);
      const tg = this.envelope(this.dest, t, TRIM.snare * 0.6 * lv, 0.001, t + 0.1);
      this.osc('sine', 180, t, t + 0.1, tg, [tg]);
    } else {
      const end = t + 0.18;
      const g = this.envelope(this.dest, t, TRIM.kick * lv, 0.002, end);
      const o = this.osc('sine', 150, t, end, g, [g]);
      o.frequency.exponentialRampToValueAtTime(50, end);
    }
  }

  private tuba(midi: number, t: number, lv: number): void {
    const f = midiToHz(midi);
    const end = t + 0.4;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(400, t);
    filter.frequency.exponentialRampToValueAtTime(1100, t + 0.08);
    filter.frequency.exponentialRampToValueAtTime(300, end);
    const g = this.envelope(this.dest, t, TRIM.tuba * lv, 0.03, end);
    filter.connect(g);
    const o = this.osc('sawtooth', f * 0.84, t, end, filter, [filter, g]);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.07);
    // The bubble pop: a quick upward chirp.
    const popAt = end - 0.03;
    const pg = this.envelope(this.dest, popAt, TRIM.tuba * 0.35 * lv, 0.004, popAt + 0.05);
    const pop = this.osc('sine', 300, popAt, popAt + 0.05, pg, [pg]);
    pop.frequency.exponentialRampToValueAtTime(1000, popAt + 0.04);
  }

  tick(when: number, accent: boolean): void {
    if (this.full()) return;
    const t = Math.max(when, this.ctx.currentTime);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = accent ? 6500 : 4500;
    const g = this.envelope(this.dest, t, accent ? 0.16 : 0.09, 0.0005, t + 0.025);
    hp.connect(g);
    this.noiseBurst(t, 0.025, hp, [hp, g]);
  }

  cue(cue: BandCue, when: number): void {
    if (this.full()) return;
    const t = Math.max(when, this.ctx.currentTime);
    switch (cue) {
      case 'count':
        this.block(t, 1000, 0.3);
        break;
      case 'go':
        this.block(t, 1500, 0.34);
        break;
      case 'miss': {
        const end = t + 0.16;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 400;
        const g = this.envelope(this.dest, t, 0.22, 0.004, end);
        lp.connect(g);
        const o = this.osc('triangle', 120, t, end, lp, [lp, g]);
        o.frequency.exponentialRampToValueAtTime(65, end);
        break;
      }
      case 'stray': {
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1200;
        bp.Q.value = 2;
        const g = this.envelope(this.dest, t, 0.12, 0.001, t + 0.03);
        bp.connect(g);
        this.noiseBurst(t, 0.03, bp, [bp, g]);
        break;
      }
      case 'ui': {
        const g = this.envelope(this.dest, t, 0.09, 0.001, t + 0.04);
        this.osc('triangle', 1800, t, t + 0.04, g, [g]);
        break;
      }
      case 'finale': {
        const arp = [69, 72, 76, 81];
        arp.forEach((m, i) => this.chime(m, t + i * 0.11, 1, 0.7));
        const chordAt = t + arp.length * 0.11;
        for (const m of [57, 69, 72, 76]) this.chime(m, chordAt, 0.8, 1.2 - arp.length * 0.11 + 0.3);
        break;
      }
    }
  }

  /** Woodblock-like beep: a short pitched knock. */
  private block(t: number, freq: number, peak: number): void {
    const end = t + 0.09;
    const g = this.envelope(this.dest, t, peak, 0.001, end);
    this.osc('sine', freq, t, end, g, [g]);
    const g2 = this.envelope(this.dest, t, peak * 0.4, 0.001, t + 0.04);
    this.osc('triangle', freq * 2.4, t, t + 0.04, g2, [g2]);
  }
}

/** Test seam (dev): a VoiceKit on any context, plus its noise buffer and source set. */
export function __createVoiceKit(
  ctx: BaseAudioContext,
  dest: AudioNode
): { kit: VoiceKit; live: Set<AudioScheduledSourceNode> } {
  const live = new Set<Source>();
  return { kit: new VoiceKit(ctx, dest, makeNoiseBuffer(ctx), live), live };
}

let liveCounter: () => number = () => 0;
/** Dev-only: how many sources are alive right now (0 when there is no engine). */
export function __liveSourceCount(): number {
  return liveCounter();
}

const MASTER_LEVEL = 0.8;

function silentAudio(): BandAudio {
  return {
    resume() {},
    now: () => null,
    setMuted() {},
    play() {},
    tick() {},
    cue() {},
    hush() {},
    stream: () => null,
    dispose() {},
  };
}

type AudioCtxCtor = new (options?: AudioContextOptions) => AudioContext;

export function createBandAudio(): BandAudio {
  const g = globalThis as unknown as { AudioContext?: AudioCtxCtor; webkitAudioContext?: AudioCtxCtor };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) return silentAudio();

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let comp: DynamicsCompressorNode | null = null;
  let streamDest: MediaStreamAudioDestinationNode | null = null;
  let kit: VoiceKit | null = null;
  let muted = false;
  let disposed = false;
  const live = new Set<Source>();
  liveCounter = () => live.size;

  function target(): number {
    return muted ? 0 : MASTER_LEVEL;
  }

  function create(): void {
    let c: AudioContext;
    try {
      c = new Ctor!({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    ctx = c;
    master = c.createGain();
    master.gain.value = target();
    comp = c.createDynamicsCompressor();
    comp.threshold.value = -8;
    comp.knee.value = 10;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    master.connect(comp);
    comp.connect(c.destination);
    kit = new VoiceKit(c, master, makeNoiseBuffer(c), live);
    // iOS unlock: play one silent sample.
    try {
      const b = c.createBuffer(1, 1, c.sampleRate);
      const s = c.createBufferSource();
      s.buffer = b;
      s.connect(c.destination);
      s.start(0);
    } catch {
      /* ignore */
    }
  }

  function ramp(to: number, over: number): void {
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(to, t + over);
  }

  return {
    resume() {
      if (disposed) return;
      if (!ctx) create();
      if (ctx && ctx.state !== 'running') {
        ctx.resume().catch(() => undefined);
      }
    },
    now() {
      return ctx && ctx.state === 'running' ? ctx.currentTime : null;
    },
    setMuted(m) {
      muted = m;
      ramp(target(), 0.02);
    },
    play(seat, midi, when, level) {
      if (!kit || !ctx || disposed) return;
      kit.play(seat, midi, when ?? 0, level ?? 1);
    },
    tick(when, accent) {
      if (!kit || disposed) return;
      kit.tick(when, accent);
    },
    cue(cue, when) {
      if (!kit || disposed) return;
      kit.cue(cue, when ?? 0);
    },
    hush() {
      if (!ctx || !master) return;
      const c = ctx;
      const m = master;
      // Fade the bus out, stop everything just after, then restore the level.
      const t = c.currentTime;
      m.gain.cancelScheduledValues(t);
      m.gain.setValueAtTime(m.gain.value, t);
      m.gain.linearRampToValueAtTime(0, t + 0.01);
      for (const s of Array.from(live)) {
        try {
          s.stop(t + 0.015);
        } catch {
          live.delete(s);
        }
      }
      m.gain.setValueAtTime(0, t + 0.016);
      m.gain.linearRampToValueAtTime(target(), t + 0.03);
    },
    stream() {
      if (!ctx || !comp || disposed) return null;
      if (!streamDest) {
        if (typeof ctx.createMediaStreamDestination !== 'function') return null;
        try {
          streamDest = ctx.createMediaStreamDestination();
          comp.connect(streamDest);
        } catch {
          streamDest = null;
          return null;
        }
      }
      return streamDest.stream;
    },
    dispose() {
      if (disposed) return;
      const c = ctx;
      if (c) {
        for (const s of Array.from(live)) {
          try {
            s.stop();
          } catch {
            /* not started or already stopped */
          }
        }
        live.clear();
        c.close().catch(() => undefined);
      }
      disposed = true;
      ctx = null;
      master = null;
      comp = null;
      streamDest = null;
      kit = null;
    },
  };
}
