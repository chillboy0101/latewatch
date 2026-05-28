/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

require('tsx/cjs');

const root = path.join(__dirname, '..');
const previewRoutePath = path.join(root, 'src/app/api/export/preview/session/route.ts');
const exportsPagePath = path.join(root, 'src/app/exports/page.tsx');

const {
  buildMicrosoftExcelViewerUrl,
  getExportPreviewAuditPayload,
  getExportPreviewPublicResponse,
} = require('../src/lib/export-preview-session.ts');

const {
  getAuditActionLabel,
  normalizeAuditAction,
} = require('../src/lib/audit-taxonomy.ts');

test('Excel preview viewer URL uses Microsoft embed mode and hides viewer download controls', () => {
  const signedUrl = 'https://files.example.test/export.xlsx?X-Amz-Signature=abc&response-content-type=xlsx';
  const viewerUrl = buildMicrosoftExcelViewerUrl(signedUrl);
  const parsed = new URL(viewerUrl);

  assert.equal(parsed.origin, 'https://view.officeapps.live.com');
  assert.equal(parsed.pathname, '/op/embed.aspx');
  assert.equal(parsed.searchParams.get('src'), signedUrl);
  assert.equal(parsed.searchParams.get('wdDownloadButton'), 'False');
  assert.equal(parsed.searchParams.get('wdAllowInteractivity'), 'True');
});

test('preview public response and audit payload never expose the raw signed workbook URL separately', () => {
  const session = {
    expiresAt: '2026-05-28T12:10:00.000Z',
    exportType: 'monthly',
    fileName: 'Lateness_May_2026.xlsx',
    objectKey: 'export-previews/session/Lateness_May_2026.xlsx',
    signedFileUrl: 'https://files.example.test/private.xlsx?signature=secret',
    viewerUrl: 'https://view.officeapps.live.com/op/embed.aspx?src=encoded',
    sessionId: 'session',
  };

  const publicResponse = getExportPreviewPublicResponse(session);
  const auditPayload = getExportPreviewAuditPayload(session, { month: 4, year: 2026 });

  assert.deepEqual(Object.keys(publicResponse).sort(), ['expiresAt', 'fileName', 'sessionId', 'viewerUrl']);
  assert.equal('signedFileUrl' in publicResponse, false);
  assert.equal('signedFileUrl' in auditPayload, false);
  assert.equal('viewerUrl' in auditPayload, false);
  assert.equal(auditPayload.exportType, 'monthly');
  assert.equal(auditPayload.fileName, 'Lateness_May_2026.xlsx');
});

test('preview route creates and deletes temporary Office preview sessions', () => {
  assert.equal(fs.existsSync(previewRoutePath), true);
  const source = fs.readFileSync(previewRoutePath, 'utf8');

  assert.match(source, /export async function POST/);
  assert.match(source, /export async function DELETE/);
  assert.match(source, /createExportPreviewSession/);
  assert.match(source, /deleteExportPreviewSession/);
  assert.match(source, /tryWriteAuditEvent/);
  assert.match(source, /action: 'PREVIEW'/);
  assert.doesNotMatch(source, /Content-Disposition/);
});

test('exports page exposes Preview actions beside every workbook download family', () => {
  const source = fs.readFileSync(exportsPagePath, 'utf8');

  assert.match(source, /handleMonthlyPreview/);
  assert.match(source, /handleWeeklyPreview/);
  assert.match(source, /handleAttendancePreview/);
  assert.match(source, /handleOffenceBookPreview/);
  assert.match(source, /handleContributionPreview/);
  assert.match(source, /WorkbookPreviewDialog/);
  assert.match(source, /Preparing Preview/);
  assert.match(source, /Preview Workbook/);
  assert.match(source, /min-w-\[8rem\]/);
});

test('workbook preview dialog gives the iframe the full modal body instead of a side column', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/exports/workbook-preview-dialog.tsx'), 'utf8');

  assert.match(source, /grid h-\[min\(94vh,64rem\)\]/);
  assert.match(source, /grid-rows-\[auto_minmax\(0,1fr\)\]/);
  assert.match(source, /<iframe[\s\S]*className="h-full w-full/);
  assert.doesNotMatch(source, /DialogContent className="flex h-\[min\(90vh,56rem\)\]/);
});

test('audit taxonomy labels preview events distinctly from generated downloads', () => {
  assert.equal(normalizeAuditAction('preview'), 'PREVIEW');
  assert.equal(getAuditActionLabel('PREVIEW'), 'Previewed');
});
