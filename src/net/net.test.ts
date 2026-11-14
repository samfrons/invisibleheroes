import { describe, expect, it } from 'vitest';
import { GOOD, GOOD_S, MISS, PENDING, PERFECT, advance, createRun, press, scriptForTake } from '../engine';
import { NOTES, NOTES_BY_SEAT, SEATS } from '../score';
import {
  ROOM_CODE_LENGTH,
  createClockSync,
  makeRoomCode,
  normalizeRoomCode,
  parseGuestMessage,
  parseHostMessage,
  peerIdFor,
} from './protocol';
import { createRoom } from './room';

const NONE = [false, false, false, false, false];
const DRUM = SEATS.indexOf('drum');

describe('room codes', () => {
  it('are four unambiguous characters and survive being typed in lower case', () => {
    for (let i = 0; i < 200; i++) {
      const code = makeRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]+$/);
      expect(normalizeRoomCode(` ${code.toLowerCase()} `)).toBe(code);
    }
  });

  it('reject what cannot be a code', () => {
    for (const bad of ['', 'ABC', 'ABCDE', 'AB1D', 'ABO2', 'A-CD', null, undefined]) {
      expect(normalizeRoomCode(bad)).toBeNull();
    }
  });

  it('give a broker address made only of letters, digits and dashes', () => {
    expect(peerIdFor('ABCD')).toMatch(/^[a-z0-9][a-zA-Z0-9-]*[A-Z0-9]$/);
  });
});

describe('messages from the network', () => {
  it('accept the well-formed ones', () => {
    expect(parseGuestMessage({ k: 'claim', seat: 4 })).toEqual({ k: 'claim', seat: 4 });
    expect(parseGuestMessage({ k: 'release' })).toEqual({ k: 'release' });
    expect(parseGuestMessage({ k: 'press', at: 12.5 })).toEqual({ k: 'press', at: 12.5 });
    expect(parseGuestMessage({ k: 'press', at: null })).toEqual({ k: 'press', at: null });
    expect(parseGuestMessage({ k: 'ping', c: 1 })).toEqual({ k: 'ping', c: 1 });
    expect(parseHostMessage({ k: 'pong', c: 1, h: 2 })).toEqual({ k: 'pong', c: 1, h: 2 });
    expect(parseHostMessage({ k: 'judge', grade: PERFECT })).toEqual({ k: 'judge', grade: PERFECT });
    const state = {
      k: 'state',
      phase: 'lobby',
      seats: ['phone', 'local', 'machine', 'machine', 'machine'],
      you: 0,
      score: null,
    };
    expect(parseHostMessage(state)).toEqual(state);
  });

  it('drop everything else, and never pass unknown fields through', () => {
    const junk: unknown[] = [
      null,
      'press',
      42,
      [],
      {},
      { k: 'nope' },
      { k: 'claim', seat: 5 },
      { k: 'claim', seat: -1 },
      { k: 'claim', seat: 1.5 },
      { k: 'claim', seat: '1' },
      { k: 'press', at: 'now' },
      { k: 'press', at: Infinity },
      { k: 'press' },
      { k: 'ping', c: NaN },
    ];
    for (const data of junk) expect(parseGuestMessage(data)).toBeNull();
    expect(parseGuestMessage({ k: 'claim', seat: 2, admin: true })).toEqual({ k: 'claim', seat: 2 });

    const seats = ['machine', 'machine', 'machine', 'machine', 'machine'];
    for (const data of [
      { k: 'judge', grade: 7 },
      { k: 'pong', c: 1 },
      { k: 'state', phase: 'party', seats, you: null, score: null },
      { k: 'state', phase: 'lobby', seats: seats.slice(1), you: null, score: null },
      { k: 'state', phase: 'lobby', seats: [...seats.slice(1), 'robot'], you: null, score: null },
      { k: 'state', phase: 'lobby', seats, you: 9, score: null },
      { k: 'state', phase: 'lobby', seats, you: null, score: 3 },
    ]) {
      expect(parseHostMessage(data)).toBeNull();
    }
  });
});

