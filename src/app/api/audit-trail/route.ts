// app/api/audit-trail/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { auditEvent } from '@/db/schema';
import { eq, desc, gte, lte, like, and, SQL } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const entityType = searchParams.get('entityType');
    const action = searchParams.get('action');
    const actorEmail = searchParams.get('actorEmail');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // Build conditions
    const conditions: SQL[] = [];
    
    if (entityType && entityType !== 'all') {
      conditions.push(eq(auditEvent.entityType, entityType));
    }
    
    if (action && action !== 'all') {
      conditions.push(eq(auditEvent.action, action));
    }
    
    if (actorEmail) {
      conditions.push(like(auditEvent.actorEmail, `%${actorEmail}%`));
    }
    
    if (startDate) {
      conditions.push(gte(auditEvent.timestamp, new Date(startDate)));
    }
    
    if (endDate) {
      conditions.push(lte(auditEvent.timestamp, new Date(endDate)));
    }

    // Get total count
    const allEvents = await db.select({ id: auditEvent.id }).from(auditEvent);
    const totalCount = allEvents.length;

    // Get paginated data
    const logs = await db.query.auditEvent.findMany({
      where: conditions.length > 0 
        ? (audit, { and }) => and(...conditions)
        : undefined,
      orderBy: [desc(auditEvent.timestamp)],
      limit,
      offset: (page - 1) * limit,
    });

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
