import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { format, parseISO } from 'date-fns';
import type ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { getAttendanceExportFileName, isAttendanceExportGroup, isAttendanceExportTemplate } from '@/lib/attendance-export-shared';

export type ExportPreviewRequest =
  | { type: 'attendance'; group: unknown; month: unknown; template: unknown; year: unknown }
  | { type: 'contributions' }
  | { type: 'monthly'; month: unknown; year: unknown }
  | { type: 'offence-book'; month: unknown; year: unknown }
  | { type: 'weekly'; weekEnd: unknown; weekNumber?: unknown; weekStart: unknown };

export type NormalizedExportPreviewRequest =
  | { type: 'attendance'; group: ReturnType<typeof normalizeAttendanceGroup>; month: number; template: ReturnType<typeof normalizeAttendanceTemplate>; year: number }
  | { type: 'contributions' }
  | { type: 'monthly'; month: number; year: number }
  | { type: 'offence-book'; month: number; year: number }
  | { type: 'weekly'; weekEnd: string; weekNumber?: number; weekStart: string };

type ExportPreviewFile = {
  buffer: ExcelJS.Buffer;
  exportType: NormalizedExportPreviewRequest['type'];
  fileName: string;
};

export type ExportPreviewSession = {
  expiresAt: string;
  exportType: NormalizedExportPreviewRequest['type'];
  fileName: string;
  objectKey: string;
  sessionId: string;
  signedFileUrl: string;
  viewerUrl: string;
};

const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PREVIEW_PREFIX = 'export-previews';
const PREVIEW_EXPIRY_SECONDS = 10 * 60;
const PREVIEW_CLEANUP_AGE_MS = 60 * 60 * 1000;

function normalizeAttendanceGroup(value: unknown) {
  if (!isAttendanceExportGroup(value)) {
    throw new Error('Valid attendance roster group is required');
  }
  return value;
}

function normalizeAttendanceTemplate(value: unknown) {
  if (!isAttendanceExportTemplate(value)) {
    throw new Error('Valid attendance export template is required');
  }
  return value;
}

