/**
 * The tune, as data (pure). Five seats, 25 bars, sixteen steps to the bar,
 * 100 BPM, in A minor: "Junkyard Blues", a minor blues with a 1970s sci-fi
 * coat of paint.
 *
 * Form: a four-bar intro on Am where the parts walk in one at a time (drum,
 * wire, keys, then chimes and tuba), a twelve-bar minor blues (Am Am Am Am /
 * Dm Dm Am Am / F E Am E), an eight-bar shout chorus on an i - bVII - iv
 * vamp with a turnaround (Am G Dm Am / Am G F E), and one bar of three hits.
 *
 * Each bar of each seat is a 16-character string: '.' is a rest, a letter is
 * a note. Letters mean something different per seat (see `pitches`), and the
 * pitched seats follow the chord of the bar, so one riff works over every
 * chord. The wire plays the riff, the keys stab the off-beats, the drum has a
 * backbeat, and the chimes and the tuba trade phrases (call and response).
 */

export const SEATS = ['wire', 'keys', 'chimes', 'drum', 'tuba'] as const;
export type SeatId = (typeof SEATS)[number];
export const SEAT_COUNT = SEATS.length;

export const BPM = 100;
export const STEPS_PER_BAR = 16;
export const STEP_S = 60 / BPM / 4;
export const BEAT_S = STEP_S * 4;
export const BAR_S = STEP_S * STEPS_PER_BAR;
export const BARS = 25;
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
  /** MIDI pitches sounded together (the keys play a seventh chord; the drum uses 36 kick, 38 snare). */
  midi: number[];
}

interface Chord {
  /** The bass note (wire); the tuba plays an octave above. */
  root: number;
  /** Semitones from the root to the third (3 minor, 4 major). */
  third: number;
  /** The voicing the keys stab, a seventh chord. */
  triad: number[];
}

const AM: Chord = { root: 45, third: 3, triad: [57, 60, 64, 67] };
const DM: Chord = { root: 38, third: 3, triad: [57, 60, 62, 65] };
const G7: Chord = { root: 43, third: 4, triad: [55, 59, 62, 65] };
const F: Chord = { root: 41, third: 4, triad: [57, 60, 64, 65] };
const E7: Chord = { root: 40, third: 4, triad: [56, 59, 62, 64] };

/** One chord per bar: intro, 12-bar minor blues, 8-bar chorus, home. */
const PROGRESSION: readonly Chord[] = [
  ...[AM, AM, AM, AM],
  ...[AM, AM, AM, AM, DM, DM, AM, AM, F, E7, AM, E7],
  ...[AM, G7, DM, AM, AM, G7, F, E7],
  AM,
];

/** The last bar resolves home on Am. */
export function chordAt(bar: number): Chord {
  return PROGRESSION[Math.min(Math.max(bar, 0), PROGRESSION.length - 1)]!;
}

/** Chimes: A minor blues, with the flat fifth (i) and a low G and E to come down to. */
const CHIME: Record<string, number> = {
  k: 64,
  j: 67,
  a: 69,
  b: 71,
  c: 72,
  d: 74,
  i: 75,
  e: 76,
  f: 77,
  g: 79,
  h: 81,
};

/** What a pattern letter sounds like for a seat, over a chord. */
function pitches(seat: SeatId, token: string, chord: Chord): number[] {
  switch (seat) {
    case 'wire': {
      // r root, m third, n fourth, f fifth, t flat seventh, o octave, l fifth below.
      const up: Record<string, number> = { r: 0, m: chord.third, n: 5, f: 7, t: 10, o: 12, l: -5 };
      return [chord.root + (up[token] ?? 0)];
    }
    case 'keys':
      return [...chord.triad];
    case 'chimes':
      return [CHIME[token] ?? 69];
    case 'drum':
      return [token === 's' ? 38 : 36];
    case 'tuba': {
      // r root, m third, f fifth, t flat seventh, o octave (all above the wire).
      const up: Record<string, number> = { r: 12, m: 12 + chord.third, f: 19, t: 22, o: 24 };
      return [chord.root + (up[token] ?? 12)];
    }
  }
}

type BarPatterns = Partial<Record<SeatId, string>>;

/** The wire's riff: root, a push on the and-of-two, then up through the chord. */
const RIFF_A = 'r.....r.m.f.t...';
/** Its answer: the same push, then a gap, then a climb to the flat seventh. */
const RIFF_B = 'r.....r.....f.t.';
/** The turnaround riff: walks up into the next chorus. */
const RIFF_C = 'r...r.m.f.n.....';

/** The drum's backbeat, and a busier one with a second kick. */
const BEAT_1 = 'k...s.....k.s...';
const BEAT_2 = 'k...s...k.k.s...';
const FILL = 'k...s...k.s.s.s.';

