/**
 * The phone's screen: one player's button.
 *
 * A phone that opens a join link never loads the stage or the synth. It
 * connects to the room, takes a seat, and during a take is a single pad the
 * size of the screen. The player watches the big screen and taps the phone.
 *
 * A tap is stamped with the time the finger went down, converted to the big
 * screen's clock, so the delay of the network does not make the player late.
 */
import './style.css';
import './controller.css';
import { GOOD, MISS, PERFECT, rankFor } from './engine';
import {
  createClockSync,
  normalizeRoomCode,
  parseHostMessage,
  type HostMessage,
} from './net/protocol';
import { carrierFromUrl, openGuest, type GuestTransport } from './net/transport';
import { HEROES, RANKS, T, fill } from './strings';

type StateMessage = Extract<HostMessage, { k: 'state' }>;

const SEAT_COLORS = ['var(--tomato)', 'var(--sky)', 'var(--leaf)', 'var(--mustard)', 'var(--plum)'];
const SEAT_INKS = ['#fff', '#fff', '#fff', 'var(--ink)', '#fff'];
/**
 * Round trips at the start to settle the clock, then a slow heartbeat in the
 * lobby and on the results screen, and none during a take: the clock settled
 * in the lobby holds for a few minutes, and a take is when the network should
 * carry only presses. The heartbeat also tells a relay host the phone is still
 * there; keep SYNC_EVERY_RELAY_MS well under RELAY_SILENT_MS (src/net/relay.ts),
 * which the host does not apply during a take. On the relay every message is
 * metered, so it beats slower.
 */
const SYNC_BURST = 6;
const SYNC_BURST_MS = 150;
const SYNC_EVERY_MS = 2500;
const SYNC_EVERY_RELAY_MS = 10000;

const seconds = () => performance.now() / 1000;
const esc = (text: string) =>
  text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

