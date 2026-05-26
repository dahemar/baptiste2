import type { APIRoute } from 'astro';
import { loadFromCache, saveToCache, fetchFromGoogleSheets, clearMemoryCache } from '../../utils/googleSheetsManager';

export const prerender = false;

console.log('[api/theatre-works] module imported');

const OLD_R2_PUBLIC_HOST = 'pub-16fb774f4ada4a69b6c70bc856201eeb.r2.dev';
const NEW_R2_PUBLIC_HOST = 'pub-f04cf0f8494f457e889559aa0b6e57b7.r2.dev';

function rewriteR2PublicUrlIfNeeded(url: string): string {
  if (!url || typeof url !== 'string') return url;
  try {
    const u = new URL(url);
    if (u.hostname === OLD_R2_PUBLIC_HOST) {
      u.hostname = NEW_R2_PUBLIC_HOST;
      u.protocol = 'https:';
      return u.toString();
    }
  } catch {
    // ignore
  }
  return url;
}

function rewritePossiblyProxiedUrl(url: string): string {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('/api/proxy/')) {
    const encoded = url.slice('/api/proxy/'.length);
    try {
      const decoded = decodeURIComponent(encoded);
      // Always prefer returning the canonical upstream URL rather than the proxy path.
      // This prevents Vercel from streaming large binaries (videos) and reduces origin transfer.
      const rewritten = rewriteR2PublicUrlIfNeeded(decoded);
      if (rewritten.startsWith('http://') || rewritten.startsWith('https://')) return rewritten;
    } catch {
      // ignore
    }
    return url;
  }
  return rewriteR2PublicUrlIfNeeded(url);
}

function shouldProxyHost(hostname: string) {
  return (
    ['github.com', 'release-assets.githubusercontent.com'].includes(hostname) ||
    hostname.endsWith('.s3.amazonaws.com')
  );
}

function buildProxiedUrl(videoUrl: string) {
  if (!videoUrl || typeof videoUrl !== 'string') return undefined;
  const rewritten = rewritePossiblyProxiedUrl(videoUrl);
  if (rewritten.startsWith('/api/proxy/')) return rewritten;
  try {
    const u = new URL(rewritten);
    if (!shouldProxyHost(u.hostname)) return undefined;
    return `/api/proxy/${encodeURIComponent(rewritten)}`;
  } catch {
    return undefined;
  }
}

function normalizeWorksForProxy<T extends any[]>(works: T): T {
  const allowProxyUrls = !process.env.VERCEL;
  return (works || []).map((work: any) => {
    const scenes = Array.isArray(work?.scenes) ? work.scenes : [];
    const normalizedScenes = scenes.map((scene: any) => {
      const rawVideoUrl = typeof scene?.videoUrl === 'string' ? rewritePossiblyProxiedUrl(scene.videoUrl) : '';
      const existingProxied = typeof scene?.proxiedVideoUrl === 'string'
        ? rewritePossiblyProxiedUrl(scene.proxiedVideoUrl)
        : undefined;

      const computedProxied = allowProxyUrls ? (existingProxied || buildProxiedUrl(rawVideoUrl)) : undefined;
      const canonicalVideoUrl = rawVideoUrl;

      const { thumbnail: _ignoredThumb, ...sceneWithoutThumb } = scene || {};
      return {
        ...sceneWithoutThumb,
        videoUrl: canonicalVideoUrl,
        proxiedVideoUrl: computedProxied,
      };
    });

    return {
      ...work,
      scenes: normalizedScenes,
    };
  }) as T;
}

export const GET: APIRoute = async (context) => {
  console.log('[api/theatre-works] GET handler called', { url: context?.request?.url?.toString?.() });

  const jsonHeaders = {
    'Content-Type': 'application/json',
    // This endpoint is dynamic (Google Sheets as source of truth). Avoid caching empty/stale responses on Vercel.
    'Cache-Control': 'no-store',
  };
  // TEMPORARY: quick cache-first responder with small timeout on remote fetch.
  try {
    const url = new URL(context.request.url);
    const force = url.searchParams.get('force');
    if (force === '1') {
      console.log('[api/theatre-works] force refresh requested, clearing memory cache');
      try { clearMemoryCache(); } catch (e) { /* ignore */ }
    }

    const isVercel = !!process.env.VERCEL;
    if (isVercel) {
      console.log('[api/theatre-works] vercel runtime: fetching from Google Sheets (no disk cache)');
      const fetchPromise = fetchFromGoogleSheets();
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('fetch timeout')), 8000));
      const fresh = await Promise.race([fetchPromise, timeout]);
      if (fresh && Array.isArray(fresh)) {
        const normalized = normalizeWorksForProxy(fresh as any[]);
          return new Response(JSON.stringify(normalized), { headers: jsonHeaders });
      }
        return new Response(JSON.stringify([]), { headers: jsonHeaders });
    }

    console.log('[api/theatre-works] local runtime: attempting fetchFromGoogleSheets() with timeout before cache fallback');
    // Wrap fetch call in timeout promise so it can't hang the handler indefinitely.
    const fetchPromise = fetchFromGoogleSheets();
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('fetch timeout')), 8000));
    const fresh = await Promise.race([fetchPromise, timeout]);

    if (fresh && Array.isArray(fresh)) {
      const normalized = normalizeWorksForProxy(fresh as any[]);
      await saveToCache(normalized);
      console.log('[api/theatre-works] fetched and cached works count=', normalized.length);
        return new Response(JSON.stringify(normalized), { headers: jsonHeaders });
    }

    const cached = force === '1' ? null : await loadFromCache();
    if (cached && Array.isArray(cached) && cached.length > 0) {
      const normalized = normalizeWorksForProxy(cached);
      try {
        console.log('[api/theatre-works] returning cached works count=', normalized.length, 'sample=', JSON.stringify(normalized[0]));
      } catch (e) {
        console.log('[api/theatre-works] returning cached works count=', normalized.length);
      }
        return new Response(JSON.stringify(normalized), { headers: jsonHeaders });
    }

      return new Response(JSON.stringify([]), { headers: jsonHeaders });
  } catch (err) {
    const stack = (err as any)?.stack ?? String(err);
    console.error('[api/theatre-works] error in GET handler', stack);
      return new Response(JSON.stringify({ error: 'Failed to load theatre works', detail: String(err) }), {
      status: 500,
        headers: jsonHeaders,
    });
  }
};
