// Run once to add display_order column to staff table
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await db.execute(sql`ALTER TABLE staff ADD COLUMN display_order INTEGER`);
    return NextResponse.json({ message: 'display_order column added' });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
