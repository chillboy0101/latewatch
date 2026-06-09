import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/roles';
import {
  apiKeyFromSetupRequest,
  appUrlFromSetupRequest,
  setupCronJobOrgReminderJobs,
  setupFormHtml,
  setupResultHtml,
} from '@/lib/cron-job-org-reminder-setup';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  try {
    await requireRole(['admin']);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    return { error: message, status: message === 'Forbidden' ? 403 : 401 };
  }

  return null;
}

function htmlResponse(html: string, status = 200) {
  return new Response(html, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
    },
    status,
  });
}

export async function GET() {
  const adminError = await requireAdmin();
  if (adminError) {
    return NextResponse.json({ error: adminError.error }, { status: adminError.status });
  }

  return htmlResponse(setupFormHtml('/settings/reminder-scheduler'));
}

export async function POST(request: NextRequest) {
  const adminError = await requireAdmin();
  if (adminError) {
    return NextResponse.json({ error: adminError.error }, { status: adminError.status });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured in Vercel.' }, { status: 500 });
  }

  const apiKey = await apiKeyFromSetupRequest(request);
  if (!apiKey) {
    return NextResponse.json({ error: 'cron-job.org API key is required.' }, { status: 400 });
  }

  try {
    const result = await setupCronJobOrgReminderJobs({
      apiKey,
      appUrl: appUrlFromSetupRequest(request),
      cronSecret,
    });

    return htmlResponse(setupResultHtml(result));
  } catch (error) {
    console.error('Failed to configure cron-job.org reminder jobs:', error);
    return NextResponse.json({
      detail: error instanceof Error ? error.message : 'Unknown error',
      error: 'Failed to configure cron-job.org reminder jobs',
    }, { status: 500 });
  }
}
