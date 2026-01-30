#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const fetch = global.fetch || require('node-fetch');

(async function main(){
  try {
    const API_KEY = process.env.GOOGLE_SHEETS_API_KEY || process.env.GOOGLE_API_KEY;
    if (!API_KEY) {
      console.error('Missing GOOGLE_SHEETS_API_KEY or GOOGLE_API_KEY env var');
      process.exit(2);
    }

    const SHEET_ID = process.env.THEATRE_SHEET_ID || '15S6aAhOP-p20BuDP-UEdGkSoTk8ScMkHR9cnGsmlLHI';
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/theatre_works?key=${API_KEY}`;
    console.log('Fetching', url.replace(/key=.*/,'key=REDACTED'));

    const res = await fetch(url, { method: 'GET', timeout: 10000 });
    if (!res.ok) {
      console.error('Google Sheets API responded', res.status, res.statusText);
      const body = await res.text();
      console.error(body);
      process.exit(3);
    }
    const data = await res.json();
    const values = data.values || [];
    if (values.length === 0) {
      console.warn('No rows returned from sheet');
    }

    // First row = headers
    const headers = values[0] || [];
    const rows = values.slice(1);

    const works = rows.map(row => {
      const obj = {};
      for (let i = 0; i < headers.length; i++) {
        const key = (headers[i] || '').toString().trim();
        if (!key) continue;
        obj[key] = (row[i] || '').toString().trim();
      }
      // Normalize common keys
      if (!obj.title && obj.name) obj.title = obj.name;
      if (!obj.video && obj.video_url) obj.video = obj.video_url;
      if (!obj.thumbnail && obj.thumbnail_url) obj.thumbnail = obj.thumbnail_url;
      return obj;
    }).filter(w => Object.keys(w).length > 0);

    const out = { fetchedAt: new Date().toISOString(), count: works.length, works };

    const outDir = path.resolve('astro-app/.cache');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'theatre-works.json');
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    console.log('Wrote', outPath, 'works=', works.length);
    process.exit(0);
  } catch (err) {
    console.error(err && err.stack || err);
    process.exit(4);
  }
})();
