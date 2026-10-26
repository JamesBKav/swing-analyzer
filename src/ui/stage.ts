import { h } from './dom';
import type { VideoPlayer } from '../player/player';

/** Rectangle (CSS px, relative to the stage) where the video picture is drawn. */
export interface ContentRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type LayerDraw = (ctx: CanvasRenderingContext2D, rect: ContentRect, t: number) => void;

/**
 * The video area: <video> with object-fit: contain and a stack of overlay
 * canvases sized to it. Layers are redrawn on every displayed frame.
 * Gestures (when no drawing tool is active): tap toggles play, horizontal
 * swipe steps frames — handy one-handed.
 */
export class Stage {
  readonly el: HTMLDivElement;
  readonly overlay: HTMLCanvasElement;
  /** Separate canvas that receives pointer input for drawing tools. */
  readonly drawCanvas: HTMLCanvasElement;
  rect: ContentRect = { x: 0, y: 0, w: 0, h: 0 };
  private layers: LayerDraw[] = [];
  private dpr = 1;
  private ro: ResizeObserver;
  gesturesEnabled = true;

  constructor(readonly player: VideoPlayer) {
    this.overlay = h('canvas', { class: 'stage-layer' });
    this.drawCanvas = h('canvas', { class: 'stage-layer draw-layer' });
    player.video.classList.add('stage-video');
    this.el = h('div', { class: 'stage' }, player.video, this.overlay, this.drawCanvas);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    player.addEventListener('time', () => this.render());
    player.addEventListener('loaded', () => this.resize());
    this.bindGestures();
  }

  addLayer(draw: LayerDraw) {
    this.layers.push(draw);
    this.render();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (const c of [this.overlay, this.drawCanvas]) {
      c.width = Math.round(r.width * this.dpr);
      c.height = Math.round(r.height * this.dpr);
    }
    const vw = this.player.video.videoWidth || 16;
    const vh = this.player.video.videoHeight || 9;
    const s = Math.min(r.width / vw, r.height / vh);
    this.rect = { w: vw * s, h: vh * s, x: (r.width - vw * s) / 2, y: (r.height - vh * s) / 2 };
    this.render();
  }

  render() {
    const ctx = this.overlay.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    for (const layer of this.layers) {
      ctx.save();
      layer(ctx, this.rect, this.player.displayTime);
      ctx.restore();
    }
  }

  /** Context for the drawing canvas, already scaled to CSS pixels. */
  drawContext() {
    const ctx = this.drawCanvas.getContext('2d')!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.drawCanvas.width, this.drawCanvas.height);
    return ctx;
  }

  /** Convert a pointer event to normalized video coordinates (0..1). */
  toVideo(e: PointerEvent | { clientX: number; clientY: number }) {
    const r = this.el.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - this.rect.x) / this.rect.w,
      y: (e.clientY - r.top - this.rect.y) / this.rect.h,
    };
  }

  private bindGestures() {
    let startX = 0;
    let startY = 0;
    let lastStepX = 0;
    let moved = false;
    let active = false;
    const STEP_PX = 14;
    this.el.addEventListener('pointerdown', (e) => {
      if (!this.gesturesEnabled || e.target === this.drawCanvas) return;
      active = true;
      moved = false;
      startX = lastStepX = e.clientX;
      startY = e.clientY;
    });
    this.el.addEventListener('pointermove', (e) => {
      if (!active) return;
      if (!moved && Math.abs(e.clientX - startX) > 10 && Math.abs(e.clientX - startX) > Math.abs(e.clientY - startY)) {
        moved = true;
        this.player.pause();
      }
      if (moved) {
        const n = Math.trunc((e.clientX - lastStepX) / STEP_PX);
        if (n !== 0) {
          lastStepX += n * STEP_PX;
          void this.player.step(n);
        }
      }
    });
    this.el.addEventListener('pointerup', () => {
      if (active && !moved) this.player.toggle();
      active = false;
    });
    this.el.addEventListener('pointercancel', () => (active = false));
  }

  destroy() {
    this.ro.disconnect();
  }
}
