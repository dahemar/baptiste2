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

// In-memory map only used in DEV. Stored on global to survive HMR reloads.
const GLOBAL_KEY = '__dev_proxy_register_map__' as const;
if (import.meta.env.DEV && !(global as any)[GLOBAL_KEY]) (global as any)[GLOBAL_KEY] = new Map();
const registry: Map<string, string> = (global as any)[GLOBAL_KEY] || new Map();

export const POST: APIRoute = async ({ request }) => {
  if (!import.meta.env.DEV) return new Response('Not allowed', { status: 403 });

  try {
    const body = await request.json();
    const url = (body && body.url) ? String(body.url) : null;
    if (!url) return new Response('Missing url', { status: 400 });

    // Basic allowlist
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch (e) {
      return new Response('Invalid url', { status: 400 });
    }

    if (!isAllowedHost(hostname)) return new Response('Host not allowed', { status: 403 });

    // create id
    const id = (typeof crypto !== 'undefined' && (crypto as any).randomUUID) ? (crypto as any).randomUUID() : String(Math.random()).slice(2);
    registry.set(id, url);

    console.log('[api/proxy/register] registered', { id, url });

    return new Response(JSON.stringify({ id }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('[api/proxy/register] error', e?.stack ?? e);
    return new Response(String(e?.message ?? e), { status: 500 });
  }
};