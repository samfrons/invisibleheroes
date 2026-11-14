/**
 * Electron Chain (pure): the rules of the memory game, with no DOM, clock or
 * sound. The shell calls `update(t)` every frame and `press(player, t)` on
 * every key or tap, with `t` in seconds on one clock, and turns the events that
 * come back into pictures and sound.
 *
 * A round: the colony signals a sequence (each step one microbe), then the
 * players repeat it, each pressing only their own key. Every right press moves
 * the electron one hop; the whole sequence delivers it to the battery and the
 * next round adds a step. A wrong press, a double-tap left half done, or a
 * chain left waiting too long breaks the chain and the round is signalled
 * again. Ten electrons win; three breaks or the five-minute timer lose.
 */

/** The four microbes, as indexes into HEROES / SEAT_STRONG (the band's seats). Reed is a plant: it sits out. */
export const CHAIN_SEATS = [0, 1, 3, 4] as const;
export const PLAYERS = CHAIN_SEATS.length;

/** Electrons to fill the battery. One per round won. */
export const GOAL = 10;
/** Broken chains before the blackout. */
export const LIVES = 3;
/** The whole game, in seconds. */
export const TIME_S = 300;

/** The second tap of a double must land this soon after the first. */
export const DOUBLE_GAP_S = 0.5;
/** A chain left waiting this long for its next press goes cold and breaks. */
export const COLD_S = 5;
/** Quiet before the first flash of a signal, so everyone looks up. */
export const LEAD_S = 0.9;
/** How long the delivered and broken moments last before the next signal. */
export const DELIVER_S = 1.6;
export const BROKEN_S = 1.8;
/** Steps in round 1. Every round after adds one. */
export const FIRST_LENGTH = 3;

export type StepKind = 'tap' | 'double';

export interface Step {
  player: number;
  kind: StepKind;
}

export interface Tempo {
  /** How long one flash is lit. */
  flashS: number;
  /** Dark time between flashes. */
  gapS: number;
}

/** Rounds 1-3 slow, 4-7 faster, 8-10 fastest (and the doubles come in). */
export function tempoFor(round: number): Tempo {
  if (round <= 3) return { flashS: 0.6, gapS: 0.28 };
  if (round <= 7) return { flashS: 0.45, gapS: 0.2 };
  return { flashS: 0.38, gapS: 0.16 };
}

/**
 * The step a round appends. Rounds 1-3 never repeat the microbe before it;
 * from round 4 the same microbe can come twice running; from round 8 a step
 * can be a double-tap.
 */
export function nextStep(prev: Step | undefined, round: number, random: () => number): Step {
  let player = Math.floor(random() * PLAYERS) % PLAYERS;
  if (round <= 3 && prev && player === prev.player) {
    player = (player + 1 + (Math.floor(random() * (PLAYERS - 1)) % (PLAYERS - 1))) % PLAYERS;
  }
  const kind: StepKind = round >= 8 && random() < 0.4 ? 'double' : 'tap';
  return { player, kind };
}

/** When each step of a signal starting at `start` lights up. */
export function flashTimes(sequence: readonly Step[], round: number, start: number): number[] {
  const { flashS, gapS } = tempoFor(round);
  return sequence.map((_, i) => start + LEAD_S + i * (flashS + gapS));
}

/** How long a whole signal takes, from its start to the moment the players may answer. */
export function signalLength(sequence: readonly Step[], round: number): number {
  const { flashS, gapS } = tempoFor(round);
  return LEAD_S + sequence.length * (flashS + gapS);
}

export type ChainPhase = 'signal' | 'repeat' | 'delivered' | 'broken' | 'won' | 'lost';
export type BreakReason = 'wrong' | 'half' | 'cold';
export type LoseReason = 'breaks' | 'time';

export type ChainEvent =
  /** A step of the signal lights up now. */
  | { k: 'flash'; player: number; kind: StepKind; index: number }
  /** The signal is over: the players' turn. */
  | { k: 'yourTurn' }
  /** The first tap of a double landed. */
  | { k: 'half'; player: number }
  /** A right press: the electron hops to `player`. `index` is the step just completed. */
  | { k: 'hop'; player: number; index: number }
  | { k: 'delivered'; charge: number }
  /** `player` is who pressed wrong, or whose double was left half done, or who the chain waited on. */
  | { k: 'break'; reason: BreakReason; player: number; breaks: number }
  /** A new signal begins: a new round, or the same round again after a break. */
  | { k: 'signal'; round: number; length: number; replay: boolean }
  | { k: 'won' }
  | { k: 'lost'; reason: LoseReason };

export interface ChainState {
  phase: ChainPhase;
  /** When the current phase began. */
  phaseAt: number;
  startAt: number;
  /** 1-based. The round being played, or the last one once the game is over. */
  round: number;
  sequence: Step[];
  /** Signal: how many steps have flashed. Repeat: how many steps are done. */
  pos: number;
  /** Time of the first tap of a double still waiting for its second, or null. */
  halfAt: number | null;
  /** When the chain last moved (the turn began or a right press landed). */
  lastMoveAt: number;
  /** The player the electron is with, or null while it waits at the start of the chain. */
  holder: number | null;
  charge: number;
  breaks: number;
  /** Right presses over the whole game, for the end card. */
  hops: number;
  /** The longest sequence repeated without a break. */
  longest: number;
  /** Why the game was lost, once it is. */
  lostBy: LoseReason | null;
}

