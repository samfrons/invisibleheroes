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
  /** Keyboard key this player presses. */
  key: string;
  /** Signature move, used in the later "pattern twist" rounds. */
  move: Move;
  /** Picture in public/microbes/. */
  image: string;
  /** The learning card: why this microbe matters, in its own voice. */
  pitch: string;
}

export const MICROBES: Microbe[] = [
  {
    id: 'geo',
    name: 'Geo',
    species: 'Geobacter sulfurreducens',
    color: '#ffd23f', // yellow
    key: 'a',
    move: 'tap',
    image: '/microbes/geo.jpg',
    pitch:
      'I make electricity! I grow tiny wires and pass electrons out of my body. ' +
      'Scientists use me in fuel cells that clean dirty water and make power at the same time.',
  },
  {
    id: 'shiva',
    name: 'Shiva',
    species: 'Shewanella oneidensis',
    color: '#ff5fa2', // pink
    key: 'f',
    move: 'double-tap',
    image: '/microbes/shiva.jpg',
    pitch:
      'I can breathe metals instead of oxygen! That helps clean toxic metals out of ' +
      'water and soil, and I can pass my electrons to electrodes too.',
  },
  {
    id: 'cable',
    name: 'Cable',
    species: 'Cable bacteria (Desulfobulbaceae)',
    color: '#5cc04a', // green
    key: 'j',
    move: 'hold',
    image: '/microbes/cable.jpg',
    pitch:
      'Thousands of us join into one living electric cable, centimetres long, hidden ' +
      'in the mud on the seafloor. Scientists only discovered us in 2012!',
  },
  {
    id: 'rhodo',
    name: 'Rhodo',
    species: 'Rhodopseudomonas palustris',
    color: '#a24fd0', // purple
    key: 'l',
    move: 'triple-tap',
    image: '/microbes/rhodo.jpg',
    pitch:
      'I run on sunlight, like a plant, and I am purple! I can make hydrogen, ' +
      'a clean fuel for the future.',
  },
];
