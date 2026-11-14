// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { canRecordVideo } from './recorder';
import { createBandAudio, midiToHz } from './synth';

describe('midiToHz', () => {
  it('maps MIDI numbers to Hz with A4 = 440', () => {
    expect(midiToHz(69)).toBeCloseTo(440, 6);
    expect(midiToHz(57)).toBeCloseTo(220, 6);
    expect(midiToHz(81)).toBeCloseTo(880, 6);
    expect(midiToHz(60)).toBeCloseTo(261.63, 1);
  });
});

describe('createBandAudio without Web Audio', () => {
  it('returns a silent engine that never throws', () => {
    const a = createBandAudio();
    expect(() => {
      a.resume();
      a.setMuted(true);
      a.play(0, [41], 0, 1);
      a.play(1, [57, 60, 64]);
      a.tick(0, true);
      for (const c of ['count', 'go', 'miss', 'stray', 'finale', 'ui'] as const) a.cue(c, 0);
      a.hush();
      a.dispose();
      a.dispose();
    }).not.toThrow();
    expect(a.now()).toBeNull();
    expect(a.stream()).toBeNull();
  });

  it('cannot record video', () => {
    expect(canRecordVideo()).toBe(false);
  });
});
