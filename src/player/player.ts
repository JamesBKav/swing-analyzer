/**
 * Frame-accurate wrapper around a <video> element.
 *
 * - Native playback for 0.25x–1x, driven by requestVideoFrameCallback when
 *   available so overlays get the exact presented frame time.
 * - Below 0.25x (or when native slow rates misbehave) it switches to
 *   "stepped" playback: pausing and seeking frame by frame on a clock.
 * - Seeks are coalesced so fast scrubbing never queues up stale seeks.
 *
 * Events: 'time' (displayed frame changed), 'state' (play/pause/rate), 'loaded'.
 */

export const SPEEDS = [0.1, 0.25, 0.5, 1] as const;
const MIN_NATIVE_RATE = 0.25;

type VideoWithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number; presentedFrames: number }) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

export const hasRVFC = typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

export class VideoPlayer extends EventTarget {
  readonly video: VideoWithRVFC;
  fps = 30;
  /** Time of the frame currently on screen (seconds). */
  displayTime = 0;
  private _rate = 1;
  private _playing = false;
  private stepTimer = 0;
  private frameCbId = 0;
  private rafId = 0;
  private seekTarget: number | null = null;
  private internalPauseAt = 0;
  private lastRequested = 0;
  private seekPromise: Promise<void> | null = null;

  constructor(video?: HTMLVideoElement) {
    super();
    const v = (video ?? document.createElement('video')) as VideoWithRVFC;
    // iOS: inline playback + muted are required for programmatic play.
    v.playsInline = true;
    v.muted = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.setAttribute('muted', '');
    v.preload = 'auto';
    v.disablePictureInPicture = true;
    v.addEventListener('ended', () => this.setPlaying(false));
    // External pauses (e.g. iOS backgrounding the app) end playback; ignore
    // the pause events our own mode switches cause.
    v.addEventListener('pause', () => {
      if (performance.now() - this.internalPauseAt < 400) return;
      if (this._playing && !this.stepTimer) this.setPlaying(false);
    });
    this.video = v;
  }

  get duration() {
    return Number.isFinite(this.video.duration) ? this.video.duration : 0;
  }
  get frameDuration() {
    return 1 / this.fps;
  }
  get frameCount() {
    return Math.max(1, Math.round(this.duration * this.fps));
  }
  get playing() {
    return this._playing;
  }
  get rate() {
    return this._rate;
  }

  frameIndex(t = this.displayTime) {
    return Math.min(this.frameCount - 1, Math.max(0, Math.floor(t * this.fps + 1e-3)));
  }

  /** Media time at the middle of frame n, the safest place to seek to. */
  frameTime(n: number) {
    const clamped = Math.min(this.frameCount - 1, Math.max(0, n));
    return Math.min(this.duration, (clamped + 0.5) / this.fps);
  }

