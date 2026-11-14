import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAREER,
  dayKey,
  loadCareer,
  recordTake,
  saveCareer,
  type Career,
} from './storage';

const KEY = 'invisible-heroes:career:v1';

/** In-memory stand-in for localStorage. */
class MemoryStorage {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  raw(): string | undefined {
    return this.data.get(KEY);
  }

  write(value: string): void {
    this.data.set(KEY, value);
  }
}

function career(overrides: Partial<Career> = {}): Career {
  return { ...DEFAULT_CAREER, lineup: [...DEFAULT_CAREER.lineup], ...overrides };
}

describe('loadCareer', () => {
  it('returns the defaults when storage is empty', () => {
    expect(loadCareer(new MemoryStorage())).toEqual(DEFAULT_CAREER);
  });

  it('returns the defaults when there is no storage at all', () => {
    expect(loadCareer(null)).toEqual(DEFAULT_CAREER);
    // In node there is no window, so the default storage is also absent.
    expect(loadCareer()).toEqual(DEFAULT_CAREER);
  });

  it('returns a fresh copy, never DEFAULT_CAREER itself', () => {
    const loaded = loadCareer(new MemoryStorage());
    expect(loaded).not.toBe(DEFAULT_CAREER);
    expect(loaded.lineup).not.toBe(DEFAULT_CAREER.lineup);
    loaded.lineup[0] = true;
    loaded.takes = 99;
    expect(DEFAULT_CAREER.takes).toBe(0);
    expect(DEFAULT_CAREER.lineup).toEqual([false, false, false, true, false]);
  });

  it('gives defaults for garbage JSON', () => {
    const store = new MemoryStorage();
    store.write('not json {');
    expect(loadCareer(store)).toEqual(DEFAULT_CAREER);
  });

  it('gives defaults when the JSON is not an object', () => {
    for (const value of ['null', '42', '"text"', '[1,2,3]', 'true']) {
      const store = new MemoryStorage();
      store.write(value);
      expect(loadCareer(store)).toEqual(DEFAULT_CAREER);
    }
  });

  it('falls back on each bad field alone and keeps the good ones', () => {
    const store = new MemoryStorage();
    store.write(
      JSON.stringify({
        takes: -1,
        best: 0.4,
        bestStreak: 'lots',
        lastDay: '2026-1-1',
        dayStreak: 2.5,
        muted: 'yes',
        lineup: [true, true],
      }),
    );
    expect(loadCareer(store)).toEqual({
      takes: 0,
      best: 0.4,
      bestStreak: 0,
      lastDay: null,
      dayStreak: 0,
      muted: false,
      lineup: [false, false, false, true, false],
    });
  });

  it('keeps good fields when only one field is bad', () => {
    const store = new MemoryStorage();
    store.write(
      JSON.stringify({ takes: 'seven', best: 0.5, bestStreak: 3, lastDay: '2026-05-01', dayStreak: 2, muted: true, lineup: [true, false, true, false, false] }),
    );
    expect(loadCareer(store)).toEqual({
      takes: 0,
      best: 0.5,
      bestStreak: 3,
      lastDay: '2026-05-01',
      dayStreak: 2,
      muted: true,
      lineup: [true, false, true, false, false],
    });
  });

  it('clamps best to 0..1 and rejects a non-number best', () => {
    const store = new MemoryStorage();
    store.write(JSON.stringify({ best: 7 }));
    expect(loadCareer(store).best).toBe(1);
    store.write(JSON.stringify({ best: -2 }));
    expect(loadCareer(store).best).toBe(0);
    store.write(JSON.stringify({ best: '0.5' }));
    expect(loadCareer(store).best).toBe(0);
  });

  it('rejects a lastDay that does not match YYYY-MM-DD', () => {
    const store = new MemoryStorage();
    store.write(JSON.stringify({ lastDay: 20260101 }));
    expect(loadCareer(store).lastDay).toBeNull();
    store.write(JSON.stringify({ lastDay: '01/02/2026' }));
    expect(loadCareer(store).lastDay).toBeNull();
  });

  it('rejects a lineup with no true seat or the wrong length', () => {
    const store = new MemoryStorage();
    store.write(JSON.stringify({ lineup: [false, false, false, false, false] }));
    expect(loadCareer(store).lineup).toEqual(DEFAULT_CAREER.lineup);
    store.write(JSON.stringify({ lineup: [true, false, false, false, false, false] }));
    expect(loadCareer(store).lineup).toEqual(DEFAULT_CAREER.lineup);
  });

  it('does not share the lineup array with the stored data', () => {
    const store = new MemoryStorage();
    store.write(JSON.stringify({ lineup: [true, false, false, false, false] }));
    const loaded = loadCareer(store);
    loaded.lineup[1] = true;
    expect(loadCareer(store).lineup).toEqual([true, false, false, false, false]);
  });

  it('does not throw when storage throws on read', () => {
    const broken = {
      getItem: (): string | null => {
        throw new Error('access denied');
      },
    };
    expect(() => loadCareer(broken)).not.toThrow();
    expect(loadCareer(broken)).toEqual(DEFAULT_CAREER);
  });
});

