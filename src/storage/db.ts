import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Session } from '../types';
import type { PoseTrack } from '../pose/landmarks';

/**
 * Everything is stored on-device in IndexedDB: session metadata, the video
 * itself, the cached pose landmarks and a thumbnail. Nothing leaves the phone.
 */
interface StoredBlob {
  buffer: ArrayBuffer;
  type: string;
}

interface SwingDB extends DBSchema {
  sessions: { key: string; value: Session; indexes: { createdAt: number } };
  videos: { key: string; value: Blob | StoredBlob };
  poses: { key: string; value: PoseTrack };
  thumbs: { key: string; value: Blob | StoredBlob };
}

let dbPromise: Promise<IDBPDatabase<SwingDB>> | null = null;

function db() {
  dbPromise ??= openDB<SwingDB>('swing-analyzer', 1, {
    upgrade(d) {
      const s = d.createObjectStore('sessions', { keyPath: 'id' });
      s.createIndex('createdAt', 'createdAt');
      d.createObjectStore('videos');
      d.createObjectStore('poses');
      d.createObjectStore('thumbs');
    },
  });
  return dbPromise;
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* not supported */
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}

// Some older WebKit builds can't store Blobs in IndexedDB; fall back to bytes.
async function putBlob(store: 'videos' | 'thumbs', id: string, blob: Blob) {
  const d = await db();
  try {
    await d.put(store, blob, id);
  } catch (e) {
    if ((e as DOMException)?.name === 'QuotaExceededError') throw e;
    await d.put(store, { buffer: await blob.arrayBuffer(), type: blob.type }, id);
  }
}

async function getBlob(store: 'videos' | 'thumbs', id: string): Promise<Blob | undefined> {
  const v = await (await db()).get(store, id);
  if (!v) return undefined;
  return v instanceof Blob ? v : new Blob([v.buffer], { type: v.type });
}

export async function listSessions(): Promise<Session[]> {
  const all = await (await db()).getAllFromIndex('sessions', 'createdAt');
  return all.reverse();
}

export async function getSession(id: string) {
  return (await db()).get('sessions', id);
}

export async function putSession(s: Session) {
  // Store a plain clone (no class instances / proxies).
  await (await db()).put('sessions', structuredClone(s));
}

export const putVideo = (id: string, blob: Blob) => putBlob('videos', id, blob);
export const getVideo = (id: string) => getBlob('videos', id);
export const putThumb = (id: string, blob: Blob) => putBlob('thumbs', id, blob);
export const getThumb = (id: string) => getBlob('thumbs', id);

export async function putTrack(id: string, track: PoseTrack) {
  await (await db()).put('poses', track, id);
}

export async function getTrack(id: string): Promise<PoseTrack | undefined> {
  return (await db()).get('poses', id);
}

export async function deleteSession(id: string) {
  const d = await db();
  const tx = d.transaction(['sessions', 'videos', 'poses', 'thumbs'], 'readwrite');
  await Promise.all([
    tx.objectStore('sessions').delete(id),
    tx.objectStore('videos').delete(id),
    tx.objectStore('poses').delete(id),
    tx.objectStore('thumbs').delete(id),
    tx.done,
  ]);
}

/** Debounced session saver so rapid edits (drawing, settings) batch up. */
export function sessionSaver(delay = 400) {
  let timer = 0;
  let pending: Session | null = null;
  const flush = async () => {
    clearTimeout(timer);
    if (!pending) return;
    const s = pending;
    pending = null;
    try {
      await putSession(s);
    } catch (e) {
      console.error('Failed to save session', e);
    }
  };
  return {
    save(s: Session) {
      pending = s;
      clearTimeout(timer);
      timer = window.setTimeout(flush, delay);
    },
    flush,
  };
}
