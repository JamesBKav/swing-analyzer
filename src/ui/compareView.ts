import { h, icon } from './dom';
import { toast } from './toast';
import { Stage } from './stage';
import { SPEEDS, VideoPlayer } from '../player/player';
import { Scrubber } from '../player/scrubber';
import { formatTime } from '../player/transport';
import { poseAt, type PoseTrack } from '../pose/landmarks';
import { drawSkeleton } from '../pose/skeleton';
import { mapTime, type SyncMode } from '../metrics/sync';
import { PHASES, PHASE_LABEL, type Session } from '../types';

export interface CompareInput {
  session: Session;
  videoUrl: string;
  track: PoseTrack | null;
}

type Layout = 'side' | 'overlay';

/**
 * Two swings played together, synced by phase. Swing A is the master
 * timeline; B is seeked to the mapped time for every frame shown, so the
 * two stay locked even with different speeds or frame rates.
 */
export class CompareView {
  readonly el: HTMLDivElement;
  private a: { input: CompareInput; player: VideoPlayer; stage: Stage };
  private b: { input: CompareInput; player: VideoPlayer; stage: Stage };
  private layout: Layout = 'side';
  private sync: SyncMode = 'impact';
  private opacity = 0.5;
  private mirrorB = false;
  private skeleton = true;
  private rate = 0.5;
  private playing = false;
  private loopTimer = 0;
  /** Current master (A) time. */
  private t = 0;
  private stageWrap: HTMLDivElement;
  private scrubber: Scrubber;
  private readout: HTMLDivElement;
  private playBtn: HTMLButtonElement;
  private controls: HTMLDivElement;

  constructor(inA: CompareInput, inB: CompareInput, private onBack: () => void) {
    const mk = (input: CompareInput) => {
      const player = new VideoPlayer();
      player.fps = input.session.settings.fps;
      const stage = new Stage(player);
      stage.gesturesEnabled = false;
      stage.addLayer((ctx, rect, t) => {
        if (!this.skeleton || !input.track) return;
        const pose = poseAt(input.track, t);
        if (pose) drawSkeleton(ctx, pose, rect, input.session.settings.handedness);
      });
      return { input, player, stage };
    };
    this.a = mk(inA);
    this.b = mk(inB);
    this.a.stage.el.classList.add('cmp-a');
    this.b.stage.el.classList.add('cmp-b');
    this.a.stage.el.append(h('div', { class: 'cmp-tag' }, 'A · ', inA.session.name));
    this.b.stage.el.append(h('div', { class: 'cmp-tag b' }, 'B · ', inB.session.name));

    this.stageWrap = h('div', { class: 'cmp-stages' }, this.a.stage.el, this.b.stage.el);
    this.bindGestures();

    this.scrubber = new Scrubber((t) => this.seek(t), () => this.pause());
    this.readout = h('div', { class: 'readout' });
    this.playBtn = h('button', { class: 'btn round primary big', 'aria-label': 'Play/pause', onclick: () => this.toggle() });
    this.controls = h('div', { class: 'cmp-controls pad' });

    this.el = h(
      'div',
      { class: 'view compare' },
      h('header', { class: 'topbar' },
        h('button', { class: 'btn icon-btn', 'aria-label': 'Back', onclick: () => this.onBack() }, icon('back')),
        h('div', { class: 'topbar-title' }, 'Compare'),
      ),
      this.stageWrap,
      h('div', { class: 'panel' },
        h('div', { class: 'transport' },
          this.scrubber.el,
          h('div', { class: 'transport-row center' },
            h('button', { class: 'btn round big', 'aria-label': 'Previous frame', onclick: () => this.step(-1) }, icon('stepBack')),
            this.playBtn,
            h('button', { class: 'btn round big', 'aria-label': 'Next frame', onclick: () => this.step(1) }, icon('stepFwd')),
          ),
        ),
        h('div', { class: 'tab-body' }, this.controls),
      ),
    );
    this.renderControls();
    this.applyLayout();
  }

  async init() {
    try {
      await Promise.all([this.a.player.load(this.a.input.videoUrl), this.b.player.load(this.b.input.videoUrl)]);
      this.scrubber.setDuration(this.a.player.duration);
      this.applyLayout();
      const pa = this.a.input.session.phases;
      const pb = this.b.input.session.phases;
      if (pa.impact === undefined || pb.impact === undefined) {
        toast('Analyze both swings (or tag their phases) for phase sync.', 4500);
      }
      // Start a little before address so the swing plays from the set-up.
      const start = pa.address !== undefined ? Math.max(0, pa.address - 0.3) : 0;
      await this.seek(start);
    } catch (e) {
      toast((e as Error).message, 5000);
    }
  }

  private tB(tA: number) {
    return mapTime(tA, this.a.input.session.phases, this.b.input.session.phases, this.sync);
  }

  private async seek(tA: number) {
    this.t = Math.min(Math.max(0, tA), this.a.player.duration || 0);
    const tb = Math.min(Math.max(0, this.tB(this.t)), this.b.player.duration || 0);
    await Promise.all([this.a.player.seekFrameAt(this.t), this.b.player.seekFrameAt(tb)]);
    this.renderTime();
  }

  private step(n: number) {
    this.pause();
    const fa = this.a.player;
    void this.seek(fa.frameTime(fa.frameIndex(this.t) + n));
  }

