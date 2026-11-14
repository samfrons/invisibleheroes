/**
 * Electron Chain's page: the lobby and end cards, the frame loop, and every
 * way a press arrives (keys, fingers, phones). The rules (rules.ts) decide
 * what happens; this file only forwards presses, plays the sounds and paints.
 *
 * It borrows the band's page (index.html, style.css), synth voices, hero art
 * and phone room, so a phone that joins with the same QR flow becomes one
 * microbe's button here too.
 */
import '../style.css';
import './chain.css';
import { MISS, PERFECT } from '../engine';
import { openHostRoom, type HostRoom } from '../net/host';
import { carrierFromUrl } from '../net/transport';
import { qrSvg } from '../qr';
import { SEAT_COUNT } from '../score';
import { loadCareer, saveCareer } from '../storage';
import { createBandAudio } from '../synth';
import { PLAYER_COLORS, createChainRenderer } from './render';
import {
  CHAIN_SEATS,
  GOAL,
  PLAYERS,
  createChain,
  isOver,
  press,
  tempoFor,
  update,
  type ChainEvent,
  type ChainState,
  type LoseReason,
} from './rules';
import { C, CHAIN_HEROES, CHAIN_KEYS, chainLabels } from './strings';

const $ = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
const stage = $<HTMLElement>('stage');
const canvas = $<HTMLCanvasElement>('canvas');
const overlay = $<HTMLDivElement>('overlay');
const live = $<HTMLDivElement>('live');
const soundButton = $<HTMLButtonElement>('sound');
const fullscreenButton = $<HTMLButtonElement>('fullscreen');

document.title = C.docTitle;
document.body.classList.add('chain');
document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0C1638');
// The Bacterial Blues video's faces: Oswald for display, Roboto Mono for readouts.
const fonts = document.createElement('link');
fonts.rel = 'stylesheet';
fonts.href = 'https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Roboto+Mono:wght@400;500;700&display=swap';
document.head.append(fonts);
const brandTitle = document.querySelector('.brand h1');
if (brandTitle) brandTitle.textContent = C.brand;
stage.setAttribute('aria-label', C.stageLabel);

const touch = window.matchMedia('(pointer: coarse)').matches;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const audio = createBandAudio();
const renderer = createChainRenderer(canvas, chainLabels(touch));
const clock = () => performance.now() / 1000;

/** The same voice each microbe has in the band, one short phrase per flash. */
const VOICE: readonly (readonly number[])[] = [[45], [57, 60, 64], [36], [57]];
const KEY_PLAYERS: Record<string, number> = { a: 0, f: 1, j: 2, l: 3, '1': 0, '2': 1, '3': 2, '4': 3 };

let career = loadCareer();
let state: ChainState | null = null;
let endShown = false;
let note = '';

/* ------------------------------------------------------------- phones */

let room: HostRoom | null = null;
let roomState: 'closed' | 'opening' | 'open' | 'failed' | 'down' = 'closed';
/** Per player: true where a phone holds that microbe. */
let remote: boolean[] = new Array<boolean>(PLAYERS).fill(false);
const carrier = carrierFromUrl(location.search);
/** The band seat no microbe uses (Reed), held "locally" so no phone can claim it. */
const LOCAL = Array.from({ length: SEAT_COUNT }, (_, seat) => !(CHAIN_SEATS as readonly number[]).includes(seat));
const playerOf = (seat: number) => (CHAIN_SEATS as readonly number[]).indexOf(seat);

function joinUrl(code: string): string {
  const url = new URL(location.href);
  url.hash = '';
  url.search = '';
  url.searchParams.set('join', code);
  if (carrier !== 'peer') url.searchParams.set('net', carrier);
  return url.toString();
}

async function openRoom() {
  if (roomState === 'opening' || roomState === 'open') return;
  roomState = 'opening';
  lobby();
  try {
    room = await openHostRoom({
      carrier,
      local: () => LOCAL,
      clock,
      onPress(seat) {
        const player = playerOf(seat);
        if (player >= 0) handlePress(player);
      },
      onSeats(next) {
        remote = CHAIN_SEATS.map((seat) => next[seat]!);
        if (!state) lobby();
      },
      onDown() {
        closeRoom('down');
      },
    });
    roomState = 'open';
  } catch {
    room = null;
    roomState = 'failed';
  }
  if (!state) lobby();
}

