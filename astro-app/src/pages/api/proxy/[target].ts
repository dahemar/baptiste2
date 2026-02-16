import type { APIRoute } from 'astro';

export const prerender = false;

export function getStaticPaths() { return []; }

// Simple in-memory concurrency limiter and HEAD cache for development
const MAX_CONCURRENT = 12;
let currentConcurrent = 0;
const pendingQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  return new Promise((resolve) => {
    if (currentConcurrent < MAX_CONCURRENT) {
      currentConcurrent++;
      resolve();
      return;
    }
    pendingQueue.push(() => {
      currentConcurrent++;
      resolve();
    });
  });
}

function releaseSlot() {
  currentConcurrent = Math.max(0, currentConcurrent - 1);
  const next = pendingQueue.shift();
  if (next) next();
}

const HEAD_CACHE_TTL = 300_000; // 5 min
const headCache = new Map<string, { expires: number; status: number; headers: Record<string,string> }>();

function cacheHead(target: string, status: number, headers: Record<string,string>) {
  headCache.set(target, { expires: Date.now() + HEAD_CACHE_TTL, status, headers });
}

function getCachedHead(target: string) {
  const v = headCache.get(target);
  if (!v) return null;
  if (v.expires < Date.now()) { headCache.delete(target); return null; }
  return v;
}

const ALLOWED_HOSTS = [
  'github.com',
  'release-assets.githubusercontent.com',
  'github-production-release-asset-2e65be.s3.amazonaws.com',
  'github-production-release-asset-*.s3.amazonaws.com',
  'github-cloud.s3.amazonaws.com',
  'raw.githubusercontent.com'
];

function isAllowedHost(hostname: string) {
  return ALLOWED_HOSTS.some(h => {
    if (h.includes('*')) {
      const prefix = h.split('*')[0];
      return hostname.startsWith(prefix);
    }
    return hostname === h;
  });
}

function base64urlToString(s: string) {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    const padded = pad === 0 ? b64 : b64 + '='.repeat(4 - pad);
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch (e) {
    throw new Error('Invalid base64 target');
  }
}

function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function fetchWithRetries(target: string, opts: RequestInit, attempts = 2, timeoutMs = 30000) {
  let lastErr: any = null;
  for (let i = 0; i <= attempts; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(target, { ...opts, signal: controller.signal });
      clearTimeout(timeout);
      // Treat 5xx as retryable
      if (res.status >= 500 && i < attempts) {
        lastErr = new Error(`Upstream ${res.status}`);
        await sleep(200 * Math.pow(2, i));
        continue;
      }
      return res;
    } catch (e: any) {
      clearTimeout(timeout);
      lastErr = e;
      if (e?.name === 'AbortError') {
        // timeout - if last attempt, rethrow
        if (i === attempts) throw e;
      }
      // wait a bit before retrying
      if (i < attempts) await sleep(200 * Math.pow(2, i));
    }
  }
  throw lastErr;
}

