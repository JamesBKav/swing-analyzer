import { h, icon } from './dom';
import { toast } from './toast';
import { VideoPlayer, detectFps } from '../player/player';
import { createTransport } from '../player/transport';
import { Stage } from './stage';
import { PHASES, PHASE_LABEL, type Session } from '../types';
import { PosePanel } from './posePanel';
import { ResultsPanel, metricsFor } from './resultsPanel';
import { drawHeadBox, drawSpine } from './overlays';
import { poseAt, type PoseTrack } from '../pose/landmarks';
import { drawSkeleton } from '../pose/skeleton';
import type { SwingMetrics } from '../metrics/metrics';

export interface AnalyzeCallbacks {
  onBack: () => void;
  onChange: (s: Session) => void;
  onTrack?: (track: PoseTrack) => void;
}

type TabId = 'pose' | 'draw' | 'settings';

/** Single-swing analysis screen: video stage, transport and tool tabs. */
export class AnalyzeView {
  readonly el: HTMLDivElement;
  readonly player = new VideoPlayer();
  readonly stage: Stage;
  track: PoseTrack | null = null;
  metrics: SwingMetrics | null = null;
  showSkeleton = true;
  overlays = { headBox: false, spine: false };
  private tabBodies = new Map<TabId, HTMLElement>();
  private tabButtons = new Map<TabId, HTMLButtonElement>();
  private body: HTMLDivElement;
  private posePanel: PosePanel;
  private results: ResultsPanel;
  private transport: ReturnType<typeof createTransport>;
  /** Extra tab content and teardown registered by feature modules (drawing). */
  private disposers: (() => void)[] = [];

  constructor(public session: Session, readonly videoUrl: string, private cb: AnalyzeCallbacks, private isNew = false) {
    this.stage = new Stage(this.player);
    this.transport = createTransport(this.player);

    const topbar = h(
      'header',
      { class: 'topbar' },
      h('button', { class: 'btn icon-btn', 'aria-label': 'Back', onclick: () => cb.onBack() }, icon('back')),
      h('div', { class: 'topbar-title' }, session.name),
      h('div', { class: 'topbar-spacer' }),
    );

    this.body = h('div', { class: 'tab-body' });
    const tabbar = h('nav', { class: 'tabbar' });
    const tabs: [TabId, string, Parameters<typeof icon>[0]][] = [
      ['pose', 'Analyze', 'person'],
      ['draw', 'Draw', 'pen'],
      ['settings', 'Setup', 'gear'],
    ];
    for (const [id, label, ic] of tabs) {
      const b = h('button', { class: 'tab', onclick: () => this.showTab(id) }, icon(ic), h('span', {}, label));
      this.tabButtons.set(id, b);
      tabbar.append(b);
    }

    this.posePanel = new PosePanel(this);
    this.results = new ResultsPanel(this);
    this.posePanel.results.append(this.results.el);
    this.tabBodies.set('pose', this.posePanel.el);
    this.tabBodies.set('draw', h('div', { class: 'muted pad' }, 'Drawing tools coming soon.'));
    this.tabBodies.set('settings', this.buildSettings());

    // Overlay layers, bottom to top.
    this.stage.addLayer((ctx, rect) => {
      if (this.overlays.headBox && this.metrics) drawHeadBox(ctx, rect, this.metrics);
    });
    this.stage.addLayer((ctx, rect, t) => {
      if (!this.track || !this.showSkeleton) return;
      const pose = poseAt(this.track, t);
      if (pose) drawSkeleton(ctx, pose, rect, this.session.settings.handedness);
    });
    this.stage.addLayer((ctx, rect, t) => {
      if (this.overlays.spine && this.track) drawSpine(ctx, rect, this.track, this.session.phases, t);
    });

    this.el = h('div', { class: 'view analyze' }, topbar, this.stage.el, h('div', { class: 'panel' }, this.transport.el, this.body, tabbar));
    this.showTab('pose');
    this.updateMarkers();
  }

