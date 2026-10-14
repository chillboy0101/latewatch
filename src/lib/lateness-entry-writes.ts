import 'server-only';

import { and, eq, notExists, sql } from 'drizzle-orm';
import { db } from '@/db';
import { latenessDebtPardonEntry, latenessEntry, latenessPaymentAllocation } from '@/db/schema';

// Paid or pardoned charges are settled and never rewritten. Callers check that up front, but a
// payment can land between that check and the write, so every rewrite re-checks it in the same
// SQL statement: a charge settled in the meantime is left exactly as it is.

type LatenessEntryChanges = Partial<typeof latenessEntry.$inferInsert>;

const hasNoPayment = () => notExists(
  db.select({ one: sql`1` }).from(latenessPaymentAllocation).where(eq(latenessPaymentAllocation.entryId, latenessEntry.id)),
);
const hasNoPardon = () => notExists(
  db.select({ one: sql`1` }).from(latenessDebtPardonEntry).where(eq(latenessDebtPardonEntry.entryId, latenessEntry.id)),
);

/** Deletes the charge unless it is paid or pardoned. Returns how many rows were deleted (0 or 1). */
export async function deleteUnsettledLatenessEntry(id: string) {
  const deleted = await db.delete(latenessEntry)
    .where(and(eq(latenessEntry.id, id), hasNoPayment(), hasNoPardon()))
    .returning({ id: latenessEntry.id });
  return deleted.length;
}

/** Updates the charge unless it is paid or pardoned. Returns the updated row, or null if it was settled. */
export async function updateUnsettledLatenessEntry(id: string, changes: LatenessEntryChanges) {
  const [updated] = await db.update(latenessEntry)
    .set(changes)
    .where(and(eq(latenessEntry.id, id), hasNoPayment(), hasNoPardon()))
    .returning();
  return updated || null;
}

/** Updates the charge unless money has been paid against it (used to zero a pardoned leave day). */
export async function updateUnpaidLatenessEntry(id: string, changes: LatenessEntryChanges) {
  const [updated] = await db.update(latenessEntry)
    .set(changes)
    .where(and(eq(latenessEntry.id, id), hasNoPayment()))
    .returning();
  return updated || null;
}
