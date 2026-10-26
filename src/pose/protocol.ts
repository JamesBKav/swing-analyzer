import type { ModelName } from './engine';

export type WorkerRequest =
  | { type: 'init'; model: ModelName; origin: string }
  | { type: 'frame'; id: number; bitmap: ImageBitmap; timeMs: number };

export type WorkerResponse =
  | { type: 'ready'; delegate: 'GPU' | 'CPU' }
  | { type: 'result'; id: number; landmarks: Float32Array | null }
  | { type: 'error'; id?: number; message: string };
