/** Colours, font stacks and small shared helpers for the renderer. */

export const INK = '#0C1638';
export const PAPER = '#FAF6EA';
/** A deeper cream for the header band and the stage floor. */
export const CREAM = '#F1E6C8';
export const CREAM_DARK = '#E4D6B0';
/** Pipe glass before the electrons fill it. */
export const GLASS = '#E9E2CD';
export const SPARK = '#FFD75E';
export const MACHINE_FACE = '#E7E0CE';

/** Per seat: [strong, tint, pale panel]. */
export const SEAT_STRONG = ['#E4572E', '#3F88C5', '#3E9B63', '#F2B134', '#8E5572'] as const;
export const SEAT_TINT = ['#F4B19C', '#A6CBEA', '#A9D7B8', '#F8D891', '#CFA9BD'] as const;
export const SEAT_PALE = ['#FBE6DC', '#E3EEF7', '#E2F1E6', '#FCF0D2', '#F2E6EC'] as const;

const DISPLAY = '"Arial Black", "Arial Rounded MT Bold", "Helvetica Neue", Arial, system-ui, sans-serif';
const BODY = '"Trebuchet MS", "Helvetica Neue", Arial, system-ui, sans-serif';

export function displayFont(px: number): string {
  return `900 ${Math.max(6, Math.round(px))}px ${DISPLAY}`;
}

export function bodyFont(px: number, weight = 700): string {
  return `${weight} ${Math.max(6, Math.round(px))}px ${BODY}`;
}

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
