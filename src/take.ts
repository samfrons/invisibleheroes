/**
 * A finished take as a short string (pure), so it fits in a link.
 *
 * The tune is fixed, so a take is only who played and how each note went:
 * one byte for the format, one for the five seats, then two bits per note.
 * Timing inside the window is not kept: in the video a hit lands on the beat.
 */
import { GOOD, MISS, PERFECT, type Grade } from './engine';
import { NOTES, SEAT_COUNT } from './score';

const VERSION = 1;

export interface Take {
  humans: boolean[];
  grades: Uint8Array;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

export function encodeTake(take: Take): string {
  const bytes = new Uint8Array(2 + Math.ceil(NOTES.length / 4));
  bytes[0] = VERSION;
  bytes[1] = take.humans.reduce((mask, human, seat) => (human ? mask | (1 << seat) : mask), 0);
  for (let i = 0; i < NOTES.length; i++) {
    // An unsettled note (a take stopped early) is stored as a miss.
    const grade = take.grades[i] === PERFECT ? PERFECT : take.grades[i] === GOOD ? GOOD : MISS;
    bytes[2 + (i >> 2)]! |= grade << ((i & 3) * 2);
  }
  return toBase64Url(bytes);
}

/** Null for anything that is not a take of this tune: wrong version, wrong length, an empty grade. */
export function decodeTake(text: string): Take | null {
  const bytes = fromBase64Url(text);
  if (!bytes || bytes.length !== 2 + Math.ceil(NOTES.length / 4) || bytes[0] !== VERSION) return null;
  const mask = bytes[1]!;
  if (mask >= 1 << SEAT_COUNT) return null;
  const grades = new Uint8Array(NOTES.length);
  for (let i = 0; i < NOTES.length; i++) {
    const grade = (bytes[2 + (i >> 2)]! >> ((i & 3) * 2)) & 3;
    if (grade !== MISS && grade !== GOOD && grade !== PERFECT) return null;
    grades[i] = grade as Grade;
  }
  return {
    humans: Array.from({ length: SEAT_COUNT }, (_, seat) => (mask & (1 << seat)) !== 0),
    grades,
  };
}
