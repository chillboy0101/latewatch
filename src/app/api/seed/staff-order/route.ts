// one-time seed script to set displayOrder on all staff to match LATENESS BOOK order
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { staff } from '@/db/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const STAFF_ORDER = [
  'CHARLES DODGATSE',
  'EYRAM MENSAH-GBAGBO',
  'ANNA-LISA E. A. HAMMOND',
  'CLAUDE KWASI BOADI',
  'EUNICE TWENEBOAA ADU',
  'ESTHER ADJOKOR ADJEI',
  'RAPHAELADJEI MENSAH',
  'DENNIS AKUETTEH ARYEETEY',
  'DANIEL ASARE KWARTENG',
  'WISDOM KOFI DATSOMOR',
  'CARL CHRISTIAN QUIST',
  'LISABETH SYBIL ADDAIH',
  'ELEAZAR KWABENA TJ',
  'REGINA ALLOTEY',
  'EMMANUEL CHUKWUDI',
];

export async function POST() {
  try {
    const results: string[] = [];
    for (let i = 0; i < STAFF_ORDER.length; i++) {
      const result = await db.update(staff)
        .set({ displayOrder: i + 1 })
        .where(eq(staff.fullName, STAFF_ORDER[i]))
        .returning({ id: staff.id, fullName: staff.fullName });
      if (result.length > 0) {
        results.push(`✓ ${STAFF_ORDER[i]} → ${i + 1}`);
      } else {
        results.push(`✗ not found: ${STAFF_ORDER[i]}`);
      }
    }
    return NextResponse.json({ message: 'Done', results });
  } catch (error) {
    console.error('Seed failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
