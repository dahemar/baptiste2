import type { APIRoute } from 'astro';

export const prerender = false;

export function getStaticPaths() { return []; }

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

export const GET: APIRoute = async ({ params, request }) => {
  const targetB64 = params?.target as string | undefined;
  if (!targetB64) return new Response('Missing target', { status: 400 });

  let target: string;
  try {
    target = base64urlToString(targetB64);
  } catch (e: any) {
    console.error('[api/proxy] invalid base64', e?.message ?? e);
    return new Response(String(e?.message ?? e), { status: 400 });
  }

  console.log('[api/proxy] proxying GET', { target });

  try {
    const u = new URL(target);
    if (!isAllowedHost(u.hostname)) return new Response('Host not allowed', { status: 403 });

    const range = request.headers.get('range') || undefined;
    const upstreamHeaders: Record<string, string> = {};
    if (range) upstreamHeaders['range'] = range;

    const res = await fetch(target, { method: 'GET', redirect: 'follow', headers: upstreamHeaders });

    const headers = new Headers();
    ['content-type','content-length','content-range','accept-ranges','last-modified','etag','content-disposition'].forEach(h => {
      const v = res.headers.get(h);
      if (v) headers.set(h, v);
    });

    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Accept-Ranges', res.headers.get('accept-ranges') || 'bytes');

    return new Response(res.body, { status: res.status, headers });
  } catch (e: any) {
    console.error('[api/proxy] GET handler error', e?.stack ?? e);
    return new Response(String(e?.message ?? e), { status: 500 });
  }
};

export const HEAD: APIRoute = async ({ params }) => {
  const targetB64 = params?.target as string | undefined;
  if (!targetB64) return new Response('Missing target', { status: 400 });
  let target: string;
  try {
    target = base64urlToString(targetB64);
  } catch (e: any) {
    console.error('[api/proxy] invalid base64 (HEAD)', e?.message ?? e);
    return new Response(String(e?.message ?? e), { status: 400 });
  }

  console.log('[api/proxy] proxying HEAD', { target });

  try {
    const u = new URL(target);
    if (!isAllowedHost(u.hostname)) return new Response('Host not allowed', { status: 403 });

    const res = await fetch(target, { method: 'HEAD', redirect: 'follow' });
    const headers = new Headers();
    ['content-type','content-length','accept-ranges','last-modified','etag','content-disposition'].forEach(h => {
      const v = res.headers.get(h);
      if (v) headers.set(h, v);
    });
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Accept-Ranges', res.headers.get('accept-ranges') || 'bytes');

    return new Response(null, { status: res.status, headers });
  } catch (e: any) {
    console.error('[api/proxy] HEAD handler error', e?.stack ?? e);
    return new Response(String(e?.message ?? e), { status: 500 });
  }
};