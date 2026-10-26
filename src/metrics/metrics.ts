import { LM, nearestIndex, type PoseTrack } from '../pose/landmarks';
import type { Phases, SessionSettings } from '../types';
import { angleAboveHorizontal, angleAt, angleFromVertical, dist, tiltLeadUp, type P2 } from './geometry';
import { headPoint, midPoint, point, sides, torsoLength } from './body';
import { tempo, type Tempo } from './phases';

/**
 * All metrics are 2D estimates measured in the camera image plane. They are
 * proxies for 3D quantities and depend on camera placement.
 */
export interface SwingMetrics {
  tempo: Tempo | null;
  spine: {
    /** Degrees from vertical. DTL: forward bend toward the ball. Face-on: tilt away from target. */
    address: number | null;
    impact: number | null;
    change: number | null;
  };
  head: {
    /** Range of head movement between address and impact, % of torso length. */
    lateralRange: number;
    verticalRange: number;
    /** Head position at impact relative to address, % torso. Lateral +: toward target (face-on) / toward ball (DTL). Vertical +: up. */
    lateralAtImpact: number;
    verticalAtImpact: number;
    /** Movement box and address position in normalized video coords, for drawing. */
    box: { x0: number; y0: number; x1: number; y1: number };
    start: { x: number; y: number };
  } | null;
  /** Line tilts in degrees; positive = lead side higher. */
  shoulders: PhaseAngles;
  hips: PhaseAngles;
  /** Face-on only: rotation estimated from how much the shoulder/hip line shortens. */
  shoulderTurnTop: number | null;
  hipTurnTop: number | null;
  leadArm: {
    /** Elbow angle at the top, 180 = straight. */
    elbowAtTop: number | null;
    /** Lead upper-arm-to-wrist line above horizontal at the top. */
    aboveHorizontalAtTop: number | null;
  };
}

export interface PhaseAngles {
  address: number | null;
  top: number | null;
  impact: number | null;
}

const round1 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);

export function computeMetrics(track: PoseTrack, phases: Phases, settings: SessionSettings): SwingMetrics {
  const s = sides(settings.handedness);
  const idx = (t: number | undefined) => (t === undefined ? -1 : nearestIndex(track, t));
  const iA = idx(phases.address);
  const iT = idx(phases.top);
  const iI = idx(phases.impact);
  const torso = torsoLength(track);

  const at = (i: number, lm: number) => (i < 0 ? null : point(track, i, lm));
  const shoulderMid = (i: number) => (i < 0 ? null : midPoint(track, i, LM.leftShoulder, LM.rightShoulder));
  const hipMid = (i: number) => (i < 0 ? null : midPoint(track, i, LM.leftHip, LM.rightHip));

  // Direction conventions are derived from the pose itself so they hold even
  // if the image is mirrored. targetDir: +1 if the target is toward +x.
  const leadSh = at(iA, s.leadShoulder);
  const trailSh = at(iA, s.trailShoulder);
  const leadHp = at(iA, s.leadHip);
  const trailHp = at(iA, s.trailHip);
  const targetDir = leadSh && trailSh ? Math.sign(leadSh.x - trailSh.x) || 1 : leadHp && trailHp ? Math.sign(leadHp.x - trailHp.x) || 1 : 1;
  const shA = shoulderMid(iA);
  const hpA = hipMid(iA);
  // Ball side (DTL): shoulders sit forward of the hips at address.
  const ballDir = shA && hpA ? Math.sign(shA.x - hpA.x) || 1 : 1;
  const view = settings.view;
  const forwardDir = view === 'dtl' ? ballDir : targetDir;

  // Spine: hip-mid -> shoulder-mid relative to vertical.
  const spineAt = (i: number) => {
    const sm = shoulderMid(i);
    const hm = hipMid(i);
    if (!sm || !hm) return null;
    const a = angleFromVertical(hm, sm); // + toward +x
    // DTL: report bend toward ball as positive. Face-on: tilt away from target as positive.
    return view === 'dtl' ? a * ballDir : -a * targetDir;
  };
  const spineAddress = spineAt(iA);
  const spineImpact = spineAt(iI);

  // Head movement from address through impact.
  let head: SwingMetrics['head'] = null;
  if (iA >= 0 && iI > iA) {
    const start = headPoint(track, iA);
    if (start) {
      let minX = start.x, maxX = start.x, minY = start.y, maxY = start.y;
      for (let i = iA; i <= iI; i++) {
        const p = headPoint(track, i);
        if (!p) continue;
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      const end = headPoint(track, iI) ?? start;
      const pct = (d: number) => (d / torso) * 100;
      head = {
        lateralRange: pct(maxX - minX),
        verticalRange: pct(maxY - minY),
        lateralAtImpact: pct((end.x - start.x) * forwardDir),
        verticalAtImpact: pct(start.y - end.y),
        box: { x0: minX / track.aspect, x1: maxX / track.aspect, y0: minY, y1: maxY },
        start: { x: start.x / track.aspect, y: start.y },
      };
    }
  }

  const lineTilt = (i: number, lead: number, trail: number) => {
    const a = at(i, lead);
    const b = at(i, trail);
    return a && b ? tiltLeadUp(a, b) : null;
  };
  const width = (i: number, a: number, b: number) => {
    const pa = at(i, a);
    const pb = at(i, b);
    return pa && pb ? Math.abs(pa.x - pb.x) : null;
  };
  // Face-on: a line seen square-on shortens by cos(turn) as it rotates.
  const turn = (a: number, b: number) => {
    if (view !== 'face-on') return null;
    const w0 = width(iA, a, b);
    const w1 = width(iT, a, b);
    if (!w0 || w1 === null || w0 < torso * 0.15) return null;
    return Math.acos(Math.min(1, w1 / w0)) * (180 / Math.PI);
  };

  const shoulderAt = (i: number) => lineTilt(i, s.leadShoulder, s.trailShoulder);
  const hipAt = (i: number) => lineTilt(i, s.leadHip, s.trailHip);

  const sh = at(iT, s.leadShoulder);
  const el = at(iT, s.leadElbow);
  const wr = at(iT, s.leadWrist);

  return {
    tempo: tempo(phases, settings.timeScale),
    spine: {
      address: round1(spineAddress),
      impact: round1(spineImpact),
      change: round1(spineAddress !== null && spineImpact !== null ? spineImpact - spineAddress : null),
    },
    head,
    shoulders: { address: round1(shoulderAt(iA)), top: round1(shoulderAt(iT)), impact: round1(shoulderAt(iI)) },
    hips: { address: round1(hipAt(iA)), top: round1(hipAt(iT)), impact: round1(hipAt(iI)) },
    shoulderTurnTop: round1(turn(s.leadShoulder, s.trailShoulder)),
    hipTurnTop: round1(turn(s.leadHip, s.trailHip)),
    leadArm: {
      elbowAtTop: round1(sh && el && wr ? angleAt(sh, el, wr) : null),
      aboveHorizontalAtTop: round1(sh && wr && dist(sh, wr) > 0 ? angleAboveHorizontal(sh, wr) : null),
    },
  };
}

export type { P2 };
