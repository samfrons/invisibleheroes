import qrcode from 'qrcode-generator';
import { describe, expect, it } from 'vitest';
import { qrSvg } from './qr';

/** Quiet-zone width, in modules, that qrSvg adds on every side. */
const MARGIN = 4;

const URL_TEXT = 'https://example.org/?join=ABCD';
const LOCAL_TEXT = 'http://localhost:5173/?join=8GBC&net=local';
const LONG_TEXT = 'Invisible Heroes: scan this code to join the local game session. '.repeat(3);

interface Segment {
  x: number;
  y: number;
  run: number;
}

interface ParsedSvg {
  viewBox: string;
  width: number;
  height: number;
  pathData: string;
  segments: Segment[];
}

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
}

/** Reads the SVG with regular expressions only: viewBox, the single path, and its rectangles. */
function parseSvg(svg: string): ParsedSvg {
  const viewBox = must(/viewBox="([^"]*)"/.exec(svg)?.[1], 'viewBox');
  const size = must(/^0 0 (\d+) (\d+)$/.exec(viewBox), 'viewBox "0 0 w h"');
  const pathData = must(/<path d="([^"]*)"/.exec(svg)?.[1], 'path d attribute');

  const segments: Segment[] = [];
  let consumed = 0;
  for (const m of pathData.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
    expect(m[3], `width and return of rectangle "${m[0]}"`).toBe(m[4]);
    consumed += m[0].length;
    segments.push({ x: Number(m[1]), y: Number(m[2]), run: Number(m[3]) });
  }
  // Every byte of the path must belong to a rectangle; nothing unparsed may hide dark modules.
  expect(consumed, 'path contains only well-formed rectangles').toBe(pathData.length);

  return {
    viewBox,
    width: Number(size[1]),
    height: Number(size[2]),
    pathData,
    segments,
  };
}

/** Rebuilds the module grid (margin removed) from the parsed rectangles. */
function moduleGrid(parsed: ParsedSvg): boolean[][] {
  const count = parsed.width - MARGIN * 2;
  const grid = Array.from({ length: count }, () => new Array<boolean>(count).fill(false));
  for (const { x, y, run } of parsed.segments) {
    const row = grid[y - MARGIN];
    for (let i = 0; i < run; i++) {
      const col = x - MARGIN + i;
      if (!row || col < 0 || col >= count) {
        throw new Error(`rectangle ${x} ${y} h${run} lies outside the module area`);
      }
      if (row[col]) throw new Error(`module ${y - MARGIN},${col} painted twice`);
      row[col] = true;
    }
  }
  return grid;
}

/** The expected grid, straight from qrcode-generator, independent of src/qr.ts. */
function expectedGrid(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  return Array.from({ length: count }, (_, row) =>
    Array.from({ length: count }, (_, col) => qr.isDark(row, col)),
  );
}

function isDarkAt(grid: boolean[][], row: number, col: number): boolean {
  return grid[row]?.[col] === true;
}

function pathOf(svg: string): string {
  return must(/<path d="([^"]*)"/.exec(svg)?.[1], 'path d attribute');
}

function ariaLabelOf(svg: string): string {
  return must(/aria-label="([^"]*)"/.exec(svg)?.[1], 'aria-label attribute');
}

describe('qrSvg encodes the text', () => {
  it.each([
    ['URL with join code', URL_TEXT],
    ['localhost URL with two parameters', LOCAL_TEXT],
    ['long text of about 200 characters', LONG_TEXT],
  ])('rebuilds the same module grid as qrcode-generator: %s', (_name, text) => {
    const parsed = parseSvg(qrSvg(text, 'label'));
    const expected = expectedGrid(text);
    const actual = moduleGrid(parsed);

    expect(actual.length).toBe(expected.length);
    expect(actual).toEqual(expected);
  });

  it('uses a long input that is really about 200 characters', () => {
    expect(LONG_TEXT.length).toBeGreaterThanOrEqual(190);
    expect(LONG_TEXT.length).toBeLessThanOrEqual(210);
  });
});

