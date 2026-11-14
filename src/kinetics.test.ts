import { describe, expect, it } from 'vitest';
import { BEST_ENERGY, CABLE, GEO, SHIVA, SHUTTLE_S, SPORO, createCell, deposit, lampOf, report, simulate, step } from './kinetics';
import { MISS, PERFECT, GOOD } from './engine';
import { NOTES } from './score';
import { MICROBES_BY_SEAT } from './microbes';
import { HEROES } from './strings';

const grades = (f: (seat: number, i: number) => number) => {
  const g = new Uint8Array(NOTES.length);
  for (const n of NOTES) g[n.i] = f(n.seat, n.i);
  return g;
};
const all = (grade: number) => grades(() => grade);
const share = (g: Uint8Array) => simulate(g).energy / BEST_ENERGY;

describe('the fuel cell', () => {
  it('is deterministic: the same grades make the same cell', () => {
    const g = grades((_, i) => (i % 3 ? PERFECT : MISS));
    expect(simulate(g).energy).toBe(simulate(g).energy);
  });

  it('makes more power the better the band plays', () => {
    const perfect = share(all(PERFECT));
    const good = share(all(GOOD));
    const half = share(grades((_, i) => (i % 2 ? PERFECT : MISS)));
    expect(perfect).toBeCloseTo(1);
    expect(good).toBeLessThan(perfect);
    expect(half).toBeLessThan(good);
    expect(share(all(MISS))).toBe(0);
  });

  it('needs every job: dropping any one seat costs energy', () => {
    for (let seat = 0; seat < 5; seat++) {
      expect(share(grades((s) => (s === seat ? MISS : PERFECT))), `seat ${seat}`).toBeLessThan(0.9);
    }
  });

  it('makes no current without the cathode (the drum)', () => {
    expect(share(grades((s) => (s === SPORO ? MISS : PERFECT)))).toBe(0);
  });

  it('makes little without the cable to carry it', () => {
    expect(share(grades((s) => (s === CABLE ? MISS : PERFECT)))).toBeLessThan(0.75);
  });

  it("delivers Shiva's electrons one shuttle trip late, Geo's at once", () => {
    const geo = createCell(0);
    deposit(geo, GEO, 1, 1);
    expect(geo.anode).toBeGreaterThan(0);
    const shiva = createCell(0);
    deposit(shiva, SHIVA, 1, 1);
    expect(shiva.anode).toBe(0);
    step(shiva, 1 + SHUTTLE_S + 0.05);
    expect(shiva.anode).toBeGreaterThan(0);
  });

  it('grows biofilm with hits and sheds it with misses', () => {
    const cell = createCell(0);
    const start = cell.biofilm[GEO]!;
    deposit(cell, GEO, 1, 0.1);
    expect(cell.biofilm[GEO]).toBeGreaterThan(start);
    const grown = cell.biofilm[GEO]!;
    deposit(cell, GEO, 0, 0.2);
    expect(cell.biofilm[GEO]).toBeLessThan(grown);
  });

  it('keeps the lamp within 0..1 and lights it for a perfect band', () => {
    const cell = createCell();
    let max = 0;
    for (const n of NOTES) {
      deposit(cell, n.seat, 1, n.t);
      const lamp = lampOf(cell);
      expect(lamp).toBeGreaterThanOrEqual(0);
      expect(lamp).toBeLessThanOrEqual(1);
      max = Math.max(max, lamp);
    }
    expect(max).toBe(1);
  });

  it("names the player whose part cost the cell the most", () => {
    const humans = [true, true, false, true, false];
    const r = report(grades((s) => (s === SHIVA ? MISS : PERFECT)), humans);
    expect(r.weak).toBe(SHIVA);
    expect(report(all(PERFECT), humans).weak).toBeNull();
  });
});

describe('the cast', () => {
  it('has one microbe per seat, matching the stage names and keys', () => {
    expect(MICROBES_BY_SEAT.map((m) => m.seat)).toEqual([0, 1, 2, 3, 4]);
    MICROBES_BY_SEAT.forEach((m, seat) => {
      expect(m.name).toBe(HEROES[seat]!.name);
      expect(m.key.toUpperCase()).toBe(HEROES[seat]!.key);
    });
  });
});
