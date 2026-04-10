// app/api/export/weekly/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessEntry, staff as staffTable } from '@/db/schema';
import { and, gte, lte } from 'drizzle-orm';
import ExcelJS from 'exceljs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { weekStart, weekEnd } = body;

    if (!weekStart || !weekEnd) {
      return NextResponse.json({ error: 'Week start and end required' }, { status: 400 });
    }

    // Fetch all entries for the week
    const entries = await db.query.latenessEntry.findMany({
      where: (entry, { and, gte, lte }) =>
        and(
          gte(entry.date, weekStart),
          lte(entry.date, weekEnd)
        ),
      with: {
        staff: true,
      },
      orderBy: (entry, { asc }) => [asc(entry.date), asc(entry.staffId)],
    });

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Lateness Book');

    // Add headers
    worksheet.columns = [
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Arrival Time', key: 'time', width: 12 },
      { header: 'Amount (GHC)', key: 'amount', width: 15 },
      { header: 'Reason', key: 'reason', width: 45 },
    ];

    // Style header
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF2563EB' },
    };
    worksheet.getRow(1).font = { color: { argb: 'FFFFFFFF' }, bold: true };

    // Add data
    for (const entry of entries) {
      worksheet.addRow({
        name: entry.staff?.fullName || 'Unknown',
        date: entry.date,
        time: entry.arrivalTime || '',
        amount: parseFloat(entry.computedAmount || '0'),
        reason: entry.reason || '',
      });
    }

    // Add summary
    const totalAmount = entries.reduce((sum, e) => sum + parseFloat(e.computedAmount || '0'), 0);
    worksheet.addRow({});
    const summaryRow = worksheet.addRow({
      name: 'TOTAL',
      amount: totalAmount,
    });
    summaryRow.font = { bold: true };

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Lateness_${weekStart}_${weekEnd}.xlsx"`,
      },
    });
  } catch (error) {
    console.error('Export failed:', error);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