function closeRoom(next: 'closed' | 'down' = 'closed') {
  room?.close();
  room = null;
  roomState = next;
  remote = new Array<boolean>(PLAYERS).fill(false);
  if (!state) lobby();
}

/* -------------------------------------------------------------- cards */

const esc = (text: string) =>
  text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

function roomPanel(): string {
  if (roomState === 'failed') return `<p class="note" role="status">${C.roomFailed}</p>`;
  if (roomState === 'down') return `<p class="note" role="status">${C.roomDown}</p>`;
  if (roomState !== 'open' || !room) return '';
  const url = joinUrl(room.code);
  return `<div class="room">
    <div class="room-qr">${qrSvg(url, C.qrLabel.replace('{code}', room.code))}</div>
    <div class="room-text">
      <p class="eyebrow">Room ${room.code} · ${C.roomCount.replace('{n}', String(remote.filter(Boolean).length))}</p>
      <h3>${C.roomTitle}</h3>
      <p class="note">${C.roomLine}</p>
      <p class="room-url">${esc(url.replace(/^https?:\/\//, ''))}</p>
      <button type="button" class="btn btn-quiet" data-action="room-close">${C.closeRoom}</button>
    </div>
  </div>`;
}

function seatList(): string {
  return CHAIN_HEROES.map(
    (hero, i) => `<li class="chain-seat" style="--seat:${PLAYER_COLORS[i]}">
      <span class="seat-key" aria-hidden="true">${touch ? i + 1 : CHAIN_KEYS[i]}</span>
      <span class="seat-name">${esc(hero.name)}</span>
      <span class="chain-fact">${esc(hero.short)}</span>
      <span class="seat-state">${remote[i] ? C.phoneSeat : C.player}</span>
    </li>`
  ).join('');
}

function open(html: string) {
  overlay.innerHTML = html;
  overlay.classList.add('open');
  overlay.querySelector<HTMLButtonElement>('[data-action="start"]')?.focus({ preventScroll: true });
}

function lobby() {
  open(`<section class="card" aria-labelledby="card-title">
    <p class="eyebrow">${C.eyebrow}</p>
    <h2 id="card-title">${C.lobbyTitle}</h2>
    <p class="lede">${C.how}</p>
    <ul class="chain-seats">${seatList()}</ul>
    <p class="note">${C.twistNote} ${C.soloNote}</p>
    ${note ? `<p class="note" role="status">${esc(note)}</p>` : ''}
    <div class="actions">
      ${roomState === 'open' ? '' : `<button type="button" class="btn" data-action="room" ${roomState === 'opening' ? 'disabled' : ''}>${roomState === 'opening' ? C.opening : C.addPhones}</button>`}
      <button type="button" class="btn btn-primary" data-action="start">${C.start}</button>
      <a class="btn btn-quiet" href="./">${C.back}</a>
    </div>
    ${roomPanel()}
    <details>
      <summary>Why electrons?</summary>
      <p class="note">${C.science} <cite>(${C.scienceSource})</cite></p>
    </details>
  </section>`);
}

function endCard(won: boolean, reason: LoseReason | null) {
  if (!state) return;
  const stats = C.stats
    .replace('{charge}', String(state.charge))
    .replace('{goal}', String(GOAL))
    .replace('{hops}', String(state.hops))
    .replace('{longest}', String(state.longest));
  const title = won ? C.wonTitle : reason === 'time' ? C.lostTitleTime : C.lostTitleBreaks;
  live.textContent = `${title}. ${stats}`;
  open(`<section class="card" aria-labelledby="card-title">
    <p class="eyebrow">${C.brand}</p>
    <h2 id="card-title">${title}</h2>
    <p class="lede">${stats}</p>
    <p class="note">${C.science} <cite>(${C.scienceSource})</cite></p>
    <div class="actions">
      <button type="button" class="btn btn-primary" data-action="start">${C.again}</button>
      <button type="button" class="btn" data-action="lobby">Lobby</button>
    </div>
  </section>`);
}

overlay.addEventListener('click', (event) => {
  const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
  if (action === 'start') start();
  else if (action === 'lobby') toLobby();
  else if (action === 'room') void openRoom();
  else if (action === 'room-close') closeRoom();
});

