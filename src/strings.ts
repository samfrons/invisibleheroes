/**
 * Every word on screen, in one place. English today.
 *
 * The instruments are invented. The line under each hero is not: it is what
 * that organism is actually known for, kept to what the cited work reports.
 */
import type { Rank } from './engine';
import type { RenderLabels } from './types';

export interface Hero {
  /** Keyboard key for the seat. */
  key: string;
  /** Short name, used on the stage. */
  name: string;
  /** Full name as a biologist would write it. */
  fullName: string;
  /** True for a species name set in italics. */
  latin: boolean;
  instrument: string;
  /** What it really does, in one sentence. */
  fact: string;
  /** The same in 12 words or fewer, for the seat card, the phone and the video credits. */
  short: string;
  /** Where that sentence comes from. */
  source: string;
}

/**
 * In seat order (score.ts SEATS): wire, keys, chimes, drum, tuba. Each seat is
 * one job in the fuel cell (kinetics.ts), and src/microbes.ts holds the
 * learning cards and pictures for the same five.
 */
export const HEROES: readonly Hero[] = [
  {
    key: 'A',
    name: 'Geo',
    fullName: 'Geobacter sulfurreducens',
    latin: true,
    instrument: 'nanowire bass',
    fact: 'Grows protein filaments that conduct electricity and passes electrons along them to an electrode.',
    short: 'Geo passes electrons straight down wires it grows itself.',
    source: 'Reguera et al., Nature 2005',
  },
  {
    key: 'D',
    name: 'Shiva',
    fullName: 'Shewanella oneidensis',
    latin: true,
    instrument: 'flavin keys',
    fact: 'Releases flavins, small molecules that carry its electrons across to a surface, and can breathe metals instead of oxygen.',
    short: 'Shiva sends out flavin shuttles that carry its electrons.',
    source: 'Marsili et al., PNAS 2008',
  },
  {
    key: 'G',
    name: 'Rhodo',
    fullName: 'Rhodopseudomonas palustris',
    latin: true,
    instrument: 'sunlight chimes',
    fact: 'A purple bacterium that runs on sunlight, makes hydrogen, and can pass electrons to an electrode.',
    short: 'Rhodo turns sunlight into electrons and hydrogen.',
    source: 'Xing et al., Environ. Sci. Technol. 2008',
  },
  {
    key: 'J',
    name: 'Sporo',
    fullName: 'Sporomusa ovata',
    latin: true,
    instrument: 'vinegar drum',
    fact: 'Takes electrons from an electrode and uses them to turn carbon dioxide into acetate, the acid in vinegar.',
    short: 'Sporo takes electrons at the cathode and makes vinegar.',
    source: 'Nevin et al., mBio 2010',
  },
  {
    key: 'L',
    name: 'Cable',
    fullName: 'Cable bacteria (Desulfobulbaceae)',
    latin: false,
    instrument: 'cable tuba',
    fact: 'Thousands of cells join end to end into living wires centimetres long that carry electrons through seafloor mud.',
    short: 'Cable carries electrons centimetres through the mud.',
    source: 'Pfeffer et al., Nature 2012',
  },
];

export const RANKS: Record<Rank, { title: string; line: string }> = {
  headliners: { title: 'Headliners', line: 'The lamp never flickered. Book the tour.' },
  tight: { title: 'A tight culture', line: 'A few electrons got away. Most did not.' },
  garage: { title: 'Garage biofilm', line: 'It has a groove in there somewhere. One more take.' },
  inoculating: { title: 'Still inoculating', line: 'Every band starts here. Watch the ring, not the ball.' },
};

