import { h, icon } from './dom';
import { COLORS, type DrawController, type Tool } from '../draw/controller';

const TOOLS: [Tool, string, Parameters<typeof icon>[0]][] = [
  ['none', 'Off', 'hand'],
  ['line', 'Line', 'line'],
  ['angle', 'Angle', 'angle'],
  ['circle', 'Circle', 'circle'],
  ['free', 'Pen', 'pen'],
];

const HINTS: Record<Tool, string> = {
  none: 'Pick a tool, then draw on the video. Tap the video to play/pause and swipe sideways to step frames when no tool is selected.',
  line: 'Drag to draw a line. Its angle from horizontal is shown.',
  angle: 'Tap three points: end, corner, end. Drag while touching to fine-tune each point.',
  circle: 'Drag from the centre outward.',
  free: 'Draw freehand with your finger.',
};

/** "Draw" tab: tool picker, frame/persistent mode, colours, undo/clear. */
export function createDrawPanel(ctl: DrawController) {
  const toolBtns = TOOLS.map(([tool, label, ic]) =>
    h('button', { class: 'tool', onclick: () => ctl.setTool(tool) }, icon(ic), h('span', {}, label)),
  );
  const modeBtns = [
    h('button', { class: 'seg', onclick: () => setMode(false) }, 'All frames'),
    h('button', { class: 'seg', onclick: () => setMode(true) }, 'This frame only'),
  ];
  const setMode = (perFrame: boolean) => {
    ctl.perFrame = perFrame;
    render();
  };
  const swatches = COLORS.map((c) =>
    h('button', {
      class: 'swatch',
      style: `--c:${c}`,
      'aria-label': `Colour ${c}`,
      onclick: () => {
        ctl.color = c;
        render();
      },
    }),
  );
  const undoBtn = h('button', { class: 'btn small', onclick: () => ctl.undo() }, icon('undo'), 'Undo');
  const clearBtn = h('button', {
    class: 'btn small danger square',
    'aria-label': 'Clear all drawings',
    title: 'Clear all',
    onclick: () => {
      if (ctl.shapes.length && confirm('Remove all drawings on this swing?')) ctl.clear();
    },
  }, icon('trash'));
  const hint = h('p', { class: 'hint' });

  const el = h(
    'div',
    { class: 'draw-panel pad' },
    h('div', { class: 'tools' }, toolBtns),
    h('div', { class: 'segmented compact' }, modeBtns),
    h('div', { class: 'row' }, h('div', { class: 'swatches' }, swatches), h('div', { class: 'grow' }), undoBtn, clearBtn),
    hint,
  );

  function render() {
    toolBtns.forEach((b, i) => b.classList.toggle('on', TOOLS[i][0] === ctl.tool));
    modeBtns[0].classList.toggle('on', !ctl.perFrame);
    modeBtns[1].classList.toggle('on', ctl.perFrame);
    swatches.forEach((s, i) => s.classList.toggle('on', COLORS[i] === ctl.color));
    undoBtn.disabled = ctl.shapes.length === 0;
    clearBtn.disabled = ctl.shapes.length === 0;
    hint.textContent = HINTS[ctl.tool];
  }
  ctl.addEventListener('change', render);
  render();
  return el;
}
