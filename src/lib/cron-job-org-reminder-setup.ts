import 'server-only';

import { getAccraClock } from '@/lib/attendance';

const API_BASE_URL = 'https://api.cron-job.org';
const CRON_JOB_ORG_WRITE_DELAY_MS = 750;
const EVERY_FIVE_MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const PROOF_TEST_JOB_TITLE = 'LateWatch scheduled proof test';

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

export type CronJobOrgProofTestScheduleResult = {
  action: 'created' | 'updated';
  appUrl: string;
  expiresAt: number;
  jobId: number;
  scheduledForAccra: string;
  success: true;
  testId: string;
  title: string;
  url: string;
};

export type CronJobOrgSchedulerRequest = {
  action: 'proof-test' | 'setup';
  apiKey: string | undefined;
  proofTestTime: string | undefined;
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

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);

  return { day, month, year };
}

function formatCronJobOrgExpiresAt(date: Date) {
  return Number([
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
    pad2(date.getUTCHours()),
    pad2(date.getUTCMinutes()),
    pad2(date.getUTCSeconds()),
  ].join(''));
}

export function proofTestScheduleForAccraTime(testTime: string, now = new Date()) {
  if (!/^\d{2}:\d{2}$/.test(testTime)) {
    throw new Error('Use a valid Accra test time in HH:MM format.');
  }

  const [hour, minute] = testTime.split(':').map(Number);
  if (hour > 23 || minute > 59) {
    throw new Error('Use a valid Accra test time in HH:MM format.');
  }

  const clock = getAccraClock(now);
  const { day, month, year } = parseDateKey(clock.dateKey);
  const target = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  if (target.getTime() <= now.getTime() + 60_000) {
    target.setUTCDate(target.getUTCDate() + 1);
  }

  const expiresAtDate = new Date(target.getTime() + 10 * 60 * 1000);
  const dateKey = [
    target.getUTCFullYear(),
    pad2(target.getUTCMonth() + 1),
    pad2(target.getUTCDate()),
  ].join('-');
  const timeKey = `${pad2(target.getUTCHours())}:${pad2(target.getUTCMinutes())}`;
  const compact = `${dateKey.replaceAll('-', '')}${timeKey.replace(':', '')}`;

  return {
    expiresAt: formatCronJobOrgExpiresAt(expiresAtDate),
    schedule: {
      expiresAt: formatCronJobOrgExpiresAt(expiresAtDate),
      hours: [target.getUTCHours()],
      mdays: [target.getUTCDate()],
      minutes: [target.getUTCMinutes()],
      months: [target.getUTCMonth() + 1],
      timezone: 'UTC',
      wdays: [-1],
    },
    scheduledForAccra: `${dateKey} ${timeKey}`,
    testId: `proof-${compact}`,
  };
}

export function appUrlFromSetupRequest(request: Request) {
  return (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '');
}

