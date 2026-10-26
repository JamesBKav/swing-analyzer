import { h } from './dom';

export interface SheetAction {
  label: string;
  danger?: boolean;
  run: () => void | Promise<void>;
}

/** Bottom action sheet (thumb-reachable). Resolves when closed. */
export function actionSheet(title: string, actions: SheetAction[]): Promise<void> {
  return new Promise((resolve) => {
    const close = () => {
      backdrop.classList.remove('show');
      setTimeout(() => backdrop.remove(), 200);
      resolve();
    };
    const sheet = h(
      'div',
      { class: 'sheet', onclick: (e: Event) => e.stopPropagation() },
      h('div', { class: 'sheet-title' }, title),
      actions.map((a) =>
        h('button', {
          class: `sheet-btn ${a.danger ? 'danger' : ''}`,
          onclick: async () => {
            close();
            await a.run();
          },
        }, a.label),
      ),
      h('button', { class: 'sheet-btn cancel', onclick: close }, 'Cancel'),
    );
    const backdrop = h('div', { class: 'sheet-backdrop', onclick: close }, sheet);
    document.body.append(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('show'));
  });
}
