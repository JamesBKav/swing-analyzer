// Copies the MediaPipe WASM runtime from node_modules into public/ so it is
// served (and precached) from our own origin. Runs on npm install.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const dest = join(root, 'public', 'mediapipe', 'wasm');

if (!existsSync(src)) {
  console.warn('[copy-mediapipe] tasks-vision wasm folder not found, skipping');
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
// Only the ES-module build is needed (loaded from a module worker).
for (const f of ['vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm']) {
  cpSync(join(src, f), join(dest, f));
}
console.log('[copy-mediapipe] copied wasm runtime to public/mediapipe/wasm');
