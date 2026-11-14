// The four microbe heroes: who they are, how they look, and what players learn
// about them on the character select screen.
//
// How to read this file:
// - `Microbe` describes what every hero has (like the columns of a table).
// - `MICROBES` is the list of heroes (like the rows of the table).
// Change a name, colour, key or text here and the game picks it up everywhere.

/** How a player answers when their microbe flashes. */
export type Move = 'tap' | 'double-tap' | 'hold' | 'triple-tap';

export interface Microbe {
  /** Short id used in code and in the image file name. */
  id: string;
  /** Nickname shown in the game. */
  name: string;
  /** The real scientific name. */
  species: string;
  /** Main colour, as a web colour code. */
  color: string;
  /** Seat in the band (score.ts SEATS) and job in the fuel cell (kinetics.ts ROLES). */
  seat: number;
  /** Keyboard key this player presses (the game's seat key; 1 to 5 work too). */
  key: string;
  /** Signature move, used in the later "pattern twist" rounds. */
  move: Move;
  /** Picture in public/microbes/, or null for a hero drawn by the game. */
  image: string | null;
  /** What this hero does in the fuel cell, in a few words. */
  job: string;
  /** Superpower in a few words: what this microbe can do. */
  power: string;
  /** The learning card: why this microbe matters, in its own voice. */
  pitch: string;
}

export const MICROBES: Microbe[] = [
  {
    id: 'geo',
    name: 'Geo',
    species: 'Geobacter sulfurreducens',
    color: '#ffd23f', // yellow
    seat: 0,
    key: 'a',
    move: 'tap',
    image: '/microbes/geo.jpg',
    job: 'Puts electrons straight on the anode',
    power: 'Makes electricity with tiny nanowires',
    pitch:
      'I make electricity! I grow tiny wires and pass electrons out of my body. ' +
      'Scientists use me in fuel cells that clean dirty water and make power at the same time.',
  },
  {
    id: 'shiva',
    name: 'Shiva',
    species: 'Shewanella oneidensis',
    color: '#ff5fa2', // pink
    seat: 1,
    key: 'd',
    move: 'double-tap',
    image: '/microbes/shiva.jpg',
    job: 'Sends flavin shuttles: electrons land half a beat later',
    power: 'Breathes metals and cleans up toxic waste',
    pitch:
      'I can breathe metals instead of oxygen! That helps clean toxic metals out of ' +
      'water and soil, and I can pass my electrons to electrodes too.',
  },
  {
    id: 'cable',
    name: 'Cable',
    species: 'Cable bacteria (Desulfobulbaceae)',
    color: '#5cc04a', // green
    seat: 4,
    key: 'l',
    move: 'hold',
    image: '/microbes/cable.jpg',
    job: 'Carries the current: lowers the resistance',
    power: 'Builds living electric cables in seafloor mud',
    pitch:
      'Thousands of us join into one living electric cable, centimetres long, hidden ' +
      'in the mud on the seafloor. Scientists only discovered us in 2012!',
  },
  {
    id: 'rhodo',
    name: 'Rhodo',
    species: 'Rhodopseudomonas palustris',
    color: '#b18cff', // purple
    seat: 2,
    key: 'g',
    move: 'triple-tap',
    image: '/microbes/rhodo.jpg',
    job: 'Turns sunlight into electrons: brighter in the chorus',
    power: 'Runs on sunlight and makes hydrogen fuel',
    pitch:
      'I run on sunlight, like a plant, and I am purple! I can make hydrogen, ' +
      'a clean fuel for the future.',
  },
  {
    id: 'sporo',
    name: 'Sporo',
    species: 'Sporomusa ovata',
    color: '#4ecdc4', // teal, the cathode side
    seat: 3,
    key: 'j',
    move: 'tap',
    image: null,
    job: 'Takes the electrons at the cathode: keeps the beat',
    power: 'Eats electrons and makes vinegar',
    pitch:
      'I sit on the other electrode and take the electrons back! I use them to turn ' +
      'carbon dioxide into acetate, the acid in vinegar. No me, no current.',
  },
];

/** The heroes in seat order, so MICROBES_BY_SEAT[seat] is the hero playing that part. */
export const MICROBES_BY_SEAT: readonly Microbe[] = [...MICROBES].sort((a, b) => a.seat - b.seat);
