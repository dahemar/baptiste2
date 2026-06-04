#!/usr/bin/env node
/**
 * Create/update Google Sheets tabs "about" (bio) and "files" (theatre audio list)
 * from local CSV seeds in astro-app/data/.
 *
 * Requires write access (NOT the read-only API key):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *   SERVICE_ACCOUNT_PATH=/path/to/service-account.json  (same as web-cora scripts)
 *   (share the spreadsheet with the service account client_email as Editor)
 * OR: gcloud auth application-default login
 *
 * Usage:
 *   node scripts/sync_content_tabs_to_sheets.js
 *   node scripts/sync_content_tabs_to_sheets.js --dry-run
 */

const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.THEATRE_SHEET_ID || process.env.CONTENT_SHEET_ID || '15S6aAhOP-p20BuDP-UEdGkSoTk8ScMkHR9cnGsmlLHI';
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'astro-app', 'data');

const TABS = [
  {
    title: 'about',
    csvPath: path.join(DATA_DIR, 'about.csv'),
    aliases: ['about'],
  },
  {
    title: 'files',
    csvPath: path.join(DATA_DIR, 'theatre-audio.csv'),
    aliases: ['files', 'theatre-audio'],
  },
  {
    title: 'music',
    csvPath: path.join(DATA_DIR, 'music.csv'),
    aliases: ['music'],
  },
];

function colLetter(n) {
  let x = n;
  let s = '';
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function a1Range(sheetTitle, rows) {
  const endCol = colLetter(rows[0].length);
  const endRow = rows.length;
  return `'${sheetTitle}'!A1:${endCol}${endRow}`;
}

function parseCsvLine(line) {
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
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

function resolveServiceAccountCredentials() {
  const candidates = [
    process.env.SERVICE_ACCOUNT_PATH,
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(ROOT, '.tmp', 'service-account.json'),
    path.join(process.env.HOME || '', 'Desktop', 'web', 'web-cora-ac37b5dec5b1.json'),
  ].filter(Boolean);

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const creds = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (creds.client_email && creds.private_key) {
        return { creds, filePath };
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

function readCsvRows(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return text
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim().length > 0)
    .map((line) => parseCsvLine(line));
}

async function ensureSheet(sheets, spreadsheetId, title, existingTitles) {
  if (existingTitles.has(title)) return false;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }],
    },
  });
  existingTitles.add(title);
  console.log(`Created tab "${title}".`);
  return true;
}

async function writeTab(sheets, spreadsheetId, title, rows) {
  const range = a1Range(title, rows);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });
  console.log(`OK: wrote ${rows.length - 1} data row(s) to "${title}" (${range}).`);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  for (const tab of TABS) {
    if (!fs.existsSync(tab.csvPath)) {
      console.error(`Missing seed CSV: ${tab.csvPath}`);
      process.exit(1);
    }
  }

  const tabPayloads = TABS.map((tab) => ({
    ...tab,
    rows: readCsvRows(tab.csvPath),
  }));

  if (dryRun) {
    for (const tab of tabPayloads) {
      console.log(`[dry-run] ${tab.title}: ${tab.rows.length - 1} rows from ${tab.csvPath}`);
    }
    return;
  }

  const sa = resolveServiceAccountCredentials();
  let authClient;
  try {
    if (sa) {
      console.log(`Using service account: ${sa.creds.client_email} (${sa.filePath})`);
      const auth = new google.auth.GoogleAuth({
        credentials: sa.creds,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      authClient = await auth.getClient();
    } else {
      const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      authClient = await auth.getClient();
    }
  } catch (e) {
    console.error('Authentication failed. API keys cannot write to Sheets.');
    console.error('Set SERVICE_ACCOUNT_PATH or GOOGLE_APPLICATION_CREDENTIALS to your service account JSON.');
    console.error('Share the spreadsheet with that client_email as Editor (e.g. sheets-writer@web-cora.iam.gserviceaccount.com).');
    console.error('Or run: gcloud auth application-default login');
    console.error('Error:', e.message);
    process.exit(1);
  }

  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existingTitles = new Set(
    (meta.data.sheets || []).map((s) => s.properties && s.properties.title).filter(Boolean),
  );

  console.log('Spreadsheet tabs:', [...existingTitles].join(', '));

  for (const tab of tabPayloads) {
    await ensureSheet(sheets, SPREADSHEET_ID, tab.title, existingTitles);
    await writeTab(sheets, SPREADSHEET_ID, tab.title, tab.rows);
  }

  console.log('\nDone. Site loaders read tabs: about, files, music (and legacy theatre-audio).');
  console.log('After deploy, call /api/theatre-works?force=1 or your refresh webhook to clear caches.');
}

main().catch((e) => {
  console.error('ERR', e?.message || e);
  process.exit(1);
});
