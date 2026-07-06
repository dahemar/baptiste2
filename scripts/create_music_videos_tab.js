#!/usr/bin/env node
const { google } = require('googleapis');
const SA_PATH = '/Users/david/Documents/GitHub/joan-v2/.tmp/service-account.json';
const SPREADSHEET_ID = '15S6aAhOP-p20BuDP-UEdGkSoTk8ScMkHR9cnGsmlLHI';

async function main() {
  const credentials = require(SA_PATH);
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  // Check if tab exists
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const titles = (meta.data.sheets || []).map(s => s.properties && s.properties.title).filter(Boolean);
  
  if (!titles.includes('music_videos')) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: 'music_videos' } } }] },
    });
    console.log('Created music_videos tab.');
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: "'music_videos'!A1:B2",
    valueInputOption: 'RAW',
    requestBody: { values: [['field', 'value'], ['playlist_id', 'PL5hKVoM0x4JpIa3b9__0VqyjnROCsSTIc']] },
  });

  console.log('OK: music_videos tab created with playlist_id.');
}

main().catch(e => { console.error('ERR', e?.message || e); process.exit(1); });
