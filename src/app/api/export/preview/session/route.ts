import { NextRequest, NextResponse } from 'next/server';
import {
  createExportPreviewSession,
  deleteExportPreviewSession,
  getExportPreviewAuditPayload,
  getExportPreviewPublicResponse,
  normalizeExportPreviewRequest,
} from '@/lib/export-preview-session';
import { getAuditActor, tryWriteAuditEvent } from '@/lib/audit';
import { enforceRole } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authError = await enforceRole(['admin']);
  if (authError) {
    return NextResponse.json({ error: authError.error }, { status: authError.status });
  }

  try {
    const body = await request.json();
    const input = normalizeExportPreviewRequest(body);
    const actor = await getAuditActor();
    const session = await createExportPreviewSession(input);

    await tryWriteAuditEvent({
      action: 'PREVIEW',
      actor: { email: actor.actorEmail, id: actor.actorUserId },
      after: getExportPreviewAuditPayload(session, input),
      before: null,
      entityId: `preview-${session.sessionId}`,
      entityType: 'export',
      reason: 'export-preview',
    });

    return NextResponse.json(getExportPreviewPublicResponse(session), {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Export preview failed:', error);
    const message = error instanceof Error ? error.message : 'Export preview failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const authError = await enforceRole(['admin']);
  if (authError) {
    return NextResponse.json({ error: authError.error }, { status: authError.status });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const deletedCount = await deleteExportPreviewSession((body as { sessionId?: unknown }).sessionId);

    return NextResponse.json({ deletedCount }, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.warn('Export preview cleanup failed:', error);
    return NextResponse.json({ deletedCount: 0 }, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  }
}
