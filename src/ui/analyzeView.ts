import { h, icon } from './dom';
import { toast } from './toast';
import { VideoPlayer, detectFps } from '../player/player';
import { createTransport } from '../player/transport';
import { Stage } from './stage';
import type { Session } from '../types';

export interface AnalyzeCallbacks {
  onBack: () => void;
  onChange: (s: Session) => void;
}

type TabId = 'pose' | 'draw' | 'settings';

/** Single-swing analysis screen: video stage, transport and tool tabs. */
export class AnalyzeView {
  readonly el: HTMLDivElement;
  readonly player = new VideoPlayer();
  readonly stage: Stage;
  private tabBodies = new Map<TabId, HTMLElement>();
  private tabButtons = new Map<TabId, HTMLButtonElement>();
  private body: HTMLDivElement;

  constructor(public session: Session, private videoUrl: string, private cb: AnalyzeCallbacks, private isNew = false) {
    this.stage = new Stage(this.player);
    const transport = createTransport(this.player);

    const title = h('div', { class: 'topbar-title' }, session.name);
    const topbar = h(
      'header',
      { class: 'topbar' },
      h('button', { class: 'btn icon-btn', 'aria-label': 'Back', onclick: () => cb.onBack() }, icon('back')),
      title,
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
    this.tabBodies.set('pose', h('div', { class: 'muted pad' }, 'Pose analysis coming next.'));
    this.tabBodies.set('draw', h('div', { class: 'muted pad' }, 'Drawing tools coming soon.'));
    this.tabBodies.set('settings', this.buildSettings());

    this.el = h(
      'div',
      { class: 'view analyze' },
      topbar,
      this.stage.el,
      h('div', { class: 'panel' }, transport.el, this.body, tabbar),
    );
    this.showTab('pose');
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
      await this.player.seek(this.player.frameTime(0));
    } catch (e) {
      toast((e as Error).message, 5000);
    }
  }

  showTab(id: TabId) {
    this.body.replaceChildren(this.tabBodies.get(id)!);
    this.tabButtons.forEach((b, k) => b.classList.toggle('on', k === id));
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
    this.settingsEl = h(
      'div',
      { class: 'settings pad' },
      seg('Camera view', [['face-on', 'Face-on'], ['dtl', 'Down the line']], () => s.view, (v) => (s.view = v)),
      seg('Golfer', [['right', 'Right-handed'], ['left', 'Left-handed']], () => s.handedness, (v) => (s.handedness = v)),
      seg('Video frame rate', [[30, '30'], [60, '60'], [120, '120'], [240, '240']], () => s.fps, (v) => {
        s.fps = v;
        this.player.fps = v;
        this.player.dispatchEvent(new Event('time'));
      }),
      seg('Slow-mo baked into the clip?', [[1, 'No (real time)'], [0.25, '4× slower'], [0.125, '8× slower']], () => s.timeScale, (v) => (s.timeScale = v)),
      h('p', { class: 'hint' }, 'Frame rate is auto-detected on import. If you imported slow-mo that already plays slowly, choose how much slower so times are shown in real seconds. Tempo ratios are unaffected.'),
    );
    return this.settingsEl;
  }

  destroy() {
    this.player.destroy();
    this.stage.destroy();
  }
}
