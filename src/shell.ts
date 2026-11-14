/**
 * The shell: the page around the stage. It owns the phases (lobby, take,
 * results, video), the cards drawn over the canvas, and every way a press can
 * arrive (keys, fingers, a mouse). The conductor does the timing; this file
 * only decides what is on screen and forwards presses.
 */
import './style.css';
import { charges, leaderOf, rankFor, tally } from './engine';
import { createConductor } from './game';
import { openHostRoom, type HostRoom } from './net/host';
import { carrierFromUrl } from './net/transport';
import { qrSvg } from './qr';
import { canRecordVideo, createVideoRecorder, downloadBlob, type VideoRecorder } from './recorder';
import { createRenderer } from './render';
import { SEAT_COUNT } from './score';
import { dayKey, loadCareer, recordTake, saveCareer, type Career } from './storage';
import { HEROES, RANKS, T, fill, renderLabels } from './strings';
import { createBandAudio } from './synth';
import { decodeTake, encodeTake, type Take } from './take';
import type { Centrepiece } from './three/centrepiece';
import type { Renderer } from './types';

type Phase = 'lobby' | 'take' | 'results' | 'video' | 'shared';

const SEAT_COLORS = ['var(--tomato)', 'var(--sky)', 'var(--leaf)', 'var(--mustard)', 'var(--plum)'];
/** White text only passes 4.5:1 on plum; the other four seat colours take ink. */
const SEAT_INKS = new Array<string>(5).fill('var(--on-seat)');

const $ = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
const stage = $<HTMLElement>('stage');
const canvas = $<HTMLCanvasElement>('canvas');
const overlay = $<HTMLDivElement>('overlay');
const hud = $<HTMLDivElement>('hud');
const live = $<HTMLDivElement>('live');
const soundButton = $<HTMLButtonElement>('sound');
const fullscreenButton = $<HTMLButtonElement>('fullscreen');

const touch = window.matchMedia('(pointer: coarse)').matches;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const audio = createBandAudio();
const lanes = createRenderer(canvas, renderLabels(touch));

/**
 * The stage is two layers: a 3D set (the fuel cell and its battery) and, over it, the note
 * lanes. The set is fetched after the page is up; until it arrives, or where there is no
 * WebGL, the lanes play on the bare navy stage.
 */
let scene: Centrepiece | null = null;
const sceneCanvas = $<HTMLCanvasElement>('scene');
/** The flattened picture a recording is taken from; exists only while one is running. */
let film: HTMLCanvasElement | null = null;
let stageSize = { width: 0, height: 0, dpr: 1 };
const renderer: Renderer = {
  resize(width, height, dpr) {
    stageSize = { width, height, dpr };
    lanes.resize(width, height, dpr);
    scene?.resize(width, height, dpr);
  },
  draw(frame) {
    scene?.draw(frame);
    lanes.draw(frame);
    // While a video is being saved, both layers are flattened onto one canvas for the recorder.
    // The 3D layer is copied in the same task it was drawn in, before the browser clears it.
    if (film) {
      const ctx = film.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, film.width, film.height);
        if (scene) ctx.drawImage(sceneCanvas, 0, 0, film.width, film.height);
        ctx.drawImage(canvas, 0, 0, film.width, film.height);
      }
    }
  },
  seatAt: (x, y) => lanes.seatAt(x, y),
};
// ?scene=off leaves the 3D set out: for slow machines and for scripted play-throughs.
const sceneWanted = new URLSearchParams(location.search).get('scene') !== 'off';
void (sceneWanted ? import('./three/centrepiece') : Promise.reject(new Error('scene off')))
  .then(({ createCentrepiece }) =>
    createCentrepiece(sceneCanvas, { quality: touch ? 'low' : 'high' })
  )
  .then((made) => {
    scene = made;
    if (scene && stageSize.width > 0) scene.resize(stageSize.width, stageSize.height, stageSize.dpr);
  })
  .catch(() => undefined);

let career: Career = loadCareer();
let lineup: boolean[] = [...career.lineup];
let phase: Phase = 'lobby';
/** The take on the results card: the one just played, or one that arrived in a link. */
let shown: { take: Take; number: number; bestStreak: number | null; theirs: boolean; newBest: boolean } | null =
  null;
let recorder: VideoRecorder | null = null;
let status = '';
let wakeLock: { release(): Promise<void> } | null = null;

