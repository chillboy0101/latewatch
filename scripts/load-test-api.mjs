const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const cookie = (process.env.LATEWATCH_LOAD_TEST_COOKIE || '').trim();
const concurrency = Number.parseInt(process.env.CONCURRENCY || '20', 10);
const requests = Number.parseInt(process.env.REQUESTS || '100', 10);
const date = process.env.ATTENDANCE_DATE || new Date().toISOString().slice(0, 10);
const paths = (process.env.LOAD_TEST_PATHS || [
  '/api/dashboard',
  `/api/attendance?date=${date}`,
  '/api/notifications?limit=10',
].join(','))
  .split(',')
  .map((path) => path.trim())
  .filter(Boolean);

function percentile(values, percentage) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((percentage / 100) * sorted.length) - 1);
  return sorted[index];
}

function formatMs(value) {
  return `${Math.round(value)}ms`;
}

async function hit(path, index) {
  const url = new URL(path, baseUrl);
  const startedAt = performance.now();

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: cookie ? { cookie } : undefined,
      redirect: 'manual',
    });
    await response.arrayBuffer().catch(() => null);

    return {
      clerkAuthReason: response.headers.get('x-clerk-auth-reason'),
      clerkAuthStatus: response.headers.get('x-clerk-auth-status'),
      duration: performance.now() - startedAt,
      endpoint: path,
      index,
      matchedPath: response.headers.get('x-matched-path'),
      ok: response.ok,
      status: response.status,
    };
  } catch (error) {
    return {
      duration: performance.now() - startedAt,
      endpoint: path,
      error: error instanceof Error ? error.message : String(error),
      index,
      ok: false,
      status: 'ERR',
    };
  }
}

async function main() {
  if (paths.length === 0) {
    throw new Error('No paths configured for load test.');
  }

  if (!cookie) {
    throw new Error(
      'A real signed-in Clerk session cookie is required. Set LATEWATCH_LOAD_TEST_COOKIE to the full Cookie header from a real admin browser session.',
    );
  }

  console.log(`LateWatch API load test`);
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Requests: ${requests}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`Auth cookie: ${cookie ? 'provided' : 'not provided'}`);
  console.log(`Paths: ${paths.join(', ')}`);

  const queue = Array.from({ length: requests }, (_, index) => ({
    index,
    path: paths[index % paths.length],
  }));
  const results = [];

  async function worker() {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      results.push(await hit(next.path, next.index));
    }
  }

  const startedAt = performance.now();
  await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, () => worker()));
  const totalDuration = performance.now() - startedAt;

  const durations = results.map((result) => result.duration);
  const statusCounts = results.reduce((counts, result) => {
    counts[result.status] = (counts[result.status] || 0) + 1;
    return counts;
  }, {});
  const failures = results.filter((result) => !result.ok);

  console.log('');
  console.log(`Completed in ${formatMs(totalDuration)}`);
  console.log(`p50: ${formatMs(percentile(durations, 50))}`);
  console.log(`p95: ${formatMs(percentile(durations, 95))}`);
  console.log(`max: ${formatMs(Math.max(...durations))}`);
  console.log(`statuses: ${Object.entries(statusCounts).map(([status, count]) => `${status}=${count}`).join(', ')}`);

  if (failures.length > 0) {
    console.log('');
    console.log(`Failures: ${failures.length}`);
    for (const failure of failures.slice(0, 8)) {
      const authNote = failure.clerkAuthReason
        ? ` Clerk=${failure.clerkAuthStatus || 'unknown'}:${failure.clerkAuthReason}`
        : '';
      const matchedPath = failure.matchedPath ? ` matched=${failure.matchedPath}` : '';
      console.log(`- ${failure.endpoint}: ${failure.status}${failure.error ? ` (${failure.error})` : ''}${authNote}${matchedPath}`);
    }

    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
