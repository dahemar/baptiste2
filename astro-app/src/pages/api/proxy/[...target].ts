import type { APIRoute } from 'astro';

// DEPRECATED fallback catch-all. No GET export to avoid conflicting route exports.
export function getStaticPaths() { return []; }
export const prerender = false;

export default function DEPRECATED() {
  return new Response('Deprecated: use /api/proxy/<base64url>', { status: 410 });
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
  }) || hostname.endsWith('.r2.dev');
}

function base64urlToString(s: string) {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    // pad
    const pad = b64.length % 4;
    const padded = pad === 0 ? b64 : b64 + '='.repeat(4 - pad);
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch (e) {
    throw new Error('Invalid base64 target');
  }
}

export const GET: APIRoute = async ({ params, request }) => {
  const raw = params?.target;
  const targetB64 = Array.isArray(raw) ? raw.join('/') : raw;
  if (!targetB64) return new Response('Missing target', { status: 400 });

  let target: string;
  try {
    target = base64urlToString(targetB64);
  } catch (e: any) {
    return new Response(String(e?.message ?? e), { status: 400 });
  }

  try {
    const u = new URL(target);
    if (!isAllowedHost(u.hostname)) return new Response('Host not allowed', { status: 403 });

    // Redirect instead of streaming bytes through Vercel.
    return Response.redirect(target, 307);
  } catch (e: any) {
    return new Response(String(e?.message ?? e), { status: 500 });
  }
};

export const HEAD: APIRoute = async ({ params }) => {
  const raw = params?.target;
  const targetB64 = Array.isArray(raw) ? raw.join('/') : raw;
  if (!targetB64) return new Response('Missing target', { status: 400 });
  let target: string;
  try {
    target = base64urlToString(targetB64);
  } catch (e: any) {
    return new Response(String(e?.message ?? e), { status: 400 });
  }

  try {
    const u = new URL(target);
    if (!isAllowedHost(u.hostname)) return new Response('Host not allowed', { status: 403 });

    return Response.redirect(target, 307);
  } catch (e: any) {
    return new Response(String(e?.message ?? e), { status: 500 });
  }
};
