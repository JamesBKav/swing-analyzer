/**
 * Synthetic pose tracks for tests: a stick-figure golfer whose hands follow
 * an address → top → impact → finish path with known timings.
 */
import { FRAME_FLOATS, LM, NUM_LANDMARKS, STRIDE, type PoseTrack } from '../pose/landmarks';
import type { CameraView, Handedness } from '../types';

export interface SwingSpec {
  rate?: number;
  aspect?: number;
  addressDur?: number;
  backDur?: number;
  downDur?: number;
  followDur?: number;
  finishDur?: number;
  handedness?: Handedness;
  view?: CameraView;
  /** Spine angle from vertical (deg) at address and impact. */
  spineAddress?: number;
  spineImpact?: number;
  /** Head displacement at impact vs address (iso units; +x = toward target / ball). */
  headShiftX?: number;
  headShiftY?: number;
  /** Lead elbow bend at the top (deg away from straight). */
  elbowBend?: number;
  /** Gaussian noise sigma (iso units) and fraction of dropped frames. */
  noise?: number;
  dropRate?: number;
  seed?: number;
}

export const TORSO = 0.2;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  return {
    next,
    gauss() {
      const u = Math.max(1e-9, next());
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
  };
}

const smoothstep = (s: number) => s * s * (3 - 2 * s);
const easeIn = (s: number) => s * s;
const easeOut = (s: number) => 1 - (1 - s) * (1 - s);

