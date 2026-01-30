import type { APIRoute } from 'astro';
import { loadFromCache, saveToCache, fetchFromGoogleSheets } from '../../utils/googleSheetsManager';

console.log('[api/theatre-works] module imported');

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

    const cached = await loadFromCache();
    if (cached && Array.isArray(cached) && cached.length > 0) {
      try {
        console.log('[api/theatre-works] returning cached works count=', cached.length, 'sample=', JSON.stringify(cached[0]));
      } catch (e) {
        console.log('[api/theatre-works] returning cached works count=', cached.length);
      }
      return new Response(JSON.stringify(cached), { headers: { 'Content-Type': 'application/json' } });
    }

    console.log('[api/theatre-works] cache empty, attempting fetchFromGoogleSheets() with timeout');
    // Wrap fetch call in timeout promise so it can't hang the handler indefinitely.
    const fetchPromise = fetchFromGoogleSheets();
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('fetch timeout')), 8000));
    const fresh = await Promise.race([fetchPromise, timeout]);

    if (fresh && Array.isArray(fresh)) {
      await saveToCache(fresh);
      console.log('[api/theatre-works] fetched and cached works count=', fresh.length);
    }

    return new Response(JSON.stringify(fresh || []), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const stack = (err as any)?.stack ?? String(err);
    console.error('[api/theatre-works] error in GET handler', stack);
    return new Response(JSON.stringify({ error: 'Failed to load theatre works', detail: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
