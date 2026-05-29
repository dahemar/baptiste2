#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SHEET_ID = process.env.THEATRE_SHEET_ID || '15S6aAhOP-p20BuDP-UEdGkSoTk8ScMkHR9cnGsmlLHI';
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || 'a9aa2c81cffdbdc0a558da017670f16c';
const BUCKET = process.env.R2_BUCKET || 'baptiste-videos';
const ENDPOINT = process.env.R2_ENDPOINT || `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const OUT_DIR = process.env.THUMB_OUT_DIR || '/tmp/baptiste-r2-first-frame-thumbnails';
const shouldUpload = process.argv.includes('--upload');
const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const onlySheet = onlyArg ? onlyArg.split('=')[1] : null;
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

const SHEETS = [
  { id: 'theatre', tab: process.env.THEATRE_SCENES_SHEET || 'theatre-works-scenes', labelCol: 'scene_id' },
  { id: 'audiovisual', tab: process.env.AUDIOVISUAL_SHEET || 'audiovisual', labelCol: 'id' },
];

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
      } else {
        inQuotes = !inQuotes;
      }
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

function thumbnailKeyFromVideoUrl(videoUrl) {
  const u = new URL(videoUrl);
  if (!u.hostname.endsWith('.r2.dev')) return null;
  if (!/\.mp4$/i.test(u.pathname)) return null;
  return decodeURIComponent(u.pathname.replace(/^\//, '').replace(/\.mp4$/i, '.jpg'));
}

function publicUrlForVideo(videoUrl) {
  const u = new URL(videoUrl);
  u.pathname = u.pathname.replace(/\.mp4$/i, '.jpg');
  u.search = '';
  u.hash = '';
  return u.toString();
}

async function collectVideosFromSheet(sheetConfig) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetConfig.tab)}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[${sheetConfig.id}] failed to fetch sheet (${res.status})`);
    return [];
  }

  const rows = parseCsvRows(await res.text());
  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => String(h || '').trim().toLowerCase());
  const videoIdx = headers.indexOf('video_url');
  const labelIdx = headers.indexOf(sheetConfig.labelCol.toLowerCase());
  if (videoIdx < 0) {
    console.warn(`[${sheetConfig.id}] missing video_url column`);
    return [];
  }

  const out = [];
  const seen = new Set();
  for (const row of rows.slice(1)) {
    const videoUrl = String(row[videoIdx] || '').trim();
    if (!videoUrl || seen.has(videoUrl)) continue;
    const key = thumbnailKeyFromVideoUrl(videoUrl);
    if (!key) continue;
    seen.add(videoUrl);
    out.push({
      sheet: sheetConfig.id,
      label: labelIdx >= 0 ? String(row[labelIdx] || '').trim() : '',
      videoUrl,
      key,
      publicUrl: publicUrlForVideo(videoUrl),
    });
  }
  return out;
}

const selectedSheets = onlySheet
  ? SHEETS.filter((s) => s.id === onlySheet)
  : SHEETS;

if (!selectedSheets.length) {
  console.error(`Unknown --only value. Use: ${SHEETS.map((s) => s.id).join(', ')}`);
  process.exit(1);
}

let videos = [];
for (const sheet of selectedSheets) {
  const found = await collectVideosFromSheet(sheet);
  console.log(`[${sheet.id}] ${found.length} mp4 URLs`);
  videos.push(...found);
}
if (videos.length > limit) videos = videos.slice(0, limit);

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

let generated = 0;
let uploaded = 0;
let failed = 0;

console.log(`Generating first-frame thumbnails for ${videos.length} videos`);
if (shouldUpload && (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY)) {
  console.error('Upload requires R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.');
  process.exit(1);
}

for (const item of videos) {
  const fileName = `${createHash('sha1').update(item.key).digest('hex')}.jpg`;
  const outPath = path.join(OUT_DIR, fileName);
  process.stdout.write(`[${item.sheet}] ${item.label || '-'} ${item.key} ... `);

  const ffmpeg = await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', item.videoUrl,
    '-frames:v', '1', '-q:v', '2',
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