export function startController(rawCode: string): void {
  const app = document.getElementById('app')!;
  app.classList.add('phone');
  const code = normalizeRoomCode(rawCode);
  const clock = createClockSync();
  let wire: GuestTransport | null = null;
  let state: StateMessage | null = null;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  let wakeLock: { release(): Promise<void> } | null = null;

  function screen(html: string) {
    app.innerHTML = `<main class="phone-screen">${html}</main>`;
  }

  function message(title: string, line: string, retry: boolean) {
    screen(`<section class="phone-card">
      <p class="eyebrow">Invisible Heroes</p>
      <h2>${esc(title)}</h2>
      <p class="lede" role="status">${esc(line)}</p>
      ${retry ? `<div class="actions"><button type="button" class="btn btn-primary" data-action="retry">${T.retry}</button></div>` : ''}
    </section>`);
  }

  function lobby(s: StateMessage) {
    const seats = HEROES.map((hero, seat) => {
      const mine = s.you === seat;
      const free = s.seats[seat] === 'machine';
      return `<li><button type="button" class="seat" data-seat="${seat}" aria-pressed="${mine}"
          ${mine || free ? '' : 'disabled'}
          style="--seat:${SEAT_COLORS[seat]};--seat-ink:${SEAT_INKS[seat]}">
          <span class="seat-name">${esc(hero.name)}</span>
          <span class="seat-instrument">${esc(hero.instrument)}</span>
          <span class="seat-state">${mine ? T.yours : free ? T.free : T.taken}</span>
        </button></li>`;
    }).join('');
    screen(`<section class="phone-card">
      <p class="eyebrow">${esc(fill(T.roomCode, { code: code ?? '' }))}</p>
      <h2>${T.pickHero}</h2>
      <ul class="seats phone-seats">${seats}</ul>
      ${s.you === null ? '' : `<p class="note phone-fact">${esc(HEROES[s.you]!.short)}</p>`}
      <p class="lede" role="status">${s.you === null ? T.noSeat : T.waitHost}</p>
    </section>`);
  }

  function pad(s: StateMessage) {
    if (s.you === null) {
      message(T.joinTitle, T.spectating, false);
      return;
    }
    const hero = HEROES[s.you]!;
    screen(`<button type="button" class="pad" id="pad"
        style="--seat:${SEAT_COLORS[s.you]};--seat-ink:${SEAT_INKS[s.you]}">
        <span class="pad-name">${esc(hero.name)}</span>
        <span class="pad-instrument">${esc(hero.instrument)}</span>
        <span class="pad-word" id="pad-word" aria-live="polite">${T.padWait}</span>
        <span class="pad-hint">${T.padHint}</span>
      </button>`);
    const button = document.getElementById('pad')!;
    // pointerdown, not click: a click waits for the finger to lift.
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const at = clock.toHost(seconds());
      wire?.send({ k: 'press', at });
      button.classList.add('pad-down');
      setTimeout(() => button.classList.remove('pad-down'), 90);
    });
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  function results(s: StateMessage) {
    if (s.score === null) {
      message(T.joinTitle, T.phoneVideo, false);
      return;
    }
    const rank = RANKS[rankFor(s.score)];
    screen(`<section class="phone-card">
      <p class="eyebrow">${esc(fill(T.phoneResult, { score: Math.round(s.score * 100) }))}</p>
      <h2>${esc(rank.title)}</h2>
      <p class="lede">${esc(rank.line)}</p>
      <p class="note" role="status">${s.phase === 'video' ? T.phoneVideo : T.phoneNext}</p>
    </section>`);
  }

  function paint() {
    if (!state) return;
    if (state.phase === 'lobby') lobby(state);
    else if (state.phase === 'take') pad(state);
    else results(state);
    void keepAwake(state.phase === 'take');
  }

  function judged(grade: number) {
    const word = document.getElementById('pad-word');
    const button = document.getElementById('pad');
    if (!word || !button) return;
    const kind = grade === PERFECT ? 'perfect' : grade === GOOD ? 'good' : grade === MISS ? 'miss' : 'stray';
    word.textContent = grade === PERFECT ? 'PERFECT' : grade === GOOD ? 'GOOD' : grade === MISS ? 'MISS' : '';
    button.dataset.judge = kind;
    if (grade >= GOOD) navigator.vibrate?.(grade === PERFECT ? 14 : 8);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      delete button.dataset.judge;
    }, 260);
  }

  async function keepAwake(on: boolean) {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> };
      };
      if (on && !wakeLock) wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
      else if (!on && wakeLock) {
        const lock = wakeLock;
        wakeLock = null;
        await lock.release();
      }
    } catch {
      wakeLock = null;
    }
  }

  function stopSync() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  function ping() {
    wire?.send({ k: 'ping', c: seconds() });
  }

  /** `burst`: settle the clock first (on connecting); otherwise only the heartbeat. */
  function startSync(burst: boolean) {
    stopSync();
    const every = wire?.carrier === 'relay' ? SYNC_EVERY_RELAY_MS : SYNC_EVERY_MS;
    const count = burst ? SYNC_BURST : 1;
    for (let i = 0; i < count; i++) timers.push(setTimeout(ping, i * SYNC_BURST_MS));
    const beat = () => {
      ping();
      timers.push(setTimeout(beat, every));
    };
    timers.push(setTimeout(beat, (count - 1) * SYNC_BURST_MS + every));
  }

  function lost() {
    stopSync();
    wire?.close();
    wire = null;
    state = null;
    message(T.lost, fill(T.joinFailed, { code: code ?? '' }), true);
  }

  async function connect() {
    if (!code) {
      message(T.joinTitle, T.joinBadCode, false);
      return;
    }
    message(T.joinTitle, fill(T.joining, { code }), false);
    try {
      const opened = await openGuest(code, carrierFromUrl(location.search));
      wire = opened;
      opened.onClose(lost);
      opened.onMessage((data) => {
        const m = parseHostMessage(data);
        if (!m) return;
        if (m.k === 'pong') clock.sample(m.c, m.h, seconds());
        else if (m.k === 'judge') judged(m.grade);
        else {
          const before = state;
          state = m;
          // No pings during a take; the heartbeat resumes when it ends.
          if (m.phase === 'take' && before?.phase !== 'take') stopSync();
          else if (m.phase !== 'take' && before?.phase === 'take') startSync(false);
          // Repaint only when what is on screen would differ: a repaint mid-take would eat a tap.
          if (
            !before ||
            before.phase !== m.phase ||
            before.you !== m.you ||
            before.score !== m.score ||
            (m.phase === 'lobby' && before.seats.join() !== m.seats.join())
          ) {
            paint();
          }
        }
      });
      startSync(true);
    } catch {
      message(T.joinTitle, fill(T.joinFailed, { code }), true);
    }
  }

  app.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-action="retry"]')) {
      void connect();
      return;
    }
    const seat = target.closest<HTMLElement>('[data-seat]');
    if (seat && state?.phase === 'lobby') {
      const index = Number(seat.dataset.seat);
      wire?.send(state.you === index ? { k: 'release' } : { k: 'claim', seat: index });
    }
  });

  // A phone that comes back from the lock screen has usually lost the channel.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && wire && state?.phase !== 'take') ping();
  });
  window.addEventListener('pagehide', () => wire?.close());

  void connect();
}
