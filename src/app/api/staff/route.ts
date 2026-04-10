// app/api/staff/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { staff } from '@/db/schema';

export async function GET() {
  try {
    const staffList = await db.query.staff.findMany({
      orderBy: (s, { asc }) => [asc(s.fullName)],
    });
    
    return NextResponse.json(staffList);
  } catch (error) {
    console.error('Failed to fetch staff:', error);
    return NextResponse.json({ error: 'Failed to fetch staff' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
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
    
    return NextResponse.json(newStaff[0]);
  } catch (error) {
    console.error('Failed to create staff:', error);
    return NextResponse.json({ error: 'Failed to create staff' }, { status: 500 });
  }
}
