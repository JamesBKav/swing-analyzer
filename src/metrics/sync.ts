import { PHASES, type Phases } from '../types';

export type SyncMode = 'address' | 'impact' | 'phases';

/**
 * Map a time in swing A to the matching time in swing B.
 *
 * - 'address' / 'impact': constant offset so that phase lines up.
 * - 'phases': piecewise-linear time warp through every phase both swings
 *   have, so address, top, impact and finish all coincide. Outside the
 *   tagged range it continues at 1:1.
 */
export function mapTime(tA: number, a: Phases, b: Phases, mode: SyncMode): number {
  if (mode === 'address' || mode === 'impact') {
    const pa = a[mode], pb = b[mode];
    if (pa === undefined || pb === undefined) return tA;
    return tA - pa + pb;
  }
  const pairs = PHASES.filter((p) => a[p] !== undefined && b[p] !== undefined)
    .map((p) => [a[p]!, b[p]!] as const)
    // Keep strictly increasing pairs only (guards against bad manual tags).
    .filter((pair, i, arr) => i === 0 || (pair[0] > arr[i - 1][0] && pair[1] > arr[i - 1][1]));
  if (pairs.length === 0) return tA;
  if (pairs.length === 1 || tA <= pairs[0][0]) return tA - pairs[0][0] + pairs[0][1];
  const last = pairs[pairs.length - 1];
  if (tA >= last[0]) return tA - last[0] + last[1];
  for (let i = 1; i < pairs.length; i++) {
    const [a0, b0] = pairs[i - 1];
    const [a1, b1] = pairs[i];
    if (tA <= a1) return b0 + ((tA - a0) * (b1 - b0)) / (a1 - a0);
  }
  return tA;
}
