import 'server-only';

const API_BASE_URL = 'https://api.cron-job.org';
const CRON_JOB_ORG_WRITE_DELAY_MS = 750;
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

type CronJobOrgSetupJob = {
  path: string;
  schedule: {
    expiresAt: number;
    hours: number[];
    mdays: number[];
    minutes: number[];
    months: number[];
    timezone: string;
    wdays: number[];
  };
  title: string;
};

type CronJobOrgSetupInput = {
  apiKey: string;
  appUrl: string;
  cronSecret: string;
};

type CronJobOrgSetupJobResult = {
  action: 'created' | 'updated';
  jobId: number;
  title: string;
};

export type CronJobOrgSetupResult = {
  appUrl: string;
  jobs: CronJobOrgSetupJobResult[];
  success: true;
};

export const cronJobOrgReminderJobs: CronJobOrgSetupJob[] = [
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

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function jobPayload(input: {
  appUrl: string;
  cronSecret: string;
  job: CronJobOrgSetupJob;
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
    const detail = text ? `: ${text.slice(0, 500)}` : '';
    throw new Error(`cron-job.org ${options.method || 'GET'} ${path} failed (${response.status})${detail}`);
  }

  return body as T;
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function appUrlFromSetupRequest(request: Request) {
  return (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '');
}

export function setupFormHtml(actionPath: string) {
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
      p, a { color: #94a3b8; line-height: 1.5; }
      pre { background: #111827; border: 1px solid #334155; border-radius: 6px; overflow: auto; padding: 12px; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <main>
      <h1>LateWatch cron-job.org setup</h1>
      <p>This admin-only setup uses Vercel CRON_SECRET internally and does not display it.</p>
      <form action="${escapeHtml(actionPath)}" method="post">
        <label for="apiKey">cron-job.org API key</label>
        <input id="apiKey" name="apiKey" type="password" autocomplete="off" required />
        <button type="submit">Create or update reminder jobs</button>
      </form>
    </main>
  </body>
</html>`;
}

export function setupResultHtml(result: CronJobOrgSetupResult) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LateWatch cron-job.org setup complete</title>
    <style>
      body { background: #050505; color: #f8fafc; font-family: Arial, sans-serif; margin: 0; }
      main { margin: 48px auto; max-width: 720px; padding: 24px; }
      a { color: #60a5fa; }
      pre { background: #111827; border: 1px solid #334155; border-radius: 6px; overflow: auto; padding: 12px; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <main>
      <h1>Reminder scheduler configured</h1>
      <pre>${escapeHtml(JSON.stringify(result, null, 2))}</pre>
      <p><a href="/check-in">Back to LateWatch</a></p>
    </main>
  </body>
</html>`;
}

export async function apiKeyFromSetupRequest(request: Request) {
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

export async function setupCronJobOrgReminderJobs(input: CronJobOrgSetupInput): Promise<CronJobOrgSetupResult> {
  const existing = await cronJobOrgRequest<CronJobOrgListResponse>('/jobs', input.apiKey);
  const existingByTitle = new Map((existing.jobs || []).map((job) => [job.title, job]));
  const results: CronJobOrgSetupJobResult[] = [];

  for (const job of cronJobOrgReminderJobs) {
    const payload = { job: jobPayload({ appUrl: input.appUrl, cronSecret: input.cronSecret, job }) };
    const existingJob = existingByTitle.get(job.title);

    await wait(CRON_JOB_ORG_WRITE_DELAY_MS);

    if (existingJob?.jobId) {
      await cronJobOrgRequest(`/jobs/${existingJob.jobId}`, input.apiKey, {
        body: JSON.stringify(payload),
        method: 'PATCH',
      });
      results.push({ action: 'updated', jobId: existingJob.jobId, title: job.title });
    } else {
      const created = await cronJobOrgRequest<CronJobOrgCreateResponse>('/jobs', input.apiKey, {
        body: JSON.stringify(payload),
        method: 'PUT',
      });
      if (!created.jobId) {
        throw new Error('cron-job.org did not return a job id');
      }
      results.push({ action: 'created', jobId: created.jobId, title: job.title });
    }
  }

  return {
    appUrl: input.appUrl,
    jobs: results,
    success: true,
  };
}
