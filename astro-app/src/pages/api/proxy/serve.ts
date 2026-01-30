import type { APIRoute } from 'astro';

export const prerender = false;

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

const GLOBAL_KEY = '__dev_proxy_register_map__' as const;
const registry: Map<string, string> = (global as any)[GLOBAL_KEY] || new Map();

async function proxyFetch(target: string, incomingRange?: string | null) {
  const headers: Record<string, string> = {};
  if (incomingRange) headers['range'] = incomingRange;
  const res = await fetch(target, { method: 'GET', redirect: 'follow', headers });
  return res;
}

export const GET: APIRoute = async ({ request }) => {
  if (!import.meta.env.DEV) return new Response('Not allowed', { status: 403 });

  try {
    const url = new URL(String(request.url));
    const id = url.searchParams.get('id');
    if (!id) return new Response('Missing id', { status: 400 });

    const target = registry.get(id);
    if (!target) return new Response('Not found', { status: 404 });

    const incomingRange = request.headers.get('range');
    const upstream = await proxyFetch(target, incomingRange);

    // Logging minimal info
    const upstreamContentType = upstream.headers.get('content-type');
    const upstreamContentDisposition = upstream.headers.get('content-disposition');
    console.log('[api/proxy/serve] serve', { id, target, resolved: upstream.url, status: upstream.status, incomingRange, contentType: upstreamContentType, contentDisposition: upstreamContentDisposition });

    const headers = new Headers();
    ['content-type','content-length','content-range','accept-ranges','last-modified','etag','content-disposition'].forEach(h => {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    });

    // If upstream doesn't set a useful content-type but this is clearly an .mp4 file, set video/mp4
    const resolvedUrlLower = String(upstream.url || '').toLowerCase();
    const dispositionLower = String(upstreamContentDisposition || '').toLowerCase();
    const looksLikeMp4 = resolvedUrlLower.endsWith('.mp4') || dispositionLower.includes('.mp4');
    const currentType = headers.get('content-type');
    if ((!currentType || currentType === 'application/octet-stream') && looksLikeMp4) {
      headers.set('content-type', 'video/mp4');
    } else if (!currentType) {
      headers.set('content-type', 'video/mp4');
    }

    // Allow CORS for dev use
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (e: any) {
    console.error('[api/proxy/serve] error', e?.stack ?? e);
    return new Response(String(e?.message ?? e), { status: 500 });
  }
};

export const HEAD: APIRoute = async ({ request }) => {
  if (!import.meta.env.DEV) return new Response('Not allowed', { status: 403 });
  try {
    const url = new URL(String(request.url));
    const id = url.searchParams.get('id');
    if (!id) return new Response('Missing id', { status: 400 });
    const target = registry.get(id);
    if (!target) return new Response('Not found', { status: 404 });

    const upstream = await fetch(target, { method: 'HEAD', redirect: 'follow' });

    console.log('[api/proxy/serve] HEAD', { id, target, resolved: upstream.url, status: upstream.status, contentType: upstream.headers.get('content-type') });

    const headers = new Headers();
    ['content-type','content-length','accept-ranges','last-modified','etag','content-disposition'].forEach(h => {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    });

    // If upstream doesn't set a useful content-type but this is clearly an .mp4 file, set video/mp4
    const upstreamContentType = upstream.headers.get('content-type');
    const upstreamContentDisposition = upstream.headers.get('content-disposition');
    const resolvedUrlLower = String(upstream.url || '').toLowerCase();
    const dispositionLower = String(upstreamContentDisposition || '').toLowerCase();
    const looksLikeMp4 = resolvedUrlLower.endsWith('.mp4') || dispositionLower.includes('.mp4');
    const currentType = headers.get('content-type');
    if ((!currentType || currentType === 'application/octet-stream') && looksLikeMp4) {
      headers.set('content-type', 'video/mp4');
    } else if (!currentType) {
      headers.set('content-type', 'video/mp4');
    }

    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');

    return new Response(null, { status: upstream.status, headers });
  } catch (e: any) {
    console.error('[api/proxy/serve] HEAD error', e?.stack ?? e);
    return new Response(String(e?.message ?? e), { status: 500 });
  }
};