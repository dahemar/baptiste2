#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SHEET_ID = process.env.THEATRE_SHEET_ID || '15S6aAhOP-p20BuDP-UEdGkSoTk8ScMkHR9cnGsmlLHI';
const SHEET_NAME = process.env.THEATRE_SCENES_SHEET || 'theatre-works-scenes';
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || 'a9aa2c81cffdbdc0a558da017670f16c';
const BUCKET = process.env.R2_BUCKET || 'baptiste-videos';
const ENDPOINT = process.env.R2_ENDPOINT || `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const OUT_DIR = process.env.THUMB_OUT_DIR || '/tmp/baptiste-r2-first-frame-thumbnails';
const shouldUpload = process.argv.includes('--upload');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

function parseCsvLine(line) {
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      out.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  out.push(current);
  return out;
}

function awsEnv() {
  const env = { ...process.env, AWS_DEFAULT_REGION: 'auto' };
  if (R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY) {
    env.AWS_ACCESS_KEY_ID = R2_ACCESS_KEY_ID;
    env.AWS_SECRET_ACCESS_KEY = R2_SECRET_ACCESS_KEY;
  }
  return env;
}

function run(command, args, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...awsEnv(), ...extraEnv },
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

function thumbnailKeyFromVideoUrl(videoUrl) {
  const u = new URL(videoUrl);
  if (!u.hostname.endsWith('.r2.dev')) return null;
  if (!/\.mp4$/i.test(u.pathname)) return null;
  return decodeURIComponent(u.pathname.replace(/^\//, '').replace(/\.mp4$/i, '.jpg'));
}

function publicUrlForKey(videoUrl) {
  const u = new URL(videoUrl);
  u.pathname = u.pathname.replace(/\.mp4$/i, '.jpg');
  u.search = '';
  u.hash = '';
  return u.toString();
}

const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;
const res = await fetch(csvUrl);
if (!res.ok) {
  console.error(`Failed to fetch scenes sheet: ${res.status}`);
  process.exit(1);
}

const rows = (await res.text()).trim().split(/\r?\n/).map(parseCsvLine);
const headers = rows.shift()?.map((h) => h.trim().toLowerCase()) || [];
const videoIdx = headers.indexOf('video_url');
const sceneIdx = headers.indexOf('scene_id');
if (videoIdx < 0) {
  console.error('Scenes sheet does not include video_url column.');
  process.exit(1);
}

const videos = [];
const seen = new Set();
for (const row of rows) {
  const videoUrl = String(row[videoIdx] || '').trim();
  if (!videoUrl || seen.has(videoUrl)) continue;
  const key = thumbnailKeyFromVideoUrl(videoUrl);
  if (!key) continue;
  seen.add(videoUrl);
  videos.push({ sceneId: row[sceneIdx] || '', videoUrl, key, publicUrl: publicUrlForKey(videoUrl) });
  if (videos.length >= limit) break;
}

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

let generated = 0;
let uploaded = 0;
let failed = 0;

console.log(`Generating first-frame thumbnails for ${videos.length} videos`);
console.log(`Output: ${OUT_DIR}`);
if (shouldUpload && (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY)) {
  console.error('Upload requires R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in the environment.');
  process.exit(1);
}
console.log(`Upload: ${shouldUpload ? `s3://${BUCKET} @ ${ENDPOINT}` : 'disabled (--upload to enable)'}`);

for (const item of videos) {
  const fileName = `${createHash('sha1').update(item.key).digest('hex')}.jpg`;
  const outPath = path.join(OUT_DIR, fileName);
  process.stdout.write(`${item.sceneId || '-'} ${item.key} ... `);

  const ffmpeg = await run('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', item.videoUrl,
    '-frames:v', '1',
    '-q:v', '2',
    outPath,
  ]);

  if (ffmpeg.code !== 0 || !existsSync(outPath)) {
    failed++;
    console.log('ffmpeg failed');
    continue;
  }
  generated++;

  if (!shouldUpload) {
    console.log(`generated -> ${item.publicUrl}`);
    continue;
  }

  const upload = await run('aws', [
    's3', 'cp', outPath, `s3://${BUCKET}/${item.key}`,
    '--endpoint-url', ENDPOINT,
    '--content-type', 'image/jpeg',
    '--cache-control', 'public, max-age=31536000, immutable',
  ]);

  if (upload.code === 0) {
    uploaded++;
    console.log(`uploaded -> ${item.publicUrl}`);
  } else {
    failed++;
    console.log('upload failed');
  }
}

console.log(`Done. generated=${generated} uploaded=${uploaded} failed=${failed}`);
if (!shouldUpload) {
  console.log('Run again with --upload after verifying the generated files.');
}
