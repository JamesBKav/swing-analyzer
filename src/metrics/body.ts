import { LM, STRIDE, FRAME_FLOATS, type PoseTrack } from '../pose/landmarks';
import { dist, median, mid, type P2 } from './geometry';
import type { Handedness } from '../types';

const MIN_VIS = 0.3;

/** Landmark indices for the golfer's lead (target-side) and trail sides. */
export function sides(handedness: Handedness) {
  const L = handedness === 'right';
  return {
    leadShoulder: L ? LM.leftShoulder : LM.rightShoulder,
    trailShoulder: L ? LM.rightShoulder : LM.leftShoulder,
    leadElbow: L ? LM.leftElbow : LM.rightElbow,
    leadWrist: L ? LM.leftWrist : LM.rightWrist,
    trailWrist: L ? LM.rightWrist : LM.leftWrist,
    leadHip: L ? LM.leftHip : LM.rightHip,
    trailHip: L ? LM.rightHip : LM.leftHip,
  };
}

/**
 * Landmark lm at sample i in isotropic units, averaged over valid samples
 * within ±radius to damp jitter. Null if not visible.
 */
export function point(track: PoseTrack, i: number, lm: number, radius = 1): P2 | null {
  let sx = 0, sy = 0, n = 0;
  const N = track.times.length;
  for (let k = Math.max(0, i - radius); k <= Math.min(N - 1, i + radius); k++) {
    const o = k * FRAME_FLOATS + lm * STRIDE;
    const x = track.data[o], y = track.data[o + 1], v = track.data[o + 3];
    if (Number.isNaN(x) || v < MIN_VIS) continue;
    sx += x * track.aspect;
    sy += y;
    n++;
  }
  return n ? { x: sx / n, y: sy / n } : null;
}

export function midPoint(track: PoseTrack, i: number, a: number, b: number): P2 | null {
  const pa = point(track, i, a);
  const pb = point(track, i, b);
  return pa && pb ? mid(pa, pb) : null;
}

/** Head position: mean of whichever of nose/ears are visible. */
export function headPoint(track: PoseTrack, i: number): P2 | null {
  const pts = [LM.nose, LM.leftEar, LM.rightEar].map((lm) => point(track, i, lm)).filter((p): p is P2 => !!p);
  if (!pts.length) return null;
  return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
}

/**
 * Typical torso length (shoulder-mid to hip-mid) across the clip. Used to
 * express distances independent of zoom and camera distance.
 */
export function torsoLength(track: PoseTrack): number {
  const vals: number[] = [];
  const step = Math.max(1, Math.floor(track.times.length / 120));
  for (let i = 0; i < track.times.length; i += step) {
    const s = midPoint(track, i, LM.leftShoulder, LM.rightShoulder);
    const h = midPoint(track, i, LM.leftHip, LM.rightHip);
    if (s && h) vals.push(dist(s, h));
  }
  const m = median(vals);
  return Number.isFinite(m) && m > 0 ? m : 0.3;
}

/**
 * Hand position per sample: lead wrist, averaged with the trail wrist when
 * both are visible (the hands are joined on the grip). NaN when unseen.
 */
export function handSeries(track: PoseTrack, handedness: Handedness) {
  const s = sides(handedness);
  const n = track.times.length;
  const x = new Float64Array(n).fill(NaN);
  const y = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const lead = point(track, i, s.leadWrist, 0);
    const trail = point(track, i, s.trailWrist, 0);
    const p = lead && trail ? mid(lead, trail) : lead ?? trail;
    if (p) {
      x[i] = p.x;
      y[i] = p.y;
    }
  }
  return { x, y };
}
