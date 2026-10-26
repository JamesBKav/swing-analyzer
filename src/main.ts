import './styles.css';
import { HomeView } from './ui/homeView';
import { AnalyzeView } from './ui/analyzeView';
import { probeVideo } from './capture/capture';
import { toast } from './ui/toast';
import { DEFAULT_SETTINGS, type Session } from './types';

const app = document.querySelector<HTMLDivElement>('#app')!;

// iOS Safari ignores user-scalable=no; block pinch zoom on the app chrome.
document.addEventListener('gesturestart', (e) => e.preventDefault());

let current: { el: HTMLElement; destroy?: () => void } | null = null;
function show(view: { el: HTMLElement; destroy?: () => void }) {
  current?.destroy?.();
  app.replaceChildren(view.el);
  current = view;
}

function showHome() {
  show(new HomeView({ onVideo: openFile }));
}

async function openFile(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const info = await probeVideo(url);
    const session: Session = {
      id: crypto.randomUUID(),
      name: file.name.replace(/\.[^.]+$/, '') || 'Swing',
      createdAt: Date.now(),
      ...info,
      settings: { ...DEFAULT_SETTINGS },
      phases: {},
      manualPhases: [],
      shapes: [],
      poseFps: 0,
    };
    const view = new AnalyzeView(session, url, { onBack: showHome, onChange: () => {} }, true);
    show(view);
    await view.init();
  } catch (e) {
    URL.revokeObjectURL(url);
    toast((e as Error).message, 5000);
  }
}

showHome();

// Dev-only hook so automated checks can open a generated clip without the file picker.
if (import.meta.env.DEV) (window as unknown as { __openFile: typeof openFile }).__openFile = openFile;
