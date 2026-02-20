#!/usr/bin/env node
/*
Verify that Google Sheets URLs are correctly reassigned after R2 migration, and
clean up unused objects from the bucket root.

What it does:
 - Checks `theatre-works-scenes` video_url column points to `.../Theatre Works/...`
 - Ensures `audiovisual` rows 2 and 3 video_url point to Beni 1/2 under Audiovisual/
 - Scans for any reference to `2.Organ.Vinyl.300mb.mp4`
   - If referenced: move it into the correct Theatre Works project folder and update sheets
   - If not referenced: delete it
 - Deletes root JPG thumbnails (user requested: no carátulas; web auto-extracts)

Env vars required:
 - GOOGLE_APPLICATION_CREDENTIALS
 - R2_ENDPOINT
 - R2_BUCKET
 - AWS_ACCESS_KEY_ID
 - AWS_SECRET_ACCESS_KEY
 - R2_PUBLIC_HOST (e.g. pub-...r2.dev)

Usage:
  node scripts/verify_cleanup_r2_and_sheets.js --spreadsheetId <ID> [--execute]
*/

const path = require('path');
const { google } = require('googleapis');
const {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');

function parseArgs(argv) {
  const out = { spreadsheetId: null, execute: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--spreadsheetId') out.spreadsheetId = argv[++i];
    else if (a === '--execute') out.execute = true;
  }
  return out;
}

function indexToColumnLetter(idx0) {
  let n = idx0 + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function encodeKeyForUrl(key) {
  return key
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/');
}

function urlToKey(url) {
  const u = new URL(url);
  return decodeURIComponent(u.pathname.replace(/^\//, ''));
}

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

async function listSheetTitles(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  return (meta.data.sheets || [])
    .map(s => s.properties && s.properties.title)
    .filter(Boolean);
}

async function getValues(sheets, spreadsheetId, sheetName) {
  // Build the range in JS to avoid shell history expansion issues.
  const bang = String.fromCharCode(33);
  const range = `'${sheetName}'${bang}A1:Z`;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return res.data.values || [];
}

async function updateRange(sheets, spreadsheetId, sheetName, rangeA1, values, execute) {
  if (!execute) return;
  const bang = String.fromCharCode(33);
  const range = `'${sheetName}'${bang}${rangeA1}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values },
  });
}

async function ensureCopy(s3, bucket, sourceKey, destKey, execute) {
  // If dest exists, no-op.
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: destKey }));
    return { already: true };
  } catch {
    // continue
  }
  if (!execute) return { dryRun: true };
  const copySource = `/${bucket}/${encodeURIComponent(sourceKey)}`;
  await s3.send(new CopyObjectCommand({ Bucket: bucket, Key: destKey, CopySource: copySource }));
  return { copied: true };
}

async function deleteKey(s3, bucket, key, execute) {
  if (!execute) return { dryRun: true };
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  return { deleted: true };
}

async function listAllKeys(s3, bucket) {
  const keys = [];
  let token = undefined;
  do {
    const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token, MaxKeys: 1000 }));
    for (const obj of res.Contents || []) keys.push(obj.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.spreadsheetId) {
    console.error('Missing --spreadsheetId');
    process.exit(1);
  }

  const spreadsheetId = args.spreadsheetId;
  const bucket = process.env.R2_BUCKET;
  const endpoint = process.env.R2_ENDPOINT;
  const publicHost = process.env.R2_PUBLIC_HOST;
  if (!bucket || !endpoint || !publicHost) {
    console.error('Missing env vars: R2_BUCKET, R2_ENDPOINT, R2_PUBLIC_HOST');
    process.exit(1);
  }

  const sheets = await getSheetsClient();
  const titles = await listSheetTitles(sheets, spreadsheetId);
  const scenesSheet = titles.find(t => t === 'theatre-works-scenes');
  const worksSheet = titles.find(t => t === 'theatre_works');
  const avSheet = titles.find(t => t === 'audiovisual');
  if (!scenesSheet || !worksSheet || !avSheet) {
    console.error('Expected sheets not found. Found:', titles.join(', '));
    process.exit(1);
  }

  const s3 = new S3Client({
    region: process.env.R2_REGION || 'auto',
    endpoint,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  // --- Verify audiovisual rows 2 and 3 ---
  const avValues = await getValues(sheets, spreadsheetId, avSheet);
  const avHeader = avValues[0] || [];
  const avVideoIdx = avHeader.findIndex(h => String(h).trim() === 'video_url');
  if (avVideoIdx < 0) throw new Error('audiovisual.video_url column not found');
  const avCol = indexToColumnLetter(avVideoIdx);
  const expectedBeni1 = `https://${publicHost}/Audiovisual/Beni%201.mp4`;
  const expectedBeni2 = `https://${publicHost}/Audiovisual/Beni%202.mp4`;
  const avRow2 = String((avValues[1] || [])[avVideoIdx] || '').trim();
  const avRow3 = String((avValues[2] || [])[avVideoIdx] || '').trim();

  const avOk = (avRow2 === expectedBeni1) && (avRow3 === expectedBeni2);
  console.log('audiovisual rows 2-3 ok:', avOk);
  if (!avOk) {
    console.log('audiovisual current row2:', avRow2);
    console.log('audiovisual current row3:', avRow3);
    console.log('audiovisual expected row2:', expectedBeni1);
    console.log('audiovisual expected row3:', expectedBeni2);
  }

  // --- Verify theatre works urls ---
  const sceneValues = await getValues(sheets, spreadsheetId, scenesSheet);
  const sceneHeader = sceneValues[0] || [];
  const sceneVideoIdx = sceneHeader.findIndex(h => String(h).trim() === 'video_url');
  if (sceneVideoIdx < 0) throw new Error('theatre-works-scenes.video_url column not found');

  let total = 0;
  let ok = 0;
  const bad = [];
  const referencedKeys = new Set();
  const organ300Rows = [];

  for (let i = 1; i < sceneValues.length; i++) {
    const url = String((sceneValues[i] || [])[sceneVideoIdx] || '').trim();
    if (!url) continue;
    total++;
    if (url.indexOf('/Theatre%20Works/') >= 0 || url.indexOf('/Theatre Works/') >= 0) ok++; else bad.push({ row: i + 1, url });
    try {
      const k = urlToKey(url);
      referencedKeys.add(k);
      if (k.endsWith('2.Organ.Vinyl.300mb.mp4')) organ300Rows.push(i + 1);
    } catch {
      // ignore
    }
  }
  console.log('theatre-works-scenes video_url total:', total, 'ok:', ok, 'bad:', bad.length);
  if (bad.length) console.log('sample bad rows:', bad.slice(0, 5));

  // Add audiovisual referenced keys too
  for (let i = 1; i < avValues.length; i++) {
    const url = String((avValues[i] || [])[avVideoIdx] || '').trim();
    if (!url) continue;
    try { referencedKeys.add(urlToKey(url)); } catch { /* ignore */ }
  }

  // If 300mb is referenced, move it into Dona Lourdès folder and update those rows.
  // If not referenced, delete it from root.
  const rootKeys = (await listAllKeys(s3, bucket)).filter(k => k && k.indexOf('/') < 0);
  const rootJpgs = rootKeys.filter(k => k.toLowerCase().endsWith('.jpg'));
  const organ300 = rootKeys.find(k => k === '2.Organ.Vinyl.300mb.mp4') || null;

  console.log('root objects:', rootKeys.length, 'jpg:', rootJpgs.length, 'organ300:', Boolean(organ300));

  // Delete root JPGs
  if (rootJpgs.length) {
    console.log('deleting root jpgs:', rootJpgs);
    for (const k of rootJpgs) await deleteKey(s3, bucket, k, args.execute);
  }

  if (organ300) {
    const isReferenced = referencedKeys.has(organ300);
    if (!isReferenced) {
      console.log('2.Organ.Vinyl.300mb.mp4 is NOT referenced; deleting');
      await deleteKey(s3, bucket, organ300, args.execute);
    } else {
      console.log('2.Organ.Vinyl.300mb.mp4 IS referenced; moving into project folder');
      const destKey = `Theatre Works/Dona Lourdès/${organ300}`;
      await ensureCopy(s3, bucket, organ300, destKey, args.execute);

      const newUrl = `https://${publicHost}/${encodeKeyForUrl(destKey)}`;
      // Update all rows that currently reference 300mb
      const col = indexToColumnLetter(sceneVideoIdx);
      for (const row1 of organ300Rows) {
        const a1 = `${col}${row1}`;
        await updateRange(sheets, spreadsheetId, scenesSheet, a1, [[newUrl]], args.execute);
      }
      // Delete the old root object
      await deleteKey(s3, bucket, organ300, args.execute);

      // If we are using the 300mb variant, remove the other variant in the project folder (if present).
      const otherKey = 'Theatre Works/Dona Lourdès/2.Organ.Vinyl.mp4';
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: otherKey }));
        console.log('Deleting other Organ Vinyl variant:', otherKey);
        await deleteKey(s3, bucket, otherKey, args.execute);
      } catch {
        // ignore
      }
    }
  }

  console.log('execute:', args.execute, 'done');
}

main().catch(err => {
  console.error('ERR', err?.message || err);
  process.exit(1);
});
