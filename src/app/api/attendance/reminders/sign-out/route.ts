import { NextResponse } from 'next/server';
import { sendAttendanceReminderBatch } from '@/lib/push-reminders';

export const dynamic = 'force-dynamic';

export async function GET() {
  const result = await sendAttendanceReminderBatch('sign_out');

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
