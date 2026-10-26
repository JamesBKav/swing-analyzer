import { h, icon } from './dom';
import { toast } from './toast';
import { analyzeVideo } from '../pose/analyzer';
import { FRAME_FLOATS, type PoseTrack } from '../pose/landmarks';
import type { Session } from '../types';

export interface PosePanelHost {
  session: Session;
  videoUrl: string;
  track: PoseTrack | null;
  showSkeleton: boolean;
  setTrack(track: PoseTrack): void;
  redraw(): void;
  save(): void;
}

/** "Analyze" tab: run pose detection, toggle overlays. Results sections are appended by the host. */
export class PosePanel {
  readonly el: HTMLDivElement;
  readonly results: HTMLDivElement;
  private runBox: HTMLDivElement;
  private abort: AbortController | null = null;

  constructor(private host: PosePanelHost) {
    this.runBox = h('div', { class: 'run-box' });
    this.results = h('div', { class: 'results' });
    this.el = h('div', { class: 'pose-panel pad' }, this.runBox, this.results);
    this.renderIdle();
  }

  renderIdle() {
    const s = this.host.session.settings;
    const hasTrack = !!this.host.track;
    const modelSeg = h(
      'div',
      { class: 'segmented compact' },
      (['full', 'lite'] as const).map((m) =>
        h('button', {
          class: `seg ${s.model === m ? 'on' : ''}`,
          onclick: () => {
            s.model = m;
            this.host.save();
            this.renderIdle();
          },
        }, m === 'full' ? 'Accurate' : 'Fast'),
      ),
    );
    const skeletonBtn = h('button', {
      class: `btn small toggle ${this.host.showSkeleton ? 'on' : ''}`,
      disabled: !hasTrack,
      onclick: () => {
        this.host.showSkeleton = !this.host.showSkeleton;
        skeletonBtn.classList.toggle('on', this.host.showSkeleton);
        this.host.redraw();
      },
    }, icon('person'), 'Skeleton');

    this.runBox.replaceChildren(
      h('div', { class: 'row' },
        h('button', { class: `btn ${hasTrack ? '' : 'primary'} grow`, onclick: () => this.run() }, icon('person'), hasTrack ? 'Re-analyze' : 'Analyze swing'),
        skeletonBtn,
      ),
      h('div', { class: 'row small-gap' }, h('span', { class: 'muted label' }, 'Pose model'), modelSeg),
    );
  }

  async run() {
    const s = this.host.session.settings;
    this.abort = new AbortController();
    const bar = h('div', { class: 'progress-fill' });
    const label = h('div', { class: 'muted small' }, 'Loading pose model…');
    this.runBox.replaceChildren(
      h('div', { class: 'progress' }, bar),
      h('div', { class: 'row' }, label, h('button', { class: 'btn small', onclick: () => this.abort?.abort() }, 'Cancel')),
    );
    const started = performance.now();
    try {
      const track = await analyzeVideo({
        videoUrl: this.host.videoUrl,
        fps: s.fps,
        timeScale: s.timeScale,
        model: s.model,
        signal: this.abort.signal,
        onProgress: (done, total, info) => {
          bar.style.width = `${(done / total) * 100}%`;
          const rate = done / ((performance.now() - started) / 1000);
          label.textContent = `Frame ${done}/${total} · ${rate.toFixed(1)} fps · ${info.delegate}${info.inWorker ? '' : ' (main thread)'}`;
        },
      });
      const found = countDetected(track);
      if (found === 0) toast('No golfer detected. Make sure your whole body is in frame.', 5000);
      else if (found < track.times.length * 0.6) toast(`Golfer detected in ${Math.round((found / track.times.length) * 100)}% of frames`);
      this.host.showSkeleton = true;
      this.host.setTrack(track);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast(`Analysis failed: ${(e as Error).message}`, 6000);
    } finally {
      this.abort = null;
      this.renderIdle();
    }
  }

  destroy() {
    this.abort?.abort();
  }
}

function countDetected(track: PoseTrack) {
  let n = 0;
  for (let i = 0; i < track.times.length; i++) if (!Number.isNaN(track.data[i * FRAME_FLOATS])) n++;
  return n;
}
