import type { PoseTrack } from '../pose/landmarks';
import type { Handedness, PhaseName, Phases } from '../types';
import { derivative, fillGaps, smooth } from './geometry';
import { handSeries, torsoLength } from './body';

export interface PhaseIndices {
  address: number;
  top: number;
  impact: number;
  finish: number;
}

export interface PhaseDetection {
  /** Media times of each phase. */
  phases: Required<Phases>;
  indices: PhaseIndices;
  /** Peak hand speed, torso lengths per media second. */
  peakSpeed: number;
  /** Rough 0..1 plausibility score. */
  confidence: number;
}

/**
 * Detect address, top, impact and finish from the hand (lead wrist)
 * trajectory and speed.
 *
 * - Impact region: the peak hand speed of the clip happens just before or at
 *   impact.
 * - Top: the highest hand point before that peak.
 * - Impact: the lowest hand point between the top and just after the peak.
 * - Address: the end of the last still period before the takeaway.
 * - Finish: the first still period after impact with the hands raised.
 *
 * Returns null when there isn't enough pose data to find a swing.
 */
export function detectPhases(track: PoseTrack, handedness: Handedness): PhaseDetection | null {
  const n = track.times.length;
  if (n < 12) return null;
  const raw = handSeries(track, handedness);
  let valid = 0;
  for (let i = 0; i < n; i++) if (!Number.isNaN(raw.x[i])) valid++;
  if (valid < Math.max(10, n * 0.3)) return null;

  const t = track.times;
  const rate = track.rate;
  const torso = torsoLength(track);
  const win = Math.max(3, Math.round(rate * 0.05) | 1);
  const x = smooth(fillGaps(raw.x), win);
  const y = smooth(fillGaps(raw.y), win);
  const vx = derivative(x, t);
  const vy = derivative(y, t);
  const speed = new Float64Array(n);
  for (let i = 0; i < n; i++) speed[i] = Math.hypot(vx[i], vy[i]) / torso;

  // Peak speed (ignore the very edges where smoothing is one-sided).
  let peak = 1;
  for (let i = 1; i < n - 1; i++) if (speed[i] > speed[peak]) peak = i;
  const peakSpeed = speed[peak];

  // Top: highest hands (min y) before the peak.
  let top = 0;
  for (let i = 0; i <= peak; i++) if (y[i] < y[top]) top = i;

  // Impact: lowest hands between top and shortly after the peak.
  const after = Math.min(n - 1, peak + Math.max(2, Math.round(rate * 0.12)));
  let impact = Math.min(peak, n - 1);
  for (let i = top + 1; i <= after; i++) if (y[i] > y[impact]) impact = i;
  if (impact <= top) impact = Math.min(n - 1, top + 1);

  // "Still" = hand speed below a fraction of the peak, held for ~0.1s.
  const still = Math.max(0.35, peakSpeed * 0.08);
  const run = Math.max(2, Math.round(rate * 0.1));

  // Address: walk back to the last frame of a still run. Start from where the
  // hands are well below the top, so the brief pause at the top isn't taken
  // for address.
  let from = top;
  while (from > 0 && y[from] < y[top] + torso * 0.5) from--;
  let address = -1;
  let count = 0;
  for (let i = from; i >= 0; i--) {
    if (speed[i] < still) {
      count++;
      if (count >= run) {
        // i is the start of the run; its last frame is i + run - 1.
        address = i + run - 1;
        break;
      }
    } else count = 0;
  }
  if (address < 0) {
    // No still period found: use the lowest hand point before the top.
    address = 0;
    for (let i = 0; i < top; i++) if (y[i] > y[address]) address = i;
  }

  // Finish: first still run after impact once the hands are back up high.
  const raised = y[impact] - torso * 0.5;
  let finish = -1;
  count = 0;
  for (let i = impact + 1; i < n; i++) {
    if (speed[i] < still && y[i] < raised) {
      count++;
      if (count >= run) {
        finish = i - run + 1;
        break;
      }
    } else count = 0;
  }
  if (finish < 0) {
    finish = impact;
    for (let i = impact; i < n; i++) if (y[i] < y[finish]) finish = i;
  }

  // Refine: the slow start of the takeaway (and end of the follow-through)
  // sits between the "still" threshold and the jitter floor. Walk outward
  // until the hands are truly at rest.
  const restSpeeds: number[] = [];
  for (let i = 0; i <= address; i++) restSpeeds.push(speed[i]);
  for (let i = finish; i < n; i++) restSpeeds.push(speed[i]);
  restSpeeds.sort((a, b) => a - b);
  const jitter = restSpeeds.length ? restSpeeds[Math.floor(restSpeeds.length / 2)] : 0;
  const floor = Math.max(jitter * 2, peakSpeed * 0.02);
  while (address > 0 && speed[address] > floor && speed[address - 1] <= speed[address]) address--;
  while (finish < n - 1 && speed[finish] > floor && speed[finish + 1] <= speed[finish]) finish++;

  // Confidence: hands must travel well above address height and the
  // downswing must be quicker than the backswing.
  const rise = (y[address] - y[top]) / torso;
  const back = t[top] - t[address];
  const down = t[impact] - t[top];
  let confidence = 1;
  if (rise < 0.8) confidence *= 0.4;
  if (!(down > 0 && back > down)) confidence *= 0.5;
  if (valid < n * 0.7) confidence *= 0.7;

  const indices = { address, top, impact, finish };
  return {
    indices,
    phases: { address: t[address], top: t[top], impact: t[impact], finish: t[finish] },
    peakSpeed,
    confidence,
  };
}

/** Merge detected phases with ones the user set by hand (manual wins). */
export function mergePhases(detected: Phases, current: Phases, manual: PhaseName[]): Phases {
  const out: Phases = { ...detected };
  for (const p of manual) if (current[p] !== undefined) out[p] = current[p];
  return out;
}

export interface Tempo {
  backswing: number;
  downswing: number;
  ratio: number;
}

/** Backswing and downswing durations in real seconds, and their ratio. */
export function tempo(phases: Phases, timeScale = 1): Tempo | null {
  const { address, top, impact } = phases;
  if (address === undefined || top === undefined || impact === undefined) return null;
  const backswing = (top - address) * timeScale;
  const downswing = (impact - top) * timeScale;
  if (backswing <= 0 || downswing <= 0) return null;
  return { backswing, downswing, ratio: backswing / downswing };
}
