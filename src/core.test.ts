import { describe, expect, it } from 'vitest';
import { planShots } from './director';
import {
  GOOD,
  GOOD_S,
  MISS,
  PENDING,
  PERFECT,
  advance,
  createRun,
  press,
  rankFor,
  scriptForTake,
  tally,
} from './engine';
import { BARS, BAR_S, NOTES, NOTES_BY_SEAT, SEATS, SEAT_COUNT, SONG_S, STEP_S } from './score';
import { decodeTake, encodeTake } from './take';

const ALL_HUMAN = [true, true, true, true, true];
const SOLO_DRUM = [false, false, false, true, false];
const DRUM = SEATS.indexOf('drum');

describe('the tune', () => {
  it('is in time order, inside the song, on the step grid', () => {
    expect(NOTES.length).toBeGreaterThan(200);
    NOTES.forEach((n, i) => {
      expect(n.i).toBe(i);
      expect(n.t).toBeGreaterThanOrEqual(0);
      expect(n.t).toBeLessThan(SONG_S);
      expect(n.t / STEP_S).toBeCloseTo(Math.round(n.t / STEP_S), 6);
      if (i > 0) expect(n.t).toBeGreaterThanOrEqual(NOTES[i - 1]!.t);
    });
  });

  it('gives every seat a part, and never two notes of a seat closer than an eighth', () => {
    NOTES_BY_SEAT.forEach((indices) => {
      expect(indices.length).toBeGreaterThan(20);
      for (let k = 1; k < indices.length; k++) {
        const gap = NOTES[indices[k]!]!.t - NOTES[indices[k - 1]!]!.t;
        // Two windows must never overlap, or one press could be read two ways.
        expect(gap).toBeGreaterThanOrEqual(2 * STEP_S - 1e-9);
        expect(gap).toBeGreaterThan(2 * GOOD_S * 0.9);
      }
    });
  });

  it('opens with the drum alone and ends with all five together', () => {
    const firstBar = NOTES.filter((n) => n.bar === 0);
    expect(new Set(firstBar.map((n) => n.seat))).toEqual(new Set([DRUM]));
    const lastHit = NOTES.filter((n) => n.bar === BARS - 1 && n.step === 8);
    expect(lastHit.map((n) => n.seat).sort()).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('a run', () => {
  it('plays the machine seats by itself and leaves the players seats open', () => {
    const run = createRun(scriptForTake(SOLO_DRUM));
    const events = advance(run, SONG_S + 1);
    const hits = events.filter((e) => e.type === 'hit');
    const misses = events.filter((e) => e.type === 'miss');
    expect(hits.every((e) => e.seat !== DRUM)).toBe(true);
    expect(misses.every((e) => e.seat === DRUM)).toBe(true);
    expect(misses.length).toBe(NOTES_BY_SEAT[DRUM]!.length);
    expect([...run.grades].every((g) => g !== PENDING)).toBe(true);
  });

  it('grades a press by how far it lands from the beat', () => {
    const run = createRun(scriptForTake(SOLO_DRUM));
    const [first, second, third] = NOTES_BY_SEAT[DRUM]!.map((i) => NOTES[i]!);
    expect(press(run, DRUM, first!.t + 0.02)).toMatchObject([{ type: 'hit', grade: PERFECT }]);
    expect(press(run, DRUM, second!.t - 0.12)).toMatchObject([{ type: 'hit', grade: GOOD }]);
    // Far too early for the third note: nothing is used up.
    expect(press(run, DRUM, third!.t - 0.4)).toMatchObject([{ type: 'stray' }]);
    expect(run.grades[third!.i]).toBe(PENDING);
    expect(run.streak).toBe(2);
  });

  it('turns an untouched note into a miss once the window has passed', () => {
    const run = createRun(scriptForTake(SOLO_DRUM));
    const first = NOTES[NOTES_BY_SEAT[DRUM]![0]!]!;
    expect(advance(run, first.t + GOOD_S - 0.01).filter((e) => e.seat === DRUM)).toEqual([]);
    const late = advance(run, first.t + GOOD_S + 0.01).filter((e) => e.seat === DRUM);
    expect(late).toMatchObject([{ type: 'miss', scripted: false }]);
    expect(run.streak).toBe(0);
  });

  it('a late press writes off the note that went by and catches the next one', () => {
    const run = createRun(scriptForTake(SOLO_DRUM));
    const [first, second] = NOTES_BY_SEAT[DRUM]!.map((i) => NOTES[i]!);
    const events = press(run, DRUM, second!.t);
    expect(events.map((e) => e.type)).toEqual(['miss', 'hit']);
    expect(run.grades[first!.i]).toBe(MISS);
    expect(run.grades[second!.i]).toBe(PERFECT);
  });

  it('a press on a machine seat does nothing to the take', () => {
    const run = createRun(scriptForTake(SOLO_DRUM));
    expect(press(run, 0, BAR_S)).toEqual([{ type: 'stray', seat: 0 }]);
    expect([...run.grades].every((g) => g === PENDING)).toBe(true);
  });

  it('scores only the players seats', () => {
    const run = createRun(scriptForTake(SOLO_DRUM));
    for (const i of NOTES_BY_SEAT[DRUM]!) {
      advance(run, NOTES[i]!.t);
      press(run, DRUM, NOTES[i]!.t);
    }
    advance(run, SONG_S + 1);
    const result = tally(run.grades, SOLO_DRUM);
    expect(result.team.total).toBe(NOTES_BY_SEAT[DRUM]!.length);
    expect(result.score).toBe(1);
    expect(rankFor(result.score)).toBe('headliners');
    expect(rankFor(0.2)).toBe('inoculating');
  });
});

describe('a take in a link', () => {
  it('survives the round trip', () => {
    const run = createRun(scriptForTake(SOLO_DRUM));
    NOTES_BY_SEAT[DRUM]!.forEach((i, k) => {
      if (k % 3 !== 0) press(run, DRUM, NOTES[i]!.t + (k % 2 ? 0.1 : 0));
      advance(run, NOTES[i]!.t + GOOD_S + 0.001);
    });
    advance(run, SONG_S + 1);
    const text = encodeTake({ humans: SOLO_DRUM, grades: run.grades });
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(text.length).toBeLessThan(200);
    const back = decodeTake(text);
    expect(back?.humans).toEqual(SOLO_DRUM);
    expect([...back!.grades]).toEqual([...run.grades]);
  });

  it('rejects anything that is not a take of this tune', () => {
    expect(decodeTake('')).toBeNull();
    expect(decodeTake('not a take!')).toBeNull();
    expect(decodeTake('AAAA')).toBeNull();
    const good = encodeTake({ humans: ALL_HUMAN, grades: new Uint8Array(NOTES.length).fill(PERFECT) });
    expect(decodeTake(good.slice(0, -4))).toBeNull();
    expect(decodeTake('C' + good.slice(1))).toBeNull();
  });
});

describe('the shot list', () => {
  it('has one shot per bar, follows the intro, and never repeats a close-up back to back', () => {
    const shots = planShots(new Uint8Array(NOTES.length).fill(PERFECT));
    expect(shots.length).toBe(BARS);
    expect(shots.slice(0, 4)).toEqual([DRUM, 0, 1, null]);
    expect(shots[BARS - 1]).toBeNull();
    const closeUps = shots.slice(4).filter((s): s is number => s !== null);
    expect(closeUps.length).toBeGreaterThan(5);
    closeUps.forEach((seat, k) => {
      expect(seat).toBeGreaterThanOrEqual(0);
      expect(seat).toBeLessThan(SEAT_COUNT);
      if (k > 0) expect(seat).not.toBe(closeUps[k - 1]);
    });
  });

  it('never closes in on a seat that landed nothing', () => {
    const grades = new Uint8Array(NOTES.length).fill(MISS);
    expect(planShots(grades).slice(4).every((s) => s === null)).toBe(true);
  });
});
