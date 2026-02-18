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
    // Basic allowlist check (allow r2.dev hosts)
    const allowed = ALLOWED_HOSTS.some(h => {
      if (h.includes('*')) {
        const prefix = h.split('*')[0];
        return hostname.startsWith(prefix);
      }
      return hostname === h;
    }) || hostname.endsWith('.r2.dev');
    if (!allowed) return new Response('Host not allowed', { status: 403 });

    // IMPORTANT: do not stream the upstream response through Vercel.
    // Redirecting ensures the client downloads bytes from the upstream CDN/storage directly,
    // dramatically reducing Vercel (Fast Origin Transfer) bandwidth.
    return Response.redirect(target, 307);
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
    }) || hostname.endsWith('.r2.dev');
    if (!allowed) return new Response('Host not allowed', { status: 403 });

    // Same rationale as GET: avoid proxying upstream headers/data through Vercel.
    return Response.redirect(target, 307);
  } catch (e: any) {
    return new Response(String(e?.message ?? e), { status: 500 });
  }
};
