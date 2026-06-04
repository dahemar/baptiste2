#!/usr/bin/env node
/**
 * Verify about + files tabs are loaded from Google Sheets (not local CSV fallback).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const astroRoot = path.resolve(__dirname, '../astro-app');
process.chdir(astroRoot);

// Simulate production: no local CSV shortcut (Sheets → gviz → env CSV URL only)
process.env.VERCEL = '1';
// Optional: pass GOOGLE_SHEETS_API_KEY in env for API path

const { loadAboutData, clearSectionMemoryCache } = await import(
  path.join(astroRoot, 'src/utils/sectionContentManager.ts')
);
const gsm = await import(path.join(astroRoot, 'src/utils/googleSheetsManager.ts'));

clearSectionMemoryCache();
gsm.clearMemoryCache();

const about = await loadAboutData();
const audioFiles = await gsm.loadTheatreAudioFilesData({ force: true });

const aboutOk =
  about.presentationTitle.en.includes('Baptiste') &&
  about.bioP1.en.includes('Villa Arson');
const filesOk =
  audioFiles.length > 0 &&
  audioFiles[0].filename.includes('Chien Kora');

console.log('about.presentationTitle.en:', about.presentationTitle.en.slice(0, 60) + '…');
console.log('about.bioP1.en:', about.bioP1.en.slice(0, 60) + '…');
console.log('audioFiles:', audioFiles.length, audioFiles[0] || null);

if (aboutOk && filesOk) {
  console.log('\nOK: site loaders read Google Sheets tabs "about" and "files".');
  process.exit(0);
}

console.error('\nFAIL: expected content from Sheets.');
process.exit(1);
