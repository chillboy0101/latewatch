'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { WorkbookPreviewDialog, type WorkbookPreviewSession } from '@/components/exports/workbook-preview-dialog';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import { ChevronDown, Download, Eye, FileSpreadsheet, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { type WorkingWeekRange } from '@/lib/export-weeks';
import {
  type AttendanceExportGroup,
  type AttendanceExportTemplate,
  getDefaultAttendanceExportTemplateForGroup,
  getAttendanceExportFileName,
  getAttendanceExportTemplateLabel,
  getAttendanceExportTemplatesForGroup,
} from '@/lib/attendance-export-shared';
import { formatShortDisplayDate } from '@/lib/date-format';

interface WeekSummary extends WorkingWeekRange {
  weekLabel: string;
  totalLateArrivals: number;
  totalSignOut: number;
  totalAmount: number;
}

interface LatenessSummaryResponse {
  weeks: WeekSummary[];
}

type ExportPreviewRequest =
  | { type: 'attendance'; group: AttendanceExportGroup; month: number; template: AttendanceExportTemplate; year: number }
  | { type: 'contributions' }
  | { type: 'monthly'; month: number; year: number }
  | { type: 'offence-book'; month: number; year: number }
  | { type: 'weekly'; weekEnd: string; weekNumber: number; weekStart: string };

type ExportTarget =
  | { type: 'attendance' }
  | { type: 'contributions' }
  | { type: 'monthly' }
  | { type: 'offence-book' }
  | { type: 'weekly'; key: string }
  | null;

function exportKeyForWeek(week: WorkingWeekRange) {
  return `weekly-${week.weekNumber}-${week.exportStart}-${week.exportEnd}`;
}

