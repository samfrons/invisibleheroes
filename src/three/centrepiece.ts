/**
 * The 3D stage: a dual-chamber microbial fuel cell on a 1970s mission-control
 * console, charging the band's five-cell battery pack, under a navy sky with
 * a receding grid, stars and a ringed planet. Drawn with three.js on its own
 * OPAQUE canvas that fills the stage; the 2D lanes and text go on top.
 *
 * This module is tiny on purpose: it holds the API and a WebGL check, and
 * pulls in three.js (and the scene, ./scene.ts) through a dynamic import, so
 * the main bundle does not carry it. Everything drawn follows from the Frame:
 * no game state lives here, so a replay of a take draws the same pictures.
 */
import type { Frame } from '../types';

export interface Centrepiece {
  /** CSS pixel size of the canvas and the device pixel ratio (capped at 2). Sets the canvas's style size too. */
  resize(width: number, height: number, dpr: number): void;
  /** Draw one frame from the game's Frame. Does not allocate. */
  draw(frame: Frame): void;
  /** Diagnostics from the last draw (renderer.info): draw calls and triangles. */
  info(): { calls: number; triangles: number };
  dispose(): void;
}

export interface CentrepieceOptions {
  /**
   * 'high' (default on desktop): transmissive liquids, a 256 px environment
   * map, full particle counts, two point lights. 'low' (phones): no
   * transmission, a 64 px environment, fewer stars and bubbles, one point
   * light, a coarser grid and the pixel ratio capped at 1.5.
   */
  quality?: 'high' | 'low';
}

function hasWebGL2(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * Null when WebGL 2 is unavailable (three.js r163+ needs it) or the scene
 * fails to start. three.js loads lazily, in its own chunk.
 */
export async function createCentrepiece(
  canvas: HTMLCanvasElement,
  options: CentrepieceOptions = {},
): Promise<Centrepiece | null> {
  if (!hasWebGL2()) return null;
  try {
    const { buildCentrepiece } = await import('./scene');
    return buildCentrepiece(canvas, options);
  } catch (err) {
    console.warn('3D centrepiece unavailable', err);
    return null;
  }
}