function integerInRange(value: unknown, label: string, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} is invalid`);
  }
  return parsed;
}

function isoDateKey(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

export function normalizeExportPreviewRequest(body: unknown): NormalizedExportPreviewRequest {
  const input = body && typeof body === 'object' ? body as ExportPreviewRequest : null;
  if (!input || typeof input.type !== 'string') {
    throw new Error('Valid export preview type is required');
  }

  if (input.type === 'weekly') {
    const weekNumber = Number(input.weekNumber);
    return {
      type: 'weekly',
      weekEnd: isoDateKey(input.weekEnd, 'Week end'),
      weekNumber: Number.isInteger(weekNumber) && weekNumber >= 1 ? weekNumber : undefined,
      weekStart: isoDateKey(input.weekStart, 'Week start'),
    };
  }

  if (input.type === 'monthly') {
    return {
      type: 'monthly',
      month: integerInRange(input.month, 'Month', 0, 11),
      year: integerInRange(input.year, 'Year', 2000, 2100),
    };
  }

  if (input.type === 'attendance') {
    return {
      type: 'attendance',
      group: normalizeAttendanceGroup(input.group),
      month: integerInRange(input.month, 'Month', 0, 11),
      template: normalizeAttendanceTemplate(input.template),
      year: integerInRange(input.year, 'Year', 2000, 2100),
    };
  }

  if (input.type === 'offence-book') {
    return {
      type: 'offence-book',
      month: integerInRange(input.month, 'Month', 0, 11),
      year: integerInRange(input.year, 'Year', 2000, 2100),
    };
  }

  if (input.type === 'contributions') {
    return { type: 'contributions' };
  }

  throw new Error('Valid export preview type is required');
}

function safeFileName(fileName: string) {
  return fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, '_');
}

function bufferToUint8Array(buffer: ExcelJS.Buffer) {
  if (Buffer.isBuffer(buffer)) return Uint8Array.from(buffer);
  return new Uint8Array(buffer as ArrayBuffer);
}

export function buildMicrosoftExcelViewerUrl(signedFileUrl: string) {
  const url = new URL('https://view.officeapps.live.com/op/embed.aspx');
  url.searchParams.set('src', signedFileUrl);
  url.searchParams.set('wdAllowInteractivity', 'True');
  url.searchParams.set('wdDownloadButton', 'False');
  url.searchParams.set('wdHideGridlines', 'False');
  url.searchParams.set('wdHideHeaders', 'False');
  return url.toString();
}

async function buildExportPreviewFile(input: NormalizedExportPreviewRequest): Promise<ExportPreviewFile> {
  if (input.type === 'weekly') {
    const { buildWeeklyWorkbook } = await import('@/app/api/export/weekly/route');
    const workbook = await buildWeeklyWorkbook(
      input.weekStart,
      input.weekEnd,
      null,
      undefined,
      undefined,
      undefined,
      input.weekNumber,
    );
    const buffer = await workbook.xlsx.writeBuffer();
    const weekNumber = input.weekNumber || 1;
    const monthLabel = format(parseISO(input.weekStart), 'yyyy-MM');
    return {
      buffer,
      exportType: input.type,
      fileName: `Lateness_${monthLabel}_Week_${weekNumber}_${input.weekStart}_${input.weekEnd}.xlsx`,
    };
  }

  if (input.type === 'monthly') {
    const { buildMonthlyExportWorkbook } = await import('@/app/api/export/monthly/route');
    const result = await buildMonthlyExportWorkbook({
      month: input.month,
      year: input.year,
    });
    const buffer = await result.workbook.xlsx.writeBuffer();
    return {
      buffer,
      exportType: input.type,
      fileName: `Lateness_${format(new Date(input.year, input.month, 1), 'MMMM_yyyy')}.xlsx`,
    };
  }

  if (input.type === 'attendance') {
    const { buildAttendanceExportWorkbook } = await import('@/lib/attendance-template-export');
    const result = await buildAttendanceExportWorkbook({
      group: input.group,
      month: input.month,
      template: input.template,
      year: input.year,
    });
    return {
      buffer: result.buffer,
      exportType: input.type,
      fileName: getAttendanceExportFileName(input),
    };
  }

  if (input.type === 'offence-book') {
    const { buildOffenceBookExportWorkbook } = await import('@/app/api/export/offence-book/route');
    const result = await buildOffenceBookExportWorkbook({
      month: input.month,
      year: input.year,
    });
    return {
      buffer: result.buffer,
      exportType: input.type,
      fileName: result.fileName,
    };
  }

  const { buildContributionExportWorkbook } = await import('@/lib/contribution-export');
  const result = await buildContributionExportWorkbook();
  return {
    buffer: result.buffer,
    exportType: input.type,
    fileName: result.fileName,
  };
}

async function r2ClientAndBucket() {
  const [{ getR2Client }] = await Promise.all([import('@/lib/r2/client')]);
  const bucket = process.env.CF_R2_BUCKET;
  if (!bucket) throw new Error('Cloudflare R2 bucket is required');
  return { bucket, r2: getR2Client() };
}

async function deleteObjectsByPrefix(prefix: string) {
  const { bucket, r2 } = await r2ClientAndBucket();
  const listed = await r2.send(new ListObjectsV2Command({
    Bucket: bucket,
    MaxKeys: 100,
    Prefix: prefix,
  }));
  const objects = listed.Contents || [];

  await Promise.all(objects
    .filter((object) => object.Key)
    .map((object) => r2.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: object.Key,
    }))));

  return objects.length;
}

export async function cleanupExpiredExportPreviewSessions() {
  const { bucket, r2 } = await r2ClientAndBucket();
  const cutoff = Date.now() - PREVIEW_CLEANUP_AGE_MS;
  const listed = await r2.send(new ListObjectsV2Command({
    Bucket: bucket,
    MaxKeys: 100,
    Prefix: `${PREVIEW_PREFIX}/`,
  }));
  const expired = (listed.Contents || []).filter((object) =>
    object.Key && object.LastModified && object.LastModified.getTime() < cutoff
  );

  await Promise.all(expired.map((object) => r2.send(new DeleteObjectCommand({
    Bucket: bucket,
    Key: object.Key,
  }))));

  return expired.length;
}

export async function createExportPreviewSession(input: NormalizedExportPreviewRequest) {
  const { bucket, r2 } = await r2ClientAndBucket();
  const file = await buildExportPreviewFile(input);
  const sessionId = randomUUID();
  const objectKey = `${PREVIEW_PREFIX}/${sessionId}/${safeFileName(file.fileName)}`;
  const expiresAt = new Date(Date.now() + PREVIEW_EXPIRY_SECONDS * 1000).toISOString();

  await cleanupExpiredExportPreviewSessions().catch((error) => {
    console.warn('Export preview cleanup failed:', error);
  });

  await r2.send(new PutObjectCommand({
    Body: bufferToUint8Array(file.buffer),
    Bucket: bucket,
    ContentType: EXCEL_CONTENT_TYPE,
    Key: objectKey,
    Metadata: {
      exportType: file.exportType,
      sessionId,
    },
  }));

  const signedFileUrl = await getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ResponseContentType: EXCEL_CONTENT_TYPE,
    }),
    { expiresIn: PREVIEW_EXPIRY_SECONDS },
  );
  const viewerUrl = buildMicrosoftExcelViewerUrl(signedFileUrl);

  return {
    expiresAt,
    exportType: file.exportType,
    fileName: file.fileName,
    objectKey,
    sessionId,
    signedFileUrl,
    viewerUrl,
  } satisfies ExportPreviewSession;
}

export async function deleteExportPreviewSession(sessionId: unknown) {
  if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    throw new Error('Valid preview session ID is required');
  }

  return deleteObjectsByPrefix(`${PREVIEW_PREFIX}/${sessionId}/`);
}

export function getExportPreviewPublicResponse(session: ExportPreviewSession) {
  return {
    expiresAt: session.expiresAt,
    fileName: session.fileName,
    sessionId: session.sessionId,
    viewerUrl: session.viewerUrl,
  };
}

export function getExportPreviewAuditPayload(
  session: ExportPreviewSession,
  input: NormalizedExportPreviewRequest,
) {
  return {
    expiresAt: session.expiresAt,
    exportType: session.exportType,
    fileName: session.fileName,
    parameters: input,
    previewProvider: 'microsoft-office-web-viewer',
    sessionId: session.sessionId,
  };
}