/* --------------------------------------------------------------- game */

function start() {
  audio.resume();
  audio.cue('ui');
  note = '';
  renderer.reset();
  state = createChain(clock());
  endShown = false;
  overlay.classList.remove('open');
  overlay.innerHTML = '';
  stage.focus({ preventScroll: true });
  room?.setPhase('take');
}

function toLobby(why = '') {
  audio.hush();
  state = null;
  note = why;
  renderer.reset();
  room?.setPhase('lobby');
  lobby();
}

function handle(events: readonly ChainEvent[], t: number) {
  if (!state) return;
  for (const e of events) {
    renderer.event(e, t);
    switch (e.k) {
      case 'flash': {
        const seat = CHAIN_SEATS[e.player]!;
        audio.play(seat, VOICE[e.player]!);
        if (e.kind === 'double') {
          const now = audio.now();
          if (now !== null) audio.play(seat, VOICE[e.player]!, now + tempoFor(state.round).flashS * 0.55);
        }
        break;
      }
      case 'yourTurn':
        audio.cue('go');
        live.textContent = chainLabels(touch).yourTurn;
        break;
      case 'delivered':
        audio.cue('ui');
        break;
      case 'break':
        audio.cue('miss');
        live.textContent = chainLabels(touch).broken[e.reason];
        break;
      case 'won':
        audio.cue('finale');
        break;
      case 'lost':
        audio.cue('miss');
        break;
    }
  }
}

function handlePress(player: number) {
  if (!state || isOver(state)) return;
  const t = clock();
  renderer.press(player, t);
  const events = press(state, player, t);
  if (events.length === 0) return;
  const wrong = events.some((e) => e.k === 'break');
  if (!wrong) audio.play(CHAIN_SEATS[player]!, VOICE[player]!);
  if (touch && !wrong) navigator.vibrate?.(8);
  room?.judge(CHAIN_SEATS[player]!, wrong ? MISS : PERFECT);
  handle(events, t);
}

function frame() {
  const t = clock();
  if (state && !isOver(state)) handle(update(state, t), t);
  if (state && isOver(state) && !endShown && t - state.phaseAt > 1.6) {
    endShown = true;
    room?.setPhase('results', state.charge / GOAL);
    endCard(state.phase === 'won', state.phase === 'lost' ? state.lostBy : null);
  }
  renderer.draw(state, t, remote, reducedMotion.matches);
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------- inputs */

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state) {
    toLobby();
    return;
  }
  if (!state || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
  const player = KEY_PLAYERS[event.key.toLowerCase()];
  if (player === undefined || remote[player]) return;
  event.preventDefault();
  handlePress(player);
});

canvas.addEventListener('pointerdown', (event) => {
  if (!state) return;
  event.preventDefault();
  const box = canvas.getBoundingClientRect();
  const player = renderer.playerAt(event.clientX - box.left, event.clientY - box.top);
  if (player !== null && !remote[player]) handlePress(player);
});
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

/* ---------------------------------------------------- sound and screen */

function paintSound() {
  soundButton.textContent = career.muted ? C.soundOff : C.soundOn;
  soundButton.setAttribute('aria-pressed', String(!career.muted));
}
audio.setMuted(career.muted);
paintSound();
soundButton.addEventListener('click', () => {
  career = { ...career, muted: !career.muted };
  saveCareer(career);
  audio.resume();
  audio.setMuted(career.muted);
  paintSound();
});

if (document.fullscreenEnabled) {
  fullscreenButton.hidden = false;
  const paint = () => {
    fullscreenButton.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
  };
  paint();
  document.addEventListener('fullscreenchange', paint);
  fullscreenButton.addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  });
}

function resize() {
  const box = stage.getBoundingClientRect();
  if (box.width > 0 && box.height > 0) renderer.resize(box.width, box.height, window.devicePixelRatio || 1);
}
new ResizeObserver(resize).observe(stage);
resize();

// A hidden tab stops the picture but not the clock: a round cannot survive that.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state && !isOver(state)) toLobby(C.paused);
});
window.addEventListener('pagehide', () => room?.close());

// Dev only: read the live game from the console or a test (window.__chain()).
if (import.meta.env.DEV) (window as unknown as { __chain: () => ChainState | null }).__chain = () => state;

lobby();
requestAnimationFrame(frame);
