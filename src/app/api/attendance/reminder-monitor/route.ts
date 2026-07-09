import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/roles';
import { isIsoDateKey } from '@/lib/date-format';
import { getAccraDateKey } from '@/lib/date-key';
import { getReminderDeliveryMonitor } from '@/lib/reminder-delivery-monitor';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  try {
    await requireRole(['admin']);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    return { error: message, status: message === 'Forbidden' ? 403 : 401 };
  }
}

export async function GET(request: NextRequest) {
  const adminError = await requireAdmin();
  if (adminError) {
    return NextResponse.json({ error: adminError.error }, { status: adminError.status });
  }

  const date = request.nextUrl.searchParams.get('date') || getAccraDateKey();
  if (!isIsoDateKey(date)) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }

  try {
    const result = await getReminderDeliveryMonitor(date);

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (firstError) {
    console.error('Failed to load reminder delivery monitor (retrying once):', firstError);

    try {
      const result = await getReminderDeliveryMonitor(date);

      return NextResponse.json(result, {
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch (error) {
      console.error('Failed to load reminder delivery monitor (retry also failed):', error);
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      return NextResponse.json({ error: `Failed to load reminder delivery monitor - ${detail}` }, { status: 500 });
    }
  }
}
