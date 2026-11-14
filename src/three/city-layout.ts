/**
 * Where the city's buildings stand (pure: no three.js, deterministic).
 *
 * After MESSAI's /lab/city `AmbientCity`: three kinds of building (a flat
 * block, a block with a rooftop unit, a slender tower), seeded so every
 * visitor gets the same skyline. Here they stand in rows receding behind the
 * stage, taller toward downtown (far and central), because the camera looks
 * at the city end-on, not from above.
 *
 * Units are scene units; the floor is y = 0 here and the scene lifts it.
 */

/** The city stands between these depths. The stage and its biofilm network end well in front of NEAR. */
export const CITY_NEAR_Z = -24;
export const CITY_FAR_Z = -84;

/** 0 = flat block, 1 = block with a rooftop unit, 2 = slender tower. */
export type BuildingType = 0 | 1 | 2;

export interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  type: BuildingType;
}

/** A rooftop unit: stands on building `on`, whose top is at `y`. */
export interface RooftopUnit {
  on: number;
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

export interface CityLayout {
  buildings: Building[];
  units: RooftopUnit[];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Height contract with the window shader (materials.ts): a box taller than
 * the midpoint of these two gets windows, a shorter one is a rooftop unit and
 * stays blank. Every building is at least MIN_BUILDING_H; every unit is under
 * ROOFTOP_UNIT_MAX_H.
 */
export const MIN_BUILDING_H = 3;
export const ROOFTOP_UNIT_MAX_H = 2;

/** Gap kept between neighbours so no two footprints touch. */
const GAP = 0.9;

/**
 * `rows` is the density: 9 for a desktop, 5 for a phone. Each row is as wide
 * as the camera can see at its depth (plus a margin), so the skyline always
 * reaches the screen's edges.
 */
export function layoutCity(rows: number, seed = 7): CityLayout {
  const rng = mulberry32(seed);
  const buildings: Building[] = [];
  const units: RooftopUnit[] = [];
  const rowGap = (CITY_NEAR_Z - CITY_FAR_Z) / rows;

  for (let r = 0; r < rows; r++) {
    // Row r's footprints fit inside its own band, so rows never overlap.
    const depthT = rows === 1 ? 1 : r / (rows - 1);
    const zFront = CITY_NEAR_Z - r * rowGap;
    const maxD = rowGap - GAP;
    // The camera sits about 26 in front of the stage; a landscape view sees about +-0.66 of the depth sideways.
    const span = (26 - zFront) * 0.7;
    let x = -span + rng() * 2;
    while (x < span) {
      const roll = rng();
      const type: BuildingType = roll < 0.5 ? 0 : roll < 0.78 ? 1 : 2;
      const w = type === 2 ? 2.2 + rng() * 1.4 : 3 + rng() * 3.2;
      const d = Math.min(maxD, (type === 2 ? 2.2 + rng() * 1.4 : 3 + rng() * 3.4) * (0.8 + rng() * 0.4));
      const downtown = 1 - Math.min(1, Math.abs(x) / span);
      const ground = 2.6 + rng() * 3.4;
      // Taller the farther back and the closer to the middle; towers get the most.
      const h = Math.max(
        MIN_BUILDING_H,
        type === 2
          ? (9 + rng() * 9) * (0.55 + 0.45 * depthT) * (0.6 + 0.6 * downtown)
          : ground * (0.7 + 0.9 * depthT) * (0.7 + 0.7 * downtown),
      );
      const bx = x + w / 2;
      buildings.push({ x: bx, z: zFront - d / 2, w, d, h, type });
      if (type === 1) {
        const uw = w * (0.35 + rng() * 0.2);
        const ud = d * (0.35 + rng() * 0.2);
        const ox = (rng() - 0.5) * (w - uw) * 0.8;
        const oz = (rng() - 0.5) * (d - ud) * 0.8;
        units.push({ on: buildings.length - 1, x: bx + ox, y: h, z: zFront - d / 2 + oz, w: uw, d: ud, h: 0.8 + rng() * (ROOFTOP_UNIT_MAX_H - 0.9) });
      }
      x += w + GAP + rng() * 1.4;
    }
  }
  return { buildings, units };
}
