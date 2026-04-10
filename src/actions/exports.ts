// actions/exports.ts
'use server';

import { requireRole } from '@/lib/auth/roles';
import { db } from '@/db';
import { latenessEntry, staff as staffTable, workCalendar, auditEvent } from '@/db/schema';
import { eq, and, gte, lte, inArray } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { r2 } from '@/lib/r2/client';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export async function generateWeeklyExport(weekStart: string, weekEnd: string) {
  const user = await requireRole(['admin', 'hr']);
  
  // Get all entries for the week
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
  
  // Get all staff
  const allStaff = await db.query.staff.findMany({
    where: (s, { eq }) => eq(s.active, true),
    orderBy: (s, { asc }) => [asc(s.fullName)],
  });
  
  // Get holidays for the week
  const holidays = await db.query.workCalendar.findMany({
    where: (cal, { and, gte, lte }) =>
      and(
        gte(cal.date, weekStart),
        lte(cal.date, weekEnd),
        eq(cal.isHoliday, true)
      ),
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
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2563EB' },
  };
  worksheet.getRow(1).font = { color: { argb: 'FFFFFFFF' }, bold: true };
  
  // Add data
  const holidayDates = new Set(holidays.map((h) => h.date));
  
  for (const s of allStaff) {
    const staffEntries = entries.filter((e) => e.staffId === s.id);
    
    for (const entry of staffEntries) {
      worksheet.addRow({
        name: s.fullName,
        date: entry.date,
        time: entry.arrivalTime || '',
        amount: parseFloat(entry.computedAmount),
        reason: entry.reason || '',
      });
    }
  }
  
  // Add summary at the bottom
  const totalAmount = entries.reduce((sum, e) => sum + parseFloat(e.computedAmount), 0);
  worksheet.addRow({});
  worksheet.addRow({
    name: 'TOTAL',
    amount: totalAmount,
  }).font = { bold: true };
  
  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  
  // Upload to R2
  const key = `exports/weekly-${weekStart}-${weekEnd}.xlsx`;
  const bufferArray = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.CF_R2_BUCKET,
      Key: key,
      Body: Uint8Array.from(bufferArray),
      ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  );
  
  // Generate presigned URL
  const downloadUrl = await getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: process.env.CF_R2_BUCKET,
      Key: key,
    }),
    { expiresIn: 3600 } // 1 hour
  );
  
  // Audit log
  await db.insert(auditEvent).values({
    entityType: 'export',
    entityId: key,
    action: 'EXPORT',
    beforeJson: null,
    afterJson: { weekStart, weekEnd, totalAmount },
    actorUserId: user.id,
    actorEmail: user.email,
  });
  
  return { downloadUrl, fileName: `Lateness_${weekStart}_${weekEnd}.xlsx` };
}

export async function generateMonthlyExport(year: number, month: number) {
  const user = await requireRole(['admin', 'hr']);
  
  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const monthEnd = new Date(year, month + 1, 0);
  const monthEndStr = monthEnd.toISOString().split('T')[0];
  
  // Get all entries for the month
  const entries = await db.query.latenessEntry.findMany({
    where: (entry, { and, gte, lte }) =>
      and(
        gte(entry.date, monthStart),
        lte(entry.date, monthEndStr)
      ),
    with: {
      staff: true,
    },
    orderBy: (entry, { asc }) => [asc(entry.date), asc(entry.staffId)],
  });
  
  // Create Excel workbook
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Monthly Summary');
  
  // Add summary by week
  worksheet.columns = [
    { header: 'Week', key: 'week', width: 20 },
    { header: 'Total Entries', key: 'entries', width: 15 },
    { header: 'Late Count', key: 'late', width: 12 },
    { header: 'Total Amount (GHC)', key: 'amount', width: 20 },
  ];
  
  // Style header
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2563EB' },
  };
  worksheet.getRow(1).font = { color: { argb: 'FFFFFFFF' }, bold: true };
  
  // Group by week
  const weeks: { [key: string]: typeof entries } = {};
  entries.forEach((entry) => {
    const date = new Date(entry.date);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay() + 1);
    const weekKey = weekStart.toISOString().split('T')[0];
    
    if (!weeks[weekKey]) {
      weeks[weekKey] = [];
    }
    weeks[weekKey].push(entry);
  });
  
  let totalEntries = 0;
  let totalLate = 0;
  let totalAmount = 0;
  
  Object.entries(weeks).forEach(([weekStart, weekEntries]) => {
    const lateCount = weekEntries.filter((e) => parseFloat(e.computedAmount) > 0).length;
    const weekAmount = weekEntries.reduce((sum, e) => sum + parseFloat(e.computedAmount), 0);
    
    worksheet.addRow({
      week: `Week of ${weekStart}`,
      entries: weekEntries.length,
      late: lateCount,
      amount: weekAmount,
    });
    
    totalEntries += weekEntries.length;
    totalLate += lateCount;
    totalAmount += weekAmount;
  });
  
  // Add totals
  worksheet.addRow({});
  worksheet.addRow({
    week: 'TOTAL',
    entries: totalEntries,
    late: totalLate,
    amount: totalAmount,
  }).font = { bold: true };
  
  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  
  // Upload to R2
  const key = `exports/monthly-${year}-${month}.xlsx`;
  const bufferArray = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.CF_R2_BUCKET,
      Key: key,
      Body: Uint8Array.from(bufferArray),
      ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  );
  
  // Generate presigned URL
  const downloadUrl = await getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: process.env.CF_R2_BUCKET,
      Key: key,
    }),
    { expiresIn: 3600 } // 1 hour
  );
  
  // Audit log
  await db.insert(auditEvent).values({
    entityType: 'export',
    entityId: key,
    action: 'EXPORT',
    beforeJson: null,
    afterJson: { year, month, totalEntries, totalAmount },
    actorUserId: user.id,
    actorEmail: user.email,
  });
  
  return { downloadUrl, fileName: `Lateness_Monthly_${year}_${month}.xlsx` };
}
