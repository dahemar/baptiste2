import type { APIRoute } from 'astro';
import { loadFromCache, saveToCache, fetchFromGoogleSheets, clearMemoryCache } from '../../utils/googleSheetsManager';

console.log('[api/theatre-works] module imported');

function shouldProxyHost(hostname: string) {
  return (
    ['github.com', 'release-assets.githubusercontent.com'].includes(hostname) ||
    hostname.endsWith('.s3.amazonaws.com') ||
    hostname.endsWith('.r2.dev')
  );
}

function buildProxiedUrl(videoUrl: string) {
  if (!videoUrl || typeof videoUrl !== 'string') return undefined;
  if (videoUrl.startsWith('/api/proxy/')) return videoUrl;
  try {
    const u = new URL(videoUrl);
    if (!shouldProxyHost(u.hostname)) return undefined;
    return `/api/proxy/${encodeURIComponent(videoUrl)}`;
  } catch {
    return undefined;
  }
}

function normalizeWorksForProxy<T extends any[]>(works: T): T {
  return (works || []).map((work: any) => {
    const scenes = Array.isArray(work?.scenes) ? work.scenes : [];
    const normalizedScenes = scenes.map((scene: any) => {
      const rawVideoUrl = typeof scene?.videoUrl === 'string' ? scene.videoUrl : '';
      const existingProxied = typeof scene?.proxiedVideoUrl === 'string' ? scene.proxiedVideoUrl : undefined;

      const computedProxied = existingProxied || buildProxiedUrl(rawVideoUrl);
      const canonicalVideoUrl = computedProxied || rawVideoUrl;

      return {
        ...scene,
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

  // TEMPORARY: quick cache-first responder with small timeout on remote fetch.
  try {
    const url = new URL(context.request.url);
    const force = url.searchParams.get('force');
    if (force === '1') {
      console.log('[api/theatre-works] force refresh requested, clearing memory cache');
      try { clearMemoryCache(); } catch (e) { /* ignore */ }
    }

    const cached = force === '1' ? null : await loadFromCache();
    if (cached && Array.isArray(cached) && cached.length > 0) {
      const normalized = normalizeWorksForProxy(cached);
      try {
        console.log('[api/theatre-works] returning cached works count=', normalized.length, 'sample=', JSON.stringify(normalized[0]));
      } catch (e) {
        console.log('[api/theatre-works] returning cached works count=', normalized.length);
      }
      return new Response(JSON.stringify(normalized), { headers: { 'Content-Type': 'application/json' } });
    }

    console.log('[api/theatre-works] cache empty, attempting fetchFromGoogleSheets() with timeout');
    // Wrap fetch call in timeout promise so it can't hang the handler indefinitely.
    const fetchPromise = fetchFromGoogleSheets();
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('fetch timeout')), 8000));
    const fresh = await Promise.race([fetchPromise, timeout]);

    if (fresh && Array.isArray(fresh)) {
      const normalized = normalizeWorksForProxy(fresh as any[]);
      await saveToCache(normalized);
      console.log('[api/theatre-works] fetched and cached works count=', normalized.length);
      return new Response(JSON.stringify(normalized), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const stack = (err as any)?.stack ?? String(err);
    console.error('[api/theatre-works] error in GET handler', stack);
    return new Response(JSON.stringify({ error: 'Failed to load theatre works', detail: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
