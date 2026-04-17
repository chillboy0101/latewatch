// app/api/staff/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { staff } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { publishRealtime } from '@/lib/realtime';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const [result] = await db.select().from(staff).where(eq(staff.id, id));

    if (!result) {
      return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to fetch staff member:', error);
    return NextResponse.json({ error: 'Failed to fetch staff member' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { fullName, department, unit, active } = body;

    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (fullName !== undefined) updateData.fullName = fullName;
    if (department !== undefined) updateData.department = department;
    if (unit !== undefined) updateData.unit = unit;
    if (active !== undefined) updateData.active = active;

    const updated = await db.update(staff)
      .set(updateData)
      .where(eq(staff.id, id))
      .returning();

    if (!updated.length) {
      return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });
    }

    publishRealtime('dashboard', 'invalidate', { reason: 'staff' });

    return NextResponse.json(updated[0]);
  } catch (error) {
    console.error('Failed to update staff member:', error);
    return NextResponse.json({ error: 'Failed to update staff member' }, { status: 500 });
  }
}