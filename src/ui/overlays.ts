import { LM, STRIDE, poseAt, type PoseTrack } from '../pose/landmarks';
import type { SwingMetrics } from '../metrics/metrics';
import type { ContentRect } from './stage';
import type { Phases } from '../types';

/** Head movement box (address→impact range) with the address position marked. */
export function drawHeadBox(ctx: CanvasRenderingContext2D, rect: ContentRect, m: SwingMetrics) {
  if (!m.head) return;
  const { box, start } = m.head;
  const pad = 0.012;
  const x0 = rect.x + (box.x0 - pad) * rect.w;
  const x1 = rect.x + (box.x1 + pad) * rect.w;
  const y0 = rect.y + (box.y0 - pad) * rect.h;
  const y1 = rect.y + (box.y1 + pad) * rect.h;
  ctx.strokeStyle = '#ff7ad9';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.setLineDash([]);
  const sx = rect.x + start.x * rect.w;
  const sy = rect.y + start.y * rect.h;
  ctx.beginPath();
  ctx.moveTo(sx - 8, sy);
  ctx.lineTo(sx + 8, sy);
  ctx.moveTo(sx, sy - 8);
  ctx.lineTo(sx, sy + 8);
  ctx.stroke();
}

function spineEnds(pose: Float32Array) {
  const g = (i: number) => ({ x: pose[i * STRIDE], y: pose[i * STRIDE + 1], v: pose[i * STRIDE + 3] });
  const ls = g(LM.leftShoulder), rs = g(LM.rightShoulder), lh = g(LM.leftHip), rh = g(LM.rightHip);
  if (Math.min(ls.v, rs.v, lh.v, rh.v) < 0.3) return null;
  return { hip: { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 }, sh: { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 } };
}

/**
 * Current spine line (hip-mid → shoulder-mid, extended) plus a dashed
 * reference of the address spine line.
 */
export function drawSpine(ctx: CanvasRenderingContext2D, rect: ContentRect, track: PoseTrack, phases: Phases, t: number) {
  const line = (e: NonNullable<ReturnType<typeof spineEnds>>, color: string, dash: number[]) => {
    const ext = 0.35;
    const dx = e.sh.x - e.hip.x, dy = e.sh.y - e.hip.y;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(rect.x + (e.hip.x - dx * ext * 0.3) * rect.w, rect.y + (e.hip.y - dy * ext * 0.3) * rect.h);
    ctx.lineTo(rect.x + (e.sh.x + dx * ext) * rect.w, rect.y + (e.sh.y + dy * ext) * rect.h);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  if (phases.address !== undefined) {
    const a = poseAt(track, phases.address);
    const e = a && spineEnds(a);
    if (e) line(e, 'rgba(255,255,255,0.55)', [8, 6]);
  }
  const cur = poseAt(track, t);
  const e = cur && spineEnds(cur);
  if (e) line(e, '#3ddc84', []);
}