async function downloadWorkbook(response: Response, fileName: string) {
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

function buildExportPreviewWatermarkHtml({ isDark }: { isDark: boolean }) {
  return `<!doctype html>
<html class="${isDark ? 'dark' : ''}" lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Export preview</title>
  <style>
    :root {
      --background: #ffffff;
      --primary: #2563eb;
    }

    .dark {
      --background: #0a0a0a;
      --primary: #3b82f6;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      min-height: 100%;
    }

    body {
      margin: 0;
      min-height: 100dvh;
      overflow: hidden;
      background: var(--background);
    }

    .export-preview-shell {
      position: relative;
      min-height: 100dvh;
      width: 100dvw;
      overflow: hidden;
      background: var(--background);
    }

    @keyframes loading-buffer-spin {
      to {
        transform: rotate(360deg);
      }
    }

    @keyframes auth-watermark-float {
      0%,
      100% {
        transform: translate3d(-1.4rem, 0.7rem, 0) scale(0.98);
      }
      50% {
        transform: translate3d(1.2rem, -0.9rem, 0) scale(1.03);
      }
    }

    @keyframes auth-watermark-mobile-float {
      0%,
      100% {
        transform: translate3d(-0.4rem, 0.4rem, 0) scale(2);
      }
      50% {
        transform: translate3d(0.45rem, -0.45rem, 0) scale(2.04);
      }
    }

    @keyframes auth-watermark-pulse {
      0%,
      100% {
        opacity: 0.72;
        transform: scale(0.92);
      }
      50% {
        opacity: 1;
        transform: scale(1);
      }
    }

    .auth-watermark {
      pointer-events: none;
      position: fixed;
      inset: 0;
      z-index: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100dvh;
      width: 100dvw;
      overflow: hidden;
    }

    .auth-watermark-mark {
      position: relative;
      display: grid;
      width: clamp(36rem, 120vmax, 88rem);
      aspect-ratio: 1;
      place-items: center;
      opacity: 0.28;
      transform-origin: center;
      animation: auth-watermark-float 8s ease-in-out infinite;
    }

    .dark .auth-watermark-mark {
      opacity: 0.34;
    }

    .auth-watermark-ring {
      position: absolute;
      inset: 16%;
      border: clamp(0.7rem, 1.6vw, 1.45rem) solid color-mix(in srgb, var(--primary) 26%, transparent);
      border-top-color: color-mix(in srgb, var(--primary) 92%, transparent);
      border-right-color: color-mix(in srgb, var(--primary) 70%, transparent);
      border-radius: 999px;
      box-shadow:
        0 0 0 1px color-mix(in srgb, var(--primary) 18%, transparent),
        0 1.5rem 5rem color-mix(in srgb, var(--primary) 18%, transparent);
      animation: loading-buffer-spin 8.5s linear infinite;
    }

    .auth-watermark-core {
      width: 33%;
      aspect-ratio: 1;
      border-radius: 999px;
      background: var(--primary);
      box-shadow:
        0 0 0 clamp(3rem, 6vw, 6rem) color-mix(in srgb, var(--primary) 18%, transparent),
        0 1rem 4.5rem color-mix(in srgb, var(--primary) 24%, transparent);
      animation: auth-watermark-pulse 3.2s ease-in-out infinite;
    }

    .auth-watermark-dot {
      position: absolute;
      right: 17%;
      top: 17%;
      width: 18%;
      aspect-ratio: 1;
      border: clamp(0.45rem, 1vw, 0.9rem) solid var(--background);
      border-radius: 999px;
      background: var(--primary);
      box-shadow: 0 0 0 clamp(0.9rem, 2vw, 1.6rem) color-mix(in srgb, var(--primary) 30%, transparent);
    }

    @media (max-width: 640px), (max-height: 720px) and (max-width: 900px) {
      .auth-watermark-mark {
        width: clamp(50rem, 235vw, 58rem);
        max-width: none;
        opacity: 0.72;
        animation-name: auth-watermark-mobile-float;
      }

      .dark .auth-watermark-mark {
        opacity: 0.78;
      }

      .auth-watermark-ring {
        inset: 10%;
        border-width: clamp(1rem, 5.6vw, 1.6rem);
      }

      .auth-watermark-core {
        width: 30%;
        box-shadow:
          0 0 0 clamp(3.6rem, 20vw, 6.4rem) color-mix(in srgb, var(--primary) 22%, transparent),
          0 1rem 5rem color-mix(in srgb, var(--primary) 30%, transparent);
      }

      .auth-watermark-dot {
        border-width: clamp(0.45rem, 2.5vw, 0.75rem);
        box-shadow: 0 0 0 clamp(1rem, 5.5vw, 1.8rem) color-mix(in srgb, var(--primary) 32%, transparent);
      }
    }
  </style>
</head>
<body>
  <main aria-hidden="true" class="export-preview-shell">
    <div class="auth-watermark">
      <div class="auth-watermark-mark">
        <span class="auth-watermark-ring"></span>
        <span class="auth-watermark-core"></span>
        <span class="auth-watermark-dot"></span>
      </div>
    </div>
  </main>
</body>
</html>`;
}

function openPreviewWindow() {
  const previewWindow = window.open('', '_blank');
  if (!previewWindow) return null;

  previewWindow.document.open();
  previewWindow.document.write(buildExportPreviewWatermarkHtml({
    isDark: document.documentElement.classList.contains('dark'),
  }));
  previewWindow.document.close();

  return previewWindow;
}

function sendPreviewWindowToUrl(previewWindow: Window | null, viewerUrl: string) {
  if (!previewWindow || previewWindow.closed) return false;
  previewWindow.location.href = viewerUrl;
  return true;
}

export default function ExportsPage() {
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [weekSummaries, setWeekSummaries] = useState<WeekSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<ExportTarget>(null);
  const [previewing, setPreviewing] = useState<ExportTarget>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSession, setPreviewSession] = useState<WorkbookPreviewSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attendanceGroup, setAttendanceGroup] = useState<AttendanceExportGroup>('main');
  const [attendanceTemplate, setAttendanceTemplate] = useState<AttendanceExportTemplate>('daily-summary');

  const selectedYear = selectedMonth.getFullYear();
  const selectedMonthIndex = selectedMonth.getMonth();
  const isMonthlyExporting = exporting?.type === 'monthly';
  const isAttendanceExporting = exporting?.type === 'attendance';
  const isContributionExporting = exporting?.type === 'contributions';
  const isOffenceBookExporting = exporting?.type === 'offence-book';
  const isMonthlyPreviewing = previewing?.type === 'monthly';
  const isAttendancePreviewing = previewing?.type === 'attendance';
  const isContributionPreviewing = previewing?.type === 'contributions';
  const isOffenceBookPreviewing = previewing?.type === 'offence-book';
  const attendanceTemplateOptions = useMemo(
    () => getAttendanceExportTemplatesForGroup(attendanceGroup),
    [attendanceGroup],
  );
  const selectedAttendanceTemplate = attendanceTemplateOptions.includes(attendanceTemplate)
    ? attendanceTemplate
    : getDefaultAttendanceExportTemplateForGroup(attendanceGroup);

  const fetchExportData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/export/lateness-summary?year=${selectedYear}&month=${selectedMonthIndex}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Could not load export summary (${response.status})`);

      const data = await response.json() as LatenessSummaryResponse;
      const summaries = Array.isArray(data.weeks) ? data.weeks : [];

      setWeekSummaries(summaries);
    } catch (err) {
      console.error('Failed to fetch export data:', err);
      setWeekSummaries([]);
      setError(err instanceof Error ? err.message : 'Could not load export data');
    } finally {
      setLoading(false);
    }
  }, [selectedMonthIndex, selectedYear]);

  useEffect(() => {
    fetchExportData();
  }, [fetchExportData]);

  useEffect(() => {
    if (attendanceTemplate !== selectedAttendanceTemplate) {
      setAttendanceTemplate(selectedAttendanceTemplate);
    }
  }, [attendanceTemplate, selectedAttendanceTemplate]);

  const monthlyTotals = useMemo(
    () => weekSummaries.reduce(
      (totals, week) => ({
        lateArrivals: totals.lateArrivals + week.totalLateArrivals,
        signOut: totals.signOut + week.totalSignOut,
        amount: totals.amount + week.totalAmount,
      }),
      { lateArrivals: 0, signOut: 0, amount: 0 },
    ),
    [weekSummaries],
  );

  async function cleanupPreviewSession(sessionId: string) {
    await fetch('/api/export/preview/session', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }).catch((cleanupError) => {
      console.warn('Preview cleanup failed:', cleanupError);
    });
  }

  async function closePreview() {
    const sessionId = previewSession?.sessionId;
    setPreviewOpen(false);
    setPreviewSession(null);
    if (sessionId) await cleanupPreviewSession(sessionId);
  }

  function schedulePreviewCleanup(session: WorkbookPreviewSession) {
    const expiresAtMs = new Date(session.expiresAt).getTime();
    const delayMs = Number.isFinite(expiresAtMs)
      ? Math.min(Math.max(expiresAtMs - Date.now() + 30_000, 60_000), 15 * 60_000)
      : 11 * 60_000;

    window.setTimeout(() => {
      void cleanupPreviewSession(session.sessionId);
    }, delayMs);
  }

  async function requestPreview(body: ExportPreviewRequest, target: ExportTarget) {
    if (exporting || previewing) return;

    const existingSessionId = previewSession?.sessionId;
    const previewWindow = openPreviewWindow();
    setPreviewing(target);
    setPreviewOpen(false);
    setPreviewSession(null);
    setError(null);

    try {
      if (existingSessionId) void cleanupPreviewSession(existingSessionId);

      const response = await fetch('/api/export/preview/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Preview failed (${response.status})`);
      }

      const session = await response.json() as WorkbookPreviewSession;
      schedulePreviewCleanup(session);

      if (!sendPreviewWindowToUrl(previewWindow, session.viewerUrl)) {
        setPreviewSession(session);
        setPreviewOpen(true);
      }
    } catch (err) {
      if (previewWindow && !previewWindow.closed) previewWindow.close();
      console.error('Export preview failed:', err);
      setError(err instanceof Error ? err.message : 'Export preview failed');
    } finally {
      setPreviewing(null);
    }
  }

  function handleWeeklyPreview(week: WeekSummary) {
    void requestPreview(
      {
        type: 'weekly',
        weekEnd: week.exportEnd,
        weekNumber: week.weekNumber,
        weekStart: week.exportStart,
      },
      { type: 'weekly', key: exportKeyForWeek(week) },
    );
  }

  function handleMonthlyPreview() {
    void requestPreview(
      {
        type: 'monthly',
        month: selectedMonthIndex,
        year: selectedYear,
      },
      { type: 'monthly' },
    );
  }

  function handleAttendancePreview() {
    void requestPreview(
      {
        type: 'attendance',
        group: attendanceGroup,
        month: selectedMonthIndex,
        template: selectedAttendanceTemplate,
        year: selectedYear,
      },
      { type: 'attendance' },
    );
  }

  function handleContributionPreview() {
    void requestPreview({ type: 'contributions' }, { type: 'contributions' });
  }

  function handleOffenceBookPreview() {
    void requestPreview(
      {
        type: 'offence-book',
        month: selectedMonthIndex,
        year: selectedYear,
      },
      { type: 'offence-book' },
    );
  }

  async function handleWeeklyExport(week: WeekSummary) {
    if (exporting || previewing) return;

    const exportKey = exportKeyForWeek(week);
    setExporting({ type: 'weekly', key: exportKey });
    setError(null);

    try {
      const response = await fetch('/api/export/weekly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekStart: week.exportStart,
          weekEnd: week.exportEnd,
          weekNumber: week.weekNumber,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Export failed (${response.status})`);
      }

      await downloadWorkbook(
        response,
        `Lateness_${format(selectedMonth, 'yyyy-MM')}_Week_${week.weekNumber}_${week.exportStart}_${week.exportEnd}.xlsx`,
      );
    } catch (err) {
      console.error('Weekly export failed:', err);
      setError(err instanceof Error ? err.message : 'Weekly export failed');
    } finally {
      setExporting(null);
    }
  }

  async function handleMonthlyExport() {
    if (exporting || previewing) return;

    setExporting({ type: 'monthly' });
    setError(null);

    try {
      const response = await fetch('/api/export/monthly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: selectedYear,
          month: selectedMonthIndex,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Monthly export failed (${response.status})`);
      }

      await downloadWorkbook(response, `Lateness_${format(selectedMonth, 'MMMM_yyyy')}.xlsx`);
    } catch (err) {
      console.error('Monthly export failed:', err);
      setError(err instanceof Error ? err.message : 'Monthly export failed');
    } finally {
      setExporting(null);
    }
  }

  async function handleAttendanceExport() {
    if (exporting || previewing) return;

    setExporting({ type: 'attendance' });
    setError(null);

    try {
      const response = await fetch('/api/export/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group: attendanceGroup,
          month: selectedMonthIndex,
          template: selectedAttendanceTemplate,
          year: selectedYear,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Attendance export failed (${response.status})`);
      }

      await downloadWorkbook(
        response,
        getAttendanceExportFileName({
          group: attendanceGroup,
          month: selectedMonthIndex,
          template: selectedAttendanceTemplate,
          year: selectedYear,
        }),
      );
    } catch (err) {
      console.error('Attendance export failed:', err);
      setError(err instanceof Error ? err.message : 'Attendance export failed');
    } finally {
      setExporting(null);
    }
  }

  async function handleContributionExport() {
    if (exporting || previewing) return;

    setExporting({ type: 'contributions' });
    setError(null);

    try {
      const response = await fetch('/api/export/contributions', { cache: 'no-store' });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Contribution export failed (${response.status})`);
      }

      await downloadWorkbook(response, 'Contributions.xlsx');
    } catch (err) {
      console.error('Contribution export failed:', err);
      setError(err instanceof Error ? err.message : 'Contribution export failed');
    } finally {
      setExporting(null);
    }
  }

  async function handleOffenceBookExport() {
    if (exporting || previewing) return;

    setExporting({ type: 'offence-book' });
    setError(null);

    try {
      const response = await fetch('/api/export/offence-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month: selectedMonthIndex,
          year: selectedYear,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `OFFENCE BOOK export failed (${response.status})`);
      }

      await downloadWorkbook(response, `OFFENCE_BOOK_${format(selectedMonth, 'MMMM_yyyy')}.xlsx`);
    } catch (err) {
      console.error('OFFENCE BOOK export failed:', err);
      setError(err instanceof Error ? err.message : 'OFFENCE BOOK export failed');
    } finally {
      setExporting(null);
    }
  }

  return (
    <DashboardLayout title="Exports">
      <div className="space-y-5">
        <Card className="overflow-hidden">
          <div className="border-b border-border px-6 py-5">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
                <h2 className="text-lg font-semibold leading-none">Lateness Exports</h2>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="w-full sm:w-44">
                  <label className="mb-1.5 block text-sm font-medium text-muted-foreground">Month</label>
                  <div className="relative">
                    <select
                      className="h-10 w-full appearance-none rounded-md border border-border bg-background px-3 pr-9 text-sm leading-none outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                      value={selectedMonthIndex}
                      onChange={(event) => setSelectedMonth(new Date(selectedYear, parseInt(event.target.value, 10), 1))}
                    >
                      {Array.from({ length: 12 }, (_, index) => (
                        <option key={index} value={index}>
                          {format(new Date(selectedYear, index, 1), 'MMMM')}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </div>
                <div className="w-full sm:w-28">
                  <label className="mb-1.5 block text-sm font-medium text-muted-foreground">Year</label>
                  <div className="relative">
                    <select
                      className="h-10 w-full appearance-none rounded-md border border-border bg-background px-3 pr-9 text-sm leading-none outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                      value={selectedYear}
                      onChange={(event) => setSelectedMonth(new Date(parseInt(event.target.value, 10), selectedMonthIndex, 1))}
                    >
                      {Array.from({ length: 11 }, (_, index) => {
                        const year = 2024 + index;
                        return (
                          <option key={year} value={year}>
                            {year}
                          </option>
                        );
                      })}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </div>
                <Button
                  className="h-10 gap-2 sm:mt-[1.625rem]"
                  onClick={handleMonthlyExport}
                  disabled={loading || weekSummaries.length === 0 || previewing !== null || (exporting !== null && !isMonthlyExporting)}
                  aria-busy={isMonthlyExporting}
                >
                  {isMonthlyExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {isMonthlyExporting ? 'Downloading Month' : 'Monthly Workbook'}
                </Button>
                <Button
                  variant="outline"
                  className="h-10 min-w-[8rem] gap-2 sm:mt-[1.625rem]"
                  onClick={handleMonthlyPreview}
                  disabled={loading || weekSummaries.length === 0 || exporting !== null || (previewing !== null && !isMonthlyPreviewing)}
                  aria-busy={isMonthlyPreviewing}
                >
                  {isMonthlyPreviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                  {isMonthlyPreviewing ? 'Preparing Preview' : 'Preview Workbook'}
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-px border-b border-border bg-border sm:grid-cols-3">
            <SummaryCell label="Late arrivals" value={monthlyTotals.lateArrivals.toString()} tone="danger" />
            <SummaryCell label="No sign out" value={monthlyTotals.signOut.toString()} tone="warning" />
            <SummaryCell label="Amount" value={`GHC ${monthlyTotals.amount.toFixed(2)}`} mono />
          </div>

          <div className="p-4">
            {loading ? (
              <LoadingBuffer
                variant="section"
                label="Loading export weeks"
                description="Calculating working-day ranges and monthly totals."
              />
            ) : (
              <div className="space-y-2">
                {weekSummaries.map((week) => {
                  const weekExportKey = exportKeyForWeek(week);
                  const isExporting = exporting?.type === 'weekly' && exporting.key === weekExportKey;
                  const isPreviewing = previewing?.type === 'weekly' && previewing.key === weekExportKey;
                  const isOtherBusy = (exporting !== null && !isExporting) || (previewing !== null && !isPreviewing);

                  return (
                    <div
                      key={week.weekStart}
                      className="grid gap-3 rounded-md border border-border bg-background px-4 py-3 transition-colors hover:bg-card lg:grid-cols-[minmax(180px,1.2fr)_repeat(3,minmax(112px,0.6fr))_auto] lg:items-center"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold">{week.weekLabel}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {formatShortDisplayDate(week.exportStart)} - {formatShortDisplayDate(week.exportEnd)}
                          {' '}({week.dates.length} working day{week.dates.length === 1 ? '' : 's'})
                        </p>
                      </div>

                      <Metric label="Late arrivals" value={week.totalLateArrivals.toString()} tone="danger" />
                      <Metric label="No sign out" value={week.totalSignOut.toString()} tone="warning" />
                      <Metric label="Amount" value={`GHC ${week.totalAmount.toFixed(2)}`} mono />

                      <div className="flex flex-wrap gap-2 lg:justify-self-end">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => handleWeeklyExport(week)}
                          disabled={isOtherBusy || isExporting || isPreviewing}
                          aria-busy={isExporting}
                        >
                          {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                          {isExporting ? 'Downloading' : 'Download'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-w-[6.5rem] gap-2"
                          onClick={() => handleWeeklyPreview(week)}
                          disabled={isOtherBusy || isExporting || isPreviewing}
                          aria-busy={isPreviewing}
                        >
                          {isPreviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                          {isPreviewing ? 'Preparing Preview' : 'Preview'}
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {error && (
                  <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                    {error}
                  </p>
                )}
              </div>
            )}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-border px-6 py-5">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
                <h2 className="text-lg font-semibold leading-none">Attendance Exports</h2>
              </div>

              <div className="grid w-full min-w-0 gap-3 lg:flex-1 2xl:w-auto 2xl:flex-none">
                <div className="grid w-full min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(6.75rem,0.8fr)_5.75rem_minmax(8.5rem,1fr)_minmax(9rem,1fr)] lg:items-end 2xl:grid-cols-[minmax(9rem,1fr)_7rem_minmax(10rem,1fr)_minmax(11rem,1fr)]">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-muted-foreground">Month</label>
                    <div className="relative">
                      <select
                        className="h-10 w-full appearance-none rounded-md border border-border bg-background px-3 pr-9 text-sm leading-none outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                        value={selectedMonthIndex}
                        onChange={(event) => setSelectedMonth(new Date(selectedYear, parseInt(event.target.value, 10), 1))}
                      >
                        {Array.from({ length: 12 }, (_, index) => (
                          <option key={index} value={index}>
                            {format(new Date(selectedYear, index, 1), 'MMMM')}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-muted-foreground">Year</label>
                    <div className="relative">
                      <select
                        className="h-10 w-full appearance-none rounded-md border border-border bg-background px-3 pr-9 text-sm leading-none outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                        value={selectedYear}
                        onChange={(event) => setSelectedMonth(new Date(parseInt(event.target.value, 10), selectedMonthIndex, 1))}
                      >
                        {Array.from({ length: 11 }, (_, index) => {
                          const year = 2024 + index;
                          return (
                            <option key={year} value={year}>
                              {year}
                            </option>
                          );
                        })}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-muted-foreground">Roster</label>
                    <div className="relative">
                      <select
                        className="h-10 w-full appearance-none rounded-md border border-border bg-background px-3 pr-9 text-sm leading-none outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                        value={attendanceGroup}
                        onChange={(event) => setAttendanceGroup(event.target.value as AttendanceExportGroup)}
                      >
                        <option value="main">Main Staff</option>
                        <option value="nss">NSS Personnel</option>
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-muted-foreground">Template</label>
                    <div className="relative">
                      <select
                        className="h-10 w-full appearance-none rounded-md border border-border bg-background px-3 pr-9 text-sm leading-none outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                        value={selectedAttendanceTemplate}
                        onChange={(event) => setAttendanceTemplate(event.target.value as AttendanceExportTemplate)}
                      >
                        {attendanceTemplateOptions.map((template) => (
                          <option key={template} value={template}>
                            {getAttendanceExportTemplateLabel(template)}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    </div>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[auto_auto] lg:justify-end">
                  <Button
                    className="h-10 min-w-[7.5rem] gap-2 whitespace-nowrap"
                    onClick={handleAttendanceExport}
                    disabled={loading || previewing !== null || (exporting !== null && !isAttendanceExporting)}
                    aria-busy={isAttendanceExporting}
                  >
                    {isAttendanceExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {isAttendanceExporting ? 'Downloading' : 'Download'}
                  </Button>
                  <Button
                    variant="outline"
                    className="h-10 min-w-[10rem] gap-2 whitespace-nowrap"
                    onClick={handleAttendancePreview}
                    disabled={loading || exporting !== null || (previewing !== null && !isAttendancePreviewing)}
                    aria-busy={isAttendancePreviewing}
                  >
                    {isAttendancePreviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                    {isAttendancePreviewing ? 'Preparing Preview' : 'Preview Workbook'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-border px-6 py-5">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
                <h2 className="text-lg font-semibold leading-none">OFFENCE BOOK EXPORT</h2>
              </div>

              <div className="grid gap-3 sm:grid-cols-[minmax(9rem,1fr)_7rem_auto_auto] sm:items-end">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-muted-foreground">Month</label>
                  <div className="relative">
                    <select
                      className="h-10 w-full appearance-none rounded-md border border-border bg-background px-3 pr-9 text-sm leading-none outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                      value={selectedMonthIndex}
                      onChange={(event) => setSelectedMonth(new Date(selectedYear, parseInt(event.target.value, 10), 1))}
                    >
                      {Array.from({ length: 12 }, (_, index) => (
                        <option key={index} value={index}>
                          {format(new Date(selectedYear, index, 1), 'MMMM')}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-muted-foreground">Year</label>
                  <div className="relative">
                    <select
                      className="h-10 w-full appearance-none rounded-md border border-border bg-background px-3 pr-9 text-sm leading-none outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                      value={selectedYear}
                      onChange={(event) => setSelectedMonth(new Date(parseInt(event.target.value, 10), selectedMonthIndex, 1))}
                    >
                      {Array.from({ length: 11 }, (_, index) => {
                        const year = 2024 + index;
                        return (
                          <option key={year} value={year}>
                            {year}
                          </option>
                        );
                      })}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </div>

                <Button
                  className="h-10 gap-2"
                  onClick={handleOffenceBookExport}
                  disabled={previewing !== null || (exporting !== null && !isOffenceBookExporting)}
                  aria-busy={isOffenceBookExporting}
                >
                  {isOffenceBookExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {isOffenceBookExporting ? 'Downloading' : 'Download'}
                </Button>
                <Button
                  variant="outline"
                  className="h-10 min-w-[8rem] gap-2"
                  onClick={handleOffenceBookPreview}
                  disabled={exporting !== null || (previewing !== null && !isOffenceBookPreviewing)}
                  aria-busy={isOffenceBookPreviewing}
                >
                  {isOffenceBookPreviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                  {isOffenceBookPreviewing ? 'Preparing Preview' : 'Preview Workbook'}
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-border px-6 py-5">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
                <h2 className="text-lg font-semibold leading-none">Contributions Exports</h2>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  className="h-10 gap-2 sm:w-auto"
                  onClick={handleContributionExport}
                  disabled={previewing !== null || (exporting !== null && !isContributionExporting)}
                  aria-busy={isContributionExporting}
                >
                  {isContributionExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {isContributionExporting ? 'Downloading' : 'Download Contributions'}
                </Button>
                <Button
                  variant="outline"
                  className="h-10 min-w-[8rem] gap-2 sm:w-auto"
                  onClick={handleContributionPreview}
                  disabled={exporting !== null || (previewing !== null && !isContributionPreviewing)}
                  aria-busy={isContributionPreviewing}
                >
                  {isContributionPreviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                  {isContributionPreviewing ? 'Preparing Preview' : 'Preview Workbook'}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>
      <WorkbookPreviewDialog
        open={previewOpen}
        session={previewSession}
        onOpenChange={(open) => {
          if (open) {
            setPreviewOpen(true);
            return;
          }
          void closePreview();
        }}
      />
    </DashboardLayout>
  );
}

function SummaryCell({
  label,
  value,
  tone,
  mono,
}: {
  label: string;
  value: string;
  tone?: 'danger' | 'warning';
  mono?: boolean;
}) {
  return (
    <div className="bg-card px-5 py-3">
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${mono ? 'font-mono' : ''} ${
        tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : ''
      }`}>
        {value}
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
  mono,
}: {
  label: string;
  value: string;
  tone?: 'danger' | 'warning';
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <p className={`mt-0.5 font-semibold ${mono ? 'font-mono' : ''} ${
        tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : ''
      }`}>
        {value}
      </p>
    </div>
  );
}
