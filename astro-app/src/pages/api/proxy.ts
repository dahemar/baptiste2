import type { APIRoute } from 'astro';

const ALLOWED_HOSTS = [
  'github.com',
  'release-assets.githubusercontent.com',
  'github-production-release-asset-2e65be.s3.amazonaws.com',
  'github-production-release-asset-*.s3.amazonaws.com',
  'github-cloud.s3.amazonaws.com',
  'raw.githubusercontent.com'
];

export const GET: APIRoute = async (context) => {
  console.log('[api/proxy] GET handler called', { url: context.request.url });
  const url = new URL(context.request.url);
  let target = url.searchParams.get('url');
  console.log('[api/proxy] parsed target', { target, rawUrl: String(context.request.url), pathname: url.pathname, search: url.search });

  // Fallback to path-based encoded target when clients can request /api/proxy/<encoded>
  if (!target) {
    try {
      const pathname = url.pathname || '';
      const prefix = '/api/proxy/';
      if (pathname.startsWith(prefix)) {
        const encoded = pathname.slice(prefix.length);
        if (encoded) target = decodeURIComponent(encoded);
      }
    } catch (e) {
      /* ignore */
    }
  }

  if (!target) return new Response('Missing url', { status: 400 });

  try {
    const u = new URL(target);
    const hostname = u.hostname;
    // Basic allowlist check
    const allowed = ALLOWED_HOSTS.some(h => {
      if (h.includes('*')) {
        const prefix = h.split('*')[0];
        return hostname.startsWith(prefix);
      }
      return hostname === h;
    });
    if (!allowed) return new Response('Host not allowed', { status: 403 });

    // Forward Range header if present so browsers can seek / partial requests
    const range = context.request.headers.get('range') || undefined;
    const upstreamHeaders: Record<string, string> = {};
    if (range) upstreamHeaders['range'] = range;

    const res = await fetch(target, { method: 'GET', redirect: 'follow', headers: upstreamHeaders });

    // Clone headers we want to forward
    const headers = new Headers();
    [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'last-modified',
      'etag'
    ].forEach(h => {
      const v = res.headers.get(h);
      if (v) headers.set(h, v);
    });

    // Allow CORS for dev/proxy usage
    headers.set('Access-Control-Allow-Origin', '*');
    // Allow range requests from browsers
    headers.set('Accept-Ranges', res.headers.get('accept-ranges') || 'bytes');

    return new Response(res.body, { status: res.status, headers });
  } catch (e: any) {
    return new Response(String(e?.message ?? e), { status: 500 });
  }
};

export const HEAD: APIRoute = async (context) => {
  // Respond to HEAD by proxying upstream HEAD so clients can probe headers
  const url = new URL(context.request.url);
  // Prefer query param for backward compatibility
  let target = url.searchParams.get('url');

  // Fallback: support path-based form: /api/proxy/<encoded-target>
  if (!target) {
    try {
      const pathname = url.pathname || '';
      const prefix = '/api/proxy/';
      if (pathname.startsWith(prefix)) {
        const encoded = pathname.slice(prefix.length);
        if (encoded) {
          target = decodeURIComponent(encoded);
        }
      }
    } catch (e) {
      // ignore
    }
  }

  if (!target) return new Response('Missing url', { status: 400 });
  try {
    const u = new URL(target);
    const hostname = u.hostname;
    const allowed = ALLOWED_HOSTS.some(h => {
      if (h.includes('*')) {
        const prefix = h.split('*')[0];
        return hostname.startsWith(prefix);
      }
      return hostname === h;
    });
    if (!allowed) return new Response('Host not allowed', { status: 403 });

    const res = await fetch(target, { method: 'HEAD', redirect: 'follow' });
    const headers = new Headers();
    ['content-type', 'content-length', 'accept-ranges', 'last-modified', 'etag'].forEach(h => {
      const v = res.headers.get(h);
      if (v) headers.set(h, v);
    });
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Accept-Ranges', res.headers.get('accept-ranges') || 'bytes');

    return new Response(null, { status: res.status, headers });
  } catch (e: any) {
    return new Response(String(e?.message ?? e), { status: 500 });
  }
};