  async load(src: string): Promise<void> {
    this.pause();
    const v = this.video;
    v.src = src;
    v.load();
    await new Promise<void>((resolve, reject) => {
      const ok = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error('This video could not be decoded on this device.')); };
      const cleanup = () => { v.removeEventListener('loadeddata', ok); v.removeEventListener('error', fail); };
      v.addEventListener('loadeddata', ok);
      v.addEventListener('error', fail);
    });
    this.displayTime = v.currentTime;
    this.dispatchEvent(new Event('loaded'));
    this.emitTime();
  }

  setRate(rate: number) {
    this._rate = rate;
    if (this._playing) {
      // Restart in the right mode for the new rate.
      this.stopLoops();
      this.internalPause();
      this.startPlayback();
    }
    this.dispatchEvent(new Event('state'));
  }

  async play() {
    if (this._playing) return;
    if (this.displayTime >= this.duration - this.frameDuration * 1.5) await this.seek(0);
    this.setPlaying(true);
    this.startPlayback();
  }

  pause() {
    if (!this._playing) return;
    this.stopLoops();
    this.internalPause();
    this.setPlaying(false);
    // Snap the paused position to the frame that is showing.
    this.displayTime = this.video.currentTime;
    this.emitTime();
  }

  toggle() {
    if (this._playing) this.pause();
    else void this.play();
  }

  /** Step n frames (negative = back). Pauses playback. */
  async step(n: number) {
    if (this._playing) this.pause();
    // Build on a seek that is still in flight so rapid taps all count.
    const from = this.seekPromise ? this.lastRequested : this.displayTime;
    const target = this.frameTime(this.frameIndex(from) + n);
    await this.seek(target);
  }

  /** Seek to t seconds. Rapid calls coalesce: only the latest target is honoured. */
  seek(t: number): Promise<void> {
    this.seekTarget = Math.min(Math.max(0, t), this.duration);
    this.lastRequested = this.seekTarget;
    if (!this.seekPromise) {
      this.seekPromise = this.drainSeeks().finally(() => {
        this.seekPromise = null;
      });
    }
    return this.seekPromise;
  }

  /** Seek to the frame containing time t. */
  seekFrameAt(t: number) {
    return this.seek(this.frameTime(Math.floor(t * this.fps + 1e-3)));
  }

  private async drainSeeks() {
    while (this.seekTarget !== null) {
      const t = this.seekTarget;
      this.seekTarget = null;
      await seekVideo(this.video, t);
      this.displayTime = t;
      this.emitTime();
    }
  }

  private startPlayback() {
    if (this._rate >= MIN_NATIVE_RATE) this.startNative();
    else this.startStepped();
  }

  private startNative() {
    const v = this.video;
    v.playbackRate = this._rate;
    v.play().catch(() => {
      // Some browsers reject odd rates or block play; fall back to stepping.
      if (this._playing) this.startStepped();
    });
    if (v.requestVideoFrameCallback) {
      const onFrame = (_now: number, meta: { mediaTime: number }) => {
        this.displayTime = meta.mediaTime;
        this.emitTime();
        if (this._playing) this.frameCbId = v.requestVideoFrameCallback!(onFrame);
      };
      this.frameCbId = v.requestVideoFrameCallback(onFrame);
    } else {
      const tick = () => {
        if (!this._playing) return;
        if (v.currentTime !== this.displayTime) {
          this.displayTime = v.currentTime;
          this.emitTime();
        }
        this.rafId = requestAnimationFrame(tick);
      };
      this.rafId = requestAnimationFrame(tick);
    }
  }

  /** Seek-driven playback for very slow rates: exact frames, no decoder tricks. */
  private startStepped() {
    this.internalPause();
    const startMedia = this.displayTime;
    const startWall = performance.now();
    const loop = async () => {
      if (!this._playing) return;
      const elapsed = (performance.now() - startWall) / 1000;
      const t = startMedia + elapsed * this._rate;
      if (t >= this.duration - this.frameDuration * 0.5) {
        await this.seek(this.frameTime(this.frameCount - 1));
        this.pause();
        return;
      }
      const target = this.frameTime(Math.floor(t * this.fps));
      if (Math.abs(target - this.displayTime) > 1e-4) await this.seek(target);
      if (this._playing) this.stepTimer = window.setTimeout(loop, 8);
    };
    this.stepTimer = window.setTimeout(loop, 0);
  }

  private stopLoops() {
    if (this.stepTimer) clearTimeout(this.stepTimer);
    this.stepTimer = 0;
    if (this.frameCbId && this.video.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this.frameCbId);
    this.frameCbId = 0;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private internalPause() {
    this.internalPauseAt = performance.now();
    this.video.pause();
  }

  private setPlaying(p: boolean) {
    if (this._playing === p) return;
    this._playing = p;
    if (!p) this.stopLoops();
    this.dispatchEvent(new Event('state'));
  }

  private emitTime() {
    this.dispatchEvent(new Event('time'));
  }

  destroy() {
    this.stopLoops();
    this.internalPause();
    this.video.removeAttribute('src');
    this.video.load();
  }
}

/**
 * Seek a video and resolve once the new frame is actually ready to draw.
 * Safari can fire 'seeked' before the frame is decoded, so we also wait for
 * a presented frame where requestVideoFrameCallback exists.
 */
export function seekVideo(video: HTMLVideoElement, t: number): Promise<void> {
  const v = video as VideoWithRVFC;
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeEventListener('seeked', onSeeked);
      resolve();
    };
    const onSeeked = () => {
      if (v.requestVideoFrameCallback) {
        v.requestVideoFrameCallback(() => finish());
        // rVFC may not fire for a paused, hidden video; don't hang.
        setTimeout(finish, 120);
      } else {
        finish();
      }
    };
    const timer = setTimeout(finish, 3000);
    if (Math.abs(v.currentTime - t) < 1e-6 && !v.seeking) {
      finish();
      return;
    }
    v.addEventListener('seeked', onSeeked);
    v.currentTime = t;
  });
}

const COMMON_FPS = [24, 25, 30, 48, 50, 60, 90, 100, 120, 240];

/**
 * Estimate the clip's frame rate by playing it slowly and reading the gaps
 * between presented frame timestamps. Returns null if it can't tell.
 */
export async function detectFps(video: HTMLVideoElement): Promise<number | null> {
  const v = video as VideoWithRVFC;
  if (!v.requestVideoFrameCallback) return null;
  const times: number[] = [];
  const prevRate = v.playbackRate;
  const start = v.currentTime;
  try {
    v.playbackRate = 0.2; // slow enough to present every frame of 240fps on a 60Hz screen
    await v.play();
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 1500);
      const cb = (_n: number, meta: { mediaTime: number }) => {
        times.push(meta.mediaTime);
        if (times.length >= 20) {
          clearTimeout(timeout);
          resolve();
        } else v.requestVideoFrameCallback!(cb);
      };
      v.requestVideoFrameCallback!(cb);
    });
  } catch {
    return null;
  } finally {
    v.pause();
    v.playbackRate = prevRate;
    await seekVideo(v, start);
  }
  const deltas = times
    .slice(1)
    .map((t, i) => t - times[i])
    .filter((d) => d > 1e-4)
    .sort((a, b) => a - b);
  if (deltas.length < 3) return null;
  // The smallest gaps are single-frame steps; take their median for robustness.
  const small = deltas.slice(0, Math.max(3, Math.floor(deltas.length / 2)));
  const dt = small[Math.floor(small.length / 2)];
  const raw = 1 / dt;
  const snap = COMMON_FPS.find((f) => Math.abs(f - raw) / f < 0.06);
  return snap ?? Math.round(raw);
}
