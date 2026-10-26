import { describe, expect, it } from 'vitest';
import { computeMetrics } from './metrics';
import { detectPhases } from './phases';
import { makeSwing, type SwingSpec } from './synthetic';
import { angleAt, angleFromVertical, fillGaps, smooth, tiltLeadUp } from './geometry';
import { DEFAULT_SETTINGS, type SessionSettings } from '../types';

function analyse(spec: SwingSpec, settings: Partial<SessionSettings> = {}) {
  const { track, truth } = makeSwing(spec);
  const s = { ...DEFAULT_SETTINGS, view: spec.view ?? 'face-on', handedness: spec.handedness ?? 'right', ...settings };
  // Use ground-truth phases so metric tests don't depend on detection.
  return computeMetrics(track, truth, s);
}

describe('geometry', () => {
  it('angleAt measures interior angles', () => {
    expect(angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90);
    expect(angleAt({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(180);
  });

  it('angleFromVertical is signed toward +x (y down)', () => {
    expect(angleFromVertical({ x: 0, y: 1 }, { x: 0, y: 0 })).toBeCloseTo(0);
    expect(angleFromVertical({ x: 0, y: 1 }, { x: 1, y: 0 })).toBeCloseTo(45);
    expect(angleFromVertical({ x: 0, y: 1 }, { x: -1, y: 0 })).toBeCloseTo(-45);
  });

  it('tiltLeadUp is positive when the lead point is higher, either side of frame', () => {
    expect(tiltLeadUp({ x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(45);
    expect(tiltLeadUp({ x: 0, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(45);
    expect(tiltLeadUp({ x: 1, y: 1 }, { x: 0, y: 0 })).toBeCloseTo(-45);
  });

  it('fillGaps interpolates and extends edges', () => {
    const out = fillGaps(Float64Array.from([NaN, 1, NaN, NaN, 4, NaN]));
    expect(Array.from(out)).toEqual([1, 1, 2, 3, 4, 4]);
  });

  it('smooth averages with a centred window', () => {
    const out = smooth(Float64Array.from([0, 0, 3, 0, 0]), 3);
    expect(Array.from(out)).toEqual([0, 1, 1, 1, 0]);
  });
});

describe('computeMetrics', () => {
  it('reports tempo in real seconds', () => {
    const m = analyse({ backDur: 0.9, downDur: 0.3 });
    expect(m.tempo!.ratio).toBeCloseTo(3, 1);
    expect(m.tempo!.backswing).toBeCloseTo(0.9, 1);
  });

  it('face-on spine tilt away from target at address and impact', () => {
    const m = analyse({ spineAddress: 8, spineImpact: 20 });
    expect(m.spine.address!).toBeCloseTo(8, 0);
    expect(m.spine.impact!).toBeCloseTo(20, 0);
    expect(m.spine.change!).toBeCloseTo(12, 0);
  });

  it('down-the-line forward bend, including losing posture', () => {
    const m = analyse({ view: 'dtl', spineAddress: 35, spineImpact: 28 });
    expect(m.spine.address!).toBeCloseTo(35, 0);
    expect(m.spine.impact!).toBeCloseTo(28, 0);
    expect(m.spine.change!).toBeCloseTo(-7, 0);
  });

  it('mirrors correctly for left-handed golfers', () => {
    const m = analyse({ handedness: 'left', spineAddress: 10, spineImpact: 18 });
    expect(m.spine.address!).toBeCloseTo(10, 0);
    expect(m.spine.impact!).toBeCloseTo(18, 0);
  });

  it('measures head drift as % of torso length', () => {
    // 0.02 units toward target and 0.01 down, torso = 0.2 units.
    const m = analyse({ headShiftX: 0.02, headShiftY: -0.01 });
    expect(m.head!.lateralAtImpact).toBeCloseTo(10, 0);
    expect(m.head!.verticalAtImpact).toBeCloseTo(-5, 0);
    expect(m.head!.lateralRange).toBeCloseTo(10, 0);
    expect(m.head!.box.x1).toBeGreaterThan(m.head!.box.x0);
  });

  it('head drift is zero for a still head', () => {
    const m = analyse({});
    expect(m.head!.lateralRange).toBeCloseTo(0, 1);
    expect(m.head!.verticalRange).toBeCloseTo(0, 1);
  });

  it('lead arm angle at the top', () => {
    expect(analyse({ elbowBend: 0 }).leadArm.elbowAtTop!).toBeCloseTo(180, 0);
    expect(analyse({ elbowBend: 25 }).leadArm.elbowAtTop!).toBeCloseTo(155, 0);
    // Hands are above the shoulder at the top.
    expect(analyse({}).leadArm.aboveHorizontalAtTop!).toBeGreaterThan(20);
  });

  it('shoulder and hip lines are level for the synthetic setup', () => {
    const m = analyse({});
    expect(m.shoulders.address!).toBeCloseTo(0, 0);
    expect(m.hips.address!).toBeCloseTo(0, 0);
  });

  it('turn proxy only for face-on', () => {
    expect(analyse({ view: 'dtl' }).shoulderTurnTop).toBeNull();
    expect(analyse({}).shoulderTurnTop).toBeCloseTo(0, 0);
  });

  it('works end-to-end with detected phases on noisy data', () => {
    const { track } = makeSwing({ noise: 0.002, seed: 3, spineAddress: 8, spineImpact: 14 });
    const d = detectPhases(track, 'right')!;
    const m = computeMetrics(track, d.phases, DEFAULT_SETTINGS);
    expect(m.tempo!.ratio).toBeGreaterThan(2.4);
    expect(m.tempo!.ratio).toBeLessThan(3.6);
    expect(m.spine.address!).toBeGreaterThan(5);
    expect(m.spine.impact!).toBeGreaterThan(m.spine.address!);
  });
});
