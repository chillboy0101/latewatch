import { NextRequest, NextResponse } from 'next/server';
import { writeAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const staffId = typeof body?.staffId === 'string' && body.staffId.trim()
      ? body.staffId.trim()
      : null;
    const noticeType = body?.type === 'weekly' ? 'weekly' : body?.type === 'daily' ? 'daily' : null;

    if (!staffId || !noticeType) {
      return NextResponse.json({ error: 'staffId and type are required' }, { status: 400 });
    }

    await writeAuditEvent({
      action: 'CREATE',
      after: {
        amount: typeof body?.amount === 'string' ? body.amount : null,
        date: typeof body?.date === 'string' ? body.date : null,
        staffId,
        staffName: typeof body?.staffName === 'string' ? body.staffName : null,
        type: noticeType,
        weekEnd: typeof body?.weekEnd === 'string' ? body.weekEnd : null,
        weekStart: typeof body?.weekStart === 'string' ? body.weekStart : null,
      },
      before: null,
      entityId: `${noticeType}:${staffId}:${body?.date || body?.weekStart || new Date().toISOString()}`,
      entityType: 'whatsapp_notice',
      reason: 'whatsapp-notice',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to mark WhatsApp notice sent:', error);
    return NextResponse.json({ error: 'Failed to mark WhatsApp notice sent' }, { status: 500 });
  }
}
