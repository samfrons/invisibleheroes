/**
 * The conductor: owns the clock, the run and the animation loop.
 *
 * Song time comes from performance.now(), which is smooth enough to draw
 * from; sound is scheduled a little ahead on the audio clock through one
 * measured offset between the two. The renderer gets one reused Frame per
 * animation frame and the synth gets notes; neither keeps game state.
 *
 * Three modes. 'idle' loops the verse silently behind the lobby. 'take' is a
 * live run: machine seats are scripted, players' seats wait for press().
 * 'video' replays a finished take: every note is scripted with the grade it
 * got, so the same take always sounds and cuts the same.
 */
import { planShots, type Shot } from './director';
import {
  GOOD,
  HOUSE_RATE,
  MISS,
  PERFECT,
  advance,
  chargeFor,
  leaderOf,
  createRun,
  press as pressRun,
  scriptForTake,
  type Run,
  type RunEvent,
} from './engine';
import {
  BARS,
  BAR_S,
  BEAT_S,
  COUNT_IN_S,
  NOTES,
  NOTES_BY_SEAT,
  SEAT_COUNT,
  SONG_S,
  STEP_S,
} from './score';
import type { Take } from './take';
import type { BandAudio, Frame, FrameMode, Renderer, SeatFrame } from './types';

/** How far ahead of the picture sound is handed to the audio clock. */
const LOOKAHEAD_S = 0.12;
/** The attract loop behind the lobby: the verse, bars 4 to 11. */
const IDLE_FROM_S = 4 * BAR_S;
const IDLE_SPAN_S = 8 * BAR_S;
/** How long the stage holds after the last bar before a take or a video is over. */
const TAKE_TAIL_S = 2.4;
const VIDEO_TAIL_S = 3.2;
/** A breath before the count-in, so the first click is clear of the hush that starts a run. */
const LEAD_IN_S = 0.25;
/** A phone's press may be this old when it arrives and still count at the time it was made. */
export const REMOTE_GRACE_S = 0.3;
/** A machine seat sits a little under the players in the mix. */
const MACHINE_LEVEL = 0.75;

export interface ConductorOptions {
  renderer: Renderer;
  audio: BandAudio;
  onTakeEnd(take: Take, bestStreak: number): void;
  onVideoEnd(): void;
  /** A player's press landed (true) or missed everything (false): for haptics. */
  onPress?(seat: number, landed: boolean): void;
  /** How a player's note or press went: MISS, GOOD, PERFECT, or 0 for a press that hit nothing. */
  onJudge?(seat: number, grade: number): void;
}

export interface Conductor {
  idle(humans: readonly boolean[]): void;
  startTake(humans: readonly boolean[], takeNumber: number): void;
  startVideo(take: Take, takeNumber: number, recording: boolean): void;
  /**
   * A press on a seat. Ignored outside a take. `at` is when the finger went down, in
   * performance.now() seconds; leave it out for a press made right now. A phone's press
   * arrives late and says when it was made, within REMOTE_GRACE_S.
   */
  press(seat: number, at?: number | null): void;
  /** Which seats are played from a phone: their notes wait REMOTE_GRACE_S longer before missing. */
  setRemoteSeats(remote: readonly boolean[]): void;
  mode(): FrameMode;
  setReducedMotion(reduced: boolean): void;
  dispose(): void;
}

const seconds = () => performance.now() / 1000;

