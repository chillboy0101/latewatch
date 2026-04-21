// app/api/staff/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { staff, auditEvent } from '@/db/schema';
import { asc, eq } from 'drizzle-orm';
import { publishRealtime } from '@/lib/realtime';
import { currentUser } from '@clerk/nextjs/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const staffList = await db.select({
      id: staff.id,
      fullName: staff.fullName,
      displayOrder: staff.displayOrder,
      active: staff.active,
      department: staff.department,
      unit: staff.unit,
      createdAt: staff.createdAt,
      updatedAt: staff.updatedAt,
    })
    .from(staff)
    .orderBy(asc(staff.displayOrder), asc(staff.fullName));

    return NextResponse.json(staffList, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });
  } catch (error) {
    console.error('Failed to fetch staff:', error);
    return NextResponse.json({ error: 'Failed to fetch staff' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    let actorEmail = 'system';
    let actorUserId: string | undefined = undefined;
    try {
      const user = await currentUser();
      if (user) {
        actorEmail = user.emailAddresses[0]?.emailAddress || 'unknown';
        actorUserId = user.id;
      }
    } catch {
      // continue without auth info
    }

    const body = await request.json();
    const { fullName, department, unit } = body;

    if (!fullName) {
      return NextResponse.json({ error: 'Full name is required' }, { status: 400 });
    }

    const newStaff = await db.insert(staff).values({
      fullName,
      department,
      unit,
    }).returning();

    await db.insert(auditEvent).values({
      entityType: 'staff',
      entityId: newStaff[0].id,
      action: 'CREATE',
      beforeJson: null,
      afterJson: newStaff[0],
      actorUserId: actorUserId ?? null,
      actorEmail,
    });

    publishRealtime('dashboard', 'invalidate', { reason: 'staff' });

    return NextResponse.json(newStaff[0]);
  } catch (error) {
    console.error('Failed to create staff:', error);
    return NextResponse.json({ error: 'Failed to create staff' }, { status: 500 });
  }
}
