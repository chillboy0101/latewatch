import 'server-only';

import { sql } from 'drizzle-orm';
import { db } from '@/db';

let ensurePromise: Promise<void> | null = null;

export async function ensureStaffWhatsAppColumns() {
  ensurePromise ??= (async () => {
    await db.execute(sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT`);
    await db.execute(sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS whatsapp_notifications_enabled BOOLEAN DEFAULT false NOT NULL`);
  })().catch((error) => {
    ensurePromise = null;
    throw error;
  });

  return ensurePromise;
}
