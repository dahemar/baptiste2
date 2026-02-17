import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const prerender = false;

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

function decodeTarget(targetB64: string) {
  try {
    const maybe = decodeURIComponent(targetB64);
    if (maybe.startsWith('http://') || maybe.startsWith('https://')) return maybe;
  } catch (e) {
    // fallthrough
  }
  return base64urlToString(targetB64);
}

const CACHE_DIR = path.resolve(process.cwd(), '.cache', 'thumbs');
const ALLOWED_HOSTS = new Set([
  'github.com',
  'raw.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-production-release-asset-2e65be.s3.amazonaws.com',
]);

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

function urlToCacheFileName(url: string, extHint?: string) {
  const h = crypto.createHash('sha1').update(url).digest('hex');
  const ext = (extHint || '').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
  return `${h}.${ext}`;
}

export const GET: APIRoute = async ({ params }) => {
  const targetB64 = params?.target as string | undefined;
  if (!targetB64) return new Response('Missing target', { status: 400 });
  let target: string;
  try {
    target = decodeTarget(targetB64);
  } catch (e: any) {
    return new Response(String(e?.message ?? e), { status: 400 });
  }

  try {
    const u = new URL(target);
    if (!ALLOWED_HOSTS.has(u.hostname) && !u.hostname.endsWith('.s3.amazonaws.com')) {
      return new Response('Host not allowed', { status: 403 });
    }
  } catch (e) {
    return new Response('Invalid URL', { status: 400 });
  }

  await ensureCacheDir();
  const guessedExt = (path.extname(new URL(target).pathname) || '').replace(/^\./, '') || 'jpg';
  const fileName = urlToCacheFileName(target, guessedExt);
  const filePath = path.join(CACHE_DIR, fileName);

  // Serve cached file if present
  try {
    if (fsSync.existsSync(filePath)) {
      const stat = fsSync.statSync(filePath);
      const headers = new Headers();
      headers.set('Content-Type', guessedExt === 'png' ? 'image/png' : 'image/jpeg');
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      headers.set('Content-Length', String(stat.size));
      headers.set('Access-Control-Allow-Origin', '*');
      const stream = fsSync.createReadStream(filePath);
      return new Response(stream, { status: 200, headers });
    }
  } catch (e) {
    // ignore and attempt fetch
  }

  // Fetch, save, and stream
  try {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(target, { signal: controller.signal, redirect: 'follow' });
    clearTimeout(to);
    if (!res.ok) return new Response('Upstream image failed', { status: 502 });

    const contentType = res.headers.get('content-type') || '';
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const actualFileName = urlToCacheFileName(target, ext);
    const actualPath = path.join(CACHE_DIR, actualFileName);

    // Read full body into memory then write atomically to disk (thumbnails are small)
    const tmpPath = actualPath + '.tmp';
    const ab = await res.arrayBuffer().catch(() => null);
    if (!ab) return new Response('No body', { status: 502 });
    const buf = Buffer.from(ab);
    try {
      await fs.writeFile(tmpPath, buf);
    } catch (err) {
      try { if (fsSync.existsSync(tmpPath)) fsSync.unlinkSync(tmpPath); } catch (e) {}
      throw err;
    }

    // rename
    try { await fs.rename(tmpPath, actualPath); } catch (e) { /* ignore */ }

    const headers = new Headers();
    headers.set('Content-Type', contentType || (ext === 'png' ? 'image/png' : 'image/jpeg'));
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('Access-Control-Allow-Origin', '*');

    const stream = fsSync.createReadStream(actualPath);
    return new Response(stream, { status: 200, headers });
  } catch (e: any) {
    if (e?.name === 'AbortError') return new Response('Upstream timeout', { status: 504 });
    console.error('[api/thumb] fetch error', e?.stack ?? e);
    return new Response('Thumb fetch failed', { status: 502 });
  }
};
