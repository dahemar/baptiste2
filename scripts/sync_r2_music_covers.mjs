#!/usr/bin/env node
/**
 * Scrape Bandcamp cover art and upload to R2 (music-covers/{id}.jpg).
 *
 * Usage:
 *   node scripts/sync_r2_music_covers.mjs           # dry-run: list + HEAD check
 *   node scripts/sync_r2_music_covers.mjs --upload  # scrape missing + upload
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SHEET_ID = process.env.THEATRE_SHEET_ID || '15S6aAhOP-p20BuDP-UEdGkSoTk8ScMkHR9cnGsmlLHI';
const MUSIC_TAB = process.env.MUSIC_SHEET || 'music';
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || 'a9aa2c81cffdbdc0a558da017670f16c';
const BUCKET = process.env.R2_BUCKET || 'baptiste-videos';
const ENDPOINT = process.env.R2_ENDPOINT || `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;
const PUBLIC_HOST = 'pub-f04cf0f8494f457e889559aa0b6e57b7.r2.dev';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const OUT_DIR = process.env.MUSIC_COVER_OUT_DIR || '/tmp/baptiste-music-covers';
const shouldUpload = process.argv.includes('--upload');

function parseCsvRows(csvText) {
  const rows = [];
  let row = [];
  let current = '';
  let inQuotes = false;
  const pushField = () => {
    row.push(current);
    current = '';
  };
  const pushRow = () => {
    if (row.some((c) => String(c || '').trim().length > 0)) rows.push(row);
    row = [];
  };
  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const next = csvText[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && char === ',') {
      pushField();
      continue;
    }
    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') i++;
      pushField();
      pushRow();
      continue;
    }
    current += char;
  }
  pushField();
  pushRow();
  return rows;
}

function awsEnv() {
  const env = { ...process.env, AWS_DEFAULT_REGION: 'auto' };
  if (R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY) {
    env.AWS_ACCESS_KEY_ID = R2_ACCESS_KEY_ID;
    env.AWS_SECRET_ACCESS_KEY = R2_SECRET_ACCESS_KEY;
  }
  return env;
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: awsEnv(),
    });
    child.on('close', (code) => resolve({ code }));
  });
}

function isBandcampUrl(url) {
  try {
    return new URL(url).hostname.endsWith('.bandcamp.com');
  } catch {
    return false;
  }
}

function extractCoverFromHtml(html) {
  const flat = html.replace(/\n/g, ' ');
  const ogImgMeta = flat.match(/<meta\s+[^>]*property\s*=\s*"og:image"[^>]*>/i);
  if (ogImgMeta) {
    const content = ogImgMeta[0].match(/content\s*=\s*"([^"]+)"/i);
    if (content) return content[1];
  }
  const metaContent = flat.match(/<meta\s+[^>]*content\s*=\s*"([^"]+)"[^>]*property\s*=\s*"og:image"[^>]*>/i);
  if (metaContent) return metaContent[1];
  const imageSrc = flat.match(/<link\s+rel="image_src"\s+href="([^"]+)"/i);
  if (imageSrc) return imageSrc[1];
  return null;
}

function musicCoverKey(id) {
  return `music-covers/${id}.jpg`;
}

function musicCoverPublicUrl(id) {
  return `https://${PUBLIC_HOST}/${musicCoverKey(id)}`;
}

async function headPublic(key) {
  try {
    const res = await fetch(`https://${PUBLIC_HOST}/${key}`, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

async function loadBandcampReleases() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(MUSIC_TAB)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch music sheet (${res.status})`);
  const rows = parseCsvRows(await res.text());
  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => String(h || '').trim().toLowerCase());
  const idIdx = headers.indexOf('id');
  const urlIdx = headers.findIndex((h) => ['url', 'discogs_url', 'link'].includes(h));
  const coverUrlIdx = headers.indexOf('cover_url');
  if (idIdx < 0 || urlIdx < 0) throw new Error('music sheet missing id or url column');

  const out = [];
  for (const row of rows.slice(1)) {
    const id = String(row[idIdx] || '').trim();
    const pageUrl = String(row[urlIdx] || '').trim();
    const coverUrl = coverUrlIdx >= 0 ? String(row[coverUrlIdx] || '').trim() : '';
    if (!id || !pageUrl || !isBandcampUrl(pageUrl) || coverUrl) continue;
    out.push({ id, url: pageUrl, key: musicCoverKey(id), publicUrl: musicCoverPublicUrl(id) });
  }
  return out;
}

if (shouldUpload && (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY)) {
  console.error('Upload requires R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.');
  process.exit(1);
}

const releases = await loadBandcampReleases();
console.log(`[music] ${releases.length} Bandcamp releases without cover_url`);

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

let skipped = 0;
let uploaded = 0;
let failed = 0;

for (const item of releases) {
  process.stdout.write(`[${item.id}] ${item.url} ... `);

  if (await headPublic(item.key)) {
    skipped++;
    console.log(`exists -> ${item.publicUrl}`);
    continue;
  }

  if (!shouldUpload) {
    console.log(`missing (dry-run) -> would upload to ${item.publicUrl}`);
    continue;
  }

  try {
    const pageRes = await fetch(item.url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bandcamp-cover-bot)' },
    });
    if (!pageRes.ok) {
      failed++;
      console.log(`bandcamp page ${pageRes.status}`);
      continue;
    }
    const coverUrl = extractCoverFromHtml(await pageRes.text());
    if (!coverUrl) {
      failed++;
      console.log('no og:image');
      continue;
    }
    const imgRes = await fetch(coverUrl);
    if (!imgRes.ok) {
      failed++;
      console.log(`image ${imgRes.status}`);
      continue;
    }
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const outPath = path.join(OUT_DIR, `${item.id}.jpg`);
    await writeFile(outPath, buf);

    const upload = await run('aws', [
      's3', 'cp', outPath, `s3://${BUCKET}/${item.key}`,
      '--endpoint-url', ENDPOINT,
      '--content-type', 'image/jpeg',
      '--cache-control', 'public, max-age=31536000, immutable',
    ]);

    if (upload.code === 0 && existsSync(outPath)) {
      uploaded++;
      console.log(`uploaded -> ${item.publicUrl}`);
    } else {
      failed++;
      console.log('upload failed');
    }
  } catch (err) {
    failed++;
    console.log(String(err?.message || err));
  }
}

console.log(`Done. exists=${skipped} uploaded=${uploaded} failed=${failed}`);
