import { spawn } from 'node:child_process';

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || 'a9aa2c81cffdbdc0a558da017670f16c';
const BUCKET = process.env.R2_BUCKET || 'baptiste-videos';
const ENDPOINT = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;
const PUBLIC_HOST = 'pub-f04cf0f8494f457e889559aa0b6e57b7.r2.dev';

function awsEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  env.AWS_DEFAULT_REGION = 'auto';
  const accessKey = process.env.R2_ACCESS_KEY_ID;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY;
  if (accessKey && secretKey) {
    env.AWS_ACCESS_KEY_ID = accessKey;
    env.AWS_SECRET_ACCESS_KEY = secretKey;
  }
  return env;
}

export async function uploadImageToR2(
  key: string,
  body: Buffer,
  contentType = 'image/jpeg',
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('aws', [
      's3', 'cp', '-',
      `s3://${BUCKET}/${key}`,
      '--endpoint-url', ENDPOINT,
      '--content-type', contentType,
      '--cache-control', 'public, max-age=31536000, immutable',
      '--no-progress',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: awsEnv(),
    });

    child.stdin.write(body);
    child.stdin.end();

    let stderr = '';
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(`https://${PUBLIC_HOST}/${key}`);
      } else {
        reject(new Error(`aws s3 cp failed (code ${code}): ${stderr}`));
      }
    });

    child.on('error', (err) => reject(err));
  });
}