describe('the clock a phone keeps of the big screen', () => {
  it('knows nothing before the first round trip', () => {
    const clock = createClockSync();
    expect(clock.offset()).toBeNull();
    expect(clock.toHost(1)).toBeNull();
  });

  it('recovers the offset from a symmetric round trip', () => {
    const clock = createClockSync();
    // The host's clock is 100 s ahead; 20 ms each way.
    clock.sample(5, 105.02, 5.04);
    expect(clock.offset()).toBeCloseTo(100, 6);
    expect(clock.roundTrip()).toBeCloseTo(0.04, 6);
    expect(clock.toHost(6)).toBeCloseTo(106, 6);
  });

  it('trusts the fastest round trip, and forgets old ones', () => {
    const clock = createClockSync(3);
    clock.sample(0, 100.3, 0.4); // slow and lopsided: guess is 100.1
    clock.sample(1, 101.01, 1.02); // fast: guess is 100.0
    expect(clock.offset()).toBeCloseTo(100, 6);
    // Three slower ones push the fast one out.
    clock.sample(2, 102.2, 2.1);
    clock.sample(3, 103.2, 3.1);
    clock.sample(4, 104.2, 4.1);
    expect(clock.offset()).toBeCloseTo(100.15, 6);
    // Nonsense is ignored.
    clock.sample(9, 109, 8);
    clock.sample(9, NaN, 9.1);
    expect(clock.offset()).toBeCloseTo(100.15, 6);
  });
});

describe('seats in a room', () => {
  it('gives each phone that joins the next seat nobody plays', () => {
    const room = createRoom();
    const local = [false, false, false, true, false];
    expect(room.join('a', local)).toBe(true);
    expect(room.join('b', local)).toBe(true);
    expect(room.seatOf('a')).toBe(0);
    expect(room.seatOf('b')).toBe(1);
    expect(room.holders(local)).toEqual(['phone', 'phone', 'machine', 'local', 'machine']);
    expect(room.phones()).toEqual([true, true, false, false, false]);
  });

  it('lets a phone move to a free seat but not onto another phone or a local player', () => {
    const room = createRoom();
    const local = [false, false, false, true, false];
    room.join('a', local);
    room.join('b', local);
    expect(room.claim('a', 1, local)).toBe(false);
    expect(room.claim('a', DRUM, local)).toBe(false);
    expect(room.claim('a', 4, local)).toBe(true);
    expect(room.seatOf('a')).toBe(4);
    expect(room.guestAt(0)).toBeNull();
    expect(room.claim('stranger', 2, local)).toBe(false);
    expect(room.claim('a', 9, local)).toBe(false);
  });

  it('frees the seat when a phone leaves, releases or is evicted', () => {
    const room = createRoom();
    room.join('a', NONE);
    room.join('b', NONE);
    room.join('c', NONE);
    expect(room.leave('a')).toBe(0);
    expect(room.release('b')).toBe(1);
    expect(room.evict(2)).toBe('c');
    expect(room.phones()).toEqual(NONE);
    expect(room.guests().sort()).toEqual(['b', 'c']);
    expect(room.evict(2)).toBeNull();
  });

  it('a sixth phone joins without a seat', () => {
    const room = createRoom();
    for (const g of ['a', 'b', 'c', 'd', 'e']) expect(room.join(g, NONE)).toBe(true);
    expect(room.join('f', NONE)).toBe(false);
    expect(room.seatOf('f')).toBeNull();
    room.leave('c');
    expect(room.claim('f', 2, NONE)).toBe(true);
  });
});

describe('a press that arrives late', () => {
  const solo = [false, false, false, true, false];
  const grace = [0, 0, 0, 0.3, 0];

  it('still lands on the beat it was made on, when the seat is given grace', () => {
    const run = createRun(scriptForTake(solo));
    const first = NOTES[NOTES_BY_SEAT[DRUM]![0]!]!;
    // The picture has moved 0.25 s past the note before the phone's press gets here.
    expect(advance(run, first.t + 0.25, grace).filter((e) => e.seat === DRUM)).toEqual([]);
    expect(run.grades[first.i]).toBe(PENDING);
    expect(press(run, DRUM, first.t + 0.03)).toMatchObject([{ type: 'hit', grade: PERFECT }]);
  });

  it('without grace the same note is already gone', () => {
    const run = createRun(scriptForTake(solo));
    const first = NOTES[NOTES_BY_SEAT[DRUM]![0]!]!;
    advance(run, first.t + 0.25);
    expect(run.grades[first.i]).toBe(MISS);
  });

  it('grace does not widen the window: a late press is still late', () => {
    const run = createRun(scriptForTake(solo));
    const [first, second] = NOTES_BY_SEAT[DRUM]!.map((i) => NOTES[i]!);
    expect(press(run, DRUM, first!.t + GOOD_S - 0.01)).toMatchObject([{ type: 'hit', grade: GOOD }]);
    const events = press(run, DRUM, second!.t + GOOD_S + 0.02);
    expect(events[0]).toMatchObject({ type: 'miss' });
    // And the note does become a miss once the grace is used up.
    const later = createRun(scriptForTake(solo));
    expect(advance(later, first!.t + GOOD_S + 0.31, grace).filter((e) => e.seat === DRUM)).toMatchObject([
      { type: 'miss' },
    ]);
  });
});
