// lib/r2/client.ts
import 'server-only';

import { S3Client } from '@aws-sdk/client-s3';

let cachedR2: S3Client | null = null;

export function getR2Client() {
  if (cachedR2) return cachedR2;

  const accountId = process.env.CF_R2_ACCOUNT_ID;
  const accessKeyId = process.env.CF_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CF_R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('Cloudflare R2 credentials are required');
  }

  cachedR2 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return cachedR2;
}
