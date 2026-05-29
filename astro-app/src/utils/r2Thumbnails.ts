/** Derive paired R2 JPEG URL from an MP4 URL (same path, .jpg extension). */
export function deriveAutoThumbnailUrl(videoUrl: string): string | undefined {
  if (!videoUrl) return undefined;
  try {
    const u = new URL(videoUrl);
    if (!u.hostname.endsWith('.r2.dev')) return undefined;
    if (!/\.mp4$/i.test(u.pathname)) return undefined;
    u.pathname = u.pathname.replace(/\.mp4$/i, '.jpg');
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return undefined;
  }
}
