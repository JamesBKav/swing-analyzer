import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { HomeView } from './ui/homeView';
import { AnalyzeView } from './ui/analyzeView';
import { CompareView, type CompareInput } from './ui/compareView';
import { probeVideo, thumbnailFromUrl } from './capture/capture';
import { toast } from './ui/toast';
import { h } from './ui/dom';
import { DEFAULT_SETTINGS, type Session } from './types';
import * as store from './storage/db';

const app = document.querySelector<HTMLDivElement>('#app')!;
const saver = store.sessionSaver();

// iOS Safari ignores user-scalable=no; block pinch zoom on the app chrome.
document.addEventListener('gesturestart', (e) => e.preventDefault());
// Save pending edits when the app is backgrounded (iOS may kill it).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void saver.flush();
});

type View = { el: HTMLElement; destroy?: () => void };
let current: View | null = null;
let currentUrls: string[] = [];
/** Videos imported this run, used until (or if) they finish saving. */
const memVideos = new Map<string, Blob>();
const freshIds = new Set<string>();
/** True when the current screen was reached from home (so Back = history.back). */
let cameFromHome = false;

function show(view: View, urls: string[] = []) {
  current?.destroy?.();
  currentUrls.forEach((u) => URL.revokeObjectURL(u));
  currentUrls = urls;
  app.replaceChildren(view.el);
  current = view;
}

function goHome() {
  void saver.flush();
  if (cameFromHome) history.back();
  else location.replace('#/');
}

function navigate(hash: string) {
  cameFromHome = true;
  location.hash = hash;
}

/** New swings inherit the last used camera view, handedness and model. */
function lastSettings(): Partial<Session['settings']> {
  try {
    return JSON.parse(localStorage.getItem('swing:lastSettings') ?? '{}');
  } catch {
    return {};
  }
}

function saveSession(s: Session) {
  try {
    const { view, handedness, model } = s.settings;
    localStorage.setItem('swing:lastSettings', JSON.stringify({ view, handedness, model }));
  } catch {
    /* storage blocked */
  }
  saver.save(s);
}

// ---- Routes ----------------------------------------------------------------

async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try {
    if (parts[0] === 's' && parts[1]) await showSession(parts[1]);
    else if (parts[0] === 'c' && parts[1] && parts[2]) await showCompare(parts[1], parts[2]);
    else showHome();
  } catch (e) {
    toast((e as Error).message, 5000);
    location.replace('#/');
  }
}

function showHome() {
  cameFromHome = false;
  show(
    new HomeView({
      onVideo: importFile,
      onOpen: (id) => navigate(`#/s/${id}`),
      onCompare: (a, b) => navigate(`#/c/${a}/${b}`),
    }),
  );
}

async function loadVideo(id: string) {
  const blob = memVideos.get(id) ?? (await store.getVideo(id));
  if (!blob) throw new Error('Video not found on this device.');
  return URL.createObjectURL(blob);
}

async function showSession(id: string) {
  const session = await store.getSession(id);
  if (!session) throw new Error('Swing not found.');
  const [url, track] = await Promise.all([loadVideo(id), store.getTrack(id)]);
  const isNew = freshIds.delete(id);
  const view = new AnalyzeView(
    session,
    url,
    {
      onBack: goHome,
      onChange: saveSession,
      onTrack: (t) => {
        store.putTrack(id, t).catch((e) => toast(`Could not save pose data: ${(e as Error).message}`));
      },
    },
    isNew,
  );
  show(view, [url]);
  if (track) view.setTrack(track, true);
  await view.init();
}

async function showCompare(a: string, b: string) {
  const load = async (id: string): Promise<CompareInput> => {
    const session = await store.getSession(id);
    if (!session) throw new Error('Swing not found.');
    const [videoUrl, track] = await Promise.all([loadVideo(id), store.getTrack(id)]);
    return { session, videoUrl, track: track ?? null };
  };
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const view = new CompareView(ia, ib, goHome);
  show(view, [ia.videoUrl, ib.videoUrl]);
  await view.init();
}

// ---- Import ------------------------------------------------------------------

async function importFile(file: File) {
  const url = URL.createObjectURL(file);
  let info;
  let thumb: Blob | null = null;
  try {
    info = await probeVideo(url);
    thumb = await thumbnailFromUrl(url);
  } catch (e) {
    toast((e as Error).message, 5000);
    return;
  } finally {
    URL.revokeObjectURL(url);
  }
  const session: Session = {
    id: crypto.randomUUID(),
    name: defaultName(file),
    createdAt: Date.now(),
    ...info,
    settings: { ...DEFAULT_SETTINGS, ...lastSettings() },
    phases: {},
    manualPhases: [],
    shapes: [],
    poseFps: 0,
  };
  memVideos.set(session.id, file);
  freshIds.add(session.id);
  try {
    await store.putSession(session);
    if (thumb) store.putThumb(session.id, thumb).catch(() => {});
    void store.requestPersistence();
    // Large slow-mo clips can take a moment to write; don't block opening.
    store.putVideo(session.id, file).catch((e) => {
      toast(
        (e as DOMException)?.name === 'QuotaExceededError'
          ? 'Not enough storage to keep this video. Delete old swings to free space.'
          : `Could not save video: ${(e as Error).message}`,
        6000,
      );
    });
  } catch (e) {
    toast(`Could not save: ${(e as Error).message}`, 5000);
  }
  navigate(`#/s/${session.id}`);
}

function defaultName(file: File) {
  const base = file.name.replace(/\.[^.]+$/, '');
  // Camera captures get generic names like "IMG_1234" or "capturedvideo".
  if (!base || /^(img|vid|mov|captured|video|trim)/i.test(base)) {
    const d = new Date();
    return `Swing ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
  return base;
}

// ---- Service worker ------------------------------------------------------------

if (import.meta.env.PROD) {
  const updateSW = registerSW({
    immediate: true,
    onOfflineReady() {
      toast('Ready to work offline');
    },
    onNeedRefresh() {
      // Prompt rather than auto-reload so an analysis in progress isn't lost.
      const bar = h(
        'div',
        { class: 'update-bar' },
        h('span', {}, 'A new version is available.'),
        h('button', { class: 'btn small primary', onclick: () => void updateSW(true) }, 'Reload'),
        h('button', { class: 'btn small', onclick: () => bar.remove() }, 'Later'),
      );
      document.body.append(bar);
    },
  });
}

window.addEventListener('hashchange', () => void route());
void route();

// Dev-only hooks so automated checks can drive the app without the file picker.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __importFile: importFile,
    __current: () => current,
    __compare: async (a: CompareInput, b: CompareInput) => {
      const v = new CompareView(a, b, goHome);
      show(v);
      await v.init();
    },
  });
}
