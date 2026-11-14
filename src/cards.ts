/**
 * Pictures and learning cards for the five microbes, as HTML strings.
 *
 * The big screen (shell.ts) and the phone (controller.ts) both build their
 * screens from these, so a portrait or a card looks the same everywhere.
 * The text lives in src/microbes.ts and src/strings.ts.
 */
import { MICROBES_BY_SEAT } from './microbes';
import { HEROES, T, fill } from './strings';

/** Make text safe to put inside HTML. */
export const escape = (text: string) =>
  text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

/** Picture path as the page needs it: the site root may be a sub-folder (vite.config.ts base). */
const imageUrl = (path: string) => `${import.meta.env.BASE_URL}${path}`;

/**
 * Sporo has no picture file, so it is drawn here: a curved teal rod, like its
 * real shape under a microscope, on a dark tile.
 */
function sporoDrawing(color: string, label: string): string {
  const naming = label ? `role="img" aria-label="${escape(label)}"` : 'aria-hidden="true"';
  return `<svg class="pic-img" viewBox="0 0 100 100" ${naming}>
    <rect width="100" height="100" fill="#10242a"/>
    <path d="M22 70 C 30 28, 70 28, 78 66" fill="none" stroke="#0a0a0a" stroke-width="26" stroke-linecap="round"/>
    <path d="M22 70 C 30 28, 70 28, 78 66" fill="none" stroke="${color}" stroke-width="20" stroke-linecap="round"/>
    <path d="M30 56 C 38 38, 58 36, 68 50" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="4" stroke-linecap="round"/>
    <circle cx="20" cy="22" r="3" fill="${color}"/><circle cx="84" cy="30" r="2" fill="${color}"/>
    <circle cx="14" cy="88" r="2" fill="${color}"/><circle cx="88" cy="86" r="3" fill="${color}"/>
  </svg>`;
}

/**
 * A square portrait of one microbe. `alt` false marks it decorative, for places
 * where the name is written right next to it.
 */
export function portrait(seat: number, extra = '', alt = true): string {
  const microbe = MICROBES_BY_SEAT[seat]!;
  const words = { name: microbe.name, species: microbe.species };
  const label = fill(microbe.image ? T.portraitAlt : T.portraitAltSporo, words);
  const picture = microbe.image
    ? `<img class="pic-img" src="${escape(imageUrl(microbe.image))}" alt="${alt ? escape(label) : ''}"
        width="64" height="64" loading="lazy" decoding="async" draggable="false">`
    : sporoDrawing(microbe.color, alt ? label : '');
  return `<span class="pic ${extra}" style="--seat:var(--seat-${seat})">${picture}</span>`;
}

/**
 * One learning card. `full` adds the job and the cited fact (the big screen);
 * the phone shows the short version: picture, power and the microbe's pitch.
 */
export function learningCard(seat: number, full: boolean): string {
  const microbe = MICROBES_BY_SEAT[seat]!;
  const hero = HEROES[seat]!;
  const label = fill(T.cardLabel, { name: microbe.name });
  const science = full
    ? `<p class="learn-job"><span class="learn-label">${T.cardJob}</span> ${escape(microbe.job)}</p>
      <p class="learn-fact"><span class="learn-label">${T.cardScience}</span> ${escape(hero.fact)}
        <cite>(${escape(hero.source)})</cite></p>`
    : '';
  return `<article class="learn-card" style="--seat:var(--seat-${seat})" tabindex="0" aria-label="${escape(label)}">
    <header class="learn-head">
      ${portrait(seat, 'pic-bob pic-lg', false)}
      <div>
        <h4 class="learn-name">${escape(microbe.name)}</h4>
        <p class="learn-species"><i>${escape(microbe.species)}</i></p>
      </div>
    </header>
    <p class="learn-power"><span class="learn-label">${T.cardPower}</span> ${escape(microbe.power)}</p>
    <p class="learn-pitch">${escape(microbe.pitch)}</p>
    ${science}
  </article>`;
}

/** All five cards, in seat order, as one swipeable row (a grid on wide screens). */
export function learningCards(): string {
  const items = MICROBES_BY_SEAT.map((_, seat) => `<li>${learningCard(seat, true)}</li>`).join('');
  return `<ul class="learn" role="list">${items}</ul>`;
}
