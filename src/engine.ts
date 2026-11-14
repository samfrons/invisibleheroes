/**
 * One run through the tune (pure): who hit what, and how well.
 *
 * A run holds a grade per note. A note is settled in one of two ways: a
 * scripted note (a machine seat, or every note of a replay) settles itself
 * when its time comes; an open note waits for a press on its seat and turns
 * into a miss once the window has passed. Nothing here touches the clock, the
 * screen or the speakers: the stage feeds in times and acts on the events.
 */
import { NOTES, NOTES_BY_SEAT, SEAT_COUNT, type Note } from './score';

export const PENDING = 0;
export const MISS = 1;
export const GOOD = 2;
export const PERFECT = 3;
export type Grade = typeof MISS | typeof GOOD | typeof PERFECT;

/** How far from the beat a press may land, in seconds. */
export const PERFECT_S = 0.07;
export const GOOD_S = 0.16;

export type RunEvent =
  | { type: 'hit'; seat: number; note: Note; grade: typeof GOOD | typeof PERFECT; scripted: boolean }
  | { type: 'miss'; seat: number; note: Note; scripted: boolean }
  | { type: 'stray'; seat: number };

export interface Run {
  /** Grade per note; PENDING until settled. */
  grades: Uint8Array;
  /** Pre-decided grade per note, or PENDING for a note a player must hit. */
  script: Uint8Array;
  /** Per seat: how many of the seat's notes are settled. */
  cursor: number[];
  /** Hits in a row across the players' seats. */
  streak: number;
  bestStreak: number;
  /** 0..1, a moving average of how the players are doing; lights the lamp. */
  groove: number;
}

/** A live take: machine seats play themselves perfectly, the rest wait for presses. */
export function scriptForTake(humans: readonly boolean[]): Uint8Array {
  const script = new Uint8Array(NOTES.length);
  for (const n of NOTES) script[n.i] = humans[n.seat] ? PENDING : PERFECT;
  return script;
}

export function createRun(script: Uint8Array): Run {
  return {
    grades: new Uint8Array(NOTES.length),
    script,
    cursor: new Array<number>(SEAT_COUNT).fill(0),
    streak: 0,
    bestStreak: 0,
    groove: 0.5,
  };
}

function settle(run: Run, note: Note, grade: Grade, scripted: boolean): RunEvent {
  run.grades[note.i] = grade;
  run.cursor[note.seat]! += 1;
  if (!scripted) {
    const value = grade === PERFECT ? 1 : grade === GOOD ? 0.7 : 0;
    run.groove = run.groove * 0.86 + value * 0.14;
    run.streak = grade === MISS ? 0 : run.streak + 1;
    run.bestStreak = Math.max(run.bestStreak, run.streak);
  }
  return grade === MISS
    ? { type: 'miss', seat: note.seat, note, scripted }
    : { type: 'hit', seat: note.seat, note, grade, scripted };
}

function nextNote(run: Run, seat: number): Note | null {
  const index = NOTES_BY_SEAT[seat]![run.cursor[seat]!];
  return index === undefined ? null : NOTES[index]!;
}

/**
 * Settle everything whose time has come by `t`: scripted notes, and open notes now out of reach.
 *
 * `grace` (seconds per seat) holds a seat's open notes a little longer before they become
 * misses. A press from a phone arrives after it was made, carrying the time it was made at;
 * without the grace its note would already be written off.
 */
export function advance(run: Run, t: number, grace?: readonly number[]): RunEvent[] {
  const events: RunEvent[] = [];
  for (let seat = 0; seat < SEAT_COUNT; seat++) {
    const reach = GOOD_S + (grace?.[seat] ?? 0);
    for (let note = nextNote(run, seat); note; note = nextNote(run, seat)) {
      const scripted = run.script[note.i]!;
      if (scripted !== PENDING) {
        if (note.t > t) break;
        events.push(settle(run, note, scripted as Grade, true));
      } else {
        if (note.t >= t - reach) break;
        events.push(settle(run, note, MISS, false));
      }
    }
  }
  return events;
}

/** A player pressed their seat at `t`. Hits the seat's next open note if it is in reach. */
export function press(run: Run, seat: number, t: number): RunEvent[] {
  const events: RunEvent[] = [];
  for (let note = nextNote(run, seat); note; note = nextNote(run, seat)) {
    if (run.script[note.i] !== PENDING) break;
    const off = Math.abs(note.t - t);
    if (note.t < t - GOOD_S) {
      // Already gone by: it is a miss, and the press may still catch the one after.
      events.push(settle(run, note, MISS, false));
      continue;
    }
    if (off <= GOOD_S) {
      events.push(settle(run, note, off <= PERFECT_S ? PERFECT : GOOD, false));
      return events;
    }
    break;
  }
  events.push({ type: 'stray', seat });
  return events;
}

export interface SeatTally {
  perfect: number;
  good: number;
  miss: number;
  total: number;
}

export interface Tally {
  seats: SeatTally[];
  /** Over the players' seats only; the machine's seats do not count. */
  team: SeatTally;
  /** 0..1: a perfect is worth 1, a good 0.7. */
  score: number;
}

export function tally(grades: Uint8Array, humans: readonly boolean[]): Tally {
  const blank = (): SeatTally => ({ perfect: 0, good: 0, miss: 0, total: 0 });
  const seats = Array.from({ length: SEAT_COUNT }, blank);
  const team = blank();
  for (const n of NOTES) {
    const grade = grades[n.i]!;
    const key = grade === PERFECT ? 'perfect' : grade === GOOD ? 'good' : 'miss';
    const seat = seats[n.seat]!;
    seat[key] += 1;
    seat.total += 1;
    if (humans[n.seat]) {
      team[key] += 1;
      team.total += 1;
    }
  }
  const score = team.total === 0 ? 0 : (team.perfect + 0.7 * team.good) / team.total;
  return { seats, team, score };
}

/** What a note is worth as charge: a perfect fills the most. */
export const chargeFor = (grade: number) => (grade === PERFECT ? 1 : grade === GOOD ? 0.7 : 0);
/** The machine's seats charge at this share of a perfect player, so a good band can beat them. */
export const HOUSE_RATE = 0.8;

/**
 * The battle: per seat, 0..1, how full its battery cell is. A cell is full when every note
 * of the seat's part was a perfect. A machine seat's cell fills at the house rate.
 */
export function charges(grades: Uint8Array, humans: readonly boolean[]): number[] {
  const earned = new Array<number>(SEAT_COUNT).fill(0);
  const total = new Array<number>(SEAT_COUNT).fill(0);
  for (const n of NOTES) {
    total[n.seat]! += 1;
    earned[n.seat]! += chargeFor(grades[n.i]!) * (humans[n.seat] ? 1 : HOUSE_RATE);
  }
  return earned.map((e, seat) => (total[seat] ? e / total[seat]! : 0));
}

/** The seat with the fullest cell (the lowest seat wins a tie), or null if nothing is charged. */
export function leaderOf(charge: readonly number[]): number | null {
  let best: number | null = null;
  for (let seat = 0; seat < charge.length; seat++) {
    if (charge[seat]! > 0 && (best === null || charge[seat]! > charge[best]!)) best = seat;
  }
  return best;
}

export type Rank = 'headliners' | 'tight' | 'garage' | 'inoculating';

export function rankFor(score: number): Rank {
  if (score >= 0.9) return 'headliners';
  if (score >= 0.75) return 'tight';
  if (score >= 0.5) return 'garage';
  return 'inoculating';
}
