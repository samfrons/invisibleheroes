/**
 * Colours, type and small shared helpers for the heads-up overlay.
 *
 * The look follows the "Bacterial Blues" video: a near-black charcoal stage,
 * a bold Bauhaus frame, three confident accents (coral, teal, gold) plus an
 * oscilloscope green used sparingly, thick clean strokes, huge condensed
 * all-caps lines with a coloured glow and a hard dark offset shadow, and a
 * mono face for small labels. The DOM shell and the 3D scene read these
 * named values, so keep them plain hex strings.
 */

// ---- the palette (shared with the DOM shell and the 3D scene) ---------------

/** Near-black charcoal: the stage, and every under-stroke and offset shadow. */
export const CHARCOAL = '#1A1A1A';
export const BLACK = '#111111';
/** Text. 16.6:1 on CHARCOAL. */
export const CREAM = '#FAFAF6';
/** Quiet text (labels, facts). 6.6:1 on CHARCOAL. */
export const CREAM_DIM = '#9AA0A6';
export const CORAL = '#FF6B6B';
export const TEAL = '#4ECDC4';
/** The electron's gold. 13.5:1 on BLACK. */
export const GOLD = '#FFD700';
/** Oscilloscope green, used sparingly. */
export const SCOPE_GREEN = '#00FF00';
/** Glass panels behind cards. */
export const GLASS = 'rgba(17, 17, 17, 0.86)';
export const GLASS_DEEP = 'rgba(10, 10, 10, 0.92)';

/**
 * Seat hues: coral, teal, green, gold, violet. The same five as the battery cells in the 3D
 * scene (STAGE_SEAT in three/palette.ts) and the DOM (style.css). BLACK text on each is 7:1 or more.
 */
export const SEAT_CORAL = '#FF6B6B';
export const SEAT_TEAL = '#4ECDC4';
export const SEAT_GREEN = '#7EE36B';
export const SEAT_AMBER = '#FFC93C';
export const SEAT_VIOLET = '#B18CFF';
export const SEAT_BASE = [SEAT_CORAL, SEAT_TEAL, SEAT_GREEN, SEAT_AMBER, SEAT_VIOLET] as const;
/** On the dark stage the seat hues are already bright enough to glow. */
export const SEAT_GLOW = SEAT_BASE;
/** Light tints of the seat hues (DOM chips, 3D materials). */
export const SEAT_TINT = ['#FFB3B3', '#A6E6E1', '#C4F2BA', '#FFE49C', '#D8C6FF'] as const;

// ---- names other modules import (3D palette, DOM) -----------------------------

/** MESSAI navy, still used by the 3D scene. */
export const INK = '#0C1638';
export const INK2 = '#33406B';
export const TEAL_DARK = '#1F6B60';
export const TEAL_ACCENT = TEAL;
export const SPARK = GOLD;
export const PAPER = CREAM;
export const SEAT_STRONG = SEAT_BASE;
export const STEEL = '#A7B1C2';
export const COPPER = '#B8693A';
export const SIGN_LIT = '#B4451C';

// ---- type --------------------------------------------------------------------

/** The display face (self-hosted, OFL): Oswald Bold, condensed caps. */
export const DISPLAY_FAMILY = 'Oswald';
export const DISPLAY_FONT_URL = 'fonts/oswald-latin-700-normal.woff2';
const DISPLAY = `${DISPLAY_FAMILY}, "Arial Narrow", "Helvetica Neue Condensed", Impact, sans-serif`;
const MONO = '"Roboto Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export function displayFont(px: number): string {
  return `700 ${Math.max(6, Math.round(px))}px ${DISPLAY}`;
}

/** Small labels. */
export function monoFont(px: number, weight = 500): string {
  return `${weight} ${Math.max(6, Math.round(px))}px ${MONO}`;
}

/** Kept for callers of the earlier name: small labels are mono now. */
export const bodyFont = monoFont;

// ---- helpers -----------------------------------------------------------------

/** A stable 0..1 pseudo-random number from two integers (no state, no allocation). */
export function hash(a: number, b: number): number {
  let x = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d) >>> 0;
  x ^= x >>> 12;
  x = Math.imul(x, 0x297a2d39) >>> 0;
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 1 at `age` 0 falling to 0 at `life`; 0 outside [0, life). */
export function fade(age: number, life: number): number {
  return age >= 0 && age < life ? 1 - age / life : 0;
}
