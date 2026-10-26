import type { ContentRect } from '../ui/stage';
import type { Pt, Shape } from './shapes';

const toPx = (p: Pt, r: ContentRect) => ({ x: r.x + p.x * r.w, y: r.y + p.y * r.h });

/** Interior angle at b (degrees) measured in screen space (isotropic). */
export function shapeAngle(a: Pt, b: Pt, c: Pt, r: ContentRect) {
  const A = toPx(a, r), B = toPx(b, r), C = toPx(c, r);
  const a1 = Math.atan2(A.y - B.y, A.x - B.x);
  const a2 = Math.atan2(C.y - B.y, C.x - B.x);
  let d = Math.abs(a1 - a2);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return { deg: (d * 180) / Math.PI, a1, a2, B };
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.font = '600 14px -apple-system, system-ui, sans-serif';
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 11, w, 22, 6);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 1);
}

function handle(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, color: string, big = false) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, big ? 7 : 4, 0, Math.PI * 2);
  ctx.fill();
  if (big) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** Draw one shape. `active` adds big handles for the shape being drawn. */
export function drawShape(ctx: CanvasRenderingContext2D, s: Shape, r: ContentRect, active = false) {
  const pts = s.pts.map((p) => toPx(p, r));
  if (!pts.length) return;
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 3;

  switch (s.kind) {
    case 'line': {
      if (pts.length < 2) break;
      const [a, b] = pts;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.shadowBlur = 0;
      handle(ctx, a, s.color, active);
      handle(ctx, b, s.color, active);
      // Angle from horizontal (0–90°) is handy for plane/posture lines.
      const deg = Math.abs((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
      const fromH = deg > 90 ? 180 - deg : deg;
      if (Math.hypot(b.x - a.x, b.y - a.y) > 40) label(ctx, `${fromH.toFixed(0)}°`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 16, s.color);
      break;
    }
    case 'circle': {
      if (pts.length < 2) break;
      const [c, e] = pts;
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.hypot(e.x - c.x, e.y - c.y), 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      handle(ctx, c, s.color, active);
      break;
    }
    case 'free': {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      break;
    }
    case 'angle': {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      ctx.shadowBlur = 0;
      pts.forEach((p, i) => handle(ctx, p, s.color, active && i === pts.length - 1));
      if (pts.length === 3) {
        const { deg, a1, a2, B } = shapeAngle(s.pts[0], s.pts[1], s.pts[2], r);
        const rad = Math.min(36, Math.hypot(pts[0].x - B.x, pts[0].y - B.y) * 0.4, Math.hypot(pts[2].x - B.x, pts[2].y - B.y) * 0.4);
        // Sweep the short way round between the two rays.
        let start = a1, end = a2;
        let diff = end - start;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        end = start + diff;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(B.x, B.y, rad, start, end, diff < 0);
        ctx.stroke();
        const mid = start + diff / 2;
        label(ctx, `${deg.toFixed(1)}°`, B.x + Math.cos(mid) * (rad + 22), B.y + Math.sin(mid) * (rad + 22), s.color);
      }
      break;
    }
  }
  ctx.restore();
}
