import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

const API_BASE_URL = 'https://api.cron-job.org';
const EVERY_FIVE_MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

type CronJobOrgJobSummary = {
  jobId?: number;
  title?: string;
};

type CronJobOrgListResponse = {
  jobs?: CronJobOrgJobSummary[];
};

type CronJobOrgCreateResponse = {
  jobId?: number;
};

const jobs = [
  {
    title: 'LateWatch morning reminder 8AM catch-up',
    path: '/api/attendance/reminders/morning',
    schedule: {
      expiresAt: 0,
      hours: [8],
      mdays: [-1],
      minutes: [15, 20, 25, 30, 35, 40, 45, 50, 55],
      months: [-1],
      timezone: 'UTC',
      wdays: [-1],
    },
  },
  {
    title: 'LateWatch morning reminder daytime catch-up',
    path: '/api/attendance/reminders/morning',
    schedule: {
      expiresAt: 0,
      hours: [9, 10, 11, 12, 13, 14, 15, 16],
      mdays: [-1],
      minutes: EVERY_FIVE_MINUTES,
      months: [-1],
      timezone: 'UTC',
      wdays: [-1],
    },
  },
  {
    title: 'LateWatch sign-out reminder 4PM catch-up',
    path: '/api/attendance/reminders/sign-out',
    schedule: {
      expiresAt: 0,
      hours: [16],
      mdays: [-1],
      minutes: [30, 35, 40, 45, 50, 55],
      months: [-1],
      timezone: 'UTC',
      wdays: [1, 2, 3, 4, 5],
    },
  },
  {
    title: 'LateWatch sign-out reminder evening catch-up',
    path: '/api/attendance/reminders/sign-out',
    schedule: {
      expiresAt: 0,
      hours: [17, 18, 19, 20, 21, 22, 23],
      mdays: [-1],
      minutes: EVERY_FIVE_MINUTES,
      months: [-1],
      timezone: 'UTC',
      wdays: [1, 2, 3, 4, 5],
    },
  },
];

function appUrlFromRequest(request: NextRequest) {
  return (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '');
}

function setupFormHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LateWatch cron-job.org setup</title>
    <style>
      body { background: #050505; color: #f8fafc; font-family: Arial, sans-serif; margin: 0; }
      main { margin: 48px auto; max-width: 560px; padding: 24px; }
      label, input, button { display: block; width: 100%; }
      label { color: #cbd5e1; font-size: 14px; margin-bottom: 8px; }
      input { background: #111827; border: 1px solid #334155; border-radius: 6px; box-sizing: border-box; color: #f8fafc; font-size: 14px; padding: 12px; }
      button { background: #2563eb; border: 0; border-radius: 6px; color: #fff; cursor: pointer; font-size: 15px; font-weight: 700; margin-top: 16px; padding: 12px; }
      p { color: #94a3b8; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main>
      <h1>LateWatch cron-job.org setup</h1>
      <p>This admin-only setup uses Vercel CRON_SECRET internally and does not display it.</p>
      <form method="post">
        <label for="apiKey">cron-job.org API key</label>
        <input id="apiKey" name="apiKey" type="password" autocomplete="off" required />
        <button type="submit">Create or update reminder jobs</button>
      </form>
    </main>
  </body>
</html>`;
}

function jobPayload(input: {
  appUrl: string;
  cronSecret: string;
  job: typeof jobs[number];
}) {
  return {
    auth: {
      enable: false,
      password: '',
      user: '',
    },
    enabled: true,
    extendedData: {
      body: '',
      headers: {
        Authorization: `Bearer ${input.cronSecret}`,
        'x-latewatch-cron': 'external',
      },
    },
    notification: {
      onDisable: true,
      onFailure: true,
      onFailureCount: 1,
      onSuccess: true,
    },
    redirectSuccess: false,
    requestMethod: 0,
    requestTimeout: 30,
    saveResponses: true,
    schedule: input.job.schedule,
    title: input.job.title,
    url: `${input.appUrl}${input.job.path}`,
  };
}

async function cronJobOrgRequest<T = Record<string, unknown>>(path: string, apiKey: string, options: RequestInit = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`cron-job.org ${options.method || 'GET'} ${path} failed (${response.status})`);
  }

  return body as T;
}

async function requireAdmin() {
  try {
    await requireRole(['admin']);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    return { error: message, status: message === 'Forbidden' ? 403 : 401 };
  }

  return null;
}

async function apiKeyFromRequest(request: NextRequest) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const apiKey = formData.get('apiKey');

    return typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : process.env.CRONJOB_ORG_API_KEY;
  }

  const body = await request.json().catch(() => ({}));

  return typeof body?.apiKey === 'string' && body.apiKey.trim()
    ? body.apiKey.trim()
    : process.env.CRONJOB_ORG_API_KEY;
}

export async function GET() {
  const adminError = await requireAdmin();
  if (adminError) {
    return NextResponse.json({ error: adminError.error }, { status: adminError.status });
  }

  return new Response(setupFormHtml(), {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
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

  const apiKey = await apiKeyFromRequest(request);

  if (!apiKey) {
    return NextResponse.json({ error: 'cron-job.org API key is required.' }, { status: 400 });
  }

  try {
    const appUrl = appUrlFromRequest(request);
    const existing = await cronJobOrgRequest<CronJobOrgListResponse>('/jobs', apiKey);
    const existingByTitle = new Map((existing.jobs || []).map((job) => [job.title, job]));
    const results = [];

    for (const job of jobs) {
      const payload = { job: jobPayload({ appUrl, cronSecret, job }) };
      const existingJob = existingByTitle.get(job.title);

      if (existingJob?.jobId) {
        await cronJobOrgRequest(`/jobs/${existingJob.jobId}`, apiKey, {
          body: JSON.stringify(payload),
          method: 'PATCH',
        });
        results.push({ action: 'updated', jobId: existingJob.jobId, title: job.title });
      } else {
        const created = await cronJobOrgRequest<CronJobOrgCreateResponse>('/jobs', apiKey, {
          body: JSON.stringify(payload),
          method: 'PUT',
        });
        if (!created.jobId) {
          throw new Error('cron-job.org did not return a job id');
        }
        results.push({ action: 'created', jobId: created.jobId, title: job.title });
      }
    }

    return NextResponse.json({
      appUrl,
      jobs: results,
      success: true,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Failed to configure cron-job.org reminder jobs:', error);
    return NextResponse.json({ error: 'Failed to configure cron-job.org reminder jobs' }, { status: 500 });
  }
}