  private toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  private play() {
    if (this.playing) return;
    if (this.t >= this.a.player.duration - 0.05) this.t = 0;
    this.playing = true;
    this.renderPlay();
    const startT = this.t;
    const startWall = performance.now();
    // Seek-driven clock: both videos show exactly the mapped frame.
    const loop = async () => {
      if (!this.playing) return;
      const target = startT + ((performance.now() - startWall) / 1000) * this.rate;
      if (target >= this.a.player.duration) {
        await this.seek(this.a.player.duration);
        this.pause();
        return;
      }
      await this.seek(target);
      if (this.playing) this.loopTimer = window.setTimeout(loop, 0);
    };
    void loop();
  }

  private pause() {
    this.playing = false;
    clearTimeout(this.loopTimer);
    this.renderPlay();
  }

  private renderPlay() {
    this.playBtn.replaceChildren(icon(this.playing ? 'pause' : 'play'));
  }

  private renderTime() {
    this.scrubber.setValue(this.t);
    this.readout.textContent = `A ${formatTime(this.t)} · B ${formatTime(this.b.player.displayTime)}`;
  }

  private applyLayout() {
    // Portrait clips sit best in two columns; landscape clips stack.
    const portrait = (v: VideoPlayer, sess: Session) => (v.video.videoHeight || sess.height) > (v.video.videoWidth || sess.width);
    const cols = portrait(this.a.player, this.a.input.session) && portrait(this.b.player, this.b.input.session);
    this.stageWrap.className = `cmp-stages ${this.layout} ${cols ? 'cols' : ''}`;
    this.b.stage.el.style.opacity = this.layout === 'overlay' ? String(this.opacity) : '1';
    this.b.stage.el.classList.toggle('mirror', this.mirrorB);
    requestAnimationFrame(() => {
      this.a.stage.resize();
      this.b.stage.resize();
    });
  }

  private renderControls() {
    const seg = <T extends string | number>(options: [T, string][], get: () => T, set: (v: T) => void) => {
      const btns = options.map(([v, label]) =>
        h('button', {
          class: `seg ${get() === v ? 'on' : ''}`,
          onclick: () => {
            set(v);
            this.renderControls();
          },
        }, label),
      );
      return h('div', { class: 'segmented compact' }, btns);
    };
    const field = (label: string, control: HTMLElement) => h('div', { class: 'field' }, h('label', {}, label), control);

    const opacity = h('input', {
      type: 'range',
      min: '0.1',
      max: '0.9',
      step: '0.05',
      value: String(this.opacity),
      class: 'slider',
      oninput: (e: Event) => {
        this.opacity = Number((e.target as HTMLInputElement).value);
        this.b.stage.el.style.opacity = String(this.opacity);
      },
    });

    const phases = this.a.input.session.phases;
    const jump = h(
      'div',
      { class: 'chips' },
      PHASES.map((p) =>
        h('button', {
          class: 'chip',
          disabled: phases[p] === undefined,
          onclick: () => {
            this.pause();
            if (phases[p] !== undefined) void this.seek(phases[p]!);
          },
        }, h('span', { class: 'chip-label' }, PHASE_LABEL[p])),
      ),
    );

    const toggle = (label: string, get: () => boolean, set: (v: boolean) => void) => {
      const b = h('button', {
        class: `btn small toggle ${get() ? 'on' : ''}`,
        onclick: () => {
          set(!get());
          b.classList.toggle('on', get());
        },
      }, label);
      return b;
    };

    this.controls.replaceChildren(
      h('div', { class: 'row' }, this.readout, h('div', { class: 'grow' })),
      field('Jump to', jump),
      field('Layout', seg([['side', 'Side by side'], ['overlay', 'Overlay']], () => this.layout, (v) => {
        this.layout = v;
        this.applyLayout();
      })),
      this.layout === 'overlay' ? field('B opacity', opacity) : '',
      field('Sync', seg([['address', 'Address'], ['impact', 'Impact'], ['phases', 'All phases']], () => this.sync, (v) => {
        this.sync = v;
        void this.seek(this.t);
      })),
      field('Speed', seg(SPEEDS.map((s) => [s, `${s}×`] as [number, string]), () => this.rate, (v) => {
        this.rate = v;
        if (this.playing) {
          this.pause();
          this.play();
        }
      })),
      h('div', { class: 'row' },
        toggle('Skeleton', () => this.skeleton, (v) => {
          this.skeleton = v;
          this.a.stage.render();
          this.b.stage.render();
        }),
        toggle('Mirror B', () => this.mirrorB, (v) => {
          this.mirrorB = v;
          this.applyLayout();
        }),
      ),
      h('p', { class: 'hint' }, '“All phases” stretches B so address, top, impact and finish line up — great for comparing positions even when tempos differ.'),
    );
    this.renderTime();
  }

  /** Tap to play/pause, swipe sideways to step frames. */
  private bindGestures() {
    let startX = 0, lastX = 0, moved = false, active = false;
    const el = this.stageWrap;
    el.addEventListener('pointerdown', (e) => {
      active = true;
      moved = false;
      startX = lastX = e.clientX;
    });
    el.addEventListener('pointermove', (e) => {
      if (!active) return;
      if (!moved && Math.abs(e.clientX - startX) > 10) {
        moved = true;
        this.pause();
      }
      if (moved) {
        const n = Math.trunc((e.clientX - lastX) / 14);
        if (n) {
          lastX += n * 14;
          this.step(n);
        }
      }
    });
    el.addEventListener('pointerup', () => {
      if (active && !moved) this.toggle();
      active = false;
    });
    el.addEventListener('pointercancel', () => (active = false));
  }

  destroy() {
    this.pause();
    for (const s of [this.a, this.b]) {
      s.player.destroy();
      s.stage.destroy();
    }
  }
}
