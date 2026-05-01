// Idempotent local schema repair for legacy development databases.
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await db.execute(sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS display_order INTEGER`);
    await db.execute(sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false`);
    await db.execute(sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP`);
    await db.execute(sql`UPDATE staff SET archived = false WHERE archived IS NULL`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS entry_submission (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        date date UNIQUE NOT NULL,
        submitted_by_user_id text,
        submitted_by_email text NOT NULL,
        entry_count integer DEFAULT 0 NOT NULL,
        deleted_count integer DEFAULT 0 NOT NULL,
        submitted_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )
    `);

    return NextResponse.json({ message: 'schema is up to date' });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