/** The room phones join, once the host asks for one. */
let room: HostRoom | null = null;
let roomState: 'closed' | 'opening' | 'open' | 'failed' | 'down' = 'closed';
/** Per seat: true where a phone plays. */
let phones: boolean[] = new Array<boolean>(SEAT_COUNT).fill(false);
const carrier = carrierFromUrl(location.search);

/** Who plays this take: the seats picked at the big screen plus the seats held by phones. */
const band = () => lineup.map((local, seat) => local || phones[seat]!);

const conductor = createConductor({
  renderer,
  audio,
  onTakeEnd(take, bestStreak) {
    const result = tally(take.grades, take.humans);
    const newBest = career.takes > 0 && result.score > career.best;
    career = recordTake(career, { score: result.score, bestStreak }, dayKey(new Date()));
    saveCareer(career);
    shown = { take, number: career.takes, bestStreak, theirs: false, newBest };
    status = '';
    room?.setPhase('results', result.score);
    show('results');
    audio.cue('ui');
  },
  onVideoEnd() {
    void finishVideo();
  },
  onPress(_seat, landed) {
    // A short buzz under the finger on phones that have one.
    if (touch && landed) navigator.vibrate?.(8);
  },
  onJudge(seat, grade) {
    room?.judge(seat, grade);
  },
});

/* ---------------------------------------------------------------- sizing */

function resize() {
  const box = stage.getBoundingClientRect();
  if (box.width > 0 && box.height > 0) {
    renderer.resize(box.width, box.height, window.devicePixelRatio || 1);
  }
}
new ResizeObserver(resize).observe(stage);
resize();

conductor.setReducedMotion(reducedMotion.matches);
reducedMotion.addEventListener('change', () => conductor.setReducedMotion(reducedMotion.matches));

/* ----------------------------------------------------------------- cards */

const esc = (text: string) =>
  text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
const pct = (score: number) => Math.round(score * 100);

function careerLine(): string {
  if (career.takes === 0) return T.careerNone;
  const base = fill(T.career, { takes: career.takes, best: pct(career.best) });
  return career.dayStreak > 1 ? `${base} · ${fill(T.careerDays, { days: career.dayStreak })}` : base;
}

function lobbyCard(): string {
  const players = band().filter(Boolean).length;
  const seats = HEROES.map((hero, seat) => {
    const phone = phones[seat]!;
    const on = lineup[seat]! || phone;
    return `<li><button type="button" class="seat" data-seat="${seat}" aria-pressed="${on}"
        style="--seat:${SEAT_COLORS[seat]};--seat-ink:${SEAT_INKS[seat]}">
        <span class="seat-key" aria-hidden="true">${touch ? seat + 1 : hero.key}</span>
        <span class="seat-name">${esc(hero.name)}</span>
        <span class="seat-instrument">${esc(hero.instrument)}</span>
        <span class="seat-state">${phone ? T.phone : on ? T.player : T.machine}</span>
      </button></li>`;
  }).join('');
  const bios = HEROES.map(
    (hero) =>
      `<li><strong>${hero.latin ? `<i>${esc(hero.fullName)}</i>` : esc(hero.fullName)}</strong>, ${esc(
        hero.instrument
      )}. ${esc(hero.fact)} <cite>(${esc(hero.source)})</cite></li>`
  ).join('');
  const hint = touch ? (players >= 3 ? T.turnPhone : '') : players === 1 ? T.soloKey : '';
  return `<section class="card" aria-labelledby="card-title">
    <p class="eyebrow">${T.eyebrow}</p>
    <h2 id="card-title">${T.lobbyTitle}</h2>
    <p class="lede">${T.how}</p>
    <ul class="seats">${seats}</ul>
    ${hint ? `<p class="note">${hint}</p>` : ''}
    <div class="actions">
      <button type="button" class="btn btn-primary" data-action="start" ${players ? '' : 'disabled'}>
        ${players ? T.start : T.startNeedsPlayer}
      </button>
      ${roomState === 'open' ? '' : `<button type="button" class="btn" data-action="room" ${roomState === 'opening' ? 'disabled' : ''}>${roomState === 'opening' ? T.opening : T.addPhones}</button>`}
      <span class="career">${esc(careerLine())}</span>
    </div>
    ${roomPanel()}
    <details>
      <summary>${T.meet}</summary>
      <ul class="band">${bios}</ul>
      <p class="note">${T.honest}</p>
    </details>
  </section>`;
}

function joinUrl(code: string): string {
  const url = new URL(location.href);
  url.hash = '';
  url.search = '';
  url.searchParams.set('join', code);
  if (carrier !== 'peer') url.searchParams.set('net', carrier);
  return url.toString();
}

