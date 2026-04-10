// app/api/entries/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessEntry } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    
    if (!date) {
      return NextResponse.json({ error: 'Date parameter required' }, { status: 400 });
    }
    
    const entries = await db.query.latenessEntry.findMany({
      where: (entry, { eq }) => eq(entry.date, date),
    });
    
    return NextResponse.json(entries);
  } catch (error) {
    console.error('Failed to fetch entries:', error);
    return NextResponse.json({ error: 'Failed to fetch entries' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, entries } = body;
    
    if (!date || !Array.isArray(entries)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    
    const results = [];
    
    for (const entry of entries) {
      const existing = await db.query.latenessEntry.findFirst({
        where: (e, { and, eq }) => and(
          eq(e.staffId, entry.staffId),
          eq(e.date, date)
        ),
      });
      
      let result;
      if (existing) {
        [result] = await db.update(latenessEntry)
          .set({
            arrivalTime: entry.arrivalTime || null,
            didNotSignOut: entry.didNotSignOut,
            computedAmount: entry.amount.toString(),
            reason: entry.reason,
            updatedAt: new Date(),
          })
          .where(eq(latenessEntry.id, existing.id))
          .returning();
      } else {
        [result] = await db.insert(latenessEntry).values({
          staffId: entry.staffId,
          date: date,
          arrivalTime: entry.arrivalTime || null,
          didNotSignOut: entry.didNotSignOut,
          computedAmount: entry.amount.toString(),
          reason: entry.reason,
        }).returning();
      }
      
      results.push(result);
    }
    
    return NextResponse.json({ success: true, count: results.length });
  } catch (error) {
    console.error('Failed to save entries:', error);
    return NextResponse.json({ error: 'Failed to save entries' }, { status: 500 });
  }
}
