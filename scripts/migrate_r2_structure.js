#!/usr/bin/env node
/*
End-to-end migration for Cloudflare R2 key structure + Google Sheets URL updates.

Goal:
 - Create folder structure in bucket:
   - Theatre Works/<Project Title>/<filename>
   - Audiovisual/<filename>
 - Copy (server-side) existing objects to new keys
 - Update Google Sheets URLs (theatre-works-scenes + audiovisual)
 - Optionally delete old keys after successful copy + sheet update

Required env vars:
 - R2_ENDPOINT (e.g. https://<accountid>.r2.cloudflarestorage.com)
 - R2_BUCKET (e.g. baptiste-videos)
 - AWS_ACCESS_KEY_ID
 - AWS_SECRET_ACCESS_KEY
 - GOOGLE_APPLICATION_CREDENTIALS (path to service account json)

Optional env vars:
 - R2_PUBLIC_HOST (e.g. pub-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.r2.dev)

Usage:
  node scripts/migrate_r2_structure.js --spreadsheetId <ID> --execute --delete

By default it's a dry-run (no copy/update/delete) unless --execute is provided.
*/

const path = require('path');
const { google } = require('googleapis');
const { S3Client, CopyObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

function parseArgs(argv) {
  const args = { execute: false, delete: false, spreadsheetId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--execute') args.execute = true;
    else if (a === '--delete') args.delete = true;
    else if (a === '--spreadsheetId') args.spreadsheetId = argv[++i];
  }
  return args;
}

function sanitizeKeySegment(title) {
  const raw = String(title ?? '').trim();
  if (!raw) return 'Untitled';
  // Keep unicode, but remove slashes and control chars to avoid confusing keys.
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled';
}

function encodeKeyForUrl(key) {
  return key
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/');
}

function urlToR2Key(u) {
  const parsed = new URL(u);
  return decodeURIComponent(parsed.pathname.replace(/^\//, ''));
}

function indexToColumnLetter(idx0) {
  // 0 -> A, 25 -> Z, 26 -> AA
  let n = idx0 + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

async function getValues(sheets, spreadsheetId, range) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return res.data.values || [];
}

async function updateColumnValues(sheets, spreadsheetId, sheetName, colIdx0, startRow1, values) {
  const col = indexToColumnLetter(colIdx0);
  const endRow1 = startRow1 + values.length - 1;
  const range = `'${sheetName}'!${col}${startRow1}:${col}${endRow1}`;
  const body = { values: values.map(v => [v]) };
  return sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: body,
  });
}

async function ensureCopy(client, bucket, sourceKey, destKey, execute) {
  // Skip if dest exists
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: destKey }));
    return { copied: false, already: true };
  } catch {
    // continue
  }

  if (!execute) return { copied: true, dryRun: true };

  const copySource = `/${bucket}/${encodeURIComponent(sourceKey)}`;
  await client.send(new CopyObjectCommand({ Bucket: bucket, Key: destKey, CopySource: copySource }));
  return { copied: true, already: false };
}

