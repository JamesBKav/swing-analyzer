/** MediaPipe Pose landmark indices (the person's own left/right). */
export const LM = {
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

export const NUM_LANDMARKS = 33;
/** Floats per landmark: x, y, z, visibility. */
export const STRIDE = 4;
export const FRAME_FLOATS = NUM_LANDMARKS * STRIDE;

export const BODY_CONNECTIONS: [number, number][] = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32],
];

/**
 * Pose landmarks sampled over a clip. Coordinates are normalized to the
 * video frame (x across width, y down height). Missing frames hold NaN.
 */
export interface PoseTrack {
  /** Media time of each sample (seconds), ascending. */
  times: Float32Array;
  /** times.length * FRAME_FLOATS values. */
  data: Float32Array;
  /** Video width / height, to make distances isotropic. */
  aspect: number;
  /** Nominal samples per media second. */
  rate: number;
}

export interface Landmark {
  x: number;
  y: number;
  z: number;
  v: number;
}

export function frameCount(track: PoseTrack) {
  return track.times.length;
}

export function hasFrame(track: PoseTrack, i: number) {
  return !Number.isNaN(track.data[i * FRAME_FLOATS]);
}

export function landmark(track: PoseTrack, i: number, lm: number): Landmark {
  const o = i * FRAME_FLOATS + lm * STRIDE;
  const d = track.data;
  return { x: d[o], y: d[o + 1], z: d[o + 2], v: d[o + 3] };
}

/** Index of the sample nearest to time t (binary search). */
export function nearestIndex(track: PoseTrack, t: number): number {
  const ts = track.times;
  if (ts.length === 0) return -1;
  let lo = 0;
  let hi = ts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(ts[lo - 1] - t) <= Math.abs(ts[lo] - t)) return lo - 1;
  return lo;
}

/**
 * Landmarks at time t, linearly interpolated between neighbouring samples so
 * the skeleton stays smooth when analysis ran at a lower rate than the video.
 * Returns null if there is no detection near t.
 */
export function poseAt(track: PoseTrack, t: number): Float32Array | null {
  const n = track.times.length;
  if (!n) return null;
  const ts = track.times;
  const maxGap = 2.5 / track.rate;
  let i = nearestIndex(track, t);
  if (Math.abs(ts[i] - t) > maxGap || !hasFrame(track, i)) return null;
  let j = ts[i] <= t ? i + 1 : i - 1;
  if (j < 0 || j >= n || !hasFrame(track, j)) {
    return track.data.slice(i * FRAME_FLOATS, (i + 1) * FRAME_FLOATS);
  }
  if (j < i) [i, j] = [j, i];
  const span = ts[j] - ts[i];
  const a = span > 0 ? Math.min(1, Math.max(0, (t - ts[i]) / span)) : 0;
  const out = new Float32Array(FRAME_FLOATS);
  const oi = i * FRAME_FLOATS;
  const oj = j * FRAME_FLOATS;
  for (let k = 0; k < FRAME_FLOATS; k++) out[k] = track.data[oi + k] * (1 - a) + track.data[oj + k] * a;
  return out;
}
