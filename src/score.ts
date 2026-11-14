/**
 * The tune, as data (pure). Five seats, 24 bars, sixteen steps to the bar.
 *
 * Each bar of each seat is a 16-character string: '.' is a rest, a letter is
 * a note. Letters mean something different per seat (see TOKENS), and the
 * pitched seats follow the chord of the bar, so a pattern written once works
 * over the whole Am, F, C, G loop.
 */

export const SEATS = ['wire', 'keys', 'chimes', 'drum', 'tuba'] as const;
export type SeatId = (typeof SEATS)[number];
export const SEAT_COUNT = SEATS.length;

export const BPM = 104;
export const STEPS_PER_BAR = 16;
export const STEP_S = 60 / BPM / 4;
export const BEAT_S = STEP_S * 4;
export const BAR_S = STEP_S * STEPS_PER_BAR;
export const BARS = 24;
export const SONG_S = BARS * BAR_S;
/** One bar of clicks before the first note. */
export const COUNT_IN_S = BAR_S;

export interface Note {
  /** Position in NOTES (time order). */
  i: number;
  seat: number;
  bar: number;
  step: number;
  /** Seconds from the first downbeat. */
  t: number;
  /** MIDI pitches sounded together (the keys play a triad; the drum uses 36 kick, 38 snare). */
  midi: number[];
}

interface Chord {
  root: number;
  triad: [number, number, number];
}

const AM: Chord = { root: 45, triad: [57, 60, 64] };
const F: Chord = { root: 41, triad: [57, 60, 65] };
const C: Chord = { root: 48, triad: [55, 60, 64] };
const G: Chord = { root: 43, triad: [55, 59, 62] };
const LOOP = [AM, F, C, G] as const;

/** The last bar resolves home instead of landing on G. */
export function chordAt(bar: number): Chord {
  return bar === BARS - 1 ? AM : LOOP[bar % LOOP.length]!;
}

const CHIME: Record<string, number> = { a: 69, b: 71, c: 72, d: 74, e: 76, g: 79, h: 81 };

/** What a pattern letter sounds like for a seat, over a chord. */
function pitches(seat: SeatId, token: string, chord: Chord): number[] {
  switch (seat) {
    case 'wire':
      return [chord.root + (token === 'f' ? 7 : token === 'o' ? 12 : 0)];
    case 'keys':
      return [...chord.triad];
    case 'chimes':
      return [CHIME[token] ?? 69];
    case 'drum':
      return [token === 's' ? 38 : 36];
    case 'tuba':
      return [chord.root + 12 + (token === 'f' ? 7 : 0)];
  }
}

type BarPatterns = Partial<Record<SeatId, string>>;

const VERSE: BarPatterns[] = [
  {
    drum: 'k...s...k...s...',
    wire: 'r.....r.f.......',
    keys: '....x.......x...',
    chimes: 'e...d...c.......',
    tuba: 'r...........f...',
  },
  {
    drum: 'k...s...k...s...',
    wire: 'r.....r.f.......',
    keys: '....x.......x...',
    chimes: 'c...d...a.......',
    tuba: 'r...........f...',
  },
  {
    drum: 'k...s...k...s...',
    wire: 'r.....r.f.......',
    keys: '....x.......x...',
    chimes: 'e...g...e...d...',
    tuba: 'r...........f...',
  },
  {
    drum: 'k...s...k...s.s.',
    wire: 'r.....r.f...o...',
    keys: '....x.......x...',
    chimes: 'd...b...d.......',
    tuba: 'r...........f...',
  },
];

const CHORUS: BarPatterns[] = [
  {
    drum: 'k...s.k.k...s...',
    wire: 'r.....r.f.....o.',
    keys: '....x.x.....x.x.',
    chimes: 'e...e.g.e...d...',
    tuba: 'r.......f...r...',
  },
  {
    drum: 'k...s.k.k...s...',
    wire: 'r.....r.f.....o.',
    keys: '....x.x.....x.x.',
    chimes: 'c...c.d.c...a...',
    tuba: 'r.......f...r...',
  },
  {
    drum: 'k...s.k.k...s...',
    wire: 'r.....r.f.....o.',
    keys: '....x.x.....x.x.',
    chimes: 'e...e.g.h...g...',
    tuba: 'r.......f...r...',
  },
  {
    drum: 'k...s.k.k...s.s.',
    wire: 'r.....r.f.....o.',
    keys: '....x.x.....x.x.',
    chimes: 'd...d.e.d...b...',
    tuba: 'r.......f...r...',
  },
];

/** The machine starts one part at a time, so each player hears their own entrance. */
const INTRO: BarPatterns[] = [
  { drum: VERSE[0]!.drum },
  { drum: VERSE[1]!.drum, wire: VERSE[1]!.wire },
  { drum: VERSE[2]!.drum, wire: VERSE[2]!.wire, keys: VERSE[2]!.keys },
  VERSE[3]!,
];

/** Three hits together, then silence. */
const FINALE: BarPatterns = {
  drum: 'k...s...k.......',
  wire: 'r...f...r.......',
  keys: 'x...x...x.......',
  chimes: 'a...c...h.......',
  tuba: 'r...f...r.......',
};

export type SectionId = 'intro' | 'verse' | 'chorus' | 'finale';

export function sectionAt(bar: number): SectionId {
  if (bar < 4) return 'intro';
  if (bar < 12) return 'verse';
  if (bar < BARS - 1) return 'chorus';
  return 'finale';
}

function patternsAt(bar: number): BarPatterns {
  switch (sectionAt(bar)) {
    case 'intro':
      return INTRO[bar]!;
    case 'verse':
      return VERSE[(bar - 4) % 4]!;
    case 'chorus':
      return CHORUS[(bar - 12) % 4]!;
    case 'finale':
      return FINALE;
  }
}

function build(): Note[] {
  const out: Omit<Note, 'i'>[] = [];
  for (let bar = 0; bar < BARS; bar++) {
    const patterns = patternsAt(bar);
    const chord = chordAt(bar);
    SEATS.forEach((seat, seatIndex) => {
      const pattern = patterns[seat];
      if (!pattern) return;
      for (let step = 0; step < STEPS_PER_BAR; step++) {
        const token = pattern[step];
        if (!token || token === '.') continue;
        out.push({
          seat: seatIndex,
          bar,
          step,
          t: (bar * STEPS_PER_BAR + step) * STEP_S,
          midi: pitches(seat, token, chord),
        });
      }
    });
  }
  out.sort((a, b) => a.t - b.t || a.seat - b.seat);
  return out.map((n, i) => ({ ...n, i }));
}

/** Every note of the tune, in time order. */
export const NOTES: readonly Note[] = build();

/** Per seat, the indices into NOTES of that seat's notes, in time order. */
export const NOTES_BY_SEAT: readonly (readonly number[])[] = SEATS.map((_, seat) =>
  NOTES.filter((n) => n.seat === seat).map((n) => n.i)
);
