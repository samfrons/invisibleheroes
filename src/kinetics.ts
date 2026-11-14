/**
 * The fuel cell under the band (pure): how the notes the band lands turn into
 * electrons, current, voltage and power.
 *
 * Each seat plays one job in a microbial fuel cell, and its part of the tune
 * is the rhythm of that job:
 *
 * - Seat 0, the wire: Geo (Geobacter). Direct transfer down its nanowires,
 *   so a landed note puts its electrons on the anode at once.
 * - Seat 1, the keys: Shiva (Shewanella). Mediated transfer: a landed stab
 *   sends out a flavin shuttle, and the electrons arrive SHUTTLE_S later, on
 *   the next beat the keys skank against.
 * - Seat 2, the chimes: Rhodo (Rhodopseudomonas). Light-driven: what a note
 *   delivers scales with the sunlight, which rises through the song.
 * - Seat 3, the drum: Sporomusa at the cathode. Every landed beat takes
 *   electrons off the circuit to make acetate. No drum, no current: the
 *   electrons pile up on the anode with nowhere to go.
 * - Seat 4, the tuba: Cable (cable bacteria). The long-distance conductor:
 *   each landed note lowers the cell's internal resistance, which creeps back
 *   up between notes.
 *
 * The three givers grow biofilm as they land notes (a saturating, Monod-like
 * growth) and lose some with every miss; a thicker biofilm delivers more per
 * note. Current is the flow from the anode pool to the cathode's capacity,
 * limited by the conductance; voltage is the open-circuit voltage less the
 * activation and resistive losses; power is the two multiplied. So the band
 * only makes power when the givers, the drum and the cable land together.
 *
 * Everything is stepped on a fixed grid of song time (DT_S), so the same
 * grades always give the same cell.
 */
import { BARS, BAR_S, NOTES, SEAT_COUNT, STEP_S, sectionAt } from './score';

export const GEO = 0;
export const SHIVA = 1;
export const RHODO = 2;
export const SPORO = 3;
export const CABLE = 4;


/** The seats whose electrons go onto the anode. */
export const GIVERS = [GEO, SHIVA, RHODO] as const;

export type Role = 'direct' | 'shuttle' | 'light' | 'cathode' | 'conductor';
export const ROLES: readonly Role[] = ['direct', 'shuttle', 'light', 'cathode', 'conductor'];

/** Integration step: a quarter of a sixteenth note. */
export const DT_S = STEP_S / 4;
/** A flavin shuttle's round trip: one eighth note. */
export const SHUTTLE_S = 2 * STEP_S;
/** Open-circuit voltage of a good microbial fuel cell, in volts. */
export const OCV_V = 0.8;

const BIOFILM_START = 0.25;
const GROW = 0.12;
const SHED = 0.94;
/** Electrons a landed note delivers, per giver (Geo's wires are the best path). */
const YIELD = [1, 1.15, 1.1, 0, 0];
/** Cathode capacity a landed drum note opens. */
const CATHODE_PER_HIT = 3;
/** Conductance at rest, and how fast it relaxes back towards it. */
const G_REST = 0.3;
const G_TAU_S = 2 * BAR_S;
const G_PER_HIT = 0.45;
/** How fast charge flows at full conductance (per second). */
const FLOW_K = 9;
/** Electrons and cathode capacity leak away if they sit (side reactions, oxygen). */
const ANODE_TAU_S = 2 * BAR_S;
const CATHODE_TAU_S = BAR_S;
/** Current smoothing, so the dials read like a meter, not a strobe. */
const METER_TAU_S = 0.18;
/** Loss terms: activation (Tafel-like) and resistive, in volts per unit of current. */
const ACT_V = 0.05;
const ACT_I0 = 0.4;
const OHM_V = 0.02;

