import { describe, expect, it } from 'vitest';
import { mapTime } from './sync';

const A = { address: 1, top: 2, impact: 2.3, finish: 3 };
const B = { address: 4, top: 5.5, impact: 5.8, finish: 7 };

describe('mapTime', () => {
  it('aligns at address with a constant offset', () => {
    expect(mapTime(1, A, B, 'address')).toBeCloseTo(4);
    expect(mapTime(2.3, A, B, 'address')).toBeCloseTo(5.3);
  });

  it('aligns at impact with a constant offset', () => {
    expect(mapTime(2.3, A, B, 'impact')).toBeCloseTo(5.8);
    expect(mapTime(1, A, B, 'impact')).toBeCloseTo(4.5);
  });

  it('warps through all phases', () => {
    expect(mapTime(1, A, B, 'phases')).toBeCloseTo(4);
    expect(mapTime(2, A, B, 'phases')).toBeCloseTo(5.5);
    expect(mapTime(2.3, A, B, 'phases')).toBeCloseTo(5.8);
    expect(mapTime(3, A, B, 'phases')).toBeCloseTo(7);
    // Halfway through A's backswing is halfway through B's.
    expect(mapTime(1.5, A, B, 'phases')).toBeCloseTo(4.75);
  });

  it('continues 1:1 outside the tagged range', () => {
    expect(mapTime(0.5, A, B, 'phases')).toBeCloseTo(3.5);
    expect(mapTime(3.5, A, B, 'phases')).toBeCloseTo(7.5);
  });

  it('falls back gracefully when phases are missing', () => {
    expect(mapTime(1.2, {}, B, 'impact')).toBeCloseTo(1.2);
    expect(mapTime(1.2, { impact: 2 }, { impact: 3 }, 'phases')).toBeCloseTo(2.2);
  });
});
