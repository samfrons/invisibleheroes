/**
 * The band's sound: every note is synthesised with the Web Audio API, no files.
 *
 * Voices are built by `VoiceKit`, which only needs a BaseAudioContext and a
 * destination node, so the same code runs live and in an OfflineAudioContext
 * (the measurement page renders voices offline and reads the samples).
 *
 * The sound is 1970s analogue: detuned saws through a resonant filter for the
 * bass, an FM electric piano for the keys, glassy inharmonic FM bells for the
 * chimes, a thumping kick, a snare with a tone body, a growling brass tuba.
 * Every voice feeds a small per-voice strip (made once); the strips share one
 * space bus (a dub echo plus a four-comb room), made once. The master chain
 * ends in a gentle tanh saturator that also caps the peak.
 *
 * Nothing here touches `window` or AudioContext at module load.
 */

import { BARS, STEP_S, STEPS_PER_BAR, chordAt } from './score';
import type { BandAudio, BandCue } from './types';

/** MIDI note number to Hz (A4 = 69 = 440 Hz). */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const FLOOR = 0.0001;
/** More live sources than this and a new note is dropped. */
const MAX_SOURCES = 64;
/** The machine's hats and pad give way first: they stop at this many live sources. */
const BACKING_CAP = MAX_SOURCES - 14;

/** Per-voice loudness trims, tuned by measurement so the five parts sit together. */
const TRIM = {
  wire: 0.3,
  keys: 0.7,
  chimes: 0.3,
  kick: 0.62,
  snare: 0.42,
  tuba: 0.5,
  hat: 0.07,
  pad: 0.02,
} as const;

/** How much of each strip goes to the shared space bus. */
const SEND = {
  wire: 0.05,
  keys: 0.3,
  chimes: 0.5,
  kick: 0.02,
  snare: 0.25,
  tuba: 0.14,
  hat: 0.1,
  pad: 0.55,
  cue: 0.2,
} as const;

type Source = AudioScheduledSourceNode;
type StripId = keyof typeof SEND;

/** One second of white noise, built once per context and shared by every voice. */
export function makeNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** The shared space: a dub echo and a short four-comb room, one input. */
export interface Space {
  input: GainNode;
  /** Empty the echo and the room (a take stopped early). */
  flush(): void;
}

const ECHO_S = STEP_S * 3;
const ECHO_FEEDBACK = 0.36;
const COMBS: readonly (readonly [number, number])[] = [
  [0.0297, 0.7],
  [0.0371, 0.7],
  [0.0411, 0.68],
  [0.0437, 0.68],
];

export function createSpace(ctx: BaseAudioContext, dest: AudioNode): Space {
  const input = ctx.createGain();
  const feedbacks: { gain: AudioParam; value: number }[] = [];

  // Echo: highpassed so the bass does not smear, darker on every repeat.
  const echoHp = ctx.createBiquadFilter();
  echoHp.type = 'highpass';
  echoHp.frequency.value = 280;
  const echo = ctx.createDelay(1);
  echo.delayTime.value = ECHO_S;
  const echoLp = ctx.createBiquadFilter();
  echoLp.type = 'lowpass';
  echoLp.frequency.value = 2400;
  const echoFb = ctx.createGain();
  echoFb.gain.value = ECHO_FEEDBACK;
  const echoOut = ctx.createGain();
  echoOut.gain.value = 0.5;
  input.connect(echoHp);
  echoHp.connect(echo);
  echo.connect(echoLp);
  echoLp.connect(echoFb);
  echoFb.connect(echo);
  echoLp.connect(echoOut);
  echoOut.connect(dest);
  feedbacks.push({ gain: echoFb.gain, value: ECHO_FEEDBACK });

  // Room: four short feedback combs in parallel, each damped.
  const roomIn = ctx.createBiquadFilter();
  roomIn.type = 'highpass';
  roomIn.frequency.value = 220;
  input.connect(roomIn);
  const roomOut = ctx.createGain();
  roomOut.gain.value = 0.32;
  roomOut.connect(dest);
  for (const [time, fb] of COMBS) {
    const d = ctx.createDelay(0.1);
    d.delayTime.value = time;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 3200;
    const g = ctx.createGain();
    g.gain.value = fb;
    roomIn.connect(d);
    d.connect(damp);
    damp.connect(g);
    g.connect(d);
    damp.connect(roomOut);
    feedbacks.push({ gain: g.gain, value: fb });
  }

  return {
    input,
    flush() {
      // Every sample in the loops passes its feedback gain once per delay
      // length, so holding the gains at zero for longer than the echo empties them.
      const t = ctx.currentTime;
      for (const f of feedbacks) {
        f.gain.cancelScheduledValues(t);
        f.gain.setValueAtTime(0, t);
        f.gain.setValueAtTime(f.value, t + ECHO_S + 0.1);
      }
    },
  };
}

