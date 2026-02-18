#!/usr/bin/env node

/**
 * Update CSV to use R2 URLs instead of GitHub Releases
 */

const fs = require('fs');
const path = require('path');

const CSV_PATH = path.join(__dirname, '../astro-app/data/theatre-works.csv');
const BUCKET_NAME = 'baptiste-videos';
const ACCOUNT_ID = '7305104bf22993d080aa24f59e6a8465';

// R2 public URL
const R2_PUBLIC_URL = 'https://pub-f04cf0f8494f457e889559aa0b6e57b7.r2.dev';

console.log('Updating CSV to use R2 URLs...');
console.log('CSV path:', CSV_PATH);
console.log('R2 base URL:', R2_PUBLIC_URL);

// Read CSV
let csv = fs.readFileSync(CSV_PATH, 'utf8');
const originalCsv = csv;

// Pattern: Direct GitHub URLs or proxy URLs
const githubPattern = /(?:\/api\/proxy\?url=)?https:\/\/github\.com\/dahemar\/video-assets\/releases\/download\/media-assets-2026-01-28\/([^,\n]+\.mp4)/g;

let match;
let count = 0;
const replacements = [];

// Find all matches first
while ((match = githubPattern.exec(originalCsv)) !== null) {
  const filename = match[1];
  const oldUrl = match[0];
  const newUrl = `${R2_PUBLIC_URL}/${filename}`;
  replacements.push({ filename, oldUrl, newUrl });
  count++;
}

console.log(`\nFound ${count} video URLs to update:\n`);

// Apply replacements
replacements.forEach(({ filename, oldUrl, newUrl }) => {
  console.log(`  ${filename}`);
  console.log(`    FROM: ${oldUrl}`);
  console.log(`    TO:   ${newUrl}\n`);
  csv = csv.replace(oldUrl, newUrl);
});

// Write updated CSV
fs.writeFileSync(CSV_PATH, csv, 'utf8');

console.log(`✓ Updated ${count} URLs in ${CSV_PATH}`);
console.log('\nNext steps:');
console.log('1. Review the changes: git diff astro-app/data/theatre-works.csv');
console.log('2. Test locally: cd astro-app && npm run dev');
console.log('3. Commit and push: git add -A && git commit -m "feat: migrate videos to R2" && git push');
