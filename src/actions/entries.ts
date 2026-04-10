// actions/entries.ts
'use server';

import { requireRole } from '@/lib/auth/roles';
import { db } from '@/db';
import { latenessEntry, auditEvent, workCalendar } from '@/db/schema';
import { updateTag } from 'next/cache';
import { z } from 'zod';
import { computePenalty } from '@/lib/penalty-calculator';
import { eq, and } from 'drizzle-orm';

const entrySchema = z.object({
  staffId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  arrivalTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  didNotSignOut: z.boolean(),
  reason: z.string().optional(),
});

export async function getEntries(date: string) {
  await requireRole(['admin', 'hr', 'viewer']);
  
  const entries = await db.query.latenessEntry.findMany({
    where: (entry, { eq }) => eq(entry.date, date),
    with: {
      staff: true,
    },
    orderBy: (entry, { asc }) => [asc(entry.id)],
  });
  
  return entries;
}

export async function saveEntry(formData: FormData) {
  const user = await requireRole(['admin', 'hr']);

  const parsed = entrySchema.parse({
    staffId: formData.get('staffId'),
    date: formData.get('date'),
    arrivalTime: formData.get('arrivalTime') as string | null,
    didNotSignOut: formData.get('didNotSignOut') === 'true',
    reason: formData.get('reason') || undefined,
  });

  // Check if holiday
  const calendar = await db.query.workCalendar.findFirst({
    where: (c, { eq }) => eq(c.date, parsed.date),
  });
  
  if (calendar?.isHoliday) {
    throw new Error('Cannot create entry for holiday');
  }

  // Compute penalty
  const { amount, reason } = computePenalty({
    arrivalTime: parsed.arrivalTime,
    didNotSignOut: parsed.didNotSignOut,
    isHoliday: false,
  });

  // Upsert entry
  const existing = await db.query.latenessEntry.findFirst({
    where: (e, { and, eq }) => and(
      eq(e.staffId, parsed.staffId),
      eq(e.date, parsed.date)
    ),
  });

  let entry;
  if (existing) {
    const before = { ...existing };
    [entry] = await db.update(latenessEntry)
      .set({
        arrivalTime: parsed.arrivalTime,
        didNotSignOut: parsed.didNotSignOut,
        computedAmount: amount.toString(),
        reason: reason,
        updatedAt: new Date(),
      })
      .where(eq(latenessEntry.id, existing.id))
      .returning();
    
    // Audit log
    await db.insert(auditEvent).values({
      entityType: 'entry',
      entityId: entry.id,
      action: 'UPDATE',
      beforeJson: before,
      afterJson: entry,
      actorUserId: user.id,
      actorEmail: user.email,
    });
  } else {
    [entry] = await db.insert(latenessEntry).values({
      staffId: parsed.staffId,
      date: parsed.date,
      arrivalTime: parsed.arrivalTime,
      didNotSignOut: parsed.didNotSignOut,
      computedAmount: amount.toString(),
      reason: reason,
    }).returning();
    
    // Audit log
    await db.insert(auditEvent).values({
      entityType: 'entry',
      entityId: entry.id,
      action: 'CREATE',
      beforeJson: null,
      afterJson: entry,
      actorUserId: user.id,
      actorEmail: user.email,
    });
  }

  updateTag(`entries-${parsed.date}`);

  return entry;
}

export async function deleteEntry(id: string, date: string) {
  const user = await requireRole(['admin', 'hr']);
  
  const existing = await db.query.latenessEntry.findFirst({
    where: (e, { eq }) => eq(e.id, id),
  });
  
  if (!existing) {
    throw new Error('Entry not found');
  }
  
  await db.delete(latenessEntry).where(eq(latenessEntry.id, id));
  
  // Audit log
  await db.insert(auditEvent).values({
    entityType: 'entry',
    entityId: id,
    action: 'DELETE',
    beforeJson: existing,
    afterJson: null,
    actorUserId: user.id,
    actorEmail: user.email,
  });
  
  updateTag(`entries-${date}`);
}

export async function bulkSaveEntries(entries: Array<{
  staffId: string;
  date: string;
  arrivalTime: string | null;
  didNotSignOut: boolean;
}>) {
  const user = await requireRole(['admin', 'hr']);
  
  // Check if holiday
  const calendar = await db.query.workCalendar.findFirst({
    where: (c, { eq }) => eq(c.date, entries[0]?.date),
  });
  
  if (calendar?.isHoliday) {
    throw new Error('Cannot create entries for holiday');
  }
  
  const results = [];
  
  for (const entry of entries) {
    const { amount, reason } = computePenalty({
      arrivalTime: entry.arrivalTime,
      didNotSignOut: entry.didNotSignOut,
      isHoliday: false,
    });
    
    const existing = await db.query.latenessEntry.findFirst({
      where: (e, { and, eq }) => and(
        eq(e.staffId, entry.staffId),
        eq(e.date, entry.date)
      ),
    });
    
    let result;
    if (existing) {
      [result] = await db.update(latenessEntry)
        .set({
          arrivalTime: entry.arrivalTime,
          didNotSignOut: entry.didNotSignOut,
          computedAmount: amount.toString(),
          reason: reason,
          updatedAt: new Date(),
        })
        .where(eq(latenessEntry.id, existing.id))
        .returning();
    } else {
      [result] = await db.insert(latenessEntry).values({
        staffId: entry.staffId,
        date: entry.date,
        arrivalTime: entry.arrivalTime,
        didNotSignOut: entry.didNotSignOut,
        computedAmount: amount.toString(),
        reason: reason,
      }).returning();
    }
    
    results.push(result);
  }
  
  updateTag(`entries-${entries[0]?.date}`);
  
  return results;
}
