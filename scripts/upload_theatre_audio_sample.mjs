#!/usr/bin/env node
/**
 * Upload a sample MP3 to R2 and append a row to the "files" Google Sheet tab.
 *
 * Requires:
 *   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 *   GOOGLE_APPLICATION_CREDENTIALS (service account) OR gcloud application-default login
 *
 * Usage:
 *   node scripts/upload_theatre_audio_sample.mjs [path/to/file.mp3]
 */

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SPREADSHEET_ID = process.env.THEATRE_SHEET_ID || '15S6aAhOP-p20BuDP-UEdGkSoTk8ScMkHR9cnGsmlLHI';
const AUDIO_TAB = process.env.THEATRE_AUDIO_RANGE || 'files';
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || 'a9aa2c81cffdbdc0a558da017670f16c';
const BUCKET = process.env.R2_BUCKET || 'baptiste-videos';
const ENDPOINT = process.env.R2_ENDPOINT || `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;
const PUBLIC_HOST = 'pub-f04cf0f8494f457e889559aa0b6e57b7.r2.dev';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';

const SAMPLE_KEY = 'Theatre Works/audio-samples/site-test-chien-kora.mp3';
const SAMPLE_META = {
  filename: 'Chien Kora (audio test)',
  work_title: 'Rectum Crocodile',
  order: '1',
};

function awsEnv() {
  const env = { ...process.env, AWS_DEFAULT_REGION: 'auto' };
  if (R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY) {
    env.AWS_ACCESS_KEY_ID = R2_ACCESS_KEY_ID;
    env.AWS_SECRET_ACCESS_KEY = R2_SECRET_ACCESS_KEY;
  } else if (!env.AWS_PROFILE) {
    env.AWS_PROFILE = 'r2';
  }
  return env;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: opts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      env: awsEnv(),
    });
    let stdout = '';
    let stderr = '';
    if (!opts.inherit) {
      child.stdout?.on('data', (d) => { stdout += d; });
      child.stderr?.on('data', (d) => { stderr += d; });
    }
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} ${args.join(' ')} failed (${code}): ${stderr || stdout}`));
    });
  });
}

async function ensureSampleMp3(targetPath) {
  if (existsSync(targetPath)) return targetPath;

  const videoUrl =
    'https://pub-f04cf0f8494f457e889559aa0b6e57b7.r2.dev/Theatre%20Works/Rectum%20Crocodile/Chien%20Kora.mp4';

  await mkdir(path.dirname(targetPath), { recursive: true });
  console.log('No local MP3 found; extracting a short clip from existing theatre video…');
  await run('ffmpeg', [
    '-y',
    '-i', videoUrl,
    '-t', '12',
    '-vn',
    '-acodec', 'libmp3lame',
    '-q:a', '4',
    targetPath,
  ], { inherit: true });

  return targetPath;
}

async function uploadToR2(localPath, key) {
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error('Missing R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY');
  }

  const dest = `s3://${BUCKET}/${key}`;
  console.log(`Uploading ${localPath} → ${dest}`);
  await run('aws', [
    's3', 'cp', localPath, dest,
    '--endpoint-url', ENDPOINT,
    '--content-type', 'audio/mpeg',
    '--cache-control', 'public, max-age=31536000, immutable',
  ], { inherit: true });

  const publicUrl = `https://${PUBLIC_HOST}/${key}`;
  console.log('Public URL:', publicUrl);
  return publicUrl;
}

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  await auth.getClient();
  return google.sheets({ version: 'v4', auth });
}

async function ensureAudioTab(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const titles = (meta.data.sheets || []).map((s) => s.properties?.title).filter(Boolean);
  if (titles.includes(AUDIO_TAB)) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{ addSheet: { properties: { title: AUDIO_TAB } } }],
    },
  });
  console.log(`Created tab "${AUDIO_TAB}".`);
}

async function ensureHeaderRow(sheets) {
  const range = `'${AUDIO_TAB}'!A1:E1`;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
  const first = res.data.values?.[0] || [];
  if (first.length > 0 && String(first[0]).trim()) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: 'RAW',
    requestBody: {
      values: [['id', 'filename', 'audio_url', 'work_title', 'order']],
    },
  });
  console.log('Wrote header row.');
}

async function appendAudioRow(sheets, publicUrl) {
  const row = [
    `audio-test-${Date.now()}`,
    SAMPLE_META.filename,
    publicUrl,
    SAMPLE_META.work_title,
    SAMPLE_META.order,
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${AUDIO_TAB}'!A:E`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });

  console.log('Appended row to Google Sheets:', row);
}

async function main() {
  const inputArg = process.argv[2];
  const tmpDir = path.join(ROOT, '.tmp');
  const localMp3 = inputArg
    ? path.resolve(inputArg)
    : path.join(tmpDir, 'theatre-audio-sample.mp3');

  await mkdir(tmpDir, { recursive: true });
  await ensureSampleMp3(localMp3);

  const publicUrl = await uploadToR2(localMp3, SAMPLE_KEY);

  const sheets = await getSheetsClient();
  await ensureAudioTab(sheets);
  await ensureHeaderRow(sheets);
  await appendAudioRow(sheets, publicUrl);

  if (!inputArg && existsSync(localMp3)) {
    try { unlinkSync(localMp3); } catch {}
    try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
  }

  console.log('\nDone. Reload http://127.0.0.1:4322/ and switch to "files".');
}

main().catch((err) => {
  console.error('ERR', err?.message || err);
  process.exit(1);
});
