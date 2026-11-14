import { describe, expect, it } from 'vitest';
import { CLEAR_TOP, COLUMNS, computeLayout, pointAt, seatAt } from './layout';

const SIZES: [string, number, number][] = [
  ['wide desktop', 1400, 700],
  ['landscape phone', 800, 360],
  ['portrait phone', 390, 700],
];

describe.each(SIZES)('layout at %s (%ix%i)', (_name, w, h) => {
  const layout = computeLayout(w, h);

  it('has five equal columns spanning the stage', () => {
    expect(layout.cols).toHaveLength(COLUMNS);
    for (const col of layout.cols) {
      expect(col.x1 - col.x0).toBeCloseTo(w / COLUMNS, 6);
      expect(col.cx).toBeCloseTo((col.x0 + col.x1) / 2, 6);
    }
    expect(layout.cols[COLUMNS - 1]!.x1).toBeCloseTo(w, 6);
  });

  it('keeps the top of the stage clear and stacks lane, reticle, glyph and pad below it', () => {
    expect(layout.laneTop).toBeCloseTo(h * CLEAR_TOP, 0);
    expect(layout.headerH).toBeLessThan(layout.laneTop);
    for (const col of layout.cols) {
      expect(col.outletY).toBe(layout.laneTop);
      expect(col.ringY - col.ringR).toBeGreaterThan(layout.laneTop);
      expect(col.ringY + col.ringR).toBeLessThan(col.glyphY - col.glyphSize);
      expect(col.glyphY).toBeLessThanOrEqual(col.pad.y);
      expect(col.pad.y + col.pad.h).toBeLessThanOrEqual(h);
      expect(col.glyphSize).toBeLessThanOrEqual(layout.colW);
      expect(col.pad.x).toBeGreaterThanOrEqual(col.x0);
      expect(col.pad.x + col.pad.w).toBeLessThanOrEqual(col.x1);
    }
  });

  it('keeps the oscilloscope in the top band corner, clear of the lanes', () => {
    const { scope } = layout;
    expect(scope.x + scope.w).toBeLessThanOrEqual(w);
    expect(scope.x).toBeGreaterThan(w / 2);
    expect(scope.y + scope.h).toBeLessThan(layout.laneTop);
  });

  it('starts every chute at its outlet and ends it at its ring, inside its column', () => {
    for (const col of layout.cols) {
      const { pts, n } = col.chute;
      expect(n).toBeGreaterThan(4);
      expect(pts[0]).toBeCloseTo(col.outletX, 6);
      expect(pts[1]).toBeCloseTo(col.outletY, 6);
      expect(pts[(n - 1) * 2]).toBeCloseTo(col.ringX, 6);
      expect(pts[(n - 1) * 2 + 1]).toBeCloseTo(col.ringY, 6);
      expect(col.ringX).toBeCloseTo(col.cx, 6);
      for (let i = 0; i < n; i++) {
        const x = pts[i * 2]!;
        const y = pts[i * 2 + 1]!;
        // The whole lane (not just its centre line) stays in the column.
        expect(x - layout.trackW / 2).toBeGreaterThanOrEqual(col.x0);
        expect(x + layout.trackW / 2).toBeLessThanOrEqual(col.x1);
        expect(y).toBeGreaterThanOrEqual(col.outletY - 1e-6);
        expect(y).toBeLessThanOrEqual(col.ringY + 1e-6);
      }
    }
  });

  it('ends every chute with a straight vertical run into the ring', () => {
    for (const col of layout.cols) {
      const { pts, n } = col.chute;
      expect(pts[(n - 2) * 2]).toBeCloseTo(col.cx, 6);
      expect(col.ringY - pts[(n - 2) * 2 + 1]!).toBeGreaterThanOrEqual(col.ringR * 1.5);
    }
  });

  it('samples arc length monotonically and at constant speed, hitting both ends', () => {
    const p = { x: 0, y: 0 };
    for (const col of layout.cols) {
      const { cum, n, length } = col.chute;
      for (let i = 1; i < n; i++) expect(cum[i]!).toBeGreaterThan(cum[i - 1]!);
      expect(length).toBeGreaterThan(col.ringY - col.outletY);
      pointAt(col.chute, 0, p);
      expect(p.x).toBeCloseTo(col.outletX, 6);
      expect(p.y).toBeCloseTo(col.outletY, 6);
      pointAt(col.chute, length, p);
      expect(p.x).toBeCloseTo(col.ringX, 6);
      expect(p.y).toBeCloseTo(col.ringY, 6);
      const steps = 400;
      const ds = length / steps;
      let px = col.outletX;
      let py = col.outletY;
      let travelled = 0;
      for (let k = 1; k <= steps; k++) {
        pointAt(col.chute, k * ds, p);
        const d = Math.hypot(p.x - px, p.y - py);
        // A straight-line step never exceeds the arc step; corners shave a little off.
        expect(d).toBeLessThanOrEqual(ds * 1.000001);
        travelled += d;
        px = p.x;
        py = p.y;
      }
      expect(travelled / length).toBeGreaterThan(0.97);
      pointAt(col.chute, -50, p);
      expect(p.y).toBeCloseTo(col.outletY, 6);
      pointAt(col.chute, length + 50, p);
      expect(p.y).toBeCloseTo(col.ringY, 6);
    }
  });

  it('maps column centres to their seat, full height below the top band, and the band to null', () => {
    for (const col of layout.cols) {
      expect(seatAt(layout, col.cx, col.ringY)).toBe(col.seat);
      expect(seatAt(layout, col.cx, col.pad.y + col.pad.h / 2)).toBe(col.seat);
      expect(seatAt(layout, col.cx, layout.laneTop / 2)).toBe(col.seat);
      expect(seatAt(layout, col.cx, layout.headerH + 1)).toBe(col.seat);
      expect(seatAt(layout, col.cx, layout.headerH / 2)).toBeNull();
    }
    expect(seatAt(layout, -1, h / 2)).toBeNull();
    expect(seatAt(layout, w, h / 2)).toBeNull();
    expect(seatAt(layout, w / 2, h)).toBeNull();
  });
});