export const GET: APIRoute = async ({ params, request }) => {
  const targetB64 = params?.target as string | undefined;
  if (!targetB64) return new Response('Missing target', { status: 400 });
  let target: string;
  // Accept either a percent-encoded plain URL (client may encode the URL into the
  // path), or a base64url-encoded target. Try decodeURIComponent first; if the
  // result looks like an http(s) URL use it, otherwise fall back to base64url.
  try {
    const maybe = decodeURIComponent(targetB64);
    if (maybe.startsWith('http://') || maybe.startsWith('https://')) {
      target = maybe;
    } else {
      target = base64urlToString(targetB64);
    }
  } catch (e) {
    try {
      target = base64urlToString(targetB64);
    } catch (e2: any) {
      console.error('[api/proxy] invalid target encoding', e2?.message ?? e2);
      return new Response(String(e2?.message ?? e2), { status: 400 });
    }
  }

  console.log('[api/proxy] proxying GET', { target });

  try {
    const u = new URL(target);
    if (!isAllowedHost(u.hostname)) return new Response('Host not allowed', { status: 403 });

    const range = request.headers.get('range') || undefined;
    const upstreamHeaders: Record<string, string> = {};
    if (range) upstreamHeaders['range'] = range;

    // Skip HEAD preflight — go straight to GET to reduce latency
    // The HEAD was adding 500ms-1s per request unnecessarily
    await acquireSlot();
    let res;
    try {
      res = await fetchWithRetries(target, { method: 'GET', redirect: 'follow', headers: upstreamHeaders }, 2, 30000);
    } finally {
      releaseSlot();
    }

    // Cache HEAD info from the GET response for future HEAD-only requests
    if (res.ok || res.status === 206) {
      const h: Record<string,string> = {};
      ['content-type','content-length','accept-ranges','last-modified','etag','content-disposition'].forEach(hk => {
        const v = res.headers.get(hk);
        if (v) h[hk] = v;
      });
      cacheHead(target, res.status >= 200 && res.status < 300 ? 200 : res.status, h);
    }

    const headers = new Headers();
    ['content-type','content-length','content-range','accept-ranges','last-modified','etag','content-disposition'].forEach(h => {
      const v = res.headers.get(h);
      if (v) headers.set(h, v);
    });

    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Accept-Ranges', res.headers.get('accept-ranges') || 'bytes');
    // Cache video chunks in the browser for 24h — assets are immutable release files
    headers.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
    // Ensure CDN caches different Range responses separately
    headers.set('Vary', 'Range');

    return new Response(res.body, { status: res.status, headers });
  } catch (e: any) {
    console.error('[api/proxy] GET handler error', e?.stack ?? e);
    // Distinguish abort vs other network errors
    if (e?.name === 'AbortError') return new Response('Upstream timeout', { status: 504 });
    return new Response(String(e?.message ?? e), { status: 502 });
  }
};

export const HEAD: APIRoute = async ({ params }) => {
  const targetB64 = params?.target as string | undefined;
  if (!targetB64) return new Response('Missing target', { status: 400 });
  let target: string;
  try {
    const maybe = decodeURIComponent(targetB64);
    if (maybe.startsWith('http://') || maybe.startsWith('https://')) {
      target = maybe;
    } else {
      target = base64urlToString(targetB64);
    }
  } catch (e) {
    try {
      target = base64urlToString(targetB64);
    } catch (e2: any) {
      console.error('[api/proxy] invalid base64 (HEAD)', e2?.message ?? e2);
      return new Response(String(e2?.message ?? e2), { status: 400 });
    }
  }

  console.log('[api/proxy] proxying HEAD', { target });

  try {
    const u = new URL(target);
    if (!isAllowedHost(u.hostname)) return new Response('Host not allowed', { status: 403 });

    // Use cached HEAD when available
    const cached = getCachedHead(target);
    if (cached) {
      const headers = new Headers();
      Object.entries(cached.headers).forEach(([k,v]) => headers.set(k, v));
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Accept-Ranges', cached.headers['accept-ranges'] || 'bytes');
      return new Response(null, { status: cached.status, headers });
    }

    const res = await fetchWithRetries(target, { method: 'HEAD', redirect: 'follow' }, 1, 5000);
    const headers = new Headers();
    const out: Record<string,string> = {};
    ['content-type','content-length','accept-ranges','last-modified','etag','content-disposition'].forEach(h => {
      const v = res.headers.get(h);
      if (v) { headers.set(h, v); out[h] = v; }
    });
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Accept-Ranges', res.headers.get('accept-ranges') || 'bytes');
    cacheHead(target, res.status, out);
    return new Response(null, { status: res.status, headers });
  } catch (e: any) {
    console.error('[api/proxy] HEAD handler error', e?.stack ?? e);
    return new Response(String(e?.message ?? e), { status: 500 });
  }
};