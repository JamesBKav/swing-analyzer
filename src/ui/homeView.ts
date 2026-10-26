import { h, icon } from './dom';
import { pickVideo } from '../capture/capture';

export interface HomeCallbacks {
  onVideo: (file: File) => void;
}

/** Start screen: record or import a swing. */
export class HomeView {
  readonly el: HTMLDivElement;
  readonly list: HTMLDivElement;

  constructor(cb: HomeCallbacks) {
    const pick = async (capture: boolean) => {
      const f = await pickVideo({ capture });
      if (f) cb.onVideo(f);
    };
    this.list = h('div', { class: 'session-list' });
    this.el = h(
      'div',
      { class: 'view home' },
      h('header', { class: 'topbar' }, h('div', { class: 'topbar-title brand' }, 'Swing Analyzer')),
      h('div', { class: 'home-scroll' }, this.list),
      h(
        'div',
        { class: 'home-actions' },
        h('button', { class: 'btn primary block big', onclick: () => pick(true) }, icon('camera'), 'Record swing'),
        h('button', { class: 'btn block big', onclick: () => pick(false) }, icon('upload'), 'Import video'),
      ),
    );
  }
}
