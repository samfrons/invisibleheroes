import { describe, expect, it } from 'vitest';
import { CITY_FAR_Z, CITY_NEAR_Z, MIN_BUILDING_H, ROOFTOP_UNIT_MAX_H, layoutCity } from './city-layout';

describe('layoutCity', () => {
  const city = layoutCity(9, 7);

  it('is deterministic for a seed, and different for another', () => {
    expect(layoutCity(9, 7)).toEqual(city);
    expect(layoutCity(9, 8)).not.toEqual(city);
  });

  it('is a real city: plenty of buildings, all three kinds', () => {
    expect(city.buildings.length).toBeGreaterThan(120);
    for (const type of [0, 1, 2]) expect(city.buildings.some((b) => b.type === type)).toBe(true);
  });

  it('keeps the stage and its biofilm network clear: every footprint is behind the near edge', () => {
    for (const b of city.buildings) {
      expect(b.z + b.d / 2).toBeLessThanOrEqual(CITY_NEAR_Z + 1e-9);
      expect(b.z - b.d / 2).toBeGreaterThanOrEqual(CITY_FAR_Z - 8);
    }
  });

  it('gives every building a positive size, tall enough for a street floor and a row of windows', () => {
    for (const b of city.buildings) {
      expect(b.w).toBeGreaterThan(0);
      expect(b.d).toBeGreaterThan(0);
      expect(b.h).toBeGreaterThanOrEqual(MIN_BUILDING_H);
    }
  });

  it('keeps every rooftop unit lower than the lowest building, so a shader can tell them apart by height', () => {
    for (const u of city.units) expect(u.h).toBeLessThan(ROOFTOP_UNIT_MAX_H);
    expect(ROOFTOP_UNIT_MAX_H).toBeLessThan(MIN_BUILDING_H);
  });

  it('puts no two footprints on top of each other', () => {
    const bs = city.buildings;
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i]!;
        const b = bs[j]!;
        const overlapX = Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 1e-9;
        const overlapZ = Math.abs(a.z - b.z) < (a.d + b.d) / 2 - 1e-9;
        expect(overlapX && overlapZ).toBe(false);
      }
    }
  });

  it('puts a rooftop unit on top of its building only, inside its footprint', () => {
    expect(city.units.length).toBeGreaterThan(10);
    for (const u of city.units) {
      const b = city.buildings[u.on]!;
      expect(b.type).toBe(1);
      expect(u.w).toBeLessThan(b.w);
      expect(u.d).toBeLessThan(b.d);
      expect(Math.abs(u.x - b.x) + u.w / 2).toBeLessThanOrEqual(b.w / 2 + 1e-9);
      expect(Math.abs(u.z - b.z) + u.d / 2).toBeLessThanOrEqual(b.d / 2 + 1e-9);
      expect(u.y).toBeCloseTo(b.h, 9);
    }
  });

  it('builds a lighter city for a low-power device', () => {
    expect(layoutCity(5, 7).buildings.length).toBeLessThan(city.buildings.length);
  });

  it('rises toward downtown: the tallest buildings are far and central, not near the edges', () => {
    const tall = [...city.buildings].sort((a, b) => b.h - a.h).slice(0, 10);
    const meanAbsX = tall.reduce((s, b) => s + Math.abs(b.x), 0) / tall.length;
    const all = city.buildings.reduce((s, b) => s + Math.abs(b.x), 0) / city.buildings.length;
    expect(meanAbsX).toBeLessThan(all);
  });
});
