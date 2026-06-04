/** Draw the current video frame to a JPEG data URL (needs CORS when cross-origin). */
export function capturePosterDataUrl(
  video: HTMLVideoElement,
  maxWidth = 480,
  quality = 0.78,
): string | null {
  try {
    const vw = video.videoWidth || 0;
    const vh = video.videoHeight || 0;
    if (vw < 2 || vh < 2) return null;
    const scale = Math.min(1, maxWidth / vw);
    const cw = Math.max(1, Math.round(vw * scale));
    const ch = Math.max(1, Math.round(vh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, cw, ch);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return null;
  }
}

export function sceneVideoSource(scene?: {
  videoUrl?: string;
  proxiedVideoUrl?: string;
} | null): string {
  return String(scene?.proxiedVideoUrl || scene?.videoUrl || '').trim();
}
