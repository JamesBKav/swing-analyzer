import { h } from '../ui/dom';

export interface ScrubMarker {
  t: number;
  label: string;
  cls?: string;
}

/**
 * Touch scrub bar with fine control: drag along the bar for coarse seeking,
 * slide your finger upward while dragging to slow it down (like iOS).
 */
export class Scrubber {
  readonly el: HTMLDivElement;
  private fill: HTMLDivElement;
  private thumb: HTMLDivElement;
  private markersEl: HTMLDivElement;
  private badge: HTMLDivElement;
  private duration = 0;
  private value = 0;
  private dragging = false;

  constructor(private onScrub: (t: number) => void, private onStart?: () => void, private onEnd?: () => void) {
    this.fill = h('div', { class: 'scrub-fill' });
    this.thumb = h('div', { class: 'scrub-thumb' });
    this.markersEl = h('div', { class: 'scrub-markers' });
    this.badge = h('div', { class: 'scrub-badge' });
    const track = h('div', { class: 'scrub-track' }, this.fill, this.markersEl, this.thumb);
    this.el = h('div', { class: 'scrubber', role: 'slider', 'aria-label': 'Seek' }, track, this.badge);
    this.bind(track);
  }

  setDuration(d: number) {
    this.duration = d;
    this.render();
  }

  setValue(t: number) {
    if (this.dragging) return;
    this.value = t;
    this.render();
  }

  setMarkers(markers: ScrubMarker[]) {
    this.markersEl.replaceChildren(
      ...markers.map((m) =>
        h('div', {
          class: `scrub-marker ${m.cls ?? ''}`,
          style: `left:${this.duration ? (m.t / this.duration) * 100 : 0}%`,
          title: m.label,
        }, h('span', {}, m.label[0])),
      ),
    );
  }

  private render() {
    const p = this.duration ? Math.min(1, Math.max(0, this.value / this.duration)) : 0;
    this.fill.style.width = `${p * 100}%`;
    this.thumb.style.left = `${p * 100}%`;
  }

  private bind(track: HTMLDivElement) {
    let lastX = 0;
    let startY = 0;
    const scaleFor = (dy: number) => (dy < 45 ? 1 : dy < 110 ? 0.25 : 0.05);

    this.el.addEventListener('pointerdown', (e) => {
      if (!this.duration) return;
      this.el.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.el.classList.add('active');
      this.onStart?.();
      const r = track.getBoundingClientRect();
      // Absolute jump on touch-down, relative moves after that.
      this.value = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * this.duration;
      lastX = e.clientX;
      startY = e.clientY;
      this.render();
      this.onScrub(this.value);
    });

    this.el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const r = track.getBoundingClientRect();
      const scale = scaleFor(startY - e.clientY);
      this.value = Math.min(this.duration, Math.max(0, this.value + ((e.clientX - lastX) / r.width) * this.duration * scale));
      lastX = e.clientX;
      this.badge.textContent = scale === 1 ? '' : scale === 0.25 ? 'Fine ×¼ — slide up more for ×1/20' : 'Fine ×1/20';
      this.badge.classList.toggle('show', scale !== 1);
      this.render();
      this.onScrub(this.value);
    });

    const end = () => {
      if (!this.dragging) return;
      this.dragging = false;
      this.el.classList.remove('active');
      this.badge.classList.remove('show');
      this.onEnd?.();
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }
}