describe('saveCareer', () => {
  it('round trips through save and load', () => {
    const store = new MemoryStorage();
    const saved = career({ takes: 4, best: 0.73, bestStreak: 9, lastDay: '2026-08-02', dayStreak: 3, muted: true, lineup: [true, true, false, false, true] });
    saveCareer(saved, store);
    expect(loadCareer(store)).toEqual(saved);
  });

  it('writes JSON under the versioned key', () => {
    const store = new MemoryStorage();
    saveCareer(career({ takes: 1 }), store);
    expect(JSON.parse(store.raw() ?? 'null')).toMatchObject({ takes: 1 });
  });

  it('does not throw when storage throws on write', () => {
    const broken = {
      setItem: (): void => {
        throw new Error('quota exceeded');
      },
    };
    expect(() => saveCareer(career(), broken)).not.toThrow();
  });

  it('does nothing when storage is null', () => {
    expect(() => saveCareer(career(), null)).not.toThrow();
  });
});

describe('dayKey', () => {
  it('pads single-digit months and days', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(dayKey(new Date(2026, 8, 9))).toBe('2026-09-09');
  });

  it('keeps two-digit months and days as they are', () => {
    expect(dayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
    expect(dayKey(new Date(2026, 9, 14))).toBe('2026-10-14');
  });
});

describe('recordTake', () => {
  const result = { score: 0.6, bestStreak: 4 };

  it('counts a first take on an empty career as a one-day streak', () => {
    const next = recordTake(DEFAULT_CAREER, result, '2026-03-10');
    expect(next).toEqual({
      takes: 1,
      best: 0.6,
      bestStreak: 4,
      lastDay: '2026-03-10',
      dayStreak: 1,
      muted: false,
      lineup: [false, false, false, true, false],
    });
  });

  it('keeps the day streak on the same day', () => {
    const start = career({ takes: 2, lastDay: '2026-03-10', dayStreak: 3 });
    const next = recordTake(start, result, '2026-03-10');
    expect(next.dayStreak).toBe(3);
    expect(next.takes).toBe(3);
    expect(next.lastDay).toBe('2026-03-10');
  });

  it('keeps the day streak at least 1 on the same day', () => {
    const start = career({ lastDay: '2026-03-10', dayStreak: 0 });
    expect(recordTake(start, result, '2026-03-10').dayStreak).toBe(1);
  });

  it('adds one to the day streak on the next day', () => {
    const start = career({ lastDay: '2026-03-10', dayStreak: 3 });
    expect(recordTake(start, result, '2026-03-11').dayStreak).toBe(4);
  });

  it('resets the day streak after a gap', () => {
    const start = career({ lastDay: '2026-03-10', dayStreak: 3 });
    expect(recordTake(start, result, '2026-03-12').dayStreak).toBe(1);
  });

  it('crosses a month end', () => {
    const start = career({ lastDay: '2026-01-31', dayStreak: 5 });
    expect(recordTake(start, result, '2026-02-01').dayStreak).toBe(6);
  });

  it('crosses a year end', () => {
    const start = career({ lastDay: '2026-12-31', dayStreak: 2 });
    expect(recordTake(start, result, '2027-01-01').dayStreak).toBe(3);
  });

  it('crosses a leap day in 2028', () => {
    const start = career({ lastDay: '2028-02-28', dayStreak: 1 });
    expect(recordTake(start, result, '2028-02-29').dayStreak).toBe(2);
    const afterLeap = career({ lastDay: '2028-02-29', dayStreak: 2 });
    expect(recordTake(afterLeap, result, '2028-03-01').dayStreak).toBe(3);
  });

  it('does not treat Feb 28 to Mar 1 in a leap year as consecutive', () => {
    const start = career({ lastDay: '2028-02-28', dayStreak: 4 });
    expect(recordTake(start, result, '2028-03-01').dayStreak).toBe(1);
  });

  it('keeps the best score and the best streak as maxima', () => {
    const start = career({ best: 0.8, bestStreak: 10 });
    const next = recordTake(start, { score: 0.5, bestStreak: 2 }, '2026-03-10');
    expect(next.best).toBe(0.8);
    expect(next.bestStreak).toBe(10);
  });

  it('raises the best score and clamps it to 0..1', () => {
    expect(recordTake(career({ best: 0.2 }), { score: 0.9, bestStreak: 0 }, '2026-03-10').best).toBe(0.9);
    expect(recordTake(career(), { score: 1.7, bestStreak: 0 }, '2026-03-10').best).toBe(1);
    expect(recordTake(career({ best: 0.3 }), { score: -4, bestStreak: 0 }, '2026-03-10').best).toBe(0.3);
  });

  it('does not mutate its input', () => {
    const start = career({ takes: 1, best: 0.1, bestStreak: 1, lastDay: '2026-03-10', dayStreak: 1, lineup: [false, true, false, false, false] });
    const before = JSON.stringify(start);
    const next = recordTake(start, { score: 0.9, bestStreak: 7 }, '2026-03-11');
    expect(JSON.stringify(start)).toBe(before);
    expect(next).not.toBe(start);
    expect(next.lineup).not.toBe(start.lineup);
  });
});
