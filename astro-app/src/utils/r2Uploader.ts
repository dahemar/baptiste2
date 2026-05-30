import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || 'a9aa2c81cffdbdc0a558da017670f16c';
const BUCKET = process.env.R2_BUCKET || 'baptiste-videos';
const ENDPOINT = process.env.R2_ENDPOINT || `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;
export const R2_PUBLIC_HOST = 'pub-f04cf0f8494f457e889559aa0b6e57b7.r2.dev';

let s3Client: S3Client | null = null;

function getS3Client(): S3Client | null {
  const accessKey = process.env.R2_ACCESS_KEY_ID;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accessKey || !secretKey) return null;
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.R2_REGION || 'auto',
      endpoint: ENDPOINT,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
    });
  }
  return s3Client;
}

export function isR2UploadConfigured(): boolean {
  return getS3Client() !== null;
}

export function publicR2Url(key: string): string {
  return `https://${R2_PUBLIC_HOST}/${key}`;
}

/** Check object exists via S3 API or public HEAD. */
export async function headR2Object(key: string): Promise<boolean> {
  const client = getS3Client();
  if (client) {
    try {
      await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      return true;
    } catch {
      // fall through to public HEAD
    }
  }

  try {
    const res = await fetch(publicR2Url(key), { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function uploadImageToR2(
  key: string,
  body: Buffer,
  contentType = 'image/jpeg',
): Promise<string> {
  const client = getS3Client();
  if (!client) {
    throw new Error('R2 upload requires R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY');
  }

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  return publicR2Url(key);
}
