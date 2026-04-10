// actions/audit.ts
'use server';

import { requireRole } from '@/lib/auth/roles';
import { db } from '@/db';
import { auditEvent } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';

export async function getAuditLogs(
  entityType?: string,
  entityId?: string,
  limit: number = 50
) {
  await requireRole(['admin', 'hr']);
  
  let conditions = [];
  
  if (entityType) {
    conditions.push(eq(auditEvent.entityType, entityType));
  }
  
  if (entityId) {
    conditions.push(eq(auditEvent.entityId, entityId));
  }
  
  const logs = await db.query.auditEvent.findMany({
    where: conditions.length > 0 
      ? (audit, { and }) => and(...conditions)
      : undefined,
    orderBy: [desc(auditEvent.timestamp)],
    limit,
  });
  
  return logs;
}
