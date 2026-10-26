/** 2D point in isotropic image units (y down, 1 unit = video height). */
export interface P2 {
  x: number;
  y: number;
}

export const RAD = 180 / Math.PI;

export function mid(a: P2, b: P2): P2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function dist(a: P2, b: P2) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Interior angle at b formed by a-b-c, in degrees (0..180). */
export function angleAt(a: P2, b: P2, c: P2): number {
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (n === 0) return NaN;
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / n));
  return Math.acos(cos) * RAD;
}

/**
 * Signed angle (degrees) of the vector from `base` to `tip` away from
 * straight up. Positive when the tip leans toward +x.
 */
export function angleFromVertical(base: P2, tip: P2): number {
  return Math.atan2(tip.x - base.x, base.y - tip.y) * RAD;
}

/**
 * Tilt of the line between a "lead" and "trail" point, degrees.
 * Positive when the lead point is higher in the image. Independent of which
 * side of the frame each point is on.
 */
export function tiltLeadUp(lead: P2, trail: P2): number {
  return Math.atan2(trail.y - lead.y, Math.abs(lead.x - trail.x)) * RAD;
}

/** Angle (degrees) of a segment above horizontal, ignoring left/right direction. */
export function angleAboveHorizontal(from: P2, to: P2): number {
  return Math.atan2(from.y - to.y, Math.abs(to.x - from.x)) * RAD;
}

export function median(values: number[]): number {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Fill NaN gaps by linear interpolation; edges hold the nearest value. */
export function fillGaps(values: Float64Array): Float64Array {
  const out = Float64Array.from(values);
  const n = out.length;
  let prev = -1;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(out[i])) continue;
    if (prev === -1) {
      for (let k = 0; k < i; k++) out[k] = out[i];
    } else if (i - prev > 1) {
      for (let k = prev + 1; k < i; k++) out[k] = out[prev] + ((out[i] - out[prev]) * (k - prev)) / (i - prev);
    }
    prev = i;
  }
  if (prev !== -1) for (let k = prev + 1; k < n; k++) out[k] = out[prev];
  return out;
}

/** Centered moving average with an odd window. */
export function smooth(values: Float64Array, window: number): Float64Array {
  const w = Math.max(1, window | 1);
  const half = w >> 1;
  const n = values.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let cnt = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(n - 1, i + half); k++) {
      sum += values[k];
      cnt++;
    }
    out[i] = sum / cnt;
  }
  return out;
}

/** Central-difference derivative with respect to (possibly uneven) times. */
export function derivative(values: Float64Array, times: ArrayLike<number>): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    const dt = times[b] - times[a];
    out[i] = dt > 0 ? (values[b] - values[a]) / dt : 0;
  }
  return out;
}
