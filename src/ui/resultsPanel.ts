import { h, icon } from './dom';
import { toast } from './toast';
import { detectPhases, mergePhases } from '../metrics/phases';
import { computeMetrics, type SwingMetrics } from '../metrics/metrics';
import { PHASES, PHASE_LABEL, type PhaseName, type Session } from '../types';
import type { PoseTrack } from '../pose/landmarks';
import type { VideoPlayer } from '../player/player';

export interface ResultsHost {
  session: Session;
  track: PoseTrack | null;
  player: VideoPlayer;
  overlays: { headBox: boolean; spine: boolean };
  metrics: SwingMetrics | null;
  save(): void;
  redraw(): void;
  onPhasesChanged(): void;
}

const fmt = (v: number | null | undefined, unit = '°', digits = 0) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}${unit}`;
const signed = (v: number | null | undefined, unit = '°', digits = 0) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}${unit}`;

/** Phase chips (tap to jump, set manually) and the metrics list. */
export class ResultsPanel {
  readonly el: HTMLDivElement;
  private selected: PhaseName = 'address';

  constructor(private host: ResultsHost) {
    this.el = h('div', { class: 'results-inner' });
  }

  /** Run (or re-run) detection, keeping manual phases unless reset. */
  detect(resetManual = false) {
    const { session, track } = this.host;
    if (!track) return;
    if (resetManual) session.manualPhases = [];
    const d = detectPhases(track, session.settings.handedness);
    if (!d) {
      toast('Could not find a swing in the pose data. Set the phases by hand.', 5000);
    } else if (d.confidence < 0.5) {
      toast('Phase detection is unsure — check the markers and correct them if needed.', 4500);
    }
    session.phases = mergePhases(d?.phases ?? {}, session.phases, session.manualPhases);
    this.host.onPhasesChanged();
  }

  render() {
    const { session, track } = this.host;
    if (!track) {
      this.el.replaceChildren();
      return;
    }
    this.el.replaceChildren(this.phaseCard(session), this.metricsCard(this.host.metrics));
  }

  private phaseCard(session: Session) {
    const chips = PHASES.map((p) => {
      const t = session.phases[p];
      const manual = session.manualPhases.includes(p);
      return h(
        'button',
        {
          class: `chip ${this.selected === p ? 'on' : ''} ${t === undefined ? 'missing' : ''}`,
          onclick: () => {
            this.selected = p;
            if (t !== undefined) void this.host.player.seekFrameAt(t);
            this.render();
          },
        },
        h('span', { class: 'chip-label' }, PHASE_LABEL[p], manual ? h('span', { class: 'manual-dot', title: 'Set by hand' }) : null),
        h('span', { class: 'chip-time' }, t === undefined ? '—' : `${(t * session.settings.timeScale).toFixed(2)}s`),
      );
    });
    const setBtn = h('button', {
      class: 'btn small primary grow',
      onclick: () => {
        const t = this.host.player.displayTime;
        session.phases[this.selected] = t;
        if (!session.manualPhases.includes(this.selected)) session.manualPhases.push(this.selected);
        toast(`${PHASE_LABEL[this.selected]} set to this frame`);
        // Move selection on to the next phase for quick tagging.
        const next = PHASES[PHASES.indexOf(this.selected) + 1];
        if (next) this.selected = next;
        this.host.onPhasesChanged();
      },
    }, icon('pin'), `Set ${PHASE_LABEL[this.selected]} here`);
    const redetect = h('button', { class: 'btn small', onclick: () => this.detect(true) }, 'Auto-detect');
    return h(
      'section',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, 'Swing phases'), h('span', { class: 'muted small' }, 'Tap to jump')),
      h('div', { class: 'chips' }, chips),
      h('div', { class: 'row' }, setBtn, redetect),
    );
  }

  private metricsCard(m: SwingMetrics | null) {
    const { session } = this.host;
    const view = session.settings.view;
    const overlayToggle = (key: 'headBox' | 'spine', label: string) => {
      const b = h('button', {
        class: `btn small toggle ${this.host.overlays[key] ? 'on' : ''}`,
        onclick: () => {
          this.host.overlays[key] = !this.host.overlays[key];
          b.classList.toggle('on', this.host.overlays[key]);
          this.host.redraw();
        },
      }, label);
      return b;
    };
    if (!m) {
      return h('section', { class: 'card' }, h('h3', {}, 'Metrics'), h('p', { class: 'muted' }, 'Set address, top and impact to see metrics.'));
    }
    const row = (label: string, value: string, sub?: string) =>
      h('div', { class: 'metric' }, h('div', { class: 'metric-label' }, label, sub ? h('div', { class: 'metric-sub' }, sub) : null), h('div', { class: 'metric-value' }, value));

    const t = m.tempo;
    const spineLabel = view === 'dtl' ? 'Spine forward bend' : 'Spine tilt (away from target)';
    const lateral = view === 'dtl' ? 'toward/away from ball' : 'sway toward/away from target';
    const rows = [
      row('Tempo', t ? `${t.ratio.toFixed(1)} : 1` : '—', t ? `Back ${t.backswing.toFixed(2)}s · Down ${t.downswing.toFixed(2)}s` : 'Backswing : downswing'),
      row(spineLabel, `${fmt(m.spine.address)} → ${fmt(m.spine.impact)}`, `Address → impact (${signed(m.spine.change)})`),
      m.head
        ? row('Head movement', `${m.head.lateralRange.toFixed(0)}% · ${m.head.verticalRange.toFixed(0)}%`, `Lateral (${lateral}) · vertical range, address→impact, % of torso length. At impact: ${signed(m.head.lateralAtImpact, '%')} lateral, ${signed(m.head.verticalAtImpact, '%')} up`)
        : row('Head movement', '—'),
      row('Shoulder tilt', `${signed(m.shoulders.address)} / ${signed(m.shoulders.top)} / ${signed(m.shoulders.impact)}`, 'Address / top / impact. + = lead shoulder higher'),
      row('Hip tilt', `${signed(m.hips.address)} / ${signed(m.hips.top)} / ${signed(m.hips.impact)}`, 'Address / top / impact. + = lead hip higher'),
      view === 'face-on'
        ? row('Turn at top (proxy)', `${fmt(m.shoulderTurnTop)} · ${fmt(m.hipTurnTop)}`, 'Shoulders · hips, from how much each line shortens. Rough — film square-on.')
        : null,
      row('Lead arm at top', fmt(m.leadArm.elbowAtTop), `Elbow angle (180° = straight) · arm ${fmt(m.leadArm.aboveHorizontalAtTop)} above horizontal`),
    ];
    return h(
      'section',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, 'Metrics'), h('span', { class: 'badge' }, '2D estimates')),
      h('div', { class: 'metrics' }, rows),
      h('div', { class: 'row' }, h('span', { class: 'muted label' }, 'Show'), overlayToggle('headBox', 'Head box'), overlayToggle('spine', 'Spine line')),
      h('p', { class: 'hint' }, 'All metrics are measured in the camera image (2D), not true 3D angles. They depend on camera height and position — film the same way each time to compare swings.'),
    );
  }
}

export function metricsFor(session: Session, track: PoseTrack | null) {
  return track ? computeMetrics(track, session.phases, session.settings) : null;
}