export function setupFormHtml(actionPath: string) {
  const clock = getAccraClock();
  const [hour, minute] = clock.timeKey.split(':').map(Number);
  const defaultProofTestTime = `${pad2((hour + Math.floor((minute + 10) / 60)) % 24)}:${pad2((minute + 10) % 60)}`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LateWatch cron-job.org setup</title>
    <style>
      body { background: #050505; color: #f8fafc; font-family: Arial, sans-serif; margin: 0; }
      main { margin: 48px auto; max-width: 640px; padding: 24px; }
      section { border: 1px solid #334155; border-radius: 8px; margin-top: 20px; padding: 18px; }
      label, input, button { display: block; width: 100%; }
      label { color: #cbd5e1; font-size: 14px; margin-bottom: 8px; }
      input { background: #111827; border: 1px solid #334155; border-radius: 6px; box-sizing: border-box; color: #f8fafc; font-size: 14px; margin-bottom: 12px; padding: 12px; }
      button { background: #2563eb; border: 0; border-radius: 6px; color: #fff; cursor: pointer; font-size: 15px; font-weight: 700; margin-top: 16px; padding: 12px; }
      .secondary { background: #059669; }
      p, a { color: #94a3b8; line-height: 1.5; }
      pre { background: #111827; border: 1px solid #334155; border-radius: 6px; overflow: auto; padding: 12px; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <main>
      <h1>LateWatch cron-job.org setup</h1>
      <p>This admin-only setup uses Vercel CRON_SECRET internally and does not display it.</p>
      <section>
        <h2>Production reminder catch-up jobs</h2>
        <form action="${escapeHtml(actionPath)}" method="post">
          <input name="action" type="hidden" value="setup" />
          <label for="apiKey">cron-job.org API key</label>
          <input id="apiKey" name="apiKey" type="password" autocomplete="off" required />
          <button type="submit">Create or update reminder jobs</button>
        </form>
      </section>
      <section>
        <h2>Scheduled proof test</h2>
        <p>Scope: all active reminder notification devices.</p>
        <form action="${escapeHtml(actionPath)}" method="post">
          <input name="action" type="hidden" value="proof-test" />
          <label for="proofTestApiKey">cron-job.org API key</label>
          <input id="proofTestApiKey" name="apiKey" type="password" autocomplete="off" required />
          <label for="proofTestTime">Accra test time</label>
          <input id="proofTestTime" name="proofTestTime" type="time" value="${escapeHtml(defaultProofTestTime)}" required />
          <button class="secondary" type="submit">Schedule proof test</button>
        </form>
      </section>
    </main>
  </body>
</html>`;
}

export function setupResultHtml(result: CronJobOrgProofTestScheduleResult | CronJobOrgSetupResult) {
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
  return (await schedulerRequestFromSetupRequest(request)).apiKey;
}

export async function schedulerRequestFromSetupRequest(request: Request): Promise<CronJobOrgSchedulerRequest> {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const apiKey = formData.get('apiKey');
    const action = formData.get('action');
    const proofTestTime = formData.get('proofTestTime');

    return {
      action: action === 'proof-test' ? 'proof-test' : 'setup',
      apiKey: typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : process.env.CRONJOB_ORG_API_KEY,
      proofTestTime: typeof proofTestTime === 'string' ? proofTestTime.trim() : undefined,
    };
  }

  const body = await request.json().catch(() => ({}));

  return {
    action: body?.action === 'proof-test' ? 'proof-test' : 'setup',
    apiKey: typeof body?.apiKey === 'string' && body.apiKey.trim()
      ? body.apiKey.trim()
      : process.env.CRONJOB_ORG_API_KEY,
    proofTestTime: typeof body?.proofTestTime === 'string' ? body.proofTestTime.trim() : undefined,
  };
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

export async function scheduleCronJobOrgProofTest(input: CronJobOrgSetupInput & {
  proofTestTime: string;
}): Promise<CronJobOrgProofTestScheduleResult> {
  const proofTest = proofTestScheduleForAccraTime(input.proofTestTime);
  const path = `/api/attendance/reminders/proof-test?testId=${encodeURIComponent(proofTest.testId)}`;
  const job = {
    path,
    schedule: proofTest.schedule,
    title: PROOF_TEST_JOB_TITLE,
  };
  const payload = { job: jobPayload({ appUrl: input.appUrl, cronSecret: input.cronSecret, job }) };
  const existing = await cronJobOrgRequest<CronJobOrgListResponse>('/jobs', input.apiKey);
  const existingJob = (existing.jobs || []).find((candidate) => candidate.title === PROOF_TEST_JOB_TITLE);

  await wait(CRON_JOB_ORG_WRITE_DELAY_MS);

  if (existingJob?.jobId) {
    await cronJobOrgRequest(`/jobs/${existingJob.jobId}`, input.apiKey, {
      body: JSON.stringify(payload),
      method: 'PATCH',
    });

    return {
      action: 'updated',
      appUrl: input.appUrl,
      expiresAt: proofTest.expiresAt,
      jobId: existingJob.jobId,
      scheduledForAccra: proofTest.scheduledForAccra,
      success: true,
      testId: proofTest.testId,
      title: PROOF_TEST_JOB_TITLE,
      url: `${input.appUrl}${path}`,
    };
  }

  const created = await cronJobOrgRequest<CronJobOrgCreateResponse>('/jobs', input.apiKey, {
    body: JSON.stringify(payload),
    method: 'PUT',
  });
  if (!created.jobId) {
    throw new Error('cron-job.org did not return a proof test job id');
  }

  return {
    action: 'created',
    appUrl: input.appUrl,
    expiresAt: proofTest.expiresAt,
    jobId: created.jobId,
    scheduledForAccra: proofTest.scheduledForAccra,
    success: true,
    testId: proofTest.testId,
    title: PROOF_TEST_JOB_TITLE,
    url: `${input.appUrl}${path}`,
  };
}
