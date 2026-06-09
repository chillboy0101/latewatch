import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { sendReminderProofTestBatch } from '@/lib/push-reminder-proof-test';
import { validateReminderCronAuth } from '@/lib/reminder-cron-guard';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const cronGuard = validateReminderCronAuth(request);
  if (!cronGuard.ok) return cronGuard.response;

  const testId = request.nextUrl.searchParams.get('testId') || undefined;
  const result = await sendReminderProofTestBatch(testId);

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
