// app/api/audit-trail/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { db } from '@/db';
import { auditEvent } from '@/db/schema';
import { eq, desc, gte, lte, ilike, and, count, or, inArray, ne, type SQL } from 'drizzle-orm';
import { getAuditActionAliases, normalizeAuditAction } from '@/lib/audit-taxonomy';

function getEmailFromSessionClaims(claims: Record<string, unknown> | null) {
  return [claims?.email, claims?.email_address, claims?.primary_email_address]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    ?.trim() || null;
}

async function getCurrentUserAuditEmail() {
  try {
    const user = await currentUser();
    return user?.emailAddresses[0]?.emailAddress?.trim() || null;
  } catch {
    return null;
  }
}

async function getActorEmailAliases() {
  const session = await auth();
  if (!session.userId) return new Map<string, string>();

  const claimEmail = getEmailFromSessionClaims(session.sessionClaims as Record<string, unknown> | null);
  const profileEmail = claimEmail ? null : await getCurrentUserAuditEmail();
  const email = claimEmail || profileEmail;

  return email ? new Map([[session.userId, email]]) : new Map<string, string>();
}

function buildActionCondition(action: string): SQL | undefined {
  const normalizedAction = normalizeAuditAction(action);

  if (normalizedAction === 'DEACTIVATE') {
    return or(
      eq(auditEvent.action, 'DEACTIVATE'),
      and(eq(auditEvent.action, 'DELETE'), eq(auditEvent.entityType, 'staff')),
    );
  }

  if (normalizedAction === 'DELETE') {
    return and(eq(auditEvent.action, 'DELETE'), ne(auditEvent.entityType, 'staff'));
  }

  const aliases = getAuditActionAliases(normalizedAction);
  const firstAlias = aliases[0];
  if (!firstAlias) return undefined;

  return aliases.length > 1
    ? inArray(auditEvent.action, aliases)
    : eq(auditEvent.action, firstAlias);
}

function buildSearchCondition(query: string): SQL | undefined {
  const searchTerm = `%${query}%`;
  const normalizedQuery = query.trim().toLowerCase();
  const conditions: SQL[] = [
    ilike(auditEvent.actorEmail, searchTerm),
    ilike(auditEvent.entityType, searchTerm),
    ilike(auditEvent.entityId, searchTerm),
    ilike(auditEvent.action, searchTerm),
  ];

  if (normalizedQuery.includes('create') || normalizedQuery.includes('created') || normalizedQuery.includes('add')) {
    conditions.push(eq(auditEvent.action, 'CREATE'));
  }

  if (normalizedQuery.includes('update') || normalizedQuery.includes('updated') || normalizedQuery.includes('edit')) {
    conditions.push(eq(auditEvent.action, 'UPDATE'));
  }

  if (normalizedQuery.includes('delete') || normalizedQuery.includes('deleted') || normalizedQuery.includes('remove')) {
    const deletionCondition = buildActionCondition('DELETE');
    if (deletionCondition) conditions.push(deletionCondition);
  }

  if (normalizedQuery.includes('generate') || normalizedQuery.includes('generated') || normalizedQuery.includes('export')) {
    conditions.push(inArray(auditEvent.action, ['GENERATE', 'EXPORT', 'PREVIEW']));
    conditions.push(eq(auditEvent.entityType, 'export'));
  }

  if (normalizedQuery.includes('preview') || normalizedQuery.includes('viewed')) {
    conditions.push(eq(auditEvent.action, 'PREVIEW'));
    conditions.push(eq(auditEvent.entityType, 'export'));
  }

  if (normalizedQuery.includes('sync') || normalizedQuery.includes('synced')) {
    conditions.push(eq(auditEvent.action, 'SYNC'));
  }

  if (normalizedQuery.includes('deactivate')) {
    const deactivationCondition = buildActionCondition('DEACTIVATE');
    if (deactivationCondition) conditions.push(deactivationCondition);
  } else if (normalizedQuery.includes('activate')) {
    conditions.push(eq(auditEvent.action, 'ACTIVATE'));
  }

  if (normalizedQuery.includes('archive') || normalizedQuery.includes('archived') || normalizedQuery.includes('former')) {
    conditions.push(eq(auditEvent.action, 'ARCHIVE'));
  }

  if (normalizedQuery.includes('restore') || normalizedQuery.includes('restored')) {
    conditions.push(eq(auditEvent.action, 'RESTORE'));
  }

  if (normalizedQuery.includes('holiday')) {
    conditions.push(eq(auditEvent.entityType, 'calendar'));
  }

  if (normalizedQuery.includes('lateness') || normalizedQuery.includes('entry') || normalizedQuery.includes('submission')) {
    conditions.push(inArray(auditEvent.entityType, ['entry', 'entry_submission']));
  }

  if (normalizedQuery.includes('staff') || normalizedQuery.includes('personnel') || normalizedQuery.includes('member')) {
    conditions.push(eq(auditEvent.entityType, 'staff'));
  }

  if (normalizedQuery.includes('notification') || normalizedQuery.includes('alert')) {
    conditions.push(eq(auditEvent.entityType, 'notification'));
  }

  if (normalizedQuery.includes('system')) {
    conditions.push(eq(auditEvent.entityType, 'system'));
  }

  return or(...conditions);
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const page = Math.max(parseInt(url.searchParams.get('page') || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10), 1), 100);
    const entityType = url.searchParams.get('entityType');
    const action = url.searchParams.get('action');
    const query = url.searchParams.get('q') || url.searchParams.get('actorEmail');
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');

    const conditions: SQL[] = [];

    if (entityType && entityType !== 'all') {
      conditions.push(eq(auditEvent.entityType, entityType));
    }

    if (action && action !== 'all') {
      const actionCondition = buildActionCondition(action);
      if (actionCondition) conditions.push(actionCondition);
    }

    if (query) {
      const searchCondition = buildSearchCondition(query);
      if (searchCondition) conditions.push(searchCondition);
    }

    if (startDate && !Number.isNaN(new Date(startDate).getTime())) {
      conditions.push(gte(auditEvent.timestamp, new Date(startDate)));
    }

    if (endDate && !Number.isNaN(new Date(endDate).getTime())) {
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
    const actorEmailAliases = await getActorEmailAliases();
    const displayLogs = logs.map((log) => ({
      ...log,
      actorEmail: actorEmailAliases.get(log.actorEmail || '') || log.actorEmail,
    }));

    return NextResponse.json({
      data: displayLogs,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    }, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Failed to fetch audit trail:', error);
    return NextResponse.json({ error: 'Failed to fetch audit trail' }, { status: 500 });
  }
}