describe('qrSvg geometry', () => {
  const texts = [URL_TEXT, LOCAL_TEXT, LONG_TEXT];

  it.each(texts)('has a square viewBox of module count + 8: %s', (text) => {
    const parsed = parseSvg(qrSvg(text, 'label'));
    const count = expectedGrid(text).length;

    expect(parsed.width).toBe(parsed.height);
    expect(parsed.width).toBe(count + MARGIN * 2);
    expect(parsed.viewBox).toBe(`0 0 ${count + 8} ${count + 8}`);
  });

  it.each(texts)('keeps every dark module out of the 4-module margin: %s', (text) => {
    const parsed = parseSvg(qrSvg(text, 'label'));
    const size = parsed.width;

    expect(parsed.segments.length).toBeGreaterThan(0);
    for (const { x, y, run } of parsed.segments) {
      expect(y, `rectangle at y=${y}`).toBeGreaterThanOrEqual(MARGIN);
      expect(y, `rectangle at y=${y}`).toBeLessThan(size - MARGIN);
      expect(x, `rectangle at x=${x}`).toBeGreaterThanOrEqual(MARGIN);
      expect(x + run, `rectangle at x=${x} run ${run}`).toBeLessThanOrEqual(size - MARGIN);
    }
  });

  it.each(texts)('draws the three finder patterns in the corners: %s', (text) => {
    const grid = moduleGrid(parseSvg(qrSvg(text, 'label')));
    const count = grid.length;
    const origins: Array<[string, number, number]> = [
      ['top-left', 0, 0],
      ['top-right', 0, count - 7],
      ['bottom-left', count - 7, 0],
    ];

    for (const [corner, top, left] of origins) {
      for (let i = 0; i < 7; i++) {
        for (let j = 0; j < 7; j++) {
          const outerRing = i === 0 || i === 6 || j === 0 || j === 6;
          const centre = i >= 2 && i <= 4 && j >= 2 && j <= 4;
          // Outer ring and 3x3 centre are dark; the ring between them is light.
          expect(isDarkAt(grid, top + i, left + j), `${corner} finder at ${i},${j}`).toBe(
            outerRing || centre,
          );
        }
      }
    }
  });
});

describe('qrSvg output contract', () => {
  it('is deterministic for the same input', () => {
    expect(qrSvg(URL_TEXT, 'Join')).toBe(qrSvg(URL_TEXT, 'Join'));
  });

  it('gives different paths for different texts', () => {
    expect(pathOf(qrSvg(URL_TEXT, 'Join'))).not.toBe(pathOf(qrSvg(LOCAL_TEXT, 'Join')));
  });

  it('places the label in aria-label', () => {
    expect(ariaLabelOf(qrSvg(URL_TEXT, 'Join the game'))).toBe('Join the game');
  });

  it('removes & < > " from the label so the attribute cannot be broken out of', () => {
    const svg = qrSvg(URL_TEXT, 'a"b<c>&d');
    const value = ariaLabelOf(svg);

    expect(value).toBe('abcd');
    expect(value).not.toMatch(/["<>&]/);
    // The attribute is still well formed: one aria-label and it closes before the rect.
    expect(svg.match(/aria-label=/g)?.length).toBe(1);
  });

  it('starts with <svg and ends with </svg>', () => {
    const svg = qrSvg(URL_TEXT, 'Join');

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('contains exactly one <path', () => {
    const svg = qrSvg(LONG_TEXT, 'Join');

    expect(svg.match(/<path\b/g)?.length).toBe(1);
  });

  it('uses only #fff for the background rect and #0c1638 for the path', () => {
    const svg = qrSvg(URL_TEXT, 'Join');

    expect(svg).toMatch(/<rect [^>]*fill="#fff"/);
    expect(svg).toMatch(/<path d="[^"]*" fill="#0c1638"/);
    expect(svg.match(/fill="[^"]*"/g)).toEqual(['fill="#fff"', 'fill="#0c1638"']);
  });
});