export function createConductor({
  renderer,
  audio,
  onTakeEnd,
  onVideoEnd,
  onPress,
  onJudge,
}: ConductorOptions): Conductor {
  const seats: SeatFrame[] = Array.from({ length: SEAT_COUNT }, () => ({
    hitAt: -Infinity,
    hitGrade: PERFECT,
    missAt: -Infinity,
    pressAt: -Infinity,
  }));
  const allPerfect = new Uint8Array(NOTES.length).fill(PERFECT);
  let humans: boolean[] = new Array<boolean>(SEAT_COUNT).fill(false);
  let run: Run = createRun(allPerfect);
  let shots: Shot[] = [];
  const grace = new Array<number>(SEAT_COUNT).fill(0);
  /** Per seat, 0..1: the battery cell, filled a note at a time as the run goes. */
  const charge = new Array<number>(SEAT_COUNT).fill(0);

  const frame: Frame = {
    mode: 'idle',
    t: 0,
    now: 0,
    humans,
    remote: new Array<boolean>(SEAT_COUNT).fill(false),
    charge,
    leader: null,
    grades: run.grades,
    seats,
    groove: 0.5,
    streak: 0,
    takeNumber: 1,
    shot: null,
    recording: false,
    reducedMotion: false,
  };

  /** Wall time (s) at song time 0. */
  let t0 = seconds();
  /** Next note in NOTES whose sound has not been handed to the audio clock. */
  let soundIndex = 0;
  /** Next eighth-note tick (counted from the start of the count-in) not yet scheduled. */
  let tickIndex = 0;
  let finaleCued = false;
  let raf = 0;
  let disposed = false;

  function resetSeats() {
    for (const seat of seats) {
      seat.hitAt = -Infinity;
      seat.missAt = -Infinity;
      seat.pressAt = -Infinity;
      seat.hitGrade = PERFECT;
    }
  }

  function begin(mode: FrameMode, script: Uint8Array, startAt: number) {
    audio.hush();
    run = createRun(script);
    frame.mode = mode;
    frame.grades = run.grades;
    frame.humans = humans;
    frame.shot = null;
    resetSeats();
    charge.fill(0);
    frame.leader = null;
    t0 = seconds() - startAt;
    soundIndex = 0;
    tickIndex = 0;
    finaleCued = false;
  }

  /** Restart the silent verse loop: everything before it counts as already played. */
  function beginIdleLoop() {
    begin('idle', allPerfect, IDLE_FROM_S);
    for (const n of NOTES) {
      if (n.t >= IDLE_FROM_S) break;
      run.grades[n.i] = PERFECT;
      run.cursor[n.seat]! += 1;
    }
    frame.recording = false;
  }

  /** Song time to audio-clock time, or null while there is no running audio. */
  function audioAt(songT: number, now: number): number | null {
    const audioNow = audio.now();
    return audioNow === null ? null : audioNow + (songT - (now - t0));
  }

  function scheduleSound(t: number, now: number) {
    const horizon = t + LOOKAHEAD_S;
    // Eighth-note ticks: four counted beats, then the machine's ratchet under the song.
    for (;;) {
      const tickT = -COUNT_IN_S + tickIndex * 2 * STEP_S;
      if (tickT >= horizon || tickT >= SONG_S) break;
      const when = audioAt(tickT, now);
      if (when !== null && tickT >= t - 0.05) {
        const onBeat = tickIndex % 2 === 0;
        if (tickT < -1e-6) {
          if (onBeat) audio.cue(tickT > -BEAT_S - 1e-6 ? 'go' : 'count', when);
        } else {
          audio.tick(when, onBeat);
        }
      }
      tickIndex += 1;
    }
    // Scripted notes that will land: the machine's seats, or every landed note of a replay.
    while (soundIndex < NOTES.length) {
      const note = NOTES[soundIndex]!;
      if (note.t >= horizon) break;
      if (run.script[note.i]! >= GOOD && note.t >= t - 0.05) {
        const when = audioAt(note.t, now);
        const level = frame.mode === 'take' ? MACHINE_LEVEL : humans[note.seat] ? 1 : MACHINE_LEVEL;
        if (when !== null) audio.play(note.seat, note.midi, when, level);
      }
      soundIndex += 1;
    }
    const finaleT = (BARS - 1) * BAR_S + 12 * STEP_S;
    if (!finaleCued && finaleT < horizon) {
      finaleCued = true;
      const when = audioAt(finaleT, now);
      if (when !== null) audio.cue('finale', when);
    }
  }

  function apply(events: RunEvent[], t: number) {
    for (const e of events) {
      const seat = seats[e.seat]!;
      if (e.type === 'hit') {
        // A scripted hit lands on its beat; a player's lands when they pressed.
        seat.hitAt = e.scripted ? e.note.t : t;
        seat.hitGrade = e.grade;
      } else if (e.type === 'miss') {
        seat.missAt = t;
      }
      if (e.type === 'hit') {
        const rate = humans[e.seat] ? 1 : HOUSE_RATE;
        charge[e.seat]! += (chargeFor(e.grade) * rate) / NOTES_BY_SEAT[e.seat]!.length;
        frame.leader = leaderOf(charge);
      }
      if (onJudge && frame.mode === 'take' && !(e.type !== 'stray' && e.scripted)) {
        onJudge(e.seat, e.type === 'hit' ? e.grade : e.type === 'miss' ? MISS : 0);
      }
    }
  }

  function loop() {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    const now = seconds();
    let t = now - t0;

    if (frame.mode === 'idle') {
      if (t >= IDLE_FROM_S + IDLE_SPAN_S) {
        beginIdleLoop();
        t = now - t0;
      }
    } else {
      scheduleSound(t, now);
    }

    apply(advance(run, t, frame.mode === 'take' ? grace : undefined), t);

    frame.t = t;
    frame.now = now;
    frame.groove = run.groove;
    frame.streak = run.streak;
    if (frame.mode === 'video') {
      const bar = Math.floor(t / BAR_S);
      frame.shot = t < 0 || bar >= BARS ? null : shots[bar] ?? null;
    }
    renderer.draw(frame);

    if (frame.mode === 'take' && t > SONG_S + TAKE_TAIL_S) {
      const take: Take = { humans: [...humans], grades: run.grades.slice() };
      const bestStreak = run.bestStreak;
      beginIdleLoop();
      onTakeEnd(take, bestStreak);
    } else if (frame.mode === 'video' && t > SONG_S + VIDEO_TAIL_S) {
      beginIdleLoop();
      onVideoEnd();
    }
  }

  beginIdleLoop();
  raf = requestAnimationFrame(loop);

  return {
    idle(next) {
      humans = [...next];
      beginIdleLoop();
    },
    startTake(next, takeNumber) {
      humans = [...next];
      frame.takeNumber = takeNumber;
      frame.recording = false;
      begin('take', scriptForTake(humans), -COUNT_IN_S - LEAD_IN_S);
    },
    startVideo(take, takeNumber, recording) {
      humans = [...take.humans];
      frame.takeNumber = takeNumber;
      frame.recording = recording;
      shots = planShots(take.grades);
      begin('video', take.grades.slice(), -COUNT_IN_S - LEAD_IN_S);
    },
    setRemoteSeats(remote) {
      frame.remote = [...remote];
      for (let seat = 0; seat < SEAT_COUNT; seat++) grace[seat] = remote[seat] ? REMOTE_GRACE_S : 0;
    },
    press(seat, at) {
      if (frame.mode !== 'take' || seat < 0 || seat >= SEAT_COUNT) return;
      const now = seconds();
      // Never in the future, never older than the grace the seat's notes were held for.
      const pressed = at == null ? now : Math.min(now, Math.max(now - REMOTE_GRACE_S, at));
      const t = pressed - t0;
      seats[seat]!.pressAt = t;
      const events = pressRun(run, seat, t);
      apply(events, t);
      let landed = false;
      for (const e of events) {
        if (e.type === 'hit') {
          landed = true;
          audio.play(e.seat, e.note.midi, undefined, 1);
        } else if (e.type === 'stray') {
          audio.cue('stray');
        }
      }
      onPress?.(seat, landed);
    },
    mode: () => frame.mode,
    setReducedMotion(reduced) {
      frame.reducedMotion = reduced;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      audio.hush();
    },
  };
}
