#!/usr/bin/env node

const { google } = require('googleapis');
const {
  S3Client,
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.spreadsheetId) {
    console.error('Missing --spreadsheetId');
    process.exit(1);
  }

  const bucket = process.env.R2_BUCKET;
  const endpoint = process.env.R2_ENDPOINT;
  const publicHost = process.env.R2_PUBLIC_HOST;
  if (!bucket || !endpoint || !publicHost) {
    console.error('Missing env: R2_BUCKET, R2_ENDPOINT, R2_PUBLIC_HOST');
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

  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });
  const spreadsheetId = args.spreadsheetId;

  const source1 = 'Audiovisual/Beni 1.mp4';
  const source2 = 'Audiovisual/Beni 2.mp4';
  const dest1 = 'Audiovisual/project 1/Beni 1.mp4';
  const dest2 = 'Audiovisual/project 1/Beni 2.mp4';

  // Copy if needed
  async function ensureCopy(sourceKey, destKey) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: destKey }));
      return;
    } catch {
      // continue
    }
    if (!args.execute) {
      console.log('[dry-run] copy', sourceKey, '->', destKey);
      return;
    }
    const copySource = `/${bucket}/${encodeURIComponent(sourceKey)}`;
    await s3.send(new CopyObjectCommand({ Bucket: bucket, Key: destKey, CopySource: copySource }));
    console.log('copied', sourceKey, '->', destKey);
  }

  await ensureCopy(source1, dest1);
  await ensureCopy(source2, dest2);

  const url1 = `https://${publicHost}/${encodeKeyForUrl(dest1)}`;
  const url2 = `https://${publicHost}/${encodeKeyForUrl(dest2)}`;

  // Update sheet rows 2 and 3: video_url + project_title + row_type
  const bang = String.fromCharCode(33);
  const range = (name, a1) => `'${name}'${bang}${a1}`;
  const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: range('audiovisual', 'A1:Z1') });
  const header = (headerRes.data.values && headerRes.data.values[0]) ? headerRes.data.values[0].map(h => String(h || '').trim()) : [];
  const idxVideo = header.findIndex(h => h.toLowerCase() === 'video_url');
  const idxProject = header.findIndex(h => h.toLowerCase() === 'project_title');
  const idxType = header.findIndex(h => h.toLowerCase() === 'row_type');
  if (idxVideo < 0) throw new Error('audiovisual.video_url not found');
  if (idxProject < 0 || idxType < 0) throw new Error('audiovisual project_title/row_type columns missing');

  const videoCol = indexToColumnLetter(idxVideo);
  const projectCol = indexToColumnLetter(idxProject);
  const typeCol = indexToColumnLetter(idxType);

  if (args.execute) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: range('audiovisual', `${videoCol}2:${videoCol}3`),
      valueInputOption: 'RAW',
      requestBody: { values: [[url1], [url2]] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: range('audiovisual', `${projectCol}2:${projectCol}3`),
      valueInputOption: 'RAW',
      requestBody: { values: [['project 1'], ['project 1']] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: range('audiovisual', `${typeCol}2:${typeCol}3`),
      valueInputOption: 'RAW',
      requestBody: { values: [['video'], ['video']] },
    });
  } else {
    console.log('[dry-run] would set urls:', url1, url2);
  }

  // Delete old keys
  if (args.execute) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: source1 }));
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: source2 }));
    console.log('deleted old keys', source1, source2);
  } else {
    console.log('[dry-run] would delete', source1, source2);
  }

  console.log('OK');
}

main().catch((e) => {
  console.error('ERR', e?.message || e);
  process.exit(1);
});
