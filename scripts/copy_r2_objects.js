#!/usr/bin/env node
/*
 Copy existing objects in Cloudflare R2 into the prefix `Audiovisual/`.

 Usage (local):
 1) Install deps: `npm install @aws-sdk/client-s3`
 2) Set env vars:
    - R2_ENDPOINT (e.g. https://a9aa2c81cffdbdc0a558da017670f16c.r2.cloudflarestorage.com)
    - AWS_ACCESS_KEY_ID
    - AWS_SECRET_ACCESS_KEY
    - R2_BUCKET (bucket name, e.g. baptiste-videos)
 3) Run:
    node scripts/copy_r2_objects.js beni-1.mp4 beni-2.mp4

 The script will copy each object into `Audiovisual/<basename>` and print a mapping JSON
 to stdout that can be passed to the sheet-updater script.
*/

const { S3Client, CopyObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');

async function main() {
  const endpoint = process.env.R2_ENDPOINT;
  const region = process.env.R2_REGION || 'auto';
  const bucket = process.env.R2_BUCKET;
  if (!endpoint || !bucket) {
    console.error('R2_ENDPOINT and R2_BUCKET must be set in env');
    process.exit(1);
  }

  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle: false,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('Provide one or more object keys to copy (e.g. beni-1.mp4)');
    process.exit(1);
  }

  const mapping = {};

  for (const key of args) {
    const basename = path.basename(key);
    const destKey = `Audiovisual/${basename}`;

    try {
      // Verify source exists
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    } catch (err) {
      console.error(`Source object not found: ${key}`, err?.message || err);
      continue;
    }

    try {
      // Use S3 CopyObject to duplicate the object server-side
      const copySource = `/${bucket}/${encodeURIComponent(key)}`;
      await client.send(new CopyObjectCommand({
        Bucket: bucket,
        Key: destKey,
        CopySource: copySource,
      }));

      // Construct a public-ish URL: {bucket}.{accountid}.r2.cloudflarestorage.com/<key>
      const endpointUrl = new URL(endpoint);
      const host = endpointUrl.host; // e.g. a9aa2...r2.cloudflarestorage.com
      const publicUrl = `https://${bucket}.${host}/${encodeURIComponent(destKey)}`;
      mapping[key] = { destKey, publicUrl };
      console.log(`Copied ${key} -> ${destKey}`);
    } catch (err) {
      console.error(`Copy failed for ${key}:`, err?.message || err);
    }
  }

  console.log('\nMAPPING_JSON_START');
  console.log(JSON.stringify(mapping, null, 2));
  console.log('MAPPING_JSON_END');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