/** Under the line-up: the QR code phones scan, or why there is none. */
function roomPanel(): string {
  if (roomState === 'failed') return `<p class="note" role="status">${T.roomFailed}</p>`;
  if (roomState === 'down') return `<p class="note" role="status">${T.roomDown}</p>`;
  if (roomState !== 'open' || !room) return '';
  const url = joinUrl(room.code);
  const connected = phones.filter(Boolean).length;
  return `<div class="room">
    <div class="room-qr">${qrSvg(url, fill(T.qrLabel, { code: room.code }))}</div>
    <div class="room-text">
      <p class="eyebrow">${fill(T.roomCode, { code: room.code })} · ${fill(T.roomCount, { n: connected })}</p>
      <h3>${T.roomTitle}</h3>
      <p class="note">${T.roomLine}</p>
      <p class="room-url">${esc(url.replace(/^https?:\/\//, ''))}</p>
      ${/^(localhost|127\.|\[::1\])/.test(location.hostname) ? `<p class="note">${T.roomLocalhost}</p>` : ''}
      <button type="button" class="btn btn-quiet" data-action="room-close">${T.closeRoom}</button>
    </div>
  </div>`;
}

async function openRoom() {
  if (roomState === 'opening' || roomState === 'open') return;
  roomState = 'opening';
  if (phase === 'lobby') show('lobby');
  try {
    room = await openHostRoom({
      carrier,
      local: () => lineup,
      clock: () => performance.now() / 1000,
      onPress: (seat, at) => conductor.press(seat, at),
      onSeats(next) {
        phones = next;
        conductor.setRemoteSeats(phones);
        if (phase === 'lobby') {
          conductor.idle(band());
          show('lobby');
        }
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
  if (phase === 'lobby') {
    show('lobby');
    // On a landscape phone the code opens below the fold.
    overlay.querySelector('.room')?.scrollIntoView({ block: 'nearest' });
  }
}

function closeRoom(next: 'closed' | 'down' = 'closed') {
  room?.close();
  room = null;
  roomState = next;
  phones = new Array<boolean>(SEAT_COUNT).fill(false);
  conductor.setRemoteSeats(phones);
  if (phase === 'lobby') {
    conductor.idle(band());
    show('lobby');
  }
}

function resultsCard(): string {
  if (!shown) return '';
  const { take, number, bestStreak, theirs, newBest } = shown;
  const result = tally(take.grades, take.humans);
  const rank = RANKS[rankFor(result.score)];
  // The battle: every seat has a cell, the machine's included, and the fullest wins.
  const charge = charges(take.grades, take.humans);
  const winner = leaderOf(charge);
  const pack = Math.round((100 * charge.reduce((a, b) => a + b, 0)) / charge.length);
  const rows = HEROES.map((hero, seat) => {
    const human = take.humans[seat]!;
    return `<li class="row${seat === winner ? ' row-winner' : ''}" style="--seat:${SEAT_COLORS[seat]}">
      <span class="row-name">${esc(hero.name)}${human ? '' : ` <small>${T.house}</small>`}</span>
      <span class="meter" aria-hidden="true">
        <span class="meter-perfect" style="width:${100 * charge[seat]!}%"></span>
      </span>
      <span class="row-count">${fill(T.cell, { n: Math.round(100 * charge[seat]!) })}</span>
    </li>`;
  }).join('');
  return `<section class="card" aria-labelledby="card-title">
    <p class="eyebrow">${theirs ? T.theirTake : fill(T.takeN, { n: number })}</p>
    <h2 id="card-title">${esc(rank.title)}</h2>
    <div class="score">
      <span class="score-number">${pct(result.score)}%</span>
      ${newBest ? `<span class="tag">${T.newBest}</span>` : ''}
    </div>
    <p class="lede">${winner === null ? '' : `${esc(fill(T.wins, { name: HEROES[winner]!.name }))}. `}${fill(T.packLine, { pack })}. ${esc(rank.line)}</p>
    <ul class="rows">${rows}</ul>
    ${bestStreak !== null ? `<p class="note">${fill(T.bestStreak, { n: bestStreak })}</p>` : ''}
    <div class="actions">
      <button type="button" class="btn btn-primary" data-action="${theirs ? 'again' : 'watch'}">
        ${theirs ? T.beatIt : T.watch}
      </button>
      ${theirs ? `<button type="button" class="btn" data-action="watch">${T.watch}</button>` : ''}
      ${canRecordVideo() ? `<button type="button" class="btn" data-action="save">${T.save}</button>` : ''}
      ${theirs ? '' : `<button type="button" class="btn" data-action="share">${T.share}</button>`}
      ${theirs ? '' : `<button type="button" class="btn" data-action="again">${T.again}</button>`}
      <button type="button" class="btn" data-action="lineup">${T.lineup}</button>
    </div>
    ${status ? `<p class="note" role="status">${esc(status)}</p>` : ''}
  </section>`;
}

function sharedCard(): string {
  if (!shown) return '';
  const result = tally(shown.take.grades, shown.take.humans);
  return `<section class="card" aria-labelledby="card-title">
    <p class="eyebrow">${T.eyebrow}</p>
    <h2 id="card-title">${T.sharedTitle}</h2>
    <p class="lede">${fill(T.sharedLine, {
      n: shown.take.humans.filter(Boolean).length,
      score: pct(result.score),
    })}</p>
    <div class="actions">
      <button type="button" class="btn btn-primary" data-action="watch">${T.sharedPlay}</button>
      <button type="button" class="btn" data-action="lineup">${T.sharedOwn}</button>
    </div>
  </section>`;
}

/** Put a phase on screen: its card over the stage, or the bare stage with one small button. */
function show(next: Phase) {
  const same = phase === next;
  phase = next;
  const card = next === 'lobby' ? lobbyCard() : next === 'results' ? resultsCard() : next === 'shared' ? sharedCard() : '';
  // Rebuilding the card must not throw a scrolled card back to its top.
  const scrolled = same ? overlay.querySelector('.card')?.scrollTop ?? 0 : 0;
  overlay.innerHTML = card;
  const fresh = overlay.querySelector('.card');
  if (fresh && scrolled) fresh.scrollTop = scrolled;
  overlay.classList.toggle('open', card !== '');
  hud.innerHTML =
    next === 'take'
      ? `<button type="button" class="btn btn-quiet" data-action="stop">${T.stop}</button>`
      : next === 'video'
      ? `<button type="button" class="btn btn-quiet" data-action="stop">${T.skip}</button>`
      : '';
  if (card) {
    overlay.querySelector<HTMLElement>('.btn-primary:not([disabled])')?.focus({ preventScroll: true });
    live.textContent = overlay.querySelector('h2')?.textContent ?? '';
  } else {
    stage.focus({ preventScroll: true });
  }
  void keepAwake(next === 'take' || next === 'video');
}

/** Keep a phone's screen on while the machine runs. */
async function keepAwake(on: boolean) {
  try {
    if (on && !wakeLock) {
      const nav = navigator as Navigator & {
        wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> };
      };
      wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
    } else if (!on && wakeLock) {
      const lock = wakeLock;
      wakeLock = null;
      await lock.release();
    }
  } catch {
    wakeLock = null;
  }
}

/* --------------------------------------------------------------- actions */

function startTake() {
  const players = band();
  if (!players.some(Boolean)) return;
  audio.resume();
  // Only the seats picked here are remembered: a phone's seat goes home with the phone.
  if (lineup.some(Boolean)) {
    career = { ...career, lineup: [...lineup] };
    saveCareer(career);
  }
  conductor.startTake(players, career.takes + 1);
  room?.setPhase('take');
  show('take');
}

function startVideo(record: boolean) {
  if (!shown) return;
  audio.resume();
  if (record) {
    film = document.createElement('canvas');
    film.width = canvas.width;
    film.height = canvas.height;
  }
  recorder = record && film ? createVideoRecorder(film, audio.stream()) : null;
  if (record && !recorder) {
    status = T.saveFailed;
    show('results');
    return;
  }
  conductor.startVideo(shown.take, shown.number, recorder !== null);
  recorder?.start();
  room?.setPhase('video', shown.theirs ? null : tally(shown.take.grades, shown.take.humans).score);
  show('video');
  if (recorder) live.textContent = T.saving;
}

async function finishVideo() {
  const active = recorder;
  recorder = null;
  status = '';
  if (active && shown) {
    const file = await active.stop();
    if (file) {
      const name = `biofilm-band-take-${shown.number}.${file.extension}`;
      downloadBlob(file.blob, name);
      status = fill(T.saved, { name });
    } else {
      status = T.saveFailed;
    }
  }
  film = null;
  if (shown) room?.setPhase('results', shown.theirs ? null : tally(shown.take.grades, shown.take.humans).score);
  show('results');
}

/** Stop whatever is running and go back to the card it came from. */
function stop(reason = '') {
  if (phase === 'take') {
    conductor.idle(band());
    room?.setPhase('lobby');
    show('lobby');
    if (reason) live.textContent = reason;
  } else if (phase === 'video') {
    conductor.idle(band());
    void finishVideo();
  }
}

function takeLink(): string {
  if (!shown) return location.href;
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('take', encodeTake(shown.take));
  return url.toString();
}

async function share() {
  if (!shown) return;
  const url = takeLink();
  const score = pct(tally(shown.take.grades, shown.take.humans).score);
  try {
    if (touch && navigator.share) {
      await navigator.share({ title: document.title, text: fill(T.shareText, { score }), url });
      return;
    }
    await navigator.clipboard.writeText(url);
    status = T.copied;
  } catch (error) {
    // The share sheet was closed: nothing to report.
    if ((error as DOMException)?.name === 'AbortError') return;
    status = T.shareFailed;
  }
  show('results');
}

function act(action: string) {
  audio.resume();
  switch (action) {
    case 'start':
    case 'again':
      startTake();
      break;
    case 'watch':
      startVideo(false);
      break;
    case 'save':
      startVideo(true);
      break;
    case 'share':
      void share();
      break;
    case 'lineup':
      shown = null;
      conductor.idle(band());
      room?.setPhase('lobby');
      show('lobby');
      break;
    case 'room':
      void openRoom();
      break;
    case 'room-close':
      closeRoom();
      break;
    case 'stop':
      stop();
      break;
  }
}

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const seat = target.closest<HTMLElement>('[data-seat]');
  if (seat && phase === 'lobby') {
    const index = Number(seat.dataset.seat);
    audio.resume();
    if (phones[index]) {
      // A seat a phone holds: tapping it here takes it back for the machine.
      room?.evict(index);
    } else {
      lineup[index] = !lineup[index];
      if (lineup[index]) audio.play(index, SEAT_PREVIEW[index]!);
      room?.refresh();
    }
    conductor.idle(band());
    show('lobby');
    overlay.querySelector<HTMLElement>(`[data-seat="${index}"]`)?.focus({ preventScroll: true });
    return;
  }
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
  if (action) act(action);
});

/* ---------------------------------------------------------------- presses */

/** One note per seat, sounded when a player takes it, so they know their own voice. */
const SEAT_PREVIEW: readonly (readonly number[])[] = [[45], [57, 60, 64], [76], [36], [57]];
const KEY_SEATS: Record<string, number> = { a: 0, d: 1, g: 2, j: 3, l: 4, '1': 0, '2': 1, '3': 2, '4': 3, '5': 4 };

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && (phase === 'take' || phase === 'video')) {
    stop();
    return;
  }
  if (phase !== 'take' || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
  let seat = KEY_SEATS[event.key.toLowerCase()];
  // One player: the space bar is their key too.
  if (seat === undefined && event.key === ' ' && lineup.filter(Boolean).length === 1) {
    seat = lineup.indexOf(true);
  }
  // A seat a phone holds is played from the phone.
  if (seat !== undefined && phones[seat]) return;
  if (seat === undefined) return;
  event.preventDefault();
  conductor.press(seat);
});

