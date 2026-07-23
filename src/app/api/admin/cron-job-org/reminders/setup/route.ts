import { NextRequest, NextResponse } from 'next/server';
import { enforceRole } from '@/lib/auth/roles';
import {
  appUrlFromSetupRequest,
  scheduleCronJobOrgProofTest,
  schedulerRequestFromSetupRequest,
  setupCronJobOrgReminderJobs,
  setupFormHtml,
} from '@/lib/cron-job-org-reminder-setup';

export const dynamic = 'force-dynamic';

export async function GET() {
  const adminError = await enforceRole(['admin']);
  if (adminError) {
    return NextResponse.json({ error: adminError.error }, { status: adminError.status });
  }

  return new Response(setupFormHtml('/api/admin/cron-job-org/reminders/setup'), {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
}

export async function POST(request: NextRequest) {
  const adminError = await enforceRole(['admin']);
  if (adminError) {
    return NextResponse.json({ error: adminError.error }, { status: adminError.status });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured in Vercel.' }, { status: 500 });
  }

  const schedulerRequest = await schedulerRequestFromSetupRequest(request);
  if (!schedulerRequest.apiKey) {
    return NextResponse.json({ error: 'cron-job.org API key is required.' }, { status: 400 });
  }

  try {
    const appUrl = appUrlFromSetupRequest(request);
    const result = schedulerRequest.action === 'proof-test'
      ? await scheduleCronJobOrgProofTest({
          apiKey: schedulerRequest.apiKey,
          appUrl,
          cronSecret,
          proofTestTime: schedulerRequest.proofTestTime || '',
        })
      : await setupCronJobOrgReminderJobs({
          apiKey: schedulerRequest.apiKey,
          appUrl,
          cronSecret,
        });

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Failed to configure cron-job.org reminder jobs:', error);
    return NextResponse.json({
      detail: error instanceof Error ? error.message : 'Unknown error',
      error: 'Failed to configure cron-job.org reminder jobs',
    }, { status: 500 });
  }
}