/** The instruments, cues and ticks, drawn into `dest` (and the shared `space`). */
export class VoiceKit {
  private readonly strips: Record<StripId, GainNode>;
  private readonly hatBus: GainNode;
  private lastTickAt = -Infinity;
  private eighths = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    dest: AudioNode,
    private readonly noise: AudioBuffer,
    private readonly live: Set<Source>,
    private readonly space?: Space
  ) {
    const strips = {} as Record<StripId, GainNode>;
    for (const id of Object.keys(SEND) as StripId[]) {
      const strip = ctx.createGain();
      strip.connect(dest);
      if (space) {
        const send = ctx.createGain();
        send.gain.value = SEND[id];
        strip.connect(send);
        send.connect(space.input);
      }
      strips[id] = strip;
    }
    this.strips = strips;
    // Every hat shares one highpass, so a hat is two nodes.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7200;
    hp.connect(strips.hat);
    this.hatBus = ctx.createGain();
    this.hatBus.connect(hp);
  }

  /** Empty the shared space. */
  flush(): void {
    this.space?.flush();
  }

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
    // Silent until `start`: a gain's default is 1, and a source that begins a sample early would click.
    g.gain.value = FLOOR;
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

  /** A detuned oscillator (cents). */
  private detuned(
    type: OscillatorType,
    freq: number,
    cents: number,
    start: number,
    end: number,
    out: AudioNode,
    extra?: AudioNode[]
  ): OscillatorNode {
    const o = this.osc(type, freq, start, end, out, extra);
    o.detune.value = cents;
    return o;
  }

  /**
   * Two-operator FM: a sine carrier whose pitch is bent by a sine at `ratio`,
   * the bend (index) fading. `extra` nodes are released when the carrier ends.
   */
  private fm(
    freq: number,
    ratio: number,
    index0: number,
    index1: number,
    indexDecay: number,
    start: number,
    end: number,
    out: AudioNode,
    extra?: AudioNode[]
  ): void {
    const mg = this.ctx.createGain();
    mg.gain.setValueAtTime(freq * index0, start);
    mg.gain.exponentialRampToValueAtTime(Math.max(freq * index1, 0.01), start + indexDecay);
    const carrier = this.ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(freq, start);
    mg.connect(carrier.frequency);
    carrier.connect(out);
    carrier.start(start);
    this.track(carrier, end, extra);
    this.osc('sine', freq * ratio, start, end, mg, [mg]);
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
    if (lv <= 0 || midi.length === 0) return;
    if (seat === 1) {
      if (!this.full()) this.keys(midi, t, lv);
      return;
    }
    for (const m of midi) {
      if (this.full()) return;
      switch (seat) {
        case 0:
          this.wire(m, t, lv);
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

  /** Nanowire bass: two detuned saws and a sub through a resonant filter that sweeps shut. */
  private wire(midi: number, t: number, lv: number): void {
    const f = midiToHz(midi);
    const end = t + 0.42;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 7;
    filter.frequency.setValueAtTime(Math.min(f * 13, 3600), t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(f * 2.1, 150), t + 0.2);
    const g = this.envelope(this.strips.wire, t, TRIM.wire * lv, 0.006, end);
    filter.connect(g);
    const nodes: AudioNode[] = [filter, g];
    this.detuned('sawtooth', f, -9, t, end, filter, nodes);
    this.detuned('sawtooth', f, 9, t, end, filter);
    this.osc('sine', f, t, end, g);
  }

  /** Flavin keys: an FM electric piano stab, tine bark first, then a round tail. */
  private keys(midi: readonly number[], t: number, lv: number): void {
    const end = t + 0.34;
    const g = this.envelope(this.strips.keys, t, (TRIM.keys * lv) / Math.sqrt(midi.length), 0.004, end);
    midi.forEach((m, i) => {
      if (this.full()) return;
      const f = midiToHz(m);
      // Ratio 1 with a fast-falling index is the electric-piano bark.
      this.fm(f, 1, 2.4, 0.12, 0.22, t, end, g, i === 0 ? [g] : undefined);
    });
    // The tine: a sharp upper partial that dies at once.
    const tine = this.envelope(g, t, 0.16, 0.001, t + 0.06);
    this.osc('sine', midiToHz(midi[0]!) * 7.02, t, t + 0.06, tine, [tine]);
  }

  /** Leaf chimes: a glassy FM bell, inharmonic modulator, with a shimmer partial. */
  private chime(midi: number, t: number, lv: number, ring: number): void {
    const f = midiToHz(midi);
    const main = this.envelope(this.strips.chimes, t, TRIM.chimes * lv, 0.002, t + ring);
    this.fm(f, 3.5, 1.9, 0.04, ring * 0.3, t, t + ring, main, [main]);
    const p = this.envelope(main, t, 0.3, 0.002, t + ring * 0.2);
    this.osc('sine', f * 5.43, t, t + ring * 0.2, p, [p]);
  }

  private drum(midi: number, t: number, lv: number): void {
    if (midi >= 42) {
      this.hat(t, TRIM.snare * lv * 0.5, 0.05);
    } else if (midi >= 38) {
      // Body: two tones that fall a little; wires: bandpassed noise with a long tail.
      const body = this.envelope(this.strips.snare, t, TRIM.snare * 0.75 * lv, 0.001, t + 0.13);
      const lo = this.osc('triangle', 215, t, t + 0.13, body, [body]);
      lo.frequency.exponentialRampToValueAtTime(150, t + 0.1);
      this.osc('sine', 340, t, t + 0.13, body);
      const band = this.ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 2300;
      band.Q.value = 0.7;
      const ng = this.envelope(this.strips.snare, t, TRIM.snare * 0.9 * lv, 0.001, t + 0.22);
      band.connect(ng);
      this.noiseBurst(t, 0.22, band, [band, ng]);
    } else {
      // Kick: a sine that falls fast, plus a short beater click.
      const end = t + 0.3;
      const g = this.envelope(this.strips.kick, t, TRIM.kick * lv, 0.002, end);
      const o = this.osc('sine', 175, t, end, g, [g]);
      o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
      const click = this.envelope(this.strips.kick, t, TRIM.kick * 0.5 * lv, 0.0008, t + 0.018);
      const c = this.osc('triangle', 900, t, t + 0.018, click, [click]);
      c.frequency.exponentialRampToValueAtTime(120, t + 0.016);
    }
  }

  /** Bubble tuba: detuned brass saws through a filter that blats open, with a 31 Hz growl and a pop. */
  private tuba(midi: number, t: number, lv: number): void {
    const f = midiToHz(midi);
    const end = t + 0.42;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 3;
    filter.frequency.setValueAtTime(380, t);
    filter.frequency.exponentialRampToValueAtTime(2000, t + 0.07);
    filter.frequency.exponentialRampToValueAtTime(520, end);
    const g = this.envelope(this.strips.tuba, t, TRIM.tuba * lv, 0.03, end);
    filter.connect(g);
    const nodes: AudioNode[] = [filter, g];
    const lead = this.detuned('sawtooth', f * 0.84, -7, t, end, filter, nodes);
    lead.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    const second = this.detuned('sawtooth', f * 0.84, 7, t, end, filter);
    second.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    // The growl: a fast wobble on the cutoff.
    const depth = this.ctx.createGain();
    depth.gain.value = 260;
    depth.connect(filter.frequency);
    this.osc('sine', 31, t, end, depth, [depth]);
    // The bubble pop: a quick upward chirp.
    const popAt = end - 0.03;
    const pg = this.envelope(this.strips.tuba, popAt, TRIM.tuba * 0.3 * lv, 0.004, popAt + 0.05);
    const pop = this.osc('sine', 300, popAt, popAt + 0.05, pg, [pg]);
    pop.frequency.exponentialRampToValueAtTime(1000, popAt + 0.04);
  }

  private hat(t: number, peak: number, dur: number): void {
    const g = this.envelope(this.hatBus, t, peak, 0.0006, t + dur);
    this.noiseBurst(t, dur, g, [g]);
  }

  /** A soft pad on a chord: slow-attack saws through a breathing filter, plus a sub drone. */
  private pad(bar: number, t: number): void {
    const chord = chordAt(bar);
    const end = t + STEP_S * STEPS_PER_BAR;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1.5;
    filter.frequency.setValueAtTime(500, t);
    filter.frequency.linearRampToValueAtTime(1300, t + (end - t) * 0.4);
    filter.frequency.linearRampToValueAtTime(600, end);
    const g = this.ctx.createGain();
    g.gain.value = FLOOR;
    g.gain.setValueAtTime(FLOOR, t);
    g.gain.exponentialRampToValueAtTime(TRIM.pad, t + 0.35);
    g.gain.setValueAtTime(TRIM.pad, end - 0.3);
    g.gain.exponentialRampToValueAtTime(FLOOR, end);
    filter.connect(g);
    g.connect(this.strips.pad);
    // Three chord tones an octave down, and the root as a drone.
    chord.triad.slice(0, 3).forEach((m, i) => {
      this.detuned('sawtooth', midiToHz(m - 12), i % 2 === 0 ? -6 : 6, t, end, filter, i === 0 ? [filter, g] : undefined);
    });
    this.osc('sine', midiToHz(chord.root), t, end, g);
  }

  /**
   * The machine's backing, once per eighth. Hi-hats on every eighth with a
   * ghost sixteenth after it and an open hat on the and-of-four; a pad on the
   * downbeat of each bar. `step` is the song step (a sixteenth, 0 at the first
   * downbeat), so 0, 2, 4, ... on eighths. Without it the kit counts eighths
   * itself from the first tick after a silence, which gives the same numbers.
   */
  tick(when: number, accent: boolean, step?: number): void {
    const t = Math.max(when, this.ctx.currentTime);
    let s: number;
    if (step !== undefined && Number.isFinite(step)) {
      s = Math.max(0, Math.round(step));
      this.eighths = Math.floor(s / 2) + 1;
    } else {
      if (when < this.lastTickAt - 0.01 || when - this.lastTickAt > 1) this.eighths = accent ? 0 : 1;
      s = this.eighths * 2;
      this.eighths += 1;
    }
    this.lastTickAt = when;
    if (this.live.size >= BACKING_CAP) return;
    const inBar = s % STEPS_PER_BAR;
    if (inBar === 0) {
      const bar = Math.floor(s / STEPS_PER_BAR);
      if (bar < BARS) this.pad(bar, t);
    }
    if (inBar === 14) {
      this.hat(t, TRIM.hat * 0.9, 0.16);
    } else {
      this.hat(t, accent ? TRIM.hat * 1.2 : TRIM.hat * 0.8, 0.04);
      this.hat(t + STEP_S, TRIM.hat * 0.4, 0.03);
    }
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
        const g = this.envelope(this.strips.cue, t, 0.22, 0.004, end);
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
        const g = this.envelope(this.strips.cue, t, 0.12, 0.001, t + 0.03);
        bp.connect(g);
        this.noiseBurst(t, 0.03, bp, [bp, g]);
        break;
      }
      case 'ui': {
        const g = this.envelope(this.strips.cue, t, 0.09, 0.001, t + 0.04);
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
    const g = this.envelope(this.strips.cue, t, peak, 0.001, end);
    this.osc('sine', freq, t, end, g, [g]);
    const g2 = this.envelope(this.strips.cue, t, peak * 0.4, 0.001, t + 0.04);
    this.osc('triangle', freq * 2.4, t, t + 0.04, g2, [g2]);
  }
}

/** Test seam (dev): a VoiceKit (with its own space bus) on any context, plus its source set. */
export function __createVoiceKit(
  ctx: BaseAudioContext,
  dest: AudioNode
): { kit: VoiceKit; live: Set<AudioScheduledSourceNode> } {
  const live = new Set<Source>();
  return { kit: new VoiceKit(ctx, dest, makeNoiseBuffer(ctx), live, createSpace(ctx, dest)), live };
}

let liveCounter: () => number = () => 0;
/** Dev-only: how many sources are alive right now (0 when there is no engine). */
export function __liveSourceCount(): number {
  return liveCounter();
}

const MASTER_LEVEL = 1.1;

/** The saturator curve: tanh, normalised so full scale lands at the ceiling (nothing exceeds it). */
function saturationCurve(): Float32Array<ArrayBuffer> {
  const n = 2048;
  const drive = 1.5;
  const ceiling = 0.94;
  const curve = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = (ceiling * Math.tanh(drive * x)) / norm;
  }
  return curve;
}

export interface MasterChain {
  /** Voices connect here. */
  master: GainNode;
  /** The last node before the speakers: the mix as recorded. */
  out: AudioNode;
}

/** master gain, compressor, then one saturator; created once per context and wired to its destination. */
export function createMasterChain(ctx: BaseAudioContext, level = MASTER_LEVEL): MasterChain {
  const master = ctx.createGain();
  master.gain.value = level;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -9;
  comp.knee.value = 10;
  comp.ratio.value = 5;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;
  const shaper = ctx.createWaveShaper();
  shaper.curve = saturationCurve();
  shaper.oversample = '2x';
  master.connect(comp);
  comp.connect(shaper);
  shaper.connect(ctx.destination);
  return { master, out: shaper };
}

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
  let tail: AudioNode | null = null;
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
    const chain = createMasterChain(c, target());
    master = chain.master;
    tail = chain.out;
    kit = new VoiceKit(c, master, makeNoiseBuffer(c), live, createSpace(c, master));
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
    /** `step` (optional): the song step of this eighth, 0, 2, 4, ...; it places the pad on the bar and chord. */
    tick(when, accent, step?: number) {
      if (!kit || disposed) return;
      kit.tick(when, accent, step);
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
      kit?.flush();
      m.gain.setValueAtTime(0, t + 0.016);
      m.gain.linearRampToValueAtTime(target(), t + 0.03);
    },
    stream() {
      if (!ctx || !tail || disposed) return null;
      if (!streamDest) {
        if (typeof ctx.createMediaStreamDestination !== 'function') return null;
        try {
          streamDest = ctx.createMediaStreamDestination();
          tail.connect(streamDest);
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
      tail = null;
      streamDest = null;
      kit = null;
    },
  };
}
