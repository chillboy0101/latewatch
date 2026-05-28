/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
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
  protectWorkbookForPreview,
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

test('Excel preview viewer URL can switch to noninteractive safe view mode', () => {
  const signedUrl = 'https://files.example.test/export.xlsx?X-Amz-Signature=abc';
  const viewerUrl = buildMicrosoftExcelViewerUrl(signedUrl, { allowInteractivity: false });
  const parsed = new URL(viewerUrl);

  assert.equal(parsed.searchParams.get('src'), signedUrl);
  assert.equal(parsed.searchParams.get('wdAllowInteractivity'), 'False');
  assert.equal(parsed.searchParams.get('wdDownloadButton'), 'False');
});

test('preview workbook protection locks every worksheet without protecting normal workbooks by default', async () => {
  const workbook = new ExcelJS.Workbook();
  const first = workbook.addWorksheet('FIRST');
  const second = workbook.addWorksheet('SECOND');
  first.getCell('A1').value = 'Preview only';
  second.getCell('A1').value = 'Preview only too';

  assert.equal(first.sheetProtection, null);
  assert.equal(second.sheetProtection, null);

  await protectWorkbookForPreview(workbook, 'preview-session-password');

  for (const worksheet of workbook.worksheets) {
    assert.ok(worksheet.sheetProtection, `${worksheet.name} should be protected`);
    assert.equal(worksheet.sheetProtection.sheet, true);
    assert.equal(worksheet.sheetProtection.selectLockedCells, true);
    assert.equal(worksheet.sheetProtection.selectUnlockedCells, true);
    assert.equal(worksheet.sheetProtection.formatCells, false);
    assert.equal(worksheet.sheetProtection.insertRows, false);
    assert.equal(worksheet.sheetProtection.deleteRows, false);
    assert.equal(worksheet.getCell('A1').protection?.locked ?? true, true);
  }
});

test('preview public response and audit payload never expose the raw signed workbook URL separately', () => {
  const session = {
    expiresAt: '2026-05-28T12:10:00.000Z',
    exportType: 'monthly',
    fileName: 'Lateness_May_2026.xlsx',
    fallbackViewerUrl: 'https://view.officeapps.live.com/op/embed.aspx?src=encoded&wdAllowInteractivity=False',
    objectKey: 'export-previews/session/Lateness_May_2026.xlsx',
    previewProtectionPassword: 'never-return-this',
    signedFileUrl: 'https://files.example.test/private.xlsx?signature=secret',
    viewerUrl: 'https://view.officeapps.live.com/op/embed.aspx?src=encoded',
    sessionId: 'session',
  };

  const publicResponse = getExportPreviewPublicResponse(session);
  const auditPayload = getExportPreviewAuditPayload(session, { month: 4, year: 2026 });

  assert.deepEqual(Object.keys(publicResponse).sort(), ['expiresAt', 'fallbackViewerUrl', 'fileName', 'sessionId', 'viewerUrl']);
  assert.equal('signedFileUrl' in publicResponse, false);
  assert.equal('previewProtectionPassword' in publicResponse, false);
  assert.equal('signedFileUrl' in auditPayload, false);
  assert.equal('viewerUrl' in auditPayload, false);
  assert.equal('fallbackViewerUrl' in auditPayload, false);
  assert.equal('previewProtectionPassword' in auditPayload, false);
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

test('exports page sends successful preview sessions straight to Microsoft viewer', () => {
  const source = fs.readFileSync(exportsPagePath, 'utf8');

  assert.match(source, /openPreviewWindow/);
  assert.match(source, /sendPreviewWindowToUrl\(previewWindow, session\.viewerUrl\)/);
  assert.match(source, /schedulePreviewCleanup\(session\)/);
  assert.match(source, /setPreviewSession\(session\)/);
});

test('workbook preview dialog gives the iframe the full modal body instead of a side column', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/exports/workbook-preview-dialog.tsx'), 'utf8');

  assert.match(source, /grid h-\[min\(94vh,64rem\)\]/);
  assert.match(source, /grid-rows-\[auto_minmax\(0,1fr\)\]/);
  assert.match(source, /<iframe[\s\S]*className="h-full w-full/);
  assert.doesNotMatch(source, /DialogContent className="flex h-\[min\(90vh,56rem\)\]/);
});

test('workbook preview dialog exposes safe view fallback without replacing the main preview', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/exports/workbook-preview-dialog.tsx'), 'utf8');

  assert.match(source, /fallbackViewerUrl: string/);
  assert.match(source, /useState/);
  assert.match(source, /Safe view/);
  assert.match(source, /setPreviewMode\('safe'\)/);
  assert.match(source, /session\.fallbackViewerUrl/);
  assert.match(source, /Open in new tab/);
});

test('audit taxonomy labels preview events distinctly from generated downloads', () => {
  assert.equal(normalizeAuditAction('preview'), 'PREVIEW');
  assert.equal(getAuditActionLabel('PREVIEW'), 'Previewed');
});
