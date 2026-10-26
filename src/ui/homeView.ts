import { h, icon } from './dom';
import { toast } from './toast';
import { pickVideo } from '../capture/capture';
import { deleteSession, getThumb, listSessions, putSession, storageEstimate } from '../storage/db';
import { tempo } from '../metrics/phases';
import type { Session } from '../types';
import { actionSheet } from './sheet';

export interface HomeCallbacks {
  onVideo: (file: File) => void;
  onOpen: (id: string) => void;
  onCompare: (a: string, b: string) => void;
}

/** Start screen: saved swings, record/import, pick two to compare. */
export class HomeView {
  readonly el: HTMLDivElement;
  private list: HTMLDivElement;
  private compareBtn: HTMLButtonElement;
  private selecting = false;
  private selected: string[] = [];
  private sessions: Session[] = [];
  private urls: string[] = [];
  private footer: HTMLDivElement;

  constructor(private cb: HomeCallbacks) {
    const pick = async (capture: boolean) => {
      const f = await pickVideo({ capture });
      if (f) cb.onVideo(f);
    };
    this.list = h('div', { class: 'session-list' });
    this.compareBtn = h('button', { class: 'btn small', onclick: () => this.toggleSelect() }, icon('compare'), 'Compare');
    this.footer = h('div', { class: 'muted small storage-note' });
    this.el = h(
      'div',
      { class: 'view home' },
      h('header', { class: 'topbar' }, h('div', { class: 'topbar-title brand' }, 'Swing Analyzer'), h('div', { class: 'topbar-spacer' }), this.compareBtn),
      h('div', { class: 'home-scroll' }, this.list, this.footer),
      h(
        'div',
        { class: 'home-actions' },
        h('button', { class: 'btn primary block big', onclick: () => pick(true) }, icon('camera'), 'Record swing'),
        h('button', { class: 'btn block big', onclick: () => pick(false) }, icon('upload'), 'Import video'),
      ),
    );
    void this.load();
  }

  async load() {
    try {
      this.sessions = await listSessions();
    } catch (e) {
      toast(`Storage unavailable: ${(e as Error).message}`, 5000);
      this.sessions = [];
    }
    await this.render();
    const est = await storageEstimate();
    if (est && est.quota) {
      const mb = (b: number) => (b / 1024 / 1024).toFixed(0);
      this.footer.textContent = `${this.sessions.length} swing${this.sessions.length === 1 ? '' : 's'} · ${mb(est.usage)} MB used on this device. Everything stays on your phone.`;
    }
  }

  private toggleSelect() {
    if (this.sessions.length < 2) {
      toast('Save at least two swings to compare.');
      return;
    }
    this.selecting = !this.selecting;
    this.selected = [];
    void this.render();
  }

  private async render() {
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.urls = [];
    this.compareBtn.classList.toggle('on', this.selecting);
    this.compareBtn.lastChild!.textContent = this.selecting ? 'Cancel' : 'Compare';

    if (!this.sessions.length) {
      this.list.replaceChildren(
        h('div', { class: 'empty' },
          h('h2', {}, 'No swings yet'),
          h('p', {}, 'Record a swing or import one from your camera roll. Slow-motion (120/240 fps) clips give the best detail.'),
          h('p', { class: 'small' }, 'Tip: tripod at hip height, whole body in frame, face-on or down the line.'),
        ),
      );
      return;
    }

    const cards = await Promise.all(this.sessions.map((s) => this.card(s)));
    const banner = this.selecting
      ? h('div', { class: 'select-banner' }, `Pick two swings to compare (${this.selected.length}/2)`)
      : null;
    this.list.replaceChildren(...(banner ? [banner] : []), ...cards);
  }

  private async card(s: Session) {
    let thumbUrl = '';
    try {
      const blob = await getThumb(s.id);
      if (blob) {
        thumbUrl = URL.createObjectURL(blob);
        this.urls.push(thumbUrl);
      }
    } catch {
      /* no thumb */
    }
    const t = tempo(s.phases, s.settings.timeScale);
    const date = new Date(s.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const idx = this.selected.indexOf(s.id);
    const menu = h('button', {
      class: 'btn icon-btn',
      'aria-label': 'More',
      onclick: (e: Event) => {
        e.stopPropagation();
        void this.menu(s);
      },
    }, icon('more'));
    return h(
      'div',
      {
        class: `session-card ${idx >= 0 ? 'selected' : ''}`,
        onclick: () => this.onCard(s),
      },
      h('div', { class: 'thumb', style: thumbUrl ? `background-image:url(${thumbUrl})` : '' }, idx >= 0 ? h('span', { class: 'sel-badge' }, idx === 0 ? 'A' : 'B') : null),
      h('div', { class: 'session-info' },
        h('div', { class: 'session-name' }, s.name),
        h('div', { class: 'muted small' }, `${date} · ${s.settings.view === 'dtl' ? 'Down the line' : 'Face-on'}`),
        h('div', { class: 'session-tags' },
          t ? h('span', { class: 'tag' }, `Tempo ${t.ratio.toFixed(1)}:1`) : null,
          s.poseFps ? h('span', { class: 'tag ok' }, 'Analyzed') : h('span', { class: 'tag' }, 'Not analyzed'),
          s.settings.fps >= 100 ? h('span', { class: 'tag' }, `${s.settings.fps} fps`) : null,
        ),
      ),
      this.selecting ? null : menu,
    );
  }

  private onCard(s: Session) {
    if (!this.selecting) {
      this.cb.onOpen(s.id);
      return;
    }
    const i = this.selected.indexOf(s.id);
    if (i >= 0) this.selected.splice(i, 1);
    else this.selected.push(s.id);
    if (this.selected.length === 2) {
      const [a, b] = this.selected;
      this.selecting = false;
      this.selected = [];
      this.cb.onCompare(a, b);
      return;
    }
    void this.render();
  }

  private async menu(s: Session) {
    await actionSheet(s.name, [
      { label: 'Open', run: () => this.cb.onOpen(s.id) },
      {
        label: 'Rename',
        run: async () => {
          const name = prompt('Rename swing', s.name)?.trim();
          if (name && name !== s.name) {
            s.name = name;
            await putSession(s);
            await this.load();
          }
        },
      },
      {
        label: 'Delete',
        danger: true,
        run: async () => {
          if (!confirm(`Delete "${s.name}" and its video from this device?`)) return;
          await deleteSession(s.id);
          toast('Swing deleted');
          await this.load();
        },
      },
    ]);
  }

  destroy() {
    this.urls.forEach((u) => URL.revokeObjectURL(u));
  }
}
