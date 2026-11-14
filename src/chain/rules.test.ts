import { describe, expect, it } from 'vitest';
import {
  BROKEN_S,
  COLD_S,
  DELIVER_S,
  DOUBLE_GAP_S,
  FIRST_LENGTH,
  GOAL,
  LIVES,
  PLAYERS,
  TIME_S,
  createChain,
  nextStep,
  press,
  signalLength,
  update,
  type ChainEvent,
  type ChainState,
} from './rules';

/** Past a boundary, clear of float rounding. */
const EPS = 1e-6;

/** A repeatable random source. */
function seeded(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

/** Run the signal to its end and return the time the players' turn began. */
function toTurn(s: ChainState): number {
  const end = s.phaseAt + signalLength(s.sequence, s.round) + EPS;
  update(s, end);
  expect(s.phase).toBe('repeat');
  return end;
}

/** Press the whole sequence right, starting at `t`. Returns the events and the time after. */
function playRight(s: ChainState, t: number): { events: ChainEvent[]; t: number } {
  const events: ChainEvent[] = [];
  for (const step of [...s.sequence]) {
    t += 0.3;
    events.push(...press(s, step.player, t));
    if (step.kind === 'double') {
      t += 0.15;
      events.push(...press(s, step.player, t));
    }
  }
  return { events, t };
}

describe('nextStep', () => {
  it('never repeats the microbe before it in rounds 1-3', () => {
    const random = seeded(7);
    for (let i = 0; i < 500; i++) {
      const prev = { player: i % PLAYERS, kind: 'tap' as const };
      expect(nextStep(prev, 2, random).player).not.toBe(prev.player);
    }
  });

  it('only brings in doubles from round 8', () => {
    const random = seeded(3);
    for (let i = 0; i < 300; i++) expect(nextStep(undefined, 7, random).kind).toBe('tap');
    const late = Array.from({ length: 300 }, () => nextStep(undefined, 8, random).kind);
    expect(late).toContain('double');
  });
});

describe('a round', () => {
  it('flashes every step, then hands over, then delivers on a right repeat', () => {
    const s = createChain(0, seeded(1));
    expect(s.sequence).toHaveLength(FIRST_LENGTH);
    const flashes = update(s, 100 / 1000 + signalLength(s.sequence, 1)).filter((e) => e.k === 'flash');
    expect(flashes.map((e) => (e.k === 'flash' ? e.player : -1))).toEqual(s.sequence.map((x) => x.player));
    expect(s.phase).toBe('repeat');
    const { events } = playRight(s, s.phaseAt);
    expect(events.filter((e) => e.k === 'hop')).toHaveLength(FIRST_LENGTH);
    expect(events.at(-1)).toEqual({ k: 'delivered', charge: 1 });
    expect(s.phase).toBe('delivered');
  });

  it('ignores presses while the colony is signalling', () => {
    const s = createChain(0, seeded(2));
    expect(press(s, s.sequence[0]!.player, 0.5)).toEqual([]);
    expect(s.breaks).toBe(0);
  });

  it('adds one step each round and keeps the old ones', () => {
    const s = createChain(0, seeded(4));
    const first = [...s.sequence];
    let t = toTurn(s);
    t = playRight(s, t).t;
    update(s, t + DELIVER_S + EPS);
    expect(s.round).toBe(2);
    expect(s.sequence).toHaveLength(FIRST_LENGTH + 1);
    expect(s.sequence.slice(0, FIRST_LENGTH)).toEqual(first);
  });
});

describe('breaking the chain', () => {
  it('breaks on the wrong microbe and replays the same sequence', () => {
    const s = createChain(0, seeded(5));
    const before = [...s.sequence];
    const t = toTurn(s);
    const wrong = (s.sequence[0]!.player + 1) % PLAYERS;
    expect(press(s, wrong, t + 0.2)).toEqual([{ k: 'break', reason: 'wrong', player: wrong, breaks: 1 }]);
    expect(s.phase).toBe('broken');
    const events = update(s, t + 0.2 + BROKEN_S + EPS);
    expect(events).toEqual([{ k: 'signal', round: 1, length: FIRST_LENGTH, replay: true }]);
    expect(s.sequence).toEqual(before);
  });

  it('goes cold if nobody presses', () => {
    const s = createChain(0, seeded(6));
    const t = toTurn(s);
    expect(update(s, t + COLD_S - 0.01)).toEqual([]);
    expect(update(s, t + COLD_S + 0.01)[0]).toMatchObject({ k: 'break', reason: 'cold' });
  });

  it('breaks a double left half done, and completes one tapped twice in time', () => {
    const s = createChain(0, seeded(8));
    s.sequence = [{ player: 2, kind: 'double' }, { player: 0, kind: 'tap' }];
    let t = toTurn(s);
    expect(press(s, 2, t + 0.1)).toEqual([{ k: 'half', player: 2 }]);
    expect(press(s, 2, t + 0.1 + DOUBLE_GAP_S - 0.05)).toEqual([{ k: 'hop', player: 2, index: 0 }]);
    s.pos = 0;
    t += 1;
    press(s, 2, t);
    expect(update(s, t + DOUBLE_GAP_S + 0.01)[0]).toMatchObject({ k: 'break', reason: 'half', player: 2 });
  });

  it('blacks out on the third break', () => {
    const s = createChain(0, seeded(9));
    let t = 0;
    let last: ChainEvent[] = [];
    for (let i = 0; i < LIVES; i++) {
      t = toTurn(s);
      last = press(s, (s.sequence[0]!.player + 1) % PLAYERS, t + 0.1);
      t += 0.1 + BROKEN_S + EPS;
      update(s, t);
    }
    expect(last.at(-1)).toEqual({ k: 'lost', reason: 'breaks' });
    expect(s.phase).toBe('lost');
  });
});

describe('the game', () => {
  it('lights the town after ten delivered electrons', () => {
    const random = seeded(10);
    const s = createChain(0, random);
    let t = 0;
    for (let round = 1; round <= GOAL; round++) {
      t = toTurn(s);
      t = playRight(s, t).t;
      if (round < GOAL) {
        t += DELIVER_S + EPS;
        update(s, t, random);
      }
    }
    expect(s.phase).toBe('won');
    expect(s.charge).toBe(GOAL);
    expect(s.longest).toBe(FIRST_LENGTH + GOAL - 1);
    expect(t).toBeLessThan(TIME_S);
  });

  it('runs out of time at five minutes', () => {
    const s = createChain(0, seeded(11));
    expect(update(s, TIME_S)).toEqual([{ k: 'lost', reason: 'time' }]);
    expect(update(s, TIME_S + 1)).toEqual([]);
  });
});
