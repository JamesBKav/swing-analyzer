type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

/** Tiny hyperscript helper: h('button', { class: 'x', onclick: fn }, 'Label'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k === 'style') {
      el.setAttribute('style', String(v));
    } else if (k === 'html') {
      el.innerHTML = String(v);
    } else if (k in el && typeof v !== 'string') {
      (el as unknown as Record<string, unknown>)[k] = v;
    } else {
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: (Child | Child[])[]) {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
}

export function clear(el: Element) {
  while (el.firstChild) el.firstChild.remove();
}

/** Inline SVG icon from the set below. */
export function icon(name: keyof typeof ICONS, cls = 'icon'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name];
  return svg;
}

const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
export const ICONS = {
  play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor"/>',
  stepBack: `<path ${S} d="M6 5v14"/><path d="M19 5v14l-10-7z" fill="currentColor"/>`,
  stepFwd: `<path ${S} d="M18 5v14"/><path d="M5 5v14l10-7z" fill="currentColor"/>`,
  back: `<path ${S} d="M15 5l-7 7 7 7"/>`,
  gear: `<circle ${S} cx="12" cy="12" r="3"/><path ${S} d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>`,
  undo: `<path ${S} d="M9 14L4 9l5-5"/><path ${S} d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>`,
  trash: `<path ${S} d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>`,
  line: `<path ${S} d="M5 19L19 5"/><circle cx="5" cy="19" r="2" fill="currentColor"/><circle cx="19" cy="5" r="2" fill="currentColor"/>`,
  angle: `<path ${S} d="M20 19H5l9-13"/><path ${S} d="M10 19a5 5 0 0 0-1.6-3.7"/>`,
  circle: `<circle ${S} cx="12" cy="12" r="8"/>`,
  pen: `<path ${S} d="M4 20c3-1 4-6 7-8s5 0 7-3 1-4 1-4"/>`,
  hand: `<path ${S} d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5a1.5 1.5 0 0 1 3 0V11m0-5a1.5 1.5 0 0 1 3 0v6m0-3a1.5 1.5 0 0 1 3 0v4a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L4.2 15a1.5 1.5 0 0 1 2.4-1.8L8 15"/>`,
  person: `<circle ${S} cx="12" cy="4.5" r="2"/><path ${S} d="M12 7v7m0 0l-4 6m4-6l4 6M6 10l6-2 6 2"/>`,
  camera: `<path ${S} d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle ${S} cx="12" cy="13" r="4"/>`,
  upload: `<path ${S} d="M12 16V4m0 0l-5 5m5-5l5 5M4 20h16"/>`,
  compare: `<rect ${S} x="3" y="4" width="8" height="16" rx="1.5"/><rect ${S} x="13" y="4" width="8" height="16" rx="1.5"/>`,
  check: `<path ${S} d="M5 12l5 5 9-10"/>`,
  pin: `<path ${S} d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle ${S} cx="12" cy="10" r="2"/>`,
  layers: `<path ${S} d="M12 3l9 5-9 5-9-5z"/><path ${S} d="M3 13l9 5 9-5"/>`,
  more: '<circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/>',
} as const;
