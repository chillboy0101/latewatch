// app/api/export/monthly/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessEntry, staff as staffTable } from '@/db/schema';
import { and, gte, lte } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { format, eachWeekOfInterval, startOfMonth, endOfMonth, addDays } from 'date-fns';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { year, month } = body;

    if (year === undefined || month === undefined) {
      return NextResponse.json({ error: 'Year and month required' }, { status: 400 });
    }

    const monthStart = startOfMonth(new Date(year, month));
    const monthEnd = endOfMonth(new Date(year, month));
    const weeks = eachWeekOfInterval({ start: monthStart, end: monthEnd });

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Monthly Summary');

    // Add headers
    worksheet.columns = [
      { header: 'Week', key: 'week', width: 25 },
      { header: 'Total Entries', key: 'entries', width: 15 },
      { header: 'Late Count', key: 'late', width: 12 },
      { header: 'Total Amount (GHC)', key: 'amount', width: 20 },
    ];

    // Style header
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF2563EB' },
    };
    worksheet.getRow(1).font = { color: { argb: 'FFFFFFFF' }, bold: true };

    let totalEntries = 0;
    let totalLate = 0;
    let totalAmount = 0;

    for (const weekStart of weeks) {
      const weekEnd = addDays(weekStart, 4); // Friday
      if (weekStart > monthEnd) break;

      const weekStartStr = format(weekStart, 'yyyy-MM-dd');
      const weekEndStr = format(weekEnd, 'yyyy-MM-dd');

      // Fetch entries for this week
      const entries = await db.query.latenessEntry.findMany({
        where: (entry, { and, gte, lte }) =>
          and(
            gte(entry.date, weekStartStr),
            lte(entry.date, weekEndStr)
          ),
      });

      const lateCount = entries.filter((e) => parseFloat(e.computedAmount || '0') > 0).length;
      const weekAmount = entries.reduce((sum, e) => sum + parseFloat(e.computedAmount || '0'), 0);

      worksheet.addRow({
        week: `Week of ${format(weekStart, 'MMM dd')}`,
        entries: entries.length,
        late: lateCount,
        amount: weekAmount,
      });

      totalEntries += entries.length;
      totalLate += lateCount;
      totalAmount += weekAmount;
    }

    // Add totals
    worksheet.addRow({});
    const summaryRow = worksheet.addRow({
      week: 'TOTAL',
      entries: totalEntries,
      late: totalLate,
      amount: totalAmount,
    });
    summaryRow.font = { bold: true };

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Lateness_Monthly_${year}_${month + 1}.xlsx"`,
      },
    });
  } catch (error) {
    console.error('Export failed:', error);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
