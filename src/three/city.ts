/**
 * The city behind the stage: one InstancedMesh of buildings and one of
 * rooftop units, sharing a single window shader (cityMaterial). It stands
 * still; only its light moves. update() is called every frame with the
 * battery's Daylight and allocates nothing.
 */
import { BoxGeometry, type BufferGeometry, type Color, Group, InstancedMesh, type Material, Matrix4, Quaternion, type ShaderMaterial, SRGBColorSpace, Vector3 } from 'three';
import { layoutCity } from './city-layout';
import type { Daylight } from './daylight';
import { cityMaterial, type Quality } from './materials';

export interface City {
  group: Group;
  /** Light the city for this battery level. `time` is wall seconds, for the windows' shimmer. */
  update(day: Daylight, time: number): void;
}

/**
 * `sky` is the stage's sky material (the city's haze reads its colours);
 * `floorY` is the height of the floor the city stands on. `own` registers the
 * geometry and material for disposal.
 */
export function buildCity(
  sky: ShaderMaterial,
  floorY: number,
  quality: Quality,
  own: { geometry<T extends BufferGeometry>(g: T): T; material<T extends Material>(m: T): T },
): City {
  const layout = layoutCity(quality === 'high' ? 9 : 5);
  const mat = own.material(cityMaterial(sky));
  // A unit box, centred: the shader reads each instance's scale as its size.
  const box = own.geometry(new BoxGeometry(1, 1, 1));

  const group = new Group();
  const towers = new InstancedMesh(box, mat, layout.buildings.length);
  const units = new InstancedMesh(box, mat, Math.max(1, layout.units.length));
  towers.frustumCulled = false;
  units.frustumCulled = false;

  const m = new Matrix4();
  const q = new Quaternion();
  const p = new Vector3();
  const s = new Vector3();
  layout.buildings.forEach((b, i) => {
    towers.setMatrixAt(i, m.compose(p.set(b.x, floorY + b.h / 2, b.z), q, s.set(b.w, b.h, b.d)));
  });
  layout.units.forEach((u, i) => {
    units.setMatrixAt(i, m.compose(p.set(u.x, floorY + u.y + u.h / 2, u.z), q, s.set(u.w, u.h, u.d)));
  });
  units.count = layout.units.length;
  towers.instanceMatrix.needsUpdate = true;
  units.instanceMatrix.needsUpdate = true;
  group.add(towers, units);

  const u = mat.uniforms;
  return {
    group,
    update(day, time) {
      const w = day.wall;
      (u.wallCol!.value as Color).setRGB(w[0], w[1], w[2], SRGBColorSpace);
      u.lit!.value = day.windowsLit;
      u.glow!.value = day.windowGlow;
      u.time!.value = time;
    },
  };
}