export function createChain(t: number, random: () => number = Math.random): ChainState {
  const sequence: Step[] = [];
  for (let i = 0; i < FIRST_LENGTH; i++) sequence.push(nextStep(sequence[i - 1], 1, random));
  return {
    phase: 'signal',
    phaseAt: t,
    startAt: t,
    round: 1,
    sequence,
    pos: 0,
    halfAt: null,
    lastMoveAt: t,
    holder: null,
    charge: 0,
    breaks: 0,
    hops: 0,
    longest: 0,
    lostBy: null,
  };
}

export const timeLeft = (s: ChainState, t: number) => Math.max(0, TIME_S - (t - s.startAt));
export const isOver = (s: ChainState) => s.phase === 'won' || s.phase === 'lost';

function startSignal(s: ChainState, t: number, replay: boolean): ChainEvent {
  s.phase = 'signal';
  s.phaseAt = t;
  s.pos = 0;
  s.halfAt = null;
  s.holder = null;
  return { k: 'signal', round: s.round, length: s.sequence.length, replay };
}

function breakChain(s: ChainState, t: number, reason: BreakReason, player: number): ChainEvent[] {
  s.breaks += 1;
  s.halfAt = null;
  const out: ChainEvent[] = [{ k: 'break', reason, player, breaks: s.breaks }];
  if (s.breaks >= LIVES) {
    s.lostBy = 'breaks';
    s.phase = 'lost';
    s.phaseAt = t;
    out.push({ k: 'lost', reason: 'breaks' });
  } else {
    s.phase = 'broken';
    s.phaseAt = t;
  }
  return out;
}

function completeStep(s: ChainState, t: number, player: number): ChainEvent[] {
  const index = s.pos;
  s.pos += 1;
  s.halfAt = null;
  s.holder = player;
  s.lastMoveAt = t;
  s.hops += 1;
  const out: ChainEvent[] = [{ k: 'hop', player, index }];
  if (s.pos < s.sequence.length) return out;
  s.charge += 1;
  s.longest = Math.max(s.longest, s.sequence.length);
  out.push({ k: 'delivered', charge: s.charge });
  s.phaseAt = t;
  if (s.charge >= GOAL) {
    s.phase = 'won';
    out.push({ k: 'won' });
  } else {
    s.phase = 'delivered';
  }
  return out;
}

/** Move the game on to time `t`. Call every frame; returns what happened since the last call. */
export function update(s: ChainState, t: number, random: () => number = Math.random): ChainEvent[] {
  if (isOver(s)) return [];
  if (t - s.startAt >= TIME_S) {
    s.phase = 'lost';
    s.phaseAt = t;
    s.halfAt = null;
    s.lostBy = 'time';
    return [{ k: 'lost', reason: 'time' }];
  }
  const out: ChainEvent[] = [];
  switch (s.phase) {
    case 'signal': {
      const times = flashTimes(s.sequence, s.round, s.phaseAt);
      while (s.pos < s.sequence.length && t >= times[s.pos]!) {
        const step = s.sequence[s.pos]!;
        out.push({ k: 'flash', player: step.player, kind: step.kind, index: s.pos });
        s.pos += 1;
      }
      if (t >= s.phaseAt + signalLength(s.sequence, s.round)) {
        s.phase = 'repeat';
        s.phaseAt = t;
        s.pos = 0;
        s.lastMoveAt = t;
        out.push({ k: 'yourTurn' });
      }
      break;
    }
    case 'repeat': {
      const expected = s.sequence[s.pos]!;
      if (s.halfAt !== null && t - s.halfAt > DOUBLE_GAP_S) {
        out.push(...breakChain(s, t, 'half', expected.player));
      } else if (s.halfAt === null && t - s.lastMoveAt > COLD_S) {
        out.push(...breakChain(s, t, 'cold', expected.player));
      }
      break;
    }
    case 'delivered':
      if (t - s.phaseAt >= DELIVER_S) {
        s.round += 1;
        s.sequence.push(nextStep(s.sequence[s.sequence.length - 1], s.round, random));
        out.push(startSignal(s, t, false));
      }
      break;
    case 'broken':
      if (t - s.phaseAt >= BROKEN_S) out.push(startSignal(s, t, true));
      break;
  }
  return out;
}

/** A player pressed their key at `t`. Presses outside the players' turn do nothing. */
export function press(s: ChainState, player: number, t: number): ChainEvent[] {
  if (s.phase !== 'repeat' || player < 0 || player >= PLAYERS) return [];
  const expected = s.sequence[s.pos]!;
  if (player !== expected.player) return breakChain(s, t, 'wrong', player);
  if (expected.kind === 'tap') return completeStep(s, t, player);
  if (s.halfAt === null) {
    s.halfAt = t;
    return [{ k: 'half', player }];
  }
  return completeStep(s, t, player);
}
