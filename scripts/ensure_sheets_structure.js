#!/usr/bin/env node

const { google } = require('googleapis');

function parseArgs(argv) {
  const out = { spreadsheetId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--spreadsheetId') out.spreadsheetId = argv[++i];
  }
  return out;
}

function colLetter(n1) {
  let x = n1;
  let s = '';
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const spreadsheetId = args.spreadsheetId;
  if (!spreadsheetId) {
    console.error('Missing --spreadsheetId');
    process.exit(1);
  }

  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const titles = (meta.data.sheets || []).map(s => s.properties && s.properties.title).filter(Boolean);
  const hasTitle = (t) => titles.includes(t);

  // Ensure 'contact' sheet exists
  if (hasTitle('contact') === false) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: 'contact' } } }] },
    });
  }

  const bang = String.fromCharCode(33);
  const range = (name, a1) => `'${name}'${bang}${a1}`;

  // Ensure contact header + keys
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range: range('contact', 'A1:B3') });
  const v = existing.data.values || [];
  if (v.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: range('contact', 'A1:B3'),
      valueInputOption: 'RAW',
      requestBody: { values: [['key', 'value'], ['email', ''], ['instagram', '']] },
    });
  } else {
    const header = v[0] || [];
    const h0 = String(header[0] || '').trim().toLowerCase();
    const h1 = String(header[1] || '').trim().toLowerCase();
    if (h0 !== 'key' || h1 !== 'value') {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: range('contact', 'A1:B1'),
        valueInputOption: 'RAW',
        requestBody: { values: [['key', 'value']] },
      });
    }
    const row2Key = String((v[1] || [])[0] || '').trim().toLowerCase();
    const row3Key = String((v[2] || [])[0] || '').trim().toLowerCase();
    if (row2Key !== 'email') {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: range('contact', 'A2:A2'),
        valueInputOption: 'RAW',
        requestBody: { values: [['email']] },
      });
    }
    if (row3Key !== 'instagram') {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: range('contact', 'A3:A3'),
        valueInputOption: 'RAW',
        requestBody: { values: [['instagram']] },
      });
    }
  }

  // Ensure audiovisual columns
  const av = await sheets.spreadsheets.values.get({ spreadsheetId, range: range('audiovisual', 'A1:Z1') });
  const headerRow = (av.data.values && av.data.values[0]) ? av.data.values[0] : [];
  const norm = headerRow.map(h => String(h || '').trim());
  const hasCol = (name) => norm.some(h => h.toLowerCase() === name);
  const newHeader = [...norm];
  let changed = false;
  if (hasCol('project_title') === false) { newHeader.push('project_title'); changed = true; }
  if (hasCol('row_type') === false) { newHeader.push('row_type'); changed = true; }
  if (changed) {
    const end = colLetter(newHeader.length);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: range('audiovisual', `A1:${end}1`),
      valueInputOption: 'RAW',
      requestBody: { values: [newHeader] },
    });
  }

  console.log('OK: ensured contact sheet + audiovisual columns');
}

main().catch((e) => {
  console.error('ERR', e?.message || e);
  process.exit(1);
});
