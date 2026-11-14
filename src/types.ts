/**
 * The seams between the game's parts. The conductor (game.ts) owns the clock
 * and the run; it tells the synth what to sound and hands the renderer one
 * Frame per animation frame. Neither the synth nor the renderer keeps game
 * state of its own.
 */

export type BandCue = 'count' | 'go' | 'miss' | 'stray' | 'finale' | 'ui';

/** Synthesised sound. No audio files: everything is oscillators and noise. */
export interface BandAudio {
  /** Create or resume the AudioContext. Must be called from a user gesture. */
  resume(): void;
  /** The audio clock in seconds, or null while there is no running context. */
  now(): number | null;
  setMuted(muted: boolean): void;
  /**
   * Sound a seat's instrument (seat index into SEATS in score.ts). `when` is
   * on the audio clock; omitted or in the past means now. `level` is 0..1.
   */
  play(seat: number, midi: readonly number[], when?: number, level?: number): void;
  /** The machine's ratchet tick. `accent` marks a downbeat. */
  tick(when: number, accent: boolean): void;
  cue(cue: BandCue, when?: number): void;
  /** Silence everything already scheduled (a take stopped early). */
  hush(): void;
  /** The mix as a live stream for recording a video, or null if unsupported. */
  stream(): MediaStream | null;
  dispose(): void;
}

/** What the renderer needs to know about one seat this frame. */
export interface SeatFrame {
  /** Song time of the seat's last hit, or -Infinity. */
  hitAt: number;
  /** GOOD or PERFECT (see engine.ts) for that hit. */
  hitGrade: number;
  /** Song time of the seat's last miss, or -Infinity. */
  missAt: number;
  /** Song time of the last press on the seat (any press, even a stray), or -Infinity. */
  pressAt: number;
}

export type FrameMode = 'idle' | 'take' | 'video';

/**
 * Everything the renderer draws from. Ball positions are not in here: they
 * follow from `t`, the tune (NOTES) and `grades`, so a replay of the same
 * take draws the same pictures.
 */
export interface Frame {
  mode: FrameMode;
  /**
   * Song time in seconds. Negative during the one-bar count-in; runs a little
   * past SONG_S for the ending. In 'idle' it loops over a few bars as an
   * attract loop (all notes hit, no sound).
   */
  t: number;
  /** Wall-clock seconds since the page loaded, for idle motion (blinks, gears). */
  now: number;
  /** Which seats a person plays. Machine seats are drawn as such. */
  humans: readonly boolean[];
  /** Which of those are played from a phone: their pad shows `labels.phone`, not a key. */
  remote?: readonly boolean[];
  /** Grade per note (engine.ts: PENDING, MISS, GOOD, PERFECT), indexed like NOTES. */
  grades: Uint8Array;
  seats: readonly SeatFrame[];
  /** Per seat, 0..1: how full that seat's battery cell is. */
  charge?: readonly number[];
  /** The seat with the fullest cell, or null before anyone has charged. */
  leader?: number | null;
  /** 0..1: how well the players are doing; drives the lamp. */
  groove: number;
  streak: number;
  takeNumber: number;
  /** Video only: the seat the camera closes in on, or null for the wide shot. */
  shot: number | null;
  /** Video only: a recording is being captured (show a REC mark). */
  recording: boolean;
  reducedMotion: boolean;
}

export interface SeatLabel {
  /** The key cap shown on the pad ('A'), or the touch prompt ('TAP'). */
  key: string;
  /** Short display name of the hero ('Geobacter'). */
  name: string;
  /** The made-up instrument ('nanowire bass'). */
  instrument: string;
  /** What the organism really does, 12 words or fewer. For credits and cards, never during play. */
  fact?: string;
}

/** Every word the renderer paints. English today; one object so it can be swapped. */
export interface RenderLabels {
  seats: readonly SeatLabel[];
  perfect: string;
  good: string;
  miss: string;
  machine: string;
  /** Shown on the pad of a seat played from a phone. */
  phone?: string;
  take: string;
  battery?: string;
  winner?: string;
  onAir: string;
  /** Count-in words, last one is the go word: ['4', '3', '2', '1'] style, shown one per beat. */
  countIn: readonly string[];
  title: string;
  subtitle: string;
  rec: string;
  theEnd: string;
  /** Video only: lines for filmstrip caption cards, in order. */
  lyrics?: readonly string[];
  /** Video only: one card per hit of the last bar (three hits). */
  chant?: readonly string[];
}

export interface Renderer {
  /** Size the drawing surface. `width` and `height` are CSS pixels. */
  resize(width: number, height: number, dpr: number): void;
  draw(frame: Frame): void;
  /** The seat whose column contains a point (CSS pixels from the canvas's top-left), or null. */
  seatAt(x: number, y: number): number | null;
}
