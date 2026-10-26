import { seekVideo } from '../player/player';
import { FRAME_FLOATS, type PoseTrack } from './landmarks';
import type { ModelName, PoseEngine } from './engine';
import type { WorkerRequest, WorkerResponse } from './protocol';

export interface AnalyzeOptions {
  videoUrl: string;
  /** Decoded frame rate of the file. */
  fps: number;
  /** Real seconds per media second (see SessionSettings.timeScale). */
  timeScale: number;
  model: ModelName;
  onProgress?: (done: number, total: number, info: { delegate: string; inWorker: boolean }) => void;
  signal?: AbortSignal;
}

/** Target analysis rate in real-time samples per second. */
export const ANALYSIS_REAL_HZ = 60;
/** Upper bound on analysed frames (memory/time on phones). */
export const MAX_SAMPLES = 900;
/** Long side of the frames sent to the model (it works at 256px internally). */
const ANALYSIS_SIDE = 480;

/**
 * Pick which media times to analyse. Long or high-fps clips are downsampled
 * to ~60 real-time Hz and capped at MAX_SAMPLES.
 */
export function sampleTimes(duration: number, fps: number, timeScale: number): number[] {
  let rate = Math.min(fps, ANALYSIS_REAL_HZ * timeScale);
  if (duration * rate > MAX_SAMPLES) rate = MAX_SAMPLES / duration;
  const step = Math.max(1, Math.round(fps / rate)); // in video frames
  const total = Math.floor(duration * fps);
  const times: number[] = [];
  for (let f = 0; f < total; f += step) times.push((f + 0.5) / fps);
  return times;
}

interface Runner {
  delegate: string;
  inWorker: boolean;
  detect(bitmap: ImageBitmap, timeMs: number): Promise<Float32Array | null>;
  dispose(): void;
}

// The worker is kept alive between analyses so the model loads only once.
let sharedWorker: Worker | null = null;
let workerBroken = false;

async function workerRunner(model: ModelName): Promise<Runner> {
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL('./pose.worker.ts', import.meta.url), { type: 'module', name: 'pose' });
  }
  const w = sharedWorker;
  const pending = new Map<number, { resolve: (v: Float32Array | null) => void; reject: (e: Error) => void }>();
  let nextId = 1;
  let onReady: ((d: string) => void) | null = null;
  let onInitError: ((e: Error) => void) | null = null;

  w.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const m = e.data;
    if (m.type === 'ready') onReady?.(m.delegate);
    else if (m.type === 'result') {
      pending.get(m.id)?.resolve(m.landmarks);
      pending.delete(m.id);
    } else if (m.type === 'error') {
      if (m.id !== undefined && pending.has(m.id)) {
        pending.get(m.id)!.reject(new Error(m.message));
        pending.delete(m.id);
      } else onInitError?.(new Error(m.message));
    }
  };
  w.onerror = (e) => {
    const err = new Error(e.message || 'Pose worker crashed');
    onInitError?.(err);
    pending.forEach((p) => p.reject(err));
    pending.clear();
  };

  const delegate = await new Promise<string>((resolve, reject) => {
    onReady = resolve;
    onInitError = reject;
    const msg: WorkerRequest = { type: 'init', model, origin: location.origin };
    w.postMessage(msg);
  });

  return {
    delegate,
    inWorker: true,
    detect(bitmap, timeMs) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const msg: WorkerRequest = { type: 'frame', id, bitmap, timeMs };
        w.postMessage(msg, [bitmap]);
      });
    },
    dispose() {
      pending.clear();
    },
  };
}

let inlineEngine: { model: ModelName; engine: PoseEngine } | null = null;

async function inlineRunner(model: ModelName): Promise<Runner> {
  if (!inlineEngine || inlineEngine.model !== model) {
    inlineEngine?.engine.close();
    const { PoseEngine } = await import('./engine');
    inlineEngine = { model, engine: await PoseEngine.create(model, location.origin) };
  }
  const engine = inlineEngine.engine;
  engine.beginClip();
  return {
    delegate: engine.delegate,
    inWorker: false,
    async detect(bitmap, timeMs) {
      const r = engine.detect(bitmap, timeMs);
      bitmap.close();
      // Yield so the UI can repaint the progress bar.
      await new Promise((res) => setTimeout(res, 0));
      return r;
    },
    dispose() {},
  };
}

async function getRunner(model: ModelName): Promise<Runner> {
  if (!workerBroken && typeof Worker !== 'undefined') {
    try {
      return await workerRunner(model);
    } catch (e) {
      console.warn('Pose worker unavailable, falling back to main thread', e);
      workerBroken = true;
      sharedWorker?.terminate();
      sharedWorker = null;
    }
  }
  return inlineRunner(model);
}

/** Load a hidden video element for frame extraction (kept in the DOM for iOS). */
async function loadHiddenVideo(url: string): Promise<HTMLVideoElement> {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.preload = 'auto';
  v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
  document.body.append(v);
  v.src = url;
  await new Promise<void>((resolve, reject) => {
    v.addEventListener('loadeddata', () => resolve(), { once: true });
    v.addEventListener('error', () => reject(new Error('Could not decode video for analysis')), { once: true });
  });
  return v;
}

/** Run pose detection across the clip and return the landmark track. */
export async function analyzeVideo(opts: AnalyzeOptions): Promise<PoseTrack> {
  const video = await loadHiddenVideo(opts.videoUrl);
  let runner: Runner | null = null;
  try {
    runner = await getRunner(opts.model);
    const times = sampleTimes(video.duration, opts.fps, opts.timeScale);
    const data = new Float32Array(times.length * FRAME_FLOATS).fill(NaN);
    const scale = Math.min(1, ANALYSIS_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: false })!;
    const info = { delegate: runner.delegate, inWorker: runner.inWorker };

    // Pipeline: decode/seek frame i+1 while the model works on frame i.
    let inflight: Promise<void> | null = null;
    for (let i = 0; i < times.length; i++) {
      if (opts.signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
      await seekVideo(video, times[i], false);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const bitmap = await createImageBitmap(canvas);
      if (inflight) await inflight;
      const idx = i;
      inflight = runner.detect(bitmap, times[i] * 1000).then((lm) => {
        if (lm) data.set(lm, idx * FRAME_FLOATS);
        opts.onProgress?.(idx + 1, times.length, info);
      });
    }
    if (inflight) await inflight;

    return {
      times: Float32Array.from(times),
      data,
      aspect: video.videoWidth / video.videoHeight,
      rate: times.length > 1 ? (times.length - 1) / (times[times.length - 1] - times[0]) : opts.fps,
    };
  } finally {
    runner?.dispose();
    video.removeAttribute('src');
    video.load();
    video.remove();
  }
}
