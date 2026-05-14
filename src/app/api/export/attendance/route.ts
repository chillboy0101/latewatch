import { NextRequest, NextResponse } from 'next/server';
import {
  isAttendanceExportGroup,
  isAttendanceExportTemplate,
} from '@/lib/attendance-export-shared';
import { getAuditActor, tryWriteAuditEvent } from '@/lib/audit';
import { buildAttendanceExportWorkbook } from '@/lib/attendance-template-export';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const exportYear = Number(body?.year);
    const exportMonth = Number(body?.month);
    const template = body?.template;
    const group = body?.group;

    if (!Number.isInteger(exportYear) || !Number.isInteger(exportMonth) || exportMonth < 0 || exportMonth > 11) {
      return NextResponse.json({ error: 'Valid year and month are required' }, { status: 400 });
    }

    if (!isAttendanceExportTemplate(template)) {
      return NextResponse.json({ error: 'Valid attendance export template is required' }, { status: 400 });
    }

    if (!isAttendanceExportGroup(group)) {
      return NextResponse.json({ error: 'Valid attendance roster group is required' }, { status: 400 });
    }

    const actor = await getAuditActor();
    const result = await buildAttendanceExportWorkbook({
      group,
      month: exportMonth,
      template,
      year: exportYear,
    });

    await tryWriteAuditEvent({
      entityType: 'export',
      entityId: `attendance-${group}-${template}-${exportYear}-${exportMonth + 1}`,
      action: 'GENERATE',
      before: null,
      after: {
        fileName: result.fileName,
        group,
        month: exportMonth + 1,
        rosterCount: result.rosterCount,
        template,
        year: exportYear,
      },
      actor: { id: actor.actorUserId, email: actor.actorEmail },
      reason: 'attendance-export',
    });

    return new NextResponse(result.buffer, {
      headers: {
        'Content-Disposition': `attachment; filename="${result.fileName}"`,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    });
  } catch (error) {
    console.error('Attendance export failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Attendance export failed: ${message}` }, { status: 500 });
  }
}