async function deleteKey(client, bucket, key, execute) {
  if (!execute) return { deleted: true, dryRun: true };
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  return { deleted: true };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.spreadsheetId) {
    console.error('Missing --spreadsheetId');
    process.exit(1);
  }

  const endpoint = process.env.R2_ENDPOINT;
  const bucket = process.env.R2_BUCKET;
  if (!endpoint || !bucket) {
    console.error('R2_ENDPOINT and R2_BUCKET must be set');
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

  const sheets = await getSheetsClient();
  const spreadsheetId = args.spreadsheetId;

  // Identify sheet names (case-sensitive in API)
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetTitles = (meta.data.sheets || []).map(s => s.properties && s.properties.title).filter(Boolean);
  const theatreWorksSheet = sheetTitles.find(t => t === 'theatre_works') || sheetTitles.find(t => String(t).toLowerCase() === 'theatre_works');
  const theatreScenesSheet = sheetTitles.find(t => t === 'theatre-works-scenes') || sheetTitles.find(t => String(t).toLowerCase() === 'theatre-works-scenes');
  const audiovisualSheet = sheetTitles.find(t => t === 'audiovisual') || sheetTitles.find(t => String(t).toLowerCase() === 'audiovisual');

  if (!theatreWorksSheet || !theatreScenesSheet) {
    console.error('Missing expected sheets. Found:', sheetTitles.join(', '));
    process.exit(1);
  }

  // Load works: map work_slug -> title
  const worksValues = await getValues(sheets, spreadsheetId, `'${theatreWorksSheet}'!A1:Z`);
  const worksHeader = worksValues[0] || [];
  const idxWorkSlug = worksHeader.findIndex(h => String(h).trim() === 'work_slug');
  const idxWorkTitle = worksHeader.findIndex(h => String(h).trim() === 'title');
  if (idxWorkSlug < 0 || idxWorkTitle < 0) {
    console.error('Could not find work_slug/title columns in', theatreWorksSheet, 'header:', worksHeader);
    process.exit(1);
  }
  const workSlugToTitle = new Map();
  for (const row of worksValues.slice(1)) {
    const slug = String(row[idxWorkSlug] ?? '').trim();
    const title = String(row[idxWorkTitle] ?? '').trim();
    if (slug) workSlugToTitle.set(slug, title || slug);
  }

  // Load theatre scenes
  const scenesValues = await getValues(sheets, spreadsheetId, `'${theatreScenesSheet}'!A1:Z`);
  const scenesHeader = scenesValues[0] || [];
  const idxSceneWorkSlug = scenesHeader.findIndex(h => String(h).trim() === 'work_slug');
  const idxSceneVideoUrl = scenesHeader.findIndex(h => String(h).trim() === 'video_url');
  if (idxSceneWorkSlug < 0 || idxSceneVideoUrl < 0) {
    console.error('Could not find work_slug/video_url columns in', theatreScenesSheet, 'header:', scenesHeader);
    process.exit(1);
  }

  // Infer public host from existing URLs if not provided
  let publicHost = process.env.R2_PUBLIC_HOST || null;
  if (!publicHost) {
    const sample = scenesValues.slice(1).map(r => r[idxSceneVideoUrl]).find(v => String(v || '').includes('.r2.dev/'));
    if (sample) publicHost = new URL(String(sample)).host;
  }
  if (!publicHost) {
    console.error('R2_PUBLIC_HOST not set and could not infer from sheet URLs');
    process.exit(1);
  }

  const copyOps = [];
  const theatreRowNewUrls = [];
  const theatreSourceKeysToDelete = new Set();

  // Build copy plan for theatre scenes (row-aligned list of new URLs)
  for (const row of scenesValues.slice(1)) {
    const url = String(row[idxSceneVideoUrl] ?? '').trim();
    const slug = String(row[idxSceneWorkSlug] ?? '').trim();
    if (!url || !url.includes('.mp4')) {
      theatreRowNewUrls.push(url);
      continue;
    }

    let sourceKey;
    try {
      sourceKey = urlToR2Key(url);
    } catch {
      theatreRowNewUrls.push(url);
      continue;
    }

    const title = workSlugToTitle.get(slug) || slug || 'Untitled';
    const projectFolder = sanitizeKeySegment(title);
    const destKey = `Theatre Works/${projectFolder}/${path.basename(sourceKey)}`;
    const newUrl = `https://${publicHost}/${encodeKeyForUrl(destKey)}`;

    theatreRowNewUrls.push(newUrl);
    copyOps.push({ kind: 'theatre', sourceKey, destKey, oldUrl: url, newUrl });

    // Only delete when the source is a legacy/root path (not already under the new prefixes)
    if (!sourceKey.startsWith('Theatre Works/') && !sourceKey.startsWith('Audiovisual/')) {
      theatreSourceKeysToDelete.add(sourceKey);
    }
  }

  // Audiovisual: optional
  let audiovisualOps = [];
  let audiovisualUpdate = null;
  if (audiovisualSheet) {
    const avValues = await getValues(sheets, spreadsheetId, `'${audiovisualSheet}'!A1:Z`);
    const avHeader = avValues[0] || [];
    const idxAvTitle = avHeader.findIndex(h => String(h).trim() === 'title');
    const idxAvVideoUrl = avHeader.findIndex(h => String(h).trim() === 'video_url');
    const avRowNewUrls = [];
    const avSourceKeysToDelete = new Set();

    if (idxAvVideoUrl >= 0) {
      for (const row of avValues.slice(1)) {
        const url = String(row[idxAvVideoUrl] ?? '').trim();
        const title = idxAvTitle >= 0 ? String(row[idxAvTitle] ?? '').trim() : '';

        if (url && url.includes('.mp4')) {
          let sourceKey;
          try { sourceKey = urlToR2Key(url); } catch { avRowNewUrls.push(url); continue; }
          const destKey = `Audiovisual/${path.basename(sourceKey)}`;
          const newUrl = `https://${publicHost}/${encodeKeyForUrl(destKey)}`;
          avRowNewUrls.push(newUrl);
          audiovisualOps.push({ kind: 'audiovisual', sourceKey, destKey, oldUrl: url, newUrl });
          if (!sourceKey.startsWith('Theatre Works/') && !sourceKey.startsWith('Audiovisual/')) avSourceKeysToDelete.add(sourceKey);
          continue;
        }

        // If URL is empty, but the title looks like it refers to Beni 1/2, fill it.
        if (!url && title && /\bbeni\b/i.test(title)) {
          const n = /\b(1|2)\b/.exec(title)?.[1] || null;
          if (n) {
            const key = `Beni ${n}.mp4`;
            const destKey = `Audiovisual/${key}`;
            const newUrl = `https://${publicHost}/${encodeKeyForUrl(destKey)}`;
            avRowNewUrls.push(newUrl);
            // Copy from root if it exists; if it doesn't, we'll still set URL (object already copied earlier).
            audiovisualOps.push({ kind: 'audiovisual', sourceKey: key, destKey, oldUrl: '', newUrl });
            if (!key.startsWith('Audiovisual/')) avSourceKeysToDelete.add(key);
            continue;
          }
        }

        avRowNewUrls.push(url);
      }

      audiovisualUpdate = { sheetName: audiovisualSheet, colIdx0: idxAvVideoUrl, startRow1: 2, values: avRowNewUrls, deleteKeys: avSourceKeysToDelete };
    }
  }

  // Deduplicate copy ops by (sourceKey,destKey)
  const copyPlan = [];
  const seen = new Set();
  for (const op of [...copyOps, ...audiovisualOps]) {
    const k = `${op.sourceKey}||${op.destKey}`;
    if (seen.has(k)) continue;
    seen.add(k);
    copyPlan.push(op);
  }

  console.log('--- MIGRATION PLAN ---');
  console.log('Public host:', publicHost);
  console.log('Theatre scenes rows:', scenesValues.length - 1);
  console.log('Copy ops:', copyPlan.length);
  console.log('Execute:', args.execute, 'Delete:', args.delete);

  // Execute copies
  const copyResults = { ok: 0, skipped: 0, failed: 0 };
  for (const op of copyPlan) {
    try {
      // Ensure source exists (helpful for Beni where key might already only exist in Audiovisual/)
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: op.sourceKey }));
      } catch {
        // If source missing but destination exists, treat as ok.
        try {
          await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: op.destKey }));
          copyResults.skipped++;
          continue;
        } catch {
          throw new Error(`Missing source and dest: ${op.sourceKey} -> ${op.destKey}`);
        }
      }

      const r = await ensureCopy(s3, bucket, op.sourceKey, op.destKey, args.execute);
      if (r.already) copyResults.skipped++;
      else copyResults.ok++;
    } catch (e) {
      copyResults.failed++;
      console.error('COPY_FAIL', op.sourceKey, '->', op.destKey, String(e?.message || e));
    }
  }

  if (copyResults.failed) {
    console.error('Aborting sheet update due to copy failures');
    process.exit(2);
  }

  // Update sheets
  if (args.execute) {
    await updateColumnValues(sheets, spreadsheetId, theatreScenesSheet, idxSceneVideoUrl, 2, theatreRowNewUrls);
    if (audiovisualUpdate) {
      await updateColumnValues(sheets, spreadsheetId, audiovisualUpdate.sheetName, audiovisualUpdate.colIdx0, audiovisualUpdate.startRow1, audiovisualUpdate.values);
    }
  } else {
    console.log('DRY_RUN: skipping Sheets update');
  }

  // Delete old keys
  if (args.delete) {
    const deleteKeys = new Set([...theatreSourceKeysToDelete]);
    if (audiovisualUpdate) {
      for (const k of audiovisualUpdate.deleteKeys) deleteKeys.add(k);
    }

    // Never delete keys that are already under the new prefixes
    for (const k of Array.from(deleteKeys)) {
      if (k.startsWith('Theatre Works/') || k.startsWith('Audiovisual/')) deleteKeys.delete(k);
    }

    console.log('Delete candidates:', deleteKeys.size);
    let deleted = 0;
    for (const k of deleteKeys) {
      try {
        await deleteKey(s3, bucket, k, args.execute);
        deleted++;
      } catch (e) {
        console.error('DELETE_FAIL', k, String(e?.message || e));
      }
    }
    console.log('Deleted:', deleted);
  } else {
    console.log('Skipping deletes (use --delete)');
  }

  console.log('--- DONE ---');
  console.log('Copies ok:', copyResults.ok, 'skipped:', copyResults.skipped, 'failed:', copyResults.failed);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
