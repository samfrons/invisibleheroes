/**
 * What the big screen and a phone say to each other (pure).
 *
 * The big screen is the host: it runs the game and makes the sound. A phone
 * that scans the QR code is a guest: it holds one seat and sends presses.
 * Everything that arrives is checked before it is used, because it came over
 * the network from a page we do not control.
 */
import { GOOD, MISS, PERFECT } from '../engine';
import { SEAT_COUNT } from '../score';

/** No I, O, 0 or 1: a code read off a screen across a room must not be ambiguous. */
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 4;

export function makeRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_ALPHABET[Math.floor(random() * ROOM_ALPHABET.length) % ROOM_ALPHABET.length];
  }
  return code;
}

/** A typed or scanned code in canonical form, or null if it cannot be a room code. */
export function normalizeRoomCode(text: string | null | undefined): string | null {
  const code = (text ?? '').trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_ALPHABET.includes(ch)) return null;
  return code;
}

/** The host's address on the broker that introduces the devices. */
export const peerIdFor = (code: string) => `invisible-heroes-band-${code}`;

/** Who plays a seat: the machine, someone at the big screen, or a phone. */
export type SeatHolder = 'machine' | 'local' | 'phone';
export type RoomPhase = 'lobby' | 'take' | 'results' | 'video';

export type GuestMessage =
  | { k: 'claim'; seat: number }
  | { k: 'release' }
  /** `at` is the host's clock (seconds) when the finger went down, or null if not yet in sync. */
  | { k: 'press'; at: number | null }
  /** `c` is the guest's clock (seconds) when it asked. */
  | { k: 'ping'; c: number };

export type HostMessage =
  | {
      k: 'state';
      phase: RoomPhase;
      seats: SeatHolder[];
      /** The seat this guest holds, or null. */
      you: number | null;
      /** Team score 0..1 once a take has finished, else null. */
      score: number | null;
    }
  | { k: 'pong'; c: number; h: number }
  /** How the guest's last press or note went: MISS, GOOD, PERFECT, or 0 for a press that hit nothing. */
  | { k: 'judge'; grade: number };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isSeat = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < SEAT_COUNT;

export function parseGuestMessage(data: unknown): GuestMessage | null {
  if (!isObject(data)) return null;
  switch (data.k) {
    case 'claim':
      return isSeat(data.seat) ? { k: 'claim', seat: data.seat } : null;
    case 'release':
      return { k: 'release' };
    case 'press':
      return data.at === null || isTime(data.at) ? { k: 'press', at: data.at } : null;
    case 'ping':
      return isTime(data.c) ? { k: 'ping', c: data.c } : null;
    default:
      return null;
  }
}

const HOLDERS: readonly unknown[] = ['machine', 'local', 'phone'];
const PHASES: readonly unknown[] = ['lobby', 'take', 'results', 'video'];

export function parseHostMessage(data: unknown): HostMessage | null {
  if (!isObject(data)) return null;
  switch (data.k) {
    case 'state': {
      const { phase, seats, you, score } = data;
      if (!PHASES.includes(phase)) return null;
      if (!Array.isArray(seats) || seats.length !== SEAT_COUNT) return null;
      if (!seats.every((s) => HOLDERS.includes(s))) return null;
      if (you !== null && !isSeat(you)) return null;
      if (score !== null && !(isTime(score) && score >= 0 && score <= 1)) return null;
      return {
        k: 'state',
        phase: phase as RoomPhase,
        seats: seats as SeatHolder[],
        you,
        score,
      };
    }
    case 'pong':
      return isTime(data.c) && isTime(data.h) ? { k: 'pong', c: data.c, h: data.h } : null;
    case 'judge':
      return data.grade === 0 || data.grade === MISS || data.grade === GOOD || data.grade === PERFECT
        ? { k: 'judge', grade: data.grade }
        : null;
    default:
      return null;
  }
}

/**
 * The guest's estimate of the host's clock, from ping round trips.
 *
 * Each round trip gives one guess: the host's reply was written about halfway
 * between asking and hearing back. The fastest round trip is the least
 * distorted by the network, so the estimate is the guess from the fastest of
 * the last few.
 */
export interface ClockSync {
  /** One round trip: when the guest asked, what the host's clock said, when the guest heard back. */
  sample(sentAt: number, hostTime: number, receivedAt: number): void;
  /** Host clock minus guest clock, in seconds, or null before the first round trip. */
  offset(): number | null;
  /** The fastest recent round trip in seconds, or null. */
  roundTrip(): number | null;
  /** A guest-clock time on the host's clock, or null before the first round trip. */
  toHost(guestTime: number): number | null;
}

export function createClockSync(keep = 8): ClockSync {
  const samples: { rtt: number; offset: number }[] = [];
  const best = () => samples.reduce<(typeof samples)[number] | null>((a, b) => (!a || b.rtt < a.rtt ? b : a), null);
  return {
    sample(sentAt, hostTime, receivedAt) {
      const rtt = receivedAt - sentAt;
      if (!(rtt >= 0) || !Number.isFinite(hostTime)) return;
      samples.push({ rtt, offset: hostTime - (sentAt + receivedAt) / 2 });
      if (samples.length > keep) samples.shift();
    },
    offset: () => best()?.offset ?? null,
    roundTrip: () => best()?.rtt ?? null,
    toHost(guestTime) {
      const b = best();
      return b ? guestTime + b.offset : null;
    },
  };
}
