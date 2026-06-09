#!/usr/bin/env node

const API_BASE_URL = 'https://api.cron-job.org';
const APP_URL = process.env.LATEWATCH_APP_URL || 'https://latewatch.vercel.app';
const API_KEY = process.env.CRONJOB_ORG_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const EVERY_FIVE_MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

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

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`${name} is required. Set it before running this script.`);
  }
}

function jobPayload(job) {
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
        Authorization: `Bearer ${CRON_SECRET}`,
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
    schedule: job.schedule,
    title: job.title,
    url: `${APP_URL}${job.path}`,
  };
}

async function cronJobOrgRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`cron-job.org ${options.method || 'GET'} ${path} failed (${response.status}): ${text}`);
  }

  return body;
}

async function main() {
  requireEnv('CRONJOB_ORG_API_KEY', API_KEY);
  requireEnv('CRON_SECRET', CRON_SECRET);

  const existing = await cronJobOrgRequest('/jobs');
  const existingByTitle = new Map((existing.jobs || []).map((job) => [job.title, job]));
  const results = [];

  for (const job of jobs) {
    const payload = { job: jobPayload(job) };
    const existingJob = existingByTitle.get(job.title);

    if (existingJob?.jobId) {
      await cronJobOrgRequest(`/jobs/${existingJob.jobId}`, {
        body: JSON.stringify(payload),
        method: 'PATCH',
      });
      results.push({ action: 'updated', jobId: existingJob.jobId, title: job.title });
    } else {
      const created = await cronJobOrgRequest('/jobs', {
        body: JSON.stringify(payload),
        method: 'PUT',
      });
      results.push({ action: 'created', jobId: created.jobId, title: job.title });
    }
  }

  console.log(JSON.stringify({ appUrl: APP_URL, jobs: results }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
