/// <reference lib="webworker" />
import { PoseEngine, type ModelName } from './engine';
import type { WorkerRequest, WorkerResponse } from './protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let engine: PoseEngine | null = null;
let engineModel: ModelName | null = null;

function reply(msg: WorkerResponse, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer);
}

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init': {
        if (!engine || engineModel !== msg.model) {
          engine?.close();
          engine = await PoseEngine.create(msg.model, msg.origin);
          engineModel = msg.model;
        }
        engine.beginClip();
        reply({ type: 'ready', delegate: engine.delegate });
        break;
      }
      case 'frame': {
        if (!engine) throw new Error('Pose engine not initialised');
        const result = engine.detect(msg.bitmap, msg.timeMs);
        msg.bitmap.close();
        if (result) reply({ type: 'result', id: msg.id, landmarks: result }, [result.buffer]);
        else reply({ type: 'result', id: msg.id, landmarks: null });
        break;
      }
    }
  } catch (err) {
    reply({ type: 'error', id: 'id' in msg ? msg.id : undefined, message: String((err as Error)?.message ?? err) });
  }
};
