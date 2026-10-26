/**
 * Video capture/import via the native file picker. On iOS,
 * capture="environment" opens the camera directly; without it the user can
 * pick from the photo library (including 120/240fps slow-mo clips).
 */
export function pickVideo(opts: { capture?: boolean } = {}): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    if (opts.capture) input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    document.body.append(input);
    const done = (f: File | null) => {
      input.remove();
      resolve(f);
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
}

/** Read basic metadata without keeping a player around. */
export function probeVideo(url: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight });
      v.removeAttribute('src');
      v.load();
    };
    v.onerror = () => reject(new Error('Could not read this video. Try exporting it as H.264 (Most Compatible).'));
    v.src = url;
  });
}

/** Small JPEG thumbnail of the frame currently shown in a video. */
export async function captureThumbnail(video: HTMLVideoElement, maxSide = 240): Promise<Blob | null> {
  const s = maxSide / Math.max(video.videoWidth, video.videoHeight);
  const c = document.createElement('canvas');
  c.width = Math.round(video.videoWidth * s);
  c.height = Math.round(video.videoHeight * s);
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob((b) => r(b), 'image/jpeg', 0.75));
}