/** Sunlight for Rhodo by section: dawn in the intro, full sun in the chorus. */
export function sunlightAt(t: number): number {
  const bar = Math.floor(t / BAR_S);
  if (bar < 0) return 0.4;
  switch (sectionAt(Math.min(bar, BARS - 1))) {
    case 'intro':
      return 0.45 + 0.1 * bar;
    case 'verse':
      return 0.8;
    case 'chorus':
    case 'finale':
      return 1;
  }
}

export interface Cell {
  /** Song time the cell has been stepped to. */
  t: number;
  /** Per seat 0..1: biofilm on the anode (givers only; others stay 0). */
  biofilm: number[];
  /** Electrons waiting on the anode. */
  anode: number;
  /** Electrons the cathode can still take. */
  cathode: number;
  /** 0..1: how well the circuit conducts. */
  conductance: number;
  /** Shuttles in flight: arrival time and electrons, oldest first. */
  shuttles: { at: number; q: number }[];
  /** Smoothed current, voltage and power (arbitrary units; see display helpers). */
  current: number;
  voltage: number;
  power: number;
  /** Energy made so far: the integral of power. */
  energy: number;
  /** Per seat: electrons the seat moved (given, carried or taken). */
  moved: number[];
  /** Song time of the last electrons to land on the cathode, for the spark. */
  flowAt: number;
}

export function createCell(t = -BAR_S): Cell {
  const biofilm = new Array<number>(SEAT_COUNT).fill(0);
  for (const s of GIVERS) biofilm[s] = BIOFILM_START;
  return {
    t,
    biofilm,
    anode: 0,
    cathode: 0,
    conductance: G_REST,
    shuttles: [],
    current: 0,
    voltage: OCV_V,
    power: 0,
    energy: 0,
    moved: new Array<number>(SEAT_COUNT).fill(0),
    flowAt: -Infinity,
  };
}

/**
 * A note settled: `value` is 1 for a perfect, 0.7 for a good, 0 for a miss
 * (engine.chargeFor). `t` is the note's time; the cell is stepped to it first.
 */
export function deposit(cell: Cell, seat: number, value: number, t: number): void {
  step(cell, t);
  if (value <= 0) {
    if (cell.biofilm[seat]! > 0) cell.biofilm[seat] = Math.max(0.1, cell.biofilm[seat]! * SHED);
    return;
  }
  switch (ROLES[seat]) {
    case 'direct':
    case 'light': {
      const b = cell.biofilm[seat]!;
      const sun = ROLES[seat] === 'light' ? sunlightAt(t) : 1;
      const q = YIELD[seat]! * value * (0.4 + 0.6 * b) * sun;
      cell.anode += q;
      cell.moved[seat]! += q;
      cell.biofilm[seat] = b + GROW * value * (1 - b);
      break;
    }
    case 'shuttle': {
      const b = cell.biofilm[seat]!;
      const q = YIELD[seat]! * value * (0.4 + 0.6 * b);
      cell.shuttles.push({ at: t + SHUTTLE_S, q });
      cell.moved[seat]! += q;
      cell.biofilm[seat] = b + GROW * value * (1 - b);
      break;
    }
    case 'cathode':
      cell.cathode += CATHODE_PER_HIT * value;
      break;
    case 'conductor':
      cell.conductance += G_PER_HIT * value * (1 - cell.conductance);
      break;
  }
}

/** Integrate the cell forward on the fixed grid up to song time `t`. */
export function step(cell: Cell, t: number): void {
  while (cell.t + DT_S <= t) {
    cell.t += DT_S;
    const now = cell.t;
    while (cell.shuttles.length && cell.shuttles[0]!.at <= now) cell.anode += cell.shuttles.shift()!.q;

    cell.conductance += (G_REST - cell.conductance) * (DT_S / G_TAU_S);
    const flow = Math.min(cell.anode, cell.cathode) * (1 - Math.exp(-FLOW_K * cell.conductance * DT_S));
    cell.anode -= flow;
    cell.cathode -= flow;
    if (flow > 1e-3) cell.flowAt = now;
    // The drum and the cable get credit for the electrons they carried and took.
    cell.moved[SPORO]! += flow;
    cell.moved[CABLE]! += flow * cell.conductance;

    cell.anode *= 1 - DT_S / ANODE_TAU_S;
    cell.cathode *= 1 - DT_S / CATHODE_TAU_S;

    const instant = flow / DT_S;
    cell.current += (instant - cell.current) * (DT_S / METER_TAU_S);
    const loss = ACT_V * Math.log1p(cell.current / ACT_I0) + (OHM_V * cell.current) / Math.max(cell.conductance, 0.05);
    cell.voltage = Math.max(0, OCV_V - loss);
    cell.power = cell.voltage * cell.current;
    cell.energy += cell.power * DT_S;
  }
}

