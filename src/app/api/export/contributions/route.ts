import { currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getAuditActor, tryWriteAuditEvent } from '@/lib/audit';
import { buildContributionExportWorkbook } from '@/lib/contribution-export';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const actor = await getAuditActor({
      email: user.primaryEmailAddress?.emailAddress || user.emailAddresses[0]?.emailAddress || null,
      id: user.id,
    });
    const result = await buildContributionExportWorkbook();

    await tryWriteAuditEvent({
      action: 'GENERATE',
      actor: { email: actor.actorEmail, id: actor.actorUserId },
      after: {
        entryCount: result.entryCount,
        fileName: result.fileName,
        sectionCount: result.sectionCount,
        totalAmount: result.totalAmount,
      },
      before: null,
      entityId: 'contributions',
      entityType: 'export',
      reason: 'contributions-export',
    });

    return new NextResponse(result.buffer, {
      headers: {
        'Content-Disposition': `attachment; filename="${result.fileName}"`,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    });
  } catch (error) {
    console.error('Contribution export failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Contribution export failed: ${message}` }, { status: 500 });
  }
}
