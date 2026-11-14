/**
 * The video's shot list (pure): which bars are wide and which close in on a seat.
 *
 * Decided from the take alone, so the same take always cuts the same way: the
 * intro follows each part as it enters, then odd bars close in on whoever
 * landed the most notes in that bar (never the same seat twice running), and
 * the last bar is wide for the three hits together.
 */
import { GOOD } from './engine';
import { BARS, NOTES, SEAT_COUNT } from './score';

/** A seat index for a close-up, or null for the wide shot. */
export type Shot = number | null;

/** The seat that enters in each intro bar: drum, wire, keys, then everyone. */
const INTRO_SHOTS: Shot[] = [3, 0, 1, null];

export function planShots(grades: Uint8Array): Shot[] {
  const shots: Shot[] = [];
  let last: Shot = null;
  for (let bar = 0; bar < BARS; bar++) {
    if (bar < INTRO_SHOTS.length) {
      shots.push(INTRO_SHOTS[bar]!);
      continue;
    }
    if (bar % 2 === 0 || bar === BARS - 1) {
      shots.push(null);
      continue;
    }
    const landed = new Array<number>(SEAT_COUNT).fill(0);
    for (const n of NOTES) if (n.bar === bar && grades[n.i]! >= GOOD) landed[n.seat]! += 1;
    let best: Shot = null;
    for (let seat = 0; seat < SEAT_COUNT; seat++) {
      if (seat === last || landed[seat] === 0) continue;
      if (best === null || landed[seat]! > landed[best]!) best = seat;
    }
    shots.push(best);
    if (best !== null) last = best;
  }
  return shots;
}