  async init() {
    try {
      this.player.fps = this.session.settings.fps;
      await this.player.load(this.videoUrl);
      if (this.isNew) {
        const fps = await detectFps(this.player.video);
        if (fps) {
          this.session.settings.fps = fps;
          this.player.fps = fps;
          this.save();
          this.refreshSettings();
          toast(`Detected ${fps} fps`);
        }
      }
      this.updateMarkers();
      await this.player.seek(this.player.frameTime(0));
    } catch (e) {
      toast((e as Error).message, 5000);
    }
  }

  showTab(id: TabId) {
    this.body.replaceChildren(this.tabBodies.get(id)!);
    this.tabButtons.forEach((b, k) => b.classList.toggle('on', k === id));
    this.el?.dispatchEvent(new CustomEvent('tabchange', { detail: id }));
  }

  /** Register a feature tab body (used by the drawing module). */
  setTabBody(id: TabId, el: HTMLElement) {
    this.tabBodies.set(id, el);
    if (this.tabButtons.get(id)?.classList.contains('on')) this.showTab(id);
  }

  addDisposer(fn: () => void) {
    this.disposers.push(fn);
  }

  /**
   * Attach a pose track. Fresh analyses run phase detection; stored tracks
   * keep their saved phases.
   */
  setTrack(track: PoseTrack, fromStorage = false) {
    this.track = track;
    this.session.poseFps = track.rate;
    if (!fromStorage) {
      this.cb.onTrack?.(track);
      this.results.detect();
    } else {
      this.onPhasesChanged(false);
    }
    this.posePanel.renderIdle();
  }

  onPhasesChanged(persist = true) {
    this.metrics = metricsFor(this.session, this.track);
    this.results.render();
    this.updateMarkers();
    this.redraw();
    if (persist) this.save();
  }

  private updateMarkers() {
    this.transport.scrubber.setMarkers(
      PHASES.filter((p) => this.session.phases[p] !== undefined).map((p) => ({ t: this.session.phases[p]!, label: PHASE_LABEL[p] })),
    );
  }

  redraw() {
    this.stage.render();
  }

  save() {
    this.cb.onChange(this.session);
  }

  private settingsEl?: HTMLElement;
  private refreshSettings() {
    const fresh = this.buildSettings();
    this.settingsEl?.replaceWith(fresh);
    this.tabBodies.set('settings', fresh);
  }

  private buildSettings(): HTMLElement {
    const s = this.session.settings;
    const seg = <T extends string | number>(label: string, options: [T, string][], get: () => T, set: (v: T) => void) => {
      const btns = options.map(([v, text]) =>
        h('button', {
          class: `seg ${get() === v ? 'on' : ''}`,
          onclick: () => {
            set(v);
            btns.forEach((b, i) => b.classList.toggle('on', options[i][0] === v));
            this.save();
          },
        }, text),
      );
      return h('div', { class: 'field' }, h('label', {}, label), h('div', { class: 'segmented' }, btns));
    };
    const fpsOptions = [30, 60, 120, 240];
    if (!fpsOptions.includes(s.fps)) fpsOptions.unshift(s.fps);
    this.settingsEl = h(
      'div',
      { class: 'settings pad' },
      seg('Camera view', [['face-on', 'Face-on'], ['dtl', 'Down the line']], () => s.view, (v) => {
        s.view = v;
        this.onPhasesChanged();
      }),
      seg('Golfer', [['right', 'Right-handed'], ['left', 'Left-handed']], () => s.handedness, (v) => {
        s.handedness = v;
        if (this.track) this.results.detect();
        else this.redraw();
      }),
      seg('Video frame rate', fpsOptions.map((f) => [f, String(f)] as [number, string]), () => s.fps, (v) => {
        s.fps = v;
        this.player.fps = v;
        this.player.dispatchEvent(new Event('time'));
      }),
      seg('Slow-mo baked into the clip?', [[1, 'No (real time)'], [0.25, '4× slower'], [0.125, '8× slower']], () => s.timeScale, (v) => {
        s.timeScale = v;
        this.onPhasesChanged();
      }),
      h('p', { class: 'hint' }, 'Frame rate is auto-detected on import. If you imported slow-mo that already plays slowly, choose how much slower so times are shown in real seconds. Tempo ratios are unaffected.'),
    );
    return this.settingsEl;
  }

  destroy() {
    this.disposers.forEach((d) => d());
    this.posePanel.destroy();
    this.player.destroy();
    this.stage.destroy();
  }
}
