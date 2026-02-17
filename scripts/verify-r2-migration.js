#!/usr/bin/env node

/**
 * Verify R2 migration - check all videos are accessible
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CSV_PATH = path.join(__dirname, '../astro-app/data/theatre-works.csv');

console.log('Verifying R2 migration...\n');

// Read CSV and extract all video URLs
const csv = fs.readFileSync(CSV_PATH, 'utf8');
const videoPattern = /VIDEOS,\d+,\d+,([^,\n]+)/g;
const urls = [];
let match;

while ((match = videoPattern.exec(csv)) !== null) {
  const url = match[1];
  if (url && url !== 'Video_File' && url.startsWith('http')) {
    urls.push(url);
  }
}

console.log(`Found ${urls.length} video URLs in CSV\n`);

// Check each URL
let passed = 0;
let failed = 0;
const failures = [];

async function checkUrl(url) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const req = https.request(url, { method: 'HEAD' }, (res) => {
      const elapsed = Date.now() - startTime;
      const size = res.headers['content-length'];
      const cacheControl = res.headers['cache-control'];
      const contentType = res.headers['content-type'];
      
      if (res.statusCode === 200) {
        console.log(`✓ ${path.basename(url)}`);
        console.log(`  Status: ${res.statusCode}`);
        console.log(`  Size: ${(size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Cache: ${cacheControl || 'none'}`);
        console.log(`  Type: ${contentType || 'none'}`);
        console.log(`  Time: ${elapsed}ms\n`);
        passed++;
        resolve(true);
      } else {
        console.log(`✗ ${path.basename(url)}`);
        console.log(`  Status: ${res.statusCode}`);
        console.log(`  Time: ${elapsed}ms\n`);
        failed++;
        failures.push({ url, status: res.statusCode });
        resolve(false);
      }
    });
    
    req.on('error', (error) => {
      const elapsed = Date.now() - startTime;
      console.log(`✗ ${path.basename(url)}`);
      console.log(`  Error: ${error.message}`);
      console.log(`  Time: ${elapsed}ms\n`);
      failed++;
      failures.push({ url, error: error.message });
      resolve(false);
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      console.log(`✗ ${path.basename(url)}`);
      console.log(`  Error: Timeout after 10s\n`);
      failed++;
      failures.push({ url, error: 'Timeout' });
      resolve(false);
    });
    
    req.end();
  });
}

async function runChecks() {
  for (const url of urls) {
    await checkUrl(url);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`Total: ${urls.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  
  if (failed > 0) {
    console.log('\n' + '='.repeat(60));
    console.log('FAILURES');
    console.log('='.repeat(60));
    failures.forEach(({ url, status, error }) => {
      console.log(`\n${path.basename(url)}`);
      console.log(`  URL: ${url}`);
      if (status) console.log(`  Status: ${status}`);
      if (error) console.log(`  Error: ${error}`);
    });
    process.exit(1);
  } else {
    console.log('\n✓ All videos are accessible!');
    process.exit(0);
  }
}

runChecks().catch(err => {
  console.error('Error running checks:', err);
  process.exit(1);
});