// Every finger is its own pointer, so five people can press at once.
canvas.addEventListener('pointerdown', (event) => {
  if (phase !== 'take') return;
  event.preventDefault();
  const box = canvas.getBoundingClientRect();
  const seat = renderer.seatAt(event.clientX - box.left, event.clientY - box.top);
  if (seat !== null && seat < SEAT_COUNT && !phones[seat]) conductor.press(seat);
});
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

/* ------------------------------------------------------- sound and screen */

function paintSound() {
  soundButton.textContent = career.muted ? T.soundOff : T.soundOn;
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
    fullscreenButton.textContent = document.fullscreenElement ? T.exitFullscreen : T.fullscreen;
  };
  paint();
  document.addEventListener('fullscreenchange', paint);
  fullscreenButton.addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  });
}

// The clock keeps running in a hidden tab while the picture stops: a take cannot survive that.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop(T.paused);
});

/* ------------------------------------------------------------------ start */

stage.setAttribute('aria-label', T.stageLabel);
const incoming = new URLSearchParams(location.search).get('take');
const sharedTake = incoming ? decodeTake(incoming) : null;
if (sharedTake) {
  shown = { take: sharedTake, number: 1, bestStreak: null, theirs: true, newBest: false };
  conductor.idle(sharedTake.humans);
  show('shared');
} else {
  conductor.idle(band());
  show('lobby');
}
window.addEventListener('pagehide', () => room?.close());
