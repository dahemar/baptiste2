#!/usr/bin/env node
const { google } = require('googleapis');
const SA_PATH = '/Users/david/Documents/GitHub/joan-v2/.tmp/service-account.json';
const SPREADSHEET_ID = '15S6aAhOP-p20BuDP-UEdGkSoTk8ScMkHR9cnGsmlLHI';

function colLetter(n) { let x = n, s = ''; while (x > 0) { s = String.fromCharCode(65 + ((x-1) % 26)) + s; x = Math.floor((x-1) / 26); } return s; }

async function main() {
  const credentials = require(SA_PATH);
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const read = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "'music'!A1:Z50" });
  const rows = read.data.values || [];
  if (rows.length < 2) { console.error('Music tab empty'); process.exit(1); }

  const oldHeaders = (rows[0] || []).map(h => String(h || '').trim().toLowerCase());
  const skipCols = new Set(['id', 'all_releases_url']);
  const hasSortOrder = oldHeaders.includes('sort_order');

  // Build new headers: skip id & all_releases_url
  const newHeaders = [];
  for (const h of rows[0]) {
    const name = String(h || '').trim().toLowerCase();
    if (skipCols.has(name)) continue;
    newHeaders.push(String(h || '').trim());
  }
  if (!hasSortOrder) newHeaders.unshift('sort_order');

  console.log('Old headers:', rows[0].join(', '));
  console.log('New headers:', newHeaders.join(', '));

  const newRows = [newHeaders];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const title = String(row[1] || '').trim();
    if (!title) continue;

    const newRow = [];
    // First column: sort_order (use existing value or row position)
    if (hasSortOrder) {
      const sortIdx = oldHeaders.indexOf('sort_order');
      newRow.push(String(row[sortIdx] || i).trim());
    } else {
      newRow.push(String(i));
    }

    // Remaining columns: skip id and all_releases_url
    for (let j = 0; j < row.length && j < rows[0].length; j++) {
      const colName = oldHeaders[j];
      if (skipCols.has(colName)) continue;
      if (colName === 'sort_order') continue;
      newRow.push(String(row[j] || '').trim());
    }
    newRows.push(newRow);
  }

  const endCol = colLetter(newHeaders.length);
  const range = `'music'!A1:${endCol}${newRows.length}`;
  await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range, valueInputOption: 'RAW', requestBody: { values: newRows } });

  console.log(`OK: wrote ${newRows.length - 1} rows to music tab.`);
  console.log(`Columns: ${newHeaders.join(', ')}`);
}

main().catch(e => { console.error('ERR', e?.message || e); process.exit(1); });
