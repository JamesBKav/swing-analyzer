import { describe, expect, it } from 'vitest';
import { detectPhases, mergePhases, tempo } from './phases';
import { makeSwing } from './synthetic';

describe('detectPhases', () => {
  it('finds all four phases on a clean synthetic swing', () => {
    const { track, truth } = makeSwing({ rate: 60 });
    const d = detectPhases(track, 'right')!;
    expect(d).not.toBeNull();
    const frame = 1 / 60;
    expect(d.phases.top).toBeCloseTo(truth.top, 0);
    expect(Math.abs(d.phases.top - truth.top)).toBeLessThanOrEqual(2 * frame);
    expect(Math.abs(d.phases.impact - truth.impact)).toBeLessThanOrEqual(3 * frame);
    // Address/finish come from stillness thresholds, so allow a little slack.
    expect(Math.abs(d.phases.address - truth.address)).toBeLessThan(0.05);
    expect(Math.abs(d.phases.finish - truth.finish)).toBeLessThan(0.05);
    expect(d.confidence).toBeGreaterThan(0.9);
  });

  it('keeps phases in order', () => {
    const { track } = makeSwing();
    const p = detectPhases(track, 'right')!.phases;
    expect(p.address).toBeLessThan(p.top);
    expect(p.top).toBeLessThan(p.impact);
    expect(p.impact).toBeLessThan(p.finish);
  });

  it('is robust to landmark noise and dropped frames', () => {
    const { track, truth } = makeSwing({ noise: 0.003, dropRate: 0.08, seed: 42 });
    const d = detectPhases(track, 'right')!;
    expect(Math.abs(d.phases.top - truth.top)).toBeLessThan(0.07);
    expect(Math.abs(d.phases.impact - truth.impact)).toBeLessThan(0.05);
    expect(Math.abs(d.phases.address - truth.address)).toBeLessThan(0.2);
  });

  it('works for left-handed golfers', () => {
    const { track, truth } = makeSwing({ handedness: 'left' });
    const d = detectPhases(track, 'left')!;
    expect(Math.abs(d.phases.top - truth.top)).toBeLessThan(0.05);
    expect(Math.abs(d.phases.impact - truth.impact)).toBeLessThan(0.06);
  });

  it('works on down-the-line footage', () => {
    const { track, truth } = makeSwing({ view: 'dtl' });
    const d = detectPhases(track, 'right')!;
    expect(Math.abs(d.phases.top - truth.top)).toBeLessThan(0.05);
    expect(Math.abs(d.phases.impact - truth.impact)).toBeLessThan(0.06);
  });

  it('handles high frame-rate (240fps) tracks downsampled to 60Hz', () => {
    const { track, truth } = makeSwing({ rate: 240 });
    const d = detectPhases(track, 'right')!;
    expect(Math.abs(d.phases.top - truth.top)).toBeLessThan(0.03);
    expect(Math.abs(d.phases.impact - truth.impact)).toBeLessThan(0.03);
  });

  it('recovers a 3:1 tempo', () => {
    const { track } = makeSwing({ backDur: 0.9, downDur: 0.3 });
    const d = detectPhases(track, 'right')!;
    const t = tempo(d.phases)!;
    expect(t.ratio).toBeGreaterThan(2.6);
    expect(t.ratio).toBeLessThan(3.4);
  });

  it('distinguishes a quicker 2:1 tempo', () => {
    const { track } = makeSwing({ backDur: 0.6, downDur: 0.3 });
    const t = tempo(detectPhases(track, 'right')!.phases)!;
    expect(t.ratio).toBeGreaterThan(1.6);
    expect(t.ratio).toBeLessThan(2.4);
  });

  it('returns null when there is no pose data', () => {
    const { track } = makeSwing({ dropRate: 1 });
    expect(detectPhases(track, 'right')).toBeNull();
  });
});

describe('tempo', () => {
  it('computes durations and ratio', () => {
    const t = tempo({ address: 1, top: 1.9, impact: 2.2 })!;
    expect(t.backswing).toBeCloseTo(0.9);
    expect(t.downswing).toBeCloseTo(0.3);
    expect(t.ratio).toBeCloseTo(3);
  });

  it('scales to real time for baked-in slow motion, ratio unchanged', () => {
    const t = tempo({ address: 8, top: 15.2, impact: 17.6 }, 0.125)!;
    expect(t.backswing).toBeCloseTo(0.9);
    expect(t.downswing).toBeCloseTo(0.3);
    expect(t.ratio).toBeCloseTo(3);
  });

  it('returns null for missing or out-of-order phases', () => {
    expect(tempo({ address: 1, top: 2 })).toBeNull();
    expect(tempo({ address: 2, top: 1, impact: 3 })).toBeNull();
  });
});

describe('mergePhases', () => {
  it('keeps manually set phases over detected ones', () => {
    const merged = mergePhases({ address: 1, top: 2, impact: 2.3, finish: 3 }, { top: 2.1, impact: 2.25 }, ['top']);
    expect(merged).toEqual({ address: 1, top: 2.1, impact: 2.3, finish: 3 });
  });
});