export function makeSwing(spec: SwingSpec = {}) {
  const {
    rate = 60,
    aspect = 9 / 16,
    addressDur = 1,
    backDur = 0.9,
    downDur = 0.3,
    followDur = 0.5,
    finishDur = 1,
    handedness = 'right',
    view = 'face-on',
    spineAddress = view === 'dtl' ? 35 : 8,
    spineImpact = spineAddress,
    headShiftX = 0,
    headShiftY = 0,
    elbowBend = 0,
    noise = 0,
    dropRate = 0,
    seed = 7,
  } = spec;
  const r = rng(seed);
  const tTop = addressDur + backDur;
  const tImpact = tTop + downDur;
  const tFinish = tImpact + followDur;
  const duration = tFinish + finishDur;
  const n = Math.floor(duration * rate);

  // "Forward" in the image: the target (face-on) or the ball (DTL) is toward
  // +x for a right-handed golfer in this synthetic setup, mirrored for lefties.
  const fwd = handedness === 'right' ? 1 : -1;
  const cx = 0.5 * aspect;
  const hipMid = { x: cx, y: 0.55 };
  const H0 = { x: cx + 0.01 * fwd, y: 0.68 };
  const HT = { x: cx - 0.16 * fwd, y: 0.22 };
  const HI = { x: cx + 0.02 * fwd, y: 0.69 };
  const HF = { x: cx + 0.16 * fwd, y: 0.24 };

  const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, s: number, bulge = 0) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.sin(Math.PI * s) * bulge;
    return { x: a.x + dx * s + (-dy / len) * k, y: a.y + dy * s + (dx / len) * k };
  };

  const hands = (t: number) => {
    if (t < addressDur) return H0;
    if (t < tTop) return lerp(H0, HT, smoothstep((t - addressDur) / backDur), 0.04 * fwd);
    if (t < tImpact) return lerp(HT, HI, easeIn((t - tTop) / downDur), 0.04 * fwd);
    if (t < tFinish) return lerp(HI, HF, easeOut((t - tImpact) / followDur), 0.04 * fwd);
    return HF;
  };

  // Progress 0 at address → 1 at impact, for blending spine/head changes.
  const toImpact = (t: number) => Math.min(1, Math.max(0, (t - addressDur) / (tImpact - addressDur)));

  const times = new Float32Array(n);
  const data = new Float32Array(n * FRAME_FLOATS).fill(NaN);
  const leadIsLeft = handedness === 'right';

  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / rate;
    times[i] = t;
    if (dropRate && r.next() < dropRate) continue;

    const k = toImpact(t);
    const spineDeg = spineAddress + (spineImpact - spineAddress) * k;
    const sr = (spineDeg * Math.PI) / 180;
    // Face-on: spine tilts away from target (-fwd). DTL: bends toward ball (+fwd).
    const lean = view === 'dtl' ? fwd : -fwd;
    const shMid = { x: hipMid.x + Math.sin(sr) * TORSO * lean, y: hipMid.y - Math.cos(sr) * TORSO };
    const shHalf = view === 'dtl' ? 0.02 : 0.09;
    const hipHalf = view === 'dtl' ? 0.015 : 0.06;
    const leadSide = view === 'dtl' ? -fwd : fwd; // lead shoulder is the target side
    const P: Record<number, { x: number; y: number }> = {};
    const L = (lead: boolean) => (lead === leadIsLeft ? 'left' : 'right');
    const set = (name: string, p: { x: number; y: number }) => {
      P[(LM as Record<string, number>)[name]] = p;
    };
    set(`${L(true)}Shoulder`, { x: shMid.x + shHalf * leadSide, y: shMid.y });
    set(`${L(false)}Shoulder`, { x: shMid.x - shHalf * leadSide, y: shMid.y });
    set(`${L(true)}Hip`, { x: hipMid.x + hipHalf * leadSide, y: hipMid.y });
    set(`${L(false)}Hip`, { x: hipMid.x - hipHalf * leadSide, y: hipMid.y });

    const hp = hands(t);
    const leadSh = P[LM[`${L(true)}Shoulder`]];
    set(`${L(true)}Wrist`, { x: hp.x + 0.008 * fwd, y: hp.y });
    set(`${L(false)}Wrist`, { x: hp.x - 0.008 * fwd, y: hp.y });
    // Lead elbow: midpoint of shoulder-wrist, pushed sideways to make the bend.
    const lw = P[LM[`${L(true)}Wrist`]];
    const half = Math.hypot(lw.x - leadSh.x, lw.y - leadSh.y) / 2;
    const bendNow = t >= addressDur && t <= tImpact ? elbowBend : 0;
    const off = half * Math.tan(((bendNow / 2) * Math.PI) / 180);
    const ux = (lw.x - leadSh.x) / (2 * half || 1), uy = (lw.y - leadSh.y) / (2 * half || 1);
    set(`${L(true)}Elbow`, { x: (leadSh.x + lw.x) / 2 - uy * off, y: (leadSh.y + lw.y) / 2 + ux * off });
    const trSh = P[LM[`${L(false)}Shoulder`]];
    const tw = P[LM[`${L(false)}Wrist`]];
    set(`${L(false)}Elbow`, { x: (trSh.x + tw.x) / 2, y: (trSh.y + tw.y) / 2 });

    const head = { x: shMid.x + headShiftX * k * fwd, y: shMid.y - 0.09 - headShiftY * k };
    set('nose', head);
    set('leftEar', { x: head.x - 0.02, y: head.y - 0.005 });
    set('rightEar', { x: head.x + 0.02, y: head.y - 0.005 });
    set('leftKnee', { x: hipMid.x + 0.05, y: 0.72 });
    set('rightKnee', { x: hipMid.x - 0.05, y: 0.72 });
    set('leftAnkle', { x: hipMid.x + 0.06, y: 0.9 });
    set('rightAnkle', { x: hipMid.x - 0.06, y: 0.9 });

    for (let lm = 0; lm < NUM_LANDMARKS; lm++) {
      const o = i * FRAME_FLOATS + lm * STRIDE;
      const p = P[lm];
      if (!p) {
        data[o] = 0.5; data[o + 1] = 0.5; data[o + 2] = 0; data[o + 3] = 0.05; // unseen
        continue;
      }
      data[o] = (p.x + (noise ? r.gauss() * noise : 0)) / aspect;
      data[o + 1] = p.y + (noise ? r.gauss() * noise : 0);
      data[o + 2] = 0;
      data[o + 3] = 0.95;
    }
  }

  const track: PoseTrack = { times, data, aspect, rate };
  return { track, truth: { address: addressDur, top: tTop, impact: tImpact, finish: tFinish } };
}
