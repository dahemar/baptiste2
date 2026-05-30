import { uploadImageToR2 } from './r2Uploader';

const cache = new Map<string, { url: string | null; ts: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

function isBandcampUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname.endsWith('.bandcamp.com');
  } catch {
    return false;
  }
}

function extractCoverFromHtml(html: string): string | null {
  const flat = html.replace(/\n/g, ' ');

  const ogImgMeta = flat.match(/<meta\s+[^>]*property\s*=\s*"og:image"[^>]*>/i);
  if (ogImgMeta) {
    const content = ogImgMeta[0].match(/content\s*=\s*"([^"]+)"/i);
    if (content) return content[1];
  }

  const metaContent = flat.match(/<meta\s+[^>]*content\s*=\s*"([^"]+)"[^>]*property\s*=\s*"og:image"[^>]*>/i);
  if (metaContent) return metaContent[1];

  const imageSrc = flat.match(/<link\s+rel="image_src"\s+href="([^"]+)"/i);
  if (imageSrc) return imageSrc[1];

  const popupImg = flat.match(/<a\s+class="popupImage"\s+href="([^"]+)"/i);
  if (popupImg) return popupImg[1];

  return null;
}

async function downloadImage(url: string, timeoutMs = 10000): Promise<Buffer | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

/** Public R2 URL for a music cover key */
export function musicCoverR2Url(releaseId: string): string {
  return `https://pub-f04cf0f8494f457e889559aa0b6e57b7.r2.dev/music-covers/${encodeURIComponent(releaseId)}.jpg`;
}

export async function scrapeAndUploadBandcampCover(
  releaseId: string,
  bandcampUrl: string,
  timeoutMs = 10000,
): Promise<string | null> {
  const r2Key = `music-covers/${releaseId}.jpg`;
  const r2Url = musicCoverR2Url(releaseId);

  const cached = cache.get(bandcampUrl);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.url;

  try {
    // 1. Scrape the cover URL from Bandcamp HTML
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const pageRes = await fetch(bandcampUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bandcamp-cover-bot)' },
    });
    clearTimeout(timer);
    if (!pageRes.ok) {
      cache.set(bandcampUrl, { url: null, ts: Date.now() });
      return null;
    }

    const html = await pageRes.text();
    const coverUrl = extractCoverFromHtml(html);
    if (!coverUrl) {
      cache.set(bandcampUrl, { url: null, ts: Date.now() });
      return null;
    }

    // 2. Download the cover image
    const imageBuffer = await downloadImage(coverUrl, timeoutMs);
    if (!imageBuffer || imageBuffer.length === 0) {
      cache.set(bandcampUrl, { url: null, ts: Date.now() });
      return null;
    }

    // 3. Upload to R2 (dev only; in Vercel production, return the original URL)
    if (process.env.VERCEL) {
      cache.set(bandcampUrl, { url: coverUrl, ts: Date.now() });
      return coverUrl;
    }

    try {
      await uploadImageToR2(r2Key, imageBuffer);
      cache.set(bandcampUrl, { url: r2Url, ts: Date.now() });
      return r2Url;
    } catch {
      // R2 upload failed — fall back to original Bandcamp URL
      cache.set(bandcampUrl, { url: coverUrl, ts: Date.now() });
      return coverUrl;
    }
  } catch {
    cache.set(bandcampUrl, { url: null, ts: Date.now() });
    return null;
  }
}

export async function batchFetchBandcampCovers(
  releases: Array<{ id: string; url: string }>,
  timeoutMs = 10000,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  const bandcampReleases = releases.filter((r) => isBandcampUrl(r.url));
  if (bandcampReleases.length === 0) return results;

  const fetched = await Promise.all(
    bandcampReleases.map(async (r) => {
      try {
        const cover = await scrapeAndUploadBandcampCover(r.id, r.url, timeoutMs);
        return { id: r.id, cover };
      } catch {
        return { id: r.id, cover: null };
      }
    }),
  );

  for (const { id, cover } of fetched) {
    if (cover) results.set(id, cover);
  }

  return results;
}

export function clearBandcampCache() {
  cache.clear();
}