/** The keys stab the off-beats: a sparse skank and a busier one. */
const STAB_1 = '..x...x.....x...';
const STAB_2 = '..x.....x.x.x...';

/** Chimes and tuba: a call in one half of the bar, the other seat answers in the other. */
function trade(calls: 'chimes' | 'tuba', call: string, answer: string): BarPatterns {
  const first = call + '.'.repeat(16 - call.length);
  const second = '.'.repeat(16 - answer.length) + answer;
  return calls === 'chimes' ? { chimes: first, tuba: second } : { tuba: first, chimes: second };
}

/** Twelve-bar minor blues: Am Am Am Am / Dm Dm Am Am / F E Am E. */
const VERSE: BarPatterns[] = [
  { drum: BEAT_1, wire: RIFF_A, keys: STAB_1, ...trade('chimes', 'e...d.c.', 'r...f.t.') },
  { drum: BEAT_2, wire: RIFF_B, keys: STAB_2, ...trade('tuba', 'r...r.f.', 'e...g.d.') },
  { drum: BEAT_1, wire: RIFF_A, keys: STAB_1, ...trade('chimes', 'a...c.d.', 'r...f.o.') },
  { drum: BEAT_2, wire: RIFF_B, keys: STAB_2, ...trade('tuba', 'r...f.t.', 'g...e.d.') },
  { drum: BEAT_1, wire: RIFF_A, keys: STAB_1, ...trade('chimes', 'd...f.e.', 'r...f.m.') },
  { drum: BEAT_2, wire: RIFF_B, keys: STAB_2, ...trade('tuba', 'r...r.f.', 'a...c.d.') },
  { drum: BEAT_1, wire: RIFF_A, keys: STAB_1, ...trade('chimes', 'e...g.e.', 'r...f.t.') },
  { drum: BEAT_2, wire: RIFF_B, keys: STAB_2, ...trade('tuba', 'r...f.r.', 'e...d.c.') },
  { drum: BEAT_1, wire: RIFF_A, keys: STAB_1, ...trade('chimes', 'c...d.f.', 'r...f.m.') },
  { drum: BEAT_2, wire: RIFF_B, keys: STAB_2, ...trade('tuba', 'r...f.t.', 'b...e.d.') },
  { drum: BEAT_1, wire: RIFF_A, keys: STAB_1, ...trade('chimes', 'a...c.e.', 'r...f.o.') },
  { drum: FILL, wire: RIFF_C, keys: STAB_2, chimes: 'e...g...........', tuba: '........t...f.m.' },
];

/** Eight-bar shout chorus: Am G Dm Am / Am G F E, everyone in and busier. */
const CHORUS: BarPatterns[] = [
  { drum: BEAT_2, wire: RIFF_A, keys: STAB_2, ...trade('chimes', 'h...e.g.', 'r...f.t.') },
  { drum: BEAT_1, wire: RIFF_B, keys: STAB_2, ...trade('tuba', 'r...r.f.', 'e...g.d.') },
  { drum: BEAT_1, wire: RIFF_A, keys: STAB_2, ...trade('chimes', 'f...e.d.', 'r...f.m.') },
  { drum: FILL, wire: RIFF_B, keys: STAB_2, ...trade('tuba', 'r...f.t.', 'c...d.e.') },
  { drum: BEAT_2, wire: RIFF_A, keys: STAB_2, ...trade('chimes', 'h...g.e.', 'r...f.t.') },
  { drum: BEAT_1, wire: RIFF_B, keys: STAB_2, ...trade('tuba', 'r...f.r.', 'g...e.d.') },
  { drum: BEAT_1, wire: RIFF_A, keys: STAB_2, ...trade('chimes', 'c...d.f.', 'r...f.m.') },
  { drum: FILL, wire: RIFF_C, keys: STAB_2, chimes: 'h...g...e.......', tuba: '........t...f.r.' },
];

/** The machine starts one part at a time, so each player hears their own entrance. */
const INTRO: BarPatterns[] = [
  { drum: BEAT_1 },
  { drum: BEAT_1, wire: RIFF_A },
  { drum: BEAT_1, wire: RIFF_B, keys: STAB_1 },
  VERSE[0]!,
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
  if (bar < 16) return 'verse';
  if (bar < BARS - 1) return 'chorus';
  return 'finale';
}

function patternsAt(bar: number): BarPatterns {
  switch (sectionAt(bar)) {
    case 'intro':
      return INTRO[bar]!;
    case 'verse':
      return VERSE[bar - 4]!;
    case 'chorus':
      return CHORUS[bar - 16]!;
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
      if (pattern.length !== STEPS_PER_BAR) throw new Error(`bar ${bar} ${seat}: pattern is not 16 steps`);
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
