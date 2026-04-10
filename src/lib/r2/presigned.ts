// lib/r2/presigned.ts
import { r2 } from './client';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export async function getUploadUrl(key: string, contentType: string) {
  const command = new PutObjectCommand({
    Bucket: process.env.CF_R2_BUCKET!,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(r2, command, { expiresIn: 300 }); // 5 minutes
}

export async function getDownloadUrl(key: string) {
  const command = new GetObjectCommand({
    Bucket: process.env.CF_R2_BUCKET!,
    Key: key,
  });
  return getSignedUrl(r2, command, { expiresIn: 300 }); // 5 minutes
}
