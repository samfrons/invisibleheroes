/**
 * Who holds which seat in a room (pure). The host keeps one of these.
 *
 * A phone holds at most one seat and a seat has at most one phone. A phone
 * that joins is given the first seat nobody is playing, so scanning the code
 * is all it takes to be in the band; it can then pick another free one.
 */
import { SEAT_COUNT } from '../score';
import type { SeatHolder } from './protocol';

export interface Room {
  /** A phone arrived. Gives it the first machine seat if there is one. True if it got a seat. */
  join(guest: string, local: readonly boolean[]): boolean;
  /** A phone went away. Returns the seat it held, or null. */
  leave(guest: string): number | null;
  /** A phone asks for a seat. False if another phone has it or someone at the big screen plays it. */
  claim(guest: string, seat: number, local: readonly boolean[]): boolean;
  /** A phone gives its seat back. Returns the seat, or null. */
  release(guest: string): number | null;
  /** The big screen takes a seat away from whichever phone holds it. Returns that phone, or null. */
  evict(seat: number): string | null;
  seatOf(guest: string): number | null;
  guestAt(seat: number): string | null;
  guests(): string[];
  /** Per seat: true where a phone plays. */
  phones(): boolean[];
  /** Per seat, for telling the phones: machine, local or phone. */
  holders(local: readonly boolean[]): SeatHolder[];
}

export function createRoom(): Room {
  const members = new Set<string>();
  const bySeat: (string | null)[] = new Array<string | null>(SEAT_COUNT).fill(null);

  const seatOf = (guest: string) => {
    const seat = bySeat.indexOf(guest);
    return seat === -1 ? null : seat;
  };
  const release = (guest: string) => {
    const seat = seatOf(guest);
    if (seat !== null) bySeat[seat] = null;
    return seat;
  };
  const claim = (guest: string, seat: number, local: readonly boolean[]) => {
    if (!members.has(guest) || !Number.isInteger(seat) || seat < 0 || seat >= SEAT_COUNT) return false;
    if (bySeat[seat] === guest) return true;
    if (bySeat[seat] !== null || local[seat]) return false;
    release(guest);
    bySeat[seat] = guest;
    return true;
  };

  return {
    join(guest, local) {
      members.add(guest);
      for (let seat = 0; seat < SEAT_COUNT; seat++) {
        if (claim(guest, seat, local)) return true;
      }
      return false;
    },
    leave(guest) {
      members.delete(guest);
      return release(guest);
    },
    claim,
    release,
    evict(seat) {
      const guest = bySeat[seat] ?? null;
      if (guest !== null) bySeat[seat] = null;
      return guest;
    },
    seatOf,
    guestAt: (seat) => bySeat[seat] ?? null,
    guests: () => [...members],
    phones: () => bySeat.map((guest) => guest !== null),
    holders: (local) =>
      bySeat.map((guest, seat) => (guest !== null ? 'phone' : local[seat] ? 'local' : 'machine')),
  };
}
