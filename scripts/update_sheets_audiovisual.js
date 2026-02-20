#!/usr/bin/env node
/*
 Update Google Sheets 'Audiovisual' sheet replacing old URLs with new URLs.

 Usage:
 1) Install deps: `npm install googleapis` (or add to your project)
 2) Provide service account JSON file path in env var `GOOGLE_APPLICATION_CREDENTIALS`
 3) Run:
    node scripts/update_sheets_audiovisual.js --spreadsheetId=<SPREADSHEET_ID> mapping.json

 mapping.json should be the JSON printed by the copy script, mapping oldKey -> { destKey, publicUrl }

 The script performs a FindReplace for each old URL to the new publicUrl across the sheet named 'Audiovisual'.
*/

const fs = require('fs');
const { google } = require('googleapis');
const yargs = require('yargs');

async function main() {
  const argv = yargs(process.argv.slice(2)).option('spreadsheetId', { type: 'string', demandOption: true }).argv;
  const spreadsheetId = argv.spreadsheetId;
  const mappingPath = argv._[0];
  if (!mappingPath) {
    console.error('Provide mapping.json produced by the copy script');
    process.exit(1);
  }

  const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));

  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const requests = [];
  for (const [oldKey, info] of Object.entries(mapping)) {
    const oldUrlCandidates = [
      // The sheet may contain the S3-style URL or a pub domain; try both patterns
      `https://${process.env.R2_BUCKET || ''}.${new URL(process.env.R2_ENDPOINT || '').host}/${encodeURIComponent(info.destKey)}`,
      info.publicUrl,
    ].filter(Boolean);

    for (const oldUrl of oldUrlCandidates) {
      requests.push({
        findReplace: {
          find: oldUrl,
          replacement: info.publicUrl,
          allSheets: false,
          sheetId: null,
          includeFormulas: true,
        }
      });
    }
  }

  // Restrict to sheet named 'Audiovisual' by obtaining its sheetId
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets.find(s => s.properties && s.properties.title === 'Audiovisual');
  if (!sheet) {
    console.error("Couldn't find a sheet named 'Audiovisual' in spreadsheet", spreadsheetId);
    process.exit(1);
  }

  // Adjust requests to target the sheetId
  const sheetId = sheet.properties.sheetId;
  const rr = requests.map(r => ({ findReplace: { ...r.findReplace, sheetId, allSheets: false } }));

  if (!rr.length) {
    console.log('No replacements to perform.');
    return;
  }

  const batch = { requests: rr };
  const res = await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: batch });
  console.log('BatchUpdate result:', res.status, res.statusText);
}

main().catch(err => { console.error(err); process.exit(1); });
