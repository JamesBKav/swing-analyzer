import { BODY_CONNECTIONS, LM, STRIDE } from './landmarks';
import type { ContentRect } from '../ui/stage';
import type { Handedness } from '../types';

const LEAD = '#ffb547';
const TRAIL = '#5ab0ff';
const CORE = 'rgba(255,255,255,0.9)';
const MIN_VIS = 0.35;

const LEFT_SIDE = new Set<number>([LM.leftShoulder, LM.leftElbow, LM.leftWrist, LM.leftHip, LM.leftKnee, LM.leftAnkle, LM.leftHeel, LM.leftFootIndex]);
const RIGHT_SIDE = new Set<number>([LM.rightShoulder, LM.rightElbow, LM.rightWrist, LM.rightHip, LM.rightKnee, LM.rightAnkle, LM.rightHeel, LM.rightFootIndex]);

/** Draw the pose skeleton. Lead side amber, trail side blue. */
export function drawSkeleton(ctx: CanvasRenderingContext2D, pose: Float32Array, rect: ContentRect, handedness: Handedness) {
  const leadSet = handedness === 'right' ? LEFT_SIDE : RIGHT_SIDE;
  const trailSet = handedness === 'right' ? RIGHT_SIDE : LEFT_SIDE;
  const px = (i: number) => rect.x + pose[i * STRIDE] * rect.w;
  const py = (i: number) => rect.y + pose[i * STRIDE + 1] * rect.h;
  const vis = (i: number) => pose[i * STRIDE + 3];
  const colorOf = (a: number, b: number) =>
    leadSet.has(a) && leadSet.has(b) ? LEAD : trailSet.has(a) && trailSet.has(b) ? TRAIL : CORE;

  const lw = Math.max(2, Math.min(rect.w, rect.h) / 140);
  ctx.lineCap = 'round';
  ctx.lineWidth = lw;
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 3;
  for (const [a, b] of BODY_CONNECTIONS) {
    const v = Math.min(vis(a), vis(b));
    if (v < MIN_VIS) continue;
    ctx.globalAlpha = 0.45 + 0.55 * Math.min(1, v);
    ctx.strokeStyle = colorOf(a, b);
    ctx.beginPath();
    ctx.moveTo(px(a), py(a));
    ctx.lineTo(px(b), py(b));
    ctx.stroke();
  }
  // Neck: shoulder midpoint to nose.
  if (vis(LM.nose) > MIN_VIS && vis(LM.leftShoulder) > MIN_VIS && vis(LM.rightShoulder) > MIN_VIS) {
    ctx.strokeStyle = CORE;
    ctx.beginPath();
    ctx.moveTo((px(LM.leftShoulder) + px(LM.rightShoulder)) / 2, (py(LM.leftShoulder) + py(LM.rightShoulder)) / 2);
    ctx.lineTo(px(LM.nose), py(LM.nose));
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  const joints = [LM.nose, ...LEFT_SIDE, ...RIGHT_SIDE];
  for (const j of joints) {
    if (vis(j) < MIN_VIS) continue;
    ctx.globalAlpha = 1;
    ctx.fillStyle = leadSet.has(j) ? LEAD : trailSet.has(j) ? TRAIL : '#fff';
    ctx.beginPath();
    ctx.arc(px(j), py(j), lw * 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