/** Run a whole take through the cell, from its grades (engine grades, indexed like NOTES). */
export function simulate(grades: Uint8Array, until = BARS * BAR_S + 2): Cell {
  const cell = createCell();
  for (const n of NOTES) {
    const g = grades[n.i]!;
    deposit(cell, n.seat, g === 3 ? 1 : g === 2 ? 0.7 : 0, n.t);
  }
  step(cell, until);
  return cell;
}

/** The cell an all-perfect band makes: the yardstick for the lamp and the results card. */
const BEST = simulate(new Uint8Array(NOTES.length).fill(3));
export const BEST_ENERGY = BEST.energy;
/** Peak power an all-perfect band reaches, roughly: the lamp is full here. */
export const PEAK_POWER = (() => {
  const cell = createCell();
  let peak = 0;
  for (const n of NOTES) {
    deposit(cell, n.seat, 1, n.t);
    peak = Math.max(peak, cell.power);
  }
  return peak * 0.7;
})();

/** 0..1: how bright the lamp is for this cell. */
export function lampOf(cell: Cell): number {
  return Math.min(1, Math.max(0, cell.power / PEAK_POWER));
}

export interface CellReport {
  cell: Cell;
  /** 0..1: energy against an all-perfect band's. */
  share: number;
  /** The best moment of the take: peak power and the voltage it came at. */
  peak: { power: number; voltage: number; current: number };
  /** The player's seat that cost the cell the most energy, or null if no player lost any. */
  weak: number | null;
}

/** The results card's view of a take: how much the cell made, and who held it back. */
export function report(grades: Uint8Array, humans: readonly boolean[]): CellReport {
  const run = (g: Uint8Array) => {
    const cell = createCell();
    const peak = { power: 0, voltage: OCV_V, current: 0 };
    for (const n of NOTES) {
      const v = g[n.i]!;
      deposit(cell, n.seat, v === 3 ? 1 : v === 2 ? 0.7 : 0, n.t);
      if (cell.power > peak.power) Object.assign(peak, { power: cell.power, voltage: cell.voltage, current: cell.current });
    }
    step(cell, BARS * BAR_S + 2);
    return { cell, peak };
  };
  const { cell, peak } = run(grades);
  let weak: number | null = null;
  let worst = 0.01 * BEST_ENERGY;
  for (let seat = 0; seat < SEAT_COUNT; seat++) {
    if (!humans[seat]) continue;
    const fixed = grades.slice();
    for (const n of NOTES) if (n.seat === seat) fixed[n.i] = 3;
    const gain = run(fixed).cell.energy - cell.energy;
    if (gain > worst) {
      worst = gain;
      weak = seat;
    }
  }
  return { cell, share: Math.min(1, cell.energy / BEST_ENERGY), peak, weak };
}

/** For the dials and the results card: the cell in lab units, scaled to a bench-top MFC. */
export function readout(cell: Pick<Cell, 'current' | 'voltage' | 'power' | 'energy'>) {
  return {
    /** Millivolts. */
    mV: Math.round(cell.voltage * 1000),
    /** Microamps. */
    uA: Math.round(cell.current * 120),
    /** Microwatts. */
    uW: Math.round(cell.power * 120 * 10) / 10,
    /** Millijoules over the take. */
    mJ: Math.round(cell.energy * 0.12 * 100) / 100,
  };
}
