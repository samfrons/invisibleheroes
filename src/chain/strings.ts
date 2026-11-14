/**
 * Every word Electron Chain puts on screen. English today. The microbes' names
 * and facts come from the band's HEROES (src/strings.ts), so both games tell
 * the same true story about each organism.
 */
import { HEROES } from '../strings';
import type { ChainLabels } from './render';
import { CHAIN_SEATS, GOAL, LIVES, TIME_S } from './rules';

/** Keys from the concept: far apart, so four people fit round one keyboard. */
export const CHAIN_KEYS = ['A', 'F', 'J', 'L'] as const;

export const CHAIN_HEROES = CHAIN_SEATS.map((seat) => HEROES[seat]!);

export const C = {
  docTitle: 'Invisible Heroes: Electron Chain',
  brand: 'Electron Chain',
  eyebrow: `Multiplayer co-op · 1 to 4 players · phones or keys · ${TIME_S / 60} minutes`,
  lobbyTitle: 'Make electricity. Power the town.',
  how:
    `You are the biofilm inside a microbial fuel cell. The colony flashes a signal; repeat it in order, ` +
    `each pressing only your own microbe. Every right press passes the electron down the chain; the whole ` +
    `signal sends a pulse of current through the circuit to the town. ${GOAL} pulses power all ${GOAL} houses. ` +
    `${LIVES} broken chains, or ${TIME_S / 60} minutes, and it's a blackout.`,
  twistNote: 'From round 8 some flashes blink twice: tap twice, quickly.',
  soloNote: 'Fewer than four of you? Share: one person can play two keys.',
  start: 'Start the chain',
  again: 'Play again',
  back: 'Back to the band',
  addPhones: 'Play on phones (scan a QR)',
  opening: 'Opening a room',
  roomFailed: 'Could not open a room. Check the connection and try again.',
  roomDown: 'The room closed. Add phones again to reopen it.',
  roomTitle: 'Scan to join',
  roomLine: 'Each phone becomes one microbe\'s button. Watch this screen, tap your phone.',
  roomCount: '{n} connected',
  closeRoom: 'Close the room',
  qrLabel: 'QR code to join room {code}',
  player: 'player',
  phoneSeat: 'phone',
  science:
    'This is real. In a biofilm, Geobacter cells pass electrons to each other along protein ' +
    'nanowires, a living bucket brigade, and the biofilm as a whole conducts electricity to an ' +
    'electrode. Bacteria also coordinate by sending each other chemical signals (quorum sensing).',
  scienceSource: 'Reguera et al., Nature 2005; Malvankar et al., Nature Nanotechnology 2011',
  wonTitle: 'The town is powered',
  lostTitleBreaks: 'Blackout: the chain broke three times',
  lostTitleTime: 'Blackout: time ran out',
  stats: '{charge} of {goal} pulses delivered · {hops} electron hops · longest signal {longest}',
  paused: 'Paused: the tab was hidden.',
  stageLabel: 'Electron Chain: four microbes in a fuel cell pass electrons to power a town',
  soundOn: 'Sound on',
  soundOff: 'Sound off',
};

export function chainLabels(touch: boolean): ChainLabels {
  return {
    keys: touch ? ['TAP', 'TAP', 'TAP', 'TAP'] : [...CHAIN_KEYS],
    names: CHAIN_HEROES.map((h) => h.name),
    anode: 'Anode',
    cathode: 'Cathode',
    membrane: 'Membrane',
    load: 'Load: the town',
    source: 'acetate',
    water: 'O2 + H+ + e- > H2O',
    voltage: 'Voltage',
    current: 'Current',
    power: 'Power',
    chain: 'Chain',
    phone: 'PHONE',
    round: 'Pulse {n} / {of}',
    watch: 'Watch the colony',
    yourTurn: 'Your turn: repeat it',
    delivered: 'Current flowing',
    broken: {
      wrong: 'Chain broken: wrong microbe',
      half: 'Chain broken: that one was a double',
      cold: 'Chain broken: the electron went cold',
    },
    twice: 'x2',
    lit: 'The town is powered',
    blackout: 'Blackout',
    title: 'Electron Chain',
    subtitle: 'A living fuel cell, four players',
  };
}
