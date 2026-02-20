#!/usr/bin/env node

const { google } = require('googleapis');

function parseArgs(argv) {
  const out = { spreadsheetId: null, migrateAudiovisual: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--spreadsheetId') out.spreadsheetId = argv[++i];
    if (a === '--migrateAudiovisual') out.migrateAudiovisual = true;
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

  if (args.migrateAudiovisual) {
    // Auto-fill row_type for existing rows:
    // - 'project' if project_title set and no media URL
    // - 'video' if video_url/thumbnail_url/external_url set
    const avAll = await sheets.spreadsheets.values.get({ spreadsheetId, range: range('audiovisual', 'A1:Z500') });
    const values = avAll.data.values || [];
    if (values.length >= 2) {
      const headers = (values[0] || []).map(h => String(h || '').trim().toLowerCase());
      const idx = (name) => headers.findIndex(h => h === name);
      const idxRowType = idx('row_type');
      const idxProject = idx('project_title');
      const idxVideo = idx('video_url');
      const idxThumb = idx('thumbnail_url');
      const idxExt = idx('external_url');

      if (idxRowType >= 0) {
        const outCol = [];
        let anyChanges = false;
        for (let r = 1; r < values.length; r++) {
          const row = values[r] || [];
          const existingType = String(row[idxRowType] || '').trim().toLowerCase();
          const projectTitle = idxProject >= 0 ? String(row[idxProject] || '').trim() : '';
          const videoUrl = idxVideo >= 0 ? String(row[idxVideo] || '').trim() : '';
          const thumbUrl = idxThumb >= 0 ? String(row[idxThumb] || '').trim() : '';
          const externalUrl = idxExt >= 0 ? String(row[idxExt] || '').trim() : '';
          const hasMedia = !!(videoUrl || thumbUrl || externalUrl);

          let nextType = existingType;
          if (!nextType) {
            if (hasMedia) nextType = 'video';
            else if (projectTitle) nextType = 'project';
          }

          if (nextType !== existingType) anyChanges = true;
          outCol.push([nextType]);
        }

        if (anyChanges) {
          const col = colLetter(idxRowType + 1);
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: range('audiovisual', `${col}2:${col}${outCol.length + 1}`),
            valueInputOption: 'RAW',
            requestBody: { values: outCol },
          });
        }
      }
    }
  }

  console.log('OK: ensured contact sheet + audiovisual columns');
  if (args.migrateAudiovisual) console.log('OK: audiovisual row_type migration applied (up to first 500 rows)');
}

main().catch((e) => {
  console.error('ERR', e?.message || e);
  process.exit(1);
});