export const T = {
  eyebrow: 'A band battle for 1 to 5 players',
  lobbyTitle: 'Who is playing?',
  how: 'The band is a fuel cell. Geo, Shiva and Rhodo put electrons on the anode, Cable carries them, Sporo takes them at the cathode. Land your notes together and the current flows. Hit your key, or tap your column, when the ring closes.',
  player: 'Player',
  machine: 'Machine',
  start: 'Start the machine',
  startNeedsPlayer: 'Pick at least one player',
  meet: 'Meet the band',
  meetHint: 'Swipe to meet all five.',
  cardPower: 'Superpower',
  cardJob: 'Job in the fuel cell',
  cardScience: 'The science',
  cardLabel: 'Learning card: {name}',
  portraitAlt: 'Pixel-art portrait of {name}, {species}',
  portraitAltSporo: 'Drawing of {name}, {species}: a curved teal rod',
  yourCard: 'Your microbe',
  honest:
    'The instruments are made up. The heroes are real: Geo, Shiva and Rhodo give electrons to an electrode, Cable bacteria carry electrons through mud, and Sporo takes electrons back to make vinegar.',
  turnPhone: 'Three or more on one phone? Turn it sideways for wider pads.',
  soloKey: 'Playing alone? The space bar works too.',
  careerNone: 'No takes yet on this device.',
  career: 'Take {takes} · best {best}%',
  careerDays: '{days} days running',
  stop: 'Stop',
  skip: 'Skip',
  soundOn: 'Sound on',
  soundOff: 'Sound off',
  fullscreen: 'Full screen',
  exitFullscreen: 'Exit full screen',
  takeN: 'Take {n}',
  newBest: 'New best',
  hits: '{hit} of {total}',
  bestStreak: 'Longest run: {n} in a row',
  wins: '{name} wins the battle',
  packLine: 'Battery pack {pack}% charged',
  cellLine: 'The fuel cell made {mJ} mJ, {pct}% of a perfect band. Peak {uW} µW at {mV} mV.',
  weakLink: '{name} was the weak link: {why}',
  why: {
    direct: 'fewer electrons went down the nanowires.',
    shuttle: 'fewer flavin shuttles made it to the anode.',
    light: 'the sunlight went to waste.',
    cathode: 'with no drum the cathode could not take the electrons.',
    conductor: 'without the cable the current had no path.',
  },
  cell: '{n}%',
  house: 'machine',
  watch: 'Watch the video',
  save: 'Save the video file',
  saving: 'Recording the video. It saves when the song ends.',
  saved: 'Saved {name}',
  saveFailed: 'This browser could not record the video.',
  share: 'Share this take',
  copied: 'Link copied',
  shareFailed: 'Could not copy the link',
  shareText: 'We scored {score}% in The Biofilm Band. Watch our video, then beat it.',
  again: 'Play again',
  lineup: 'Change the line-up',
  sharedTitle: 'Someone sent you a take',
  sharedLine: 'A band of {n} scored {score}%. Watch their video, then beat it.',
  sharedPlay: 'Play their video',
  sharedOwn: 'Play it yourself',
  theirTake: 'Their take',
  beatIt: 'Beat it',
  paused: 'The take stopped because the page went to the background.',
  stageLabel: 'The Biofilm Band stage',

  /* phones as buttons */
  phone: 'Phone',
  addPhones: 'Add phones',
  opening: 'Opening a room',
  roomFailed: 'Could not open a room. Check the connection and try again.',
  roomDown: 'The room closed. Add phones again to reopen it.',
  roomTitle: 'Scan to join',
  roomLine: 'Each phone becomes one player\'s button. Watch this screen, tap your phone.',
  roomCode: 'Room {code}',
  roomCount: '{n} connected',
  closeRoom: 'Close the room',
  roomLocalhost:
    'This address only works on this computer. To join from phones, open the game from an address they can reach.',
  qrLabel: 'QR code to join room {code}',

  joinTitle: 'The Biofilm Band',
  joining: 'Joining room {code}',
  joinFailed: 'Could not reach room {code}. Is it still open on the big screen?',
  joinBadCode: 'That is not a room code.',
  retry: 'Try again',
  pickHero: 'Pick your hero',
  yours: 'Yours',
  taken: 'Taken',
  free: 'Free',
  waitHost: 'You are in. The take starts from the big screen.',
  noSeat: 'Every seat is taken. Wait for one to free up.',
  padHint: 'Watch the big screen. Tap when the ring closes.',
  padWait: 'Get ready',
  spectating: 'A take is running. You can join the next one.',
  phoneResult: 'The band scored {score}%',
  phoneNext: 'Stay here for the next take.',
  phoneVideo: 'The video is playing on the big screen.',
  lost: 'Lost the room.',
} as const;

/**
 * Lines from Sam Frons's "Bacterial Blues", used as caption cards in the video.
 * The last three are the chant, one per hit of the final bar.
 */
const LYRICS = [
  'Well, I got bacteria in my fuel cell tonight',
  "They're munchin' on sewage by the pale moonlight",
  'Down in the chamber where the microbes play',
  "Electrons dancin' like it's judgment day",
  "Geobacter's singing its electron lullaby",
  "It's a microscopic carnival ride",
  "So here's to the bugs that nobody sees",
] as const;
const CHANT = ['WE ARE THE MICROBES!', 'CLEANING YOUR WATER!', 'MAKING ELECTRICITY!'] as const;

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

export function renderLabels(touch: boolean): RenderLabels {
  return {
    seats: HEROES.map((h) => ({
      key: touch ? 'TAP' : h.key,
      name: h.name,
      instrument: h.instrument,
      fact: h.short,
    })),
    perfect: 'PERFECT',
    good: 'GOOD',
    miss: 'MISS',
    machine: 'MACHINE',
    phone: 'PHONE',
    take: 'TAKE',
    battery: 'BATTERY',
    winner: 'WINNER',
    onAir: 'ON AIR',
    countIn: ['4', '3', '2', 'GO'],
    title: 'THE BIOFILM BAND',
    subtitle: 'an Invisible Heroes video',
    rec: 'REC',
    theEnd: 'THE END',
    lyrics: LYRICS,
    chant: CHANT,
  };
}
