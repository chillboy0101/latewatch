// app/api/audit-trail/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { auditEvent } from '@/db/schema';
import { eq, desc, gte, lte, like, and, count } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const entityType = url.searchParams.get('entityType');
    const action = url.searchParams.get('action');
    const actorEmail = url.searchParams.get('actorEmail');
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');

    // Build conditions
    const conditions = [];

    if (entityType && entityType !== 'all') {
      conditions.push(eq(auditEvent.entityType, entityType));
    }

    if (action && action !== 'all') {
      conditions.push(eq(auditEvent.action, action as any));
    }

    if (actorEmail) {
      conditions.push(like(auditEvent.actorEmail, `%${actorEmail}%`));
    }

    if (startDate) {
      conditions.push(gte(auditEvent.timestamp, new Date(startDate)));
    }

    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(auditEvent.timestamp, end));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get filtered count
    const countResult = await db.select({ count: count() }).from(auditEvent).where(whereClause);
    const totalCount = Number(countResult[0]?.count || 0);

    // Get paginated data
    const logs = await db.select({
      id: auditEvent.id,
      entityType: auditEvent.entityType,
      entityId: auditEvent.entityId,
      action: auditEvent.action,
      beforeJson: auditEvent.beforeJson,
      afterJson: auditEvent.afterJson,
      actorUserId: auditEvent.actorUserId,
      actorEmail: auditEvent.actorEmail,
      timestamp: auditEvent.timestamp,
    })
    .from(auditEvent)
    .where(whereClause)
    .orderBy(desc(auditEvent.timestamp))
    .limit(limit)
    .offset((page - 1) * limit);

    return NextResponse.json({
      data: logs,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    console.error('Failed to fetch audit trail:', error);
    return NextResponse.json({ error: 'Failed to fetch audit trail' }, { status: 500 });
  }
}