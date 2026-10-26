import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { FRAME_FLOATS, NUM_LANDMARKS, STRIDE } from './landmarks';

export type ModelName = 'full' | 'lite';

/** Absolute URLs of the locally bundled MediaPipe assets. */
export function assetUrls(model: ModelName, origin: string) {
  const base = new URL(import.meta.env.BASE_URL, origin);
  return {
    wasm: new URL('mediapipe/wasm', base).href,
    model: new URL(`models/pose_landmarker_${model}.task`, base).href,
  };
}

/**
 * Thin wrapper around PoseLandmarker in VIDEO mode. Works on the main thread
 * or inside a worker. Tries the GPU delegate first, then CPU.
 */
export class PoseEngine {
  private lastTs = -1;
  private base = 0;

  private constructor(private lm: PoseLandmarker, readonly delegate: 'GPU' | 'CPU') {}

  static async create(model: ModelName, origin: string): Promise<PoseEngine> {
    const urls = assetUrls(model, origin);
    // useModule=true loads the ES-module wasm build, which works in module workers.
    const fileset = await FilesetResolver.forVisionTasks(urls.wasm, true);
    let lastErr: unknown;
    for (const delegate of ['GPU', 'CPU'] as const) {
      try {
        const lm = await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: urls.model, delegate },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
          outputSegmentationMasks: false,
        });
        return new PoseEngine(lm, delegate);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Could not start pose model');
  }

  /** Call before each new clip so VIDEO-mode timestamps keep increasing. */
  beginClip() {
    this.base = this.lastTs + 1000;
  }

  /** Returns 33×(x,y,z,visibility) or null when no person is found. */
  detect(image: ImageBitmap | HTMLCanvasElement | HTMLVideoElement, timeMs: number): Float32Array | null {
    const ts = Math.max(this.lastTs + 1, Math.round(this.base + timeMs));
    this.lastTs = ts;
    const res = this.lm.detectForVideo(image, ts);
    const pts = res.landmarks?.[0];
    if (!pts || pts.length < NUM_LANDMARKS) return null;
    const out = new Float32Array(FRAME_FLOATS);
    for (let i = 0; i < NUM_LANDMARKS; i++) {
      const p = pts[i];
      out[i * STRIDE] = p.x;
      out[i * STRIDE + 1] = p.y;
      out[i * STRIDE + 2] = p.z;
      out[i * STRIDE + 3] = p.visibility ?? 1;
    }
    return out;
  }

  close() {
    this.lm.close();
  }
}
