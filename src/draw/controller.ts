import type { Stage } from '../ui/stage';
import type { VideoPlayer } from '../player/player';
import type { Pt, Shape, ShapeKind } from './shapes';
import { drawShape } from './render';

export type Tool = ShapeKind | 'none';
export const COLORS = ['#ffd60a', '#ff5c5c', '#4cc9f0', '#3ddc84', '#ffffff'];

/**
 * Handles touch input for the drawing tools and renders shapes as a stage
 * layer. Shapes are stored in normalized video coordinates so they stay put
 * across screen sizes and rotation.
 */
export class DrawController extends EventTarget {
  tool: Tool = 'none';
  color = COLORS[0];
  /** true: new shapes belong to the current frame only. */
  perFrame = false;
  private draft: Shape | null = null;
  private down = false;

  constructor(private stage: Stage, private player: VideoPlayer, public shapes: Shape[], private onChange: () => void) {
    super();
    stage.addLayer((ctx, rect, t) => {
      const frame = this.player.frameIndex(t);
      for (const s of this.shapes) {
        if (s.t !== null && this.player.frameIndex(s.t) !== frame) continue;
        drawShape(ctx, s, rect);
      }
      if (this.draft) drawShape(ctx, this.draft, rect, true);
    });
    this.bind();
  }

  setTool(tool: Tool) {
    this.tool = tool;
    this.draft = null;
    const drawing = tool !== 'none';
    this.stage.el.classList.toggle('drawing', drawing);
    this.stage.gesturesEnabled = !drawing;
    if (drawing) this.player.pause();
    this.stage.render();
    this.dispatchEvent(new Event('change'));
  }

  undo() {
    if (this.draft) this.draft = null;
    else this.shapes.pop();
    this.commitChange();
  }

  clear() {
    this.shapes.length = 0;
    this.draft = null;
    this.commitChange();
  }

  /** Number of shapes visible on the current frame. */
  visibleCount() {
    const f = this.player.frameIndex();
    return this.shapes.filter((s) => s.t === null || this.player.frameIndex(s.t) === f).length;
  }

  private commitChange() {
    this.stage.render();
    this.onChange();
    this.dispatchEvent(new Event('change'));
  }

  private newShape(kind: ShapeKind, p: Pt): Shape {
    return {
      id: crypto.randomUUID(),
      kind,
      pts: [p],
      color: this.color,
      t: this.perFrame ? this.player.displayTime : null,
    };
  }

  private finish() {
    if (!this.draft) return;
    const s = this.draft;
    this.draft = null;
    const span = s.pts.length > 1 ? Math.hypot(s.pts[1].x - s.pts[0].x, s.pts[1].y - s.pts[0].y) : 0;
    const ok = s.kind === 'free' ? s.pts.length > 2 : span > 0.01;
    if (ok) this.shapes.push(s);
    this.commitChange();
  }

  private bind() {
    const c = this.stage.drawCanvas;
    const pos = (e: PointerEvent): Pt => {
      const p = this.stage.toVideo(e);
      return { x: Math.min(1.05, Math.max(-0.05, p.x)), y: Math.min(1.05, Math.max(-0.05, p.y)) };
    };

    c.addEventListener('pointerdown', (e) => {
      if (this.tool === 'none') return;
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      this.down = true;
      const p = pos(e);
      if (this.tool === 'angle') {
        // Angle is placed one point per tap; drag to fine-tune each point.
        if (!this.draft) this.draft = this.newShape('angle', p);
        else this.draft.pts.push(p);
      } else {
        this.draft = this.newShape(this.tool, p);
        if (this.tool !== 'free') this.draft.pts.push({ ...p });
      }
      this.stage.render();
    });

    c.addEventListener('pointermove', (e) => {
      if (!this.down || !this.draft) return;
      const p = pos(e);
      const pts = this.draft.pts;
      if (this.draft.kind === 'free') {
        const last = pts[pts.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) > 0.004) pts.push(p);
      } else {
        pts[pts.length - 1] = p;
      }
      this.stage.render();
    });

    const up = () => {
      if (!this.down) return;
      this.down = false;
      if (!this.draft) return;
      if (this.draft.kind === 'angle') {
        if (this.draft.pts.length === 3) {
          this.shapes.push(this.draft);
          this.draft = null;
          this.commitChange();
        } else this.stage.render();
        return;
      }
      this.finish();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  }
}
