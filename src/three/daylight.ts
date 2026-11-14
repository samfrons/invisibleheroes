/**
 * The city's light, decided by the battery (pure: no three.js, no allocation per frame).
 *
 * The skyline behind the stage is powered by the band's battery. A flat pack
 * and a band that has stopped landing notes leave it a dark night, a few
 * windows lit; a full pack and a band in the groove bring up the day: the sky
 * pales, the buildings turn from silhouettes to stone, the windows fill with
 * light. The stops follow MESSAI's /lab/city day cycle: night navy, dusk
 * amber, noon haze.
 *
 * Colours are sRGB 0..1 triples; the scene converts them with
 * `Color.setRGB(r, g, b, SRGBColorSpace)`.
 */

export type RGB = [number, number, number];

/** Seconds for the city to close about 63% of a gap: slow, so it breathes with the band, not the beat. */
export const LEVEL_TAU_S = 0.8;

/** How much of the level is the pack's fullness and how much is the band's groove right now. */
const W_CHARGE = 0.6;
const W_GROOVE = 0.4;

function clamp01(v: number): number {
  return v > 0 ? (v < 1 ? v : 1) : 0; // NaN fails both tests and lands on 0
}

/**
 * 0..1: how well the battery is doing. The pack's mean charge only ever
 * climbs through a take, so the groove (the fuel cell's power against a
 * perfect band's) is mixed in: the city dims when the band falters.
 */
export function batteryLevel(charge: readonly number[] | undefined, groove: number): number {
  const g = clamp01(groove);
  if (!charge || charge.length === 0) return g;
  let sum = 0;
  for (let i = 0; i < charge.length; i++) sum += clamp01(charge[i]!);
  return clamp01(W_CHARGE * (sum / charge.length) + W_GROOVE * g);
}

/** One step of exponential easing towards `target`; frame-rate independent, never overshoots. */
export function smoothLevel(current: number, target: number, dt: number): number {
  if (!(dt > 0)) return current;
  return current + (target - current) * (1 - Math.exp(-dt / LEVEL_TAU_S));
}

/** Everything the scene needs to light the city at one battery level. */
export interface Daylight {
  /** The sky's radial gradient: bright at the centre of the screen, darker at the edges. */
  skyHi: RGB;
  skyLo: RGB;
  /** The floor the city stands on. */
  ground: RGB;
  /** The buildings' walls. */
  wall: RGB;
  /** 0..1: the fraction of windows with their lights on. */
  windowsLit: number;
  /** How hard a lit window shines. Strongest in the dark, where it shows. */
  windowGlow: number;
}

export function createDaylight(): Daylight {
  return { skyHi: [0, 0, 0], skyLo: [0, 0, 0], ground: [0, 0, 0], wall: [0, 0, 0], windowsLit: 0, windowGlow: 0 };
}

function rgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

interface Stop {
  at: number;
  skyHi: RGB;
  skyLo: RGB;
  ground: RGB;
  wall: RGB;
  windowsLit: number;
  windowGlow: number;
}

const stop = (
  at: number,
  skyHi: string,
  skyLo: string,
  ground: string,
  wall: string,
  windowsLit: number,
  windowGlow: number,
): Stop => ({ at, skyHi: rgb(skyHi), skyLo: rgb(skyLo), ground: rgb(ground), wall: rgb(wall), windowsLit, windowGlow });

const STOPS: readonly Stop[] = [
  // Night: MESSAI's night navy; the city is silhouettes with a few lights on.
  stop(0, '#1D2542', '#080B16', '#0B0D14', '#121930', 0.06, 1.0),
  // Dusk: amber haze low in the sky, violet-navy at the edges; half the windows lit.
  stop(0.55, '#C9A98A', '#3A3752', '#3A3A48', '#7D768A', 0.5, 0.85),
  // Noon: MESSAI's pale haze over stone; nearly every window on, but the sun outshines them.
  stop(1, '#EEF0E6', '#A9C3D6', '#9AA7A8', '#CBC6BD', 0.85, 0.4),
];

function mix(a: RGB, b: RGB, t: number, out: RGB): void {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

/** Fill `out` with the city's light at battery `level` (0..1; out-of-range is clamped). Returns `out`. */
export function daylight(level: number, out: Daylight): Daylight {
  const L = clamp01(level);
  let i = 0;
  while (i < STOPS.length - 2 && L > STOPS[i + 1]!.at) i++;
  const a = STOPS[i]!;
  const b = STOPS[i + 1]!;
  const u = clamp01((L - a.at) / (b.at - a.at));
  // Smoothstep inside each segment, so the change eases through the stops instead of kinking.
  const t = u * u * (3 - 2 * u);
  mix(a.skyHi, b.skyHi, t, out.skyHi);
  mix(a.skyLo, b.skyLo, t, out.skyLo);
  mix(a.ground, b.ground, t, out.ground);
  mix(a.wall, b.wall, t, out.wall);
  out.windowsLit = a.windowsLit + (b.windowsLit - a.windowsLit) * t;
  out.windowGlow = a.windowGlow + (b.windowGlow - a.windowGlow) * t;
  return out;
}
