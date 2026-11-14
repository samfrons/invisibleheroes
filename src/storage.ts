/**
 * Career memory: what a player has done on this device, kept between visits.
 * Every read and write is guarded, so a blocked or full storage never breaks the game.
 */

export interface Career {
  /** How many takes have been finished on this device. */
  takes: number;
  /** Best team score so far, 0..1. */
  best: number;
  /** Longest run of hits in a row in any take. */
  bestStreak: number;
  /** Local calendar day of the last finished take, 'YYYY-MM-DD', or null. */
  lastDay: string | null;
  /** Days in a row with at least one finished take, counting lastDay. */
  dayStreak: number;
  muted: boolean;
  /** Which of the five seats a person plays. */
  lineup: boolean[];
}

const STORAGE_KEY = 'invisible-heroes:career:v1';
const SEAT_COUNT = 5;
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const DEFAULT_CAREER: Career = {
  takes: 0,
  best: 0,
  bestStreak: 0,
  lastDay: null,
  dayStreak: 0,
  muted: false,
  lineup: [false, false, false, true, false],
};

/** A fresh copy of the defaults, so callers can never mutate DEFAULT_CAREER. */
function freshDefaults(): Career {
  return { ...DEFAULT_CAREER, lineup: [...DEFAULT_CAREER.lineup] };
}

/** 'YYYY-MM-DD' for a Date in the device's local time zone. */
export function dayKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The calendar day after a 'YYYY-MM-DD' key, using UTC arithmetic so month, year and leap-day edges hold. */
function dayAfter(key: string): string {
  const [yearPart, monthPart, dayPart] = key.split('-');
  const time = new Date(0);
  // setUTCFullYear rather than Date.UTC, which maps years 0..99 to 1900..1999.
  time.setUTCFullYear(Number(yearPart), Number(monthPart) - 1, Number(dayPart) + 1);
  const year = String(time.getUTCFullYear()).padStart(4, '0');
  const month = String(time.getUTCMonth() + 1).padStart(2, '0');
  const day = String(time.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The default storage: window.localStorage when it exists. Accessing it can throw, so it is guarded. */
function defaultStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function isLineup(value: unknown): value is boolean[] {
  return (
    Array.isArray(value) &&
    value.length === SEAT_COUNT &&
    value.every((seat) => typeof seat === 'boolean') &&
    value.some((seat) => seat === true)
  );
}

/** Read the career from storage. Never throws: each field is validated and falls back to its default on its own. */
export function loadCareer(storage?: Pick<Storage, 'getItem'> | null): Career {
  const store = storage === undefined ? defaultStorage() : storage;
  const career = freshDefaults();
  if (!store) return career;

  let parsed: unknown;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (raw === null) return career;
    parsed = JSON.parse(raw);
  } catch {
    return career;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return career;

  const data = parsed as Record<string, unknown>;
  if (isCount(data.takes)) career.takes = data.takes;
  if (typeof data.best === 'number' && Number.isFinite(data.best)) career.best = clampUnit(data.best);
  if (isCount(data.bestStreak)) career.bestStreak = data.bestStreak;
  if (typeof data.lastDay === 'string' && DAY_KEY_PATTERN.test(data.lastDay)) career.lastDay = data.lastDay;
  if (isCount(data.dayStreak)) career.dayStreak = data.dayStreak;
  if (typeof data.muted === 'boolean') career.muted = data.muted;
  if (isLineup(data.lineup)) career.lineup = [...data.lineup];

  return career;
}

/** Write the career. Never throws (private mode, full storage). */
export function saveCareer(career: Career, storage?: Pick<Storage, 'setItem'> | null): void {
  const store = storage === undefined ? defaultStorage() : storage;
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(career));
  } catch {
    // Storage is unavailable or full: the game carries on without saving.
  }
}

/** Pure: the career after one more finished take today. Does not mutate its input. */
export function recordTake(
  career: Career,
  result: { score: number; bestStreak: number },
  today: string,
): Career {
  const score = Number.isFinite(result.score) ? clampUnit(result.score) : 0;
  const streak = Number.isFinite(result.bestStreak) ? Math.max(0, Math.floor(result.bestStreak)) : 0;

  let dayStreak: number;
  if (today === career.lastDay) {
    dayStreak = Math.max(career.dayStreak, 1);
  } else if (career.lastDay !== null && today === dayAfter(career.lastDay)) {
    dayStreak = career.dayStreak + 1;
  } else {
    dayStreak = 1;
  }

  return {
    takes: career.takes + 1,
    best: Math.max(career.best, score),
    bestStreak: Math.max(career.bestStreak, streak),
    lastDay: today,
    dayStreak,
    muted: career.muted,
    lineup: [...career.lineup],
  };
}
