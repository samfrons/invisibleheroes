import { describe, expect, it } from 'vitest';
import { LEVEL_TAU_S, batteryLevel, createDaylight, daylight, smoothLevel, type Daylight, type RGB } from './daylight';

/** Relative luminance of an sRGB colour, rough but monotone in brightness. */
const lum = (c: RGB): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('batteryLevel', () => {
  it('is 0 for a dead battery and 1 for a full, grooving one', () => {
    expect(batteryLevel([0, 0, 0, 0, 0], 0)).toBe(0);
    expect(batteryLevel([1, 1, 1, 1, 1], 1)).toBe(1);
  });

  it('rises with the charge and with the groove', () => {
    const base = batteryLevel([0.2, 0.2, 0.2, 0.2, 0.2], 0.3);
    expect(batteryLevel([0.5, 0.5, 0.5, 0.5, 0.5], 0.3)).toBeGreaterThan(base);
    expect(batteryLevel([0.2, 0.2, 0.2, 0.2, 0.2], 0.6)).toBeGreaterThan(base);
  });

  it('falls when the band stops landing notes, even though the cells keep their charge', () => {
    const full = [0.8, 0.8, 0.8, 0.8, 0.8];
    expect(batteryLevel(full, 0.1)).toBeLessThan(batteryLevel(full, 0.9));
  });

  it('falls back to the groove alone when a frame carries no charge', () => {
    expect(batteryLevel(undefined, 0.4)).toBeCloseTo(0.4, 6);
    expect(batteryLevel([], 0.4)).toBeCloseTo(0.4, 6);
  });

  it('clamps and survives garbage', () => {
    expect(batteryLevel([9, 9, 9, 9, 9], 9)).toBe(1);
    expect(batteryLevel([-3, -3, -3, -3, -3], -3)).toBe(0);
    expect(batteryLevel([NaN, 1, 1, 1, 1], NaN)).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(batteryLevel([NaN, NaN], NaN))).toBe(true);
  });
});

describe('smoothLevel', () => {
  it('stays put for no time, and never overshoots', () => {
    expect(smoothLevel(0.3, 0.9, 0)).toBe(0.3);
    let v = 0;
    for (let i = 0; i < 600; i++) {
      v = smoothLevel(v, 1, 1 / 60);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(v).toBeGreaterThan(0.99);
  });

  it('closes about 63% of the gap in one time constant', () => {
    expect(smoothLevel(0, 1, LEVEL_TAU_S)).toBeCloseTo(1 - Math.exp(-1), 6);
  });

  it('is frame-rate independent: two half steps equal one whole step', () => {
    const whole = smoothLevel(0.1, 0.8, 0.5);
    const halves = smoothLevel(smoothLevel(0.1, 0.8, 0.25), 0.8, 0.25);
    expect(halves).toBeCloseTo(whole, 9);
  });

  it('goes down as well as up', () => {
    expect(smoothLevel(0.9, 0.1, 0.5)).toBeLessThan(0.9);
  });
});

describe('daylight', () => {
  const at = (level: number): Daylight => daylight(level, createDaylight());

  it('is a dark night at level 0 and a bright day at level 1', () => {
    const night = at(0);
    const day = at(1);
    // Night is no lighter than the charcoal stage centre it replaces (#2A2A2A, about 0.165).
    expect(lum(night.skyHi)).toBeLessThan(0.165);
    // ...and the buildings are silhouettes against it, darker than the sky behind them.
    expect(lum(night.wall)).toBeLessThan(lum(night.skyHi));
    expect(lum(day.skyHi)).toBeGreaterThan(0.75);
    expect(lum(day.wall)).toBeGreaterThan(0.5);
  });

  it('only ever gets lighter as the battery rises', () => {
    let prev = at(0);
    for (let i = 1; i <= 100; i++) {
      const d = at(i / 100);
      for (const key of ['skyHi', 'skyLo', 'ground', 'wall'] as const) {
        expect(lum(d[key])).toBeGreaterThanOrEqual(lum(prev[key]) - 1e-9);
      }
      expect(d.windowsLit).toBeGreaterThanOrEqual(prev.windowsLit - 1e-9);
      prev = d;
    }
  });

  it('lights more windows as power comes up, never all of them dark or all lit at the ends', () => {
    expect(at(0).windowsLit).toBeLessThan(0.15);
    expect(at(1).windowsLit).toBeGreaterThan(0.7);
    expect(at(1).windowsLit).toBeLessThanOrEqual(1);
  });

  it('keeps the window glow strongest in the dark, where it shows', () => {
    expect(at(0).windowGlow).toBeGreaterThan(at(1).windowGlow);
  });

  it('keeps every channel a valid sRGB value, even for a level out of range', () => {
    for (const level of [-5, -0.001, 0, 0.37, 1, 1.001, 42, NaN]) {
      const d = at(level);
      for (const c of [d.skyHi, d.skyLo, d.ground, d.wall]) {
        for (const ch of c) {
          expect(ch).toBeGreaterThanOrEqual(0);
          expect(ch).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('fills the object it is given and returns it, so a frame allocates nothing', () => {
    const out = createDaylight();
    expect(daylight(0.5, out)).toBe(out);
  });
});
